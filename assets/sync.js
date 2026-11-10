// Verwaltung lokal bearbeiten, später „Synchronisieren“.
// Legt sich um EHFY_DB: Änderungen landen zuerst auf dem Gerät (IndexedDB) und in einer Warteschlange.
// Erst der Abgleich schickt sie zur Datenbank und holt den neuen Stand (auch vom anderen Gerät).
// Rechnungsnummern vergibt immer die Datenbank; ohne Internet entsteht ein Entwurf ohne Nummer.
(function () {
  const remote = window.EHFY_DB;
  const FLAG = "ehfy-admin-ok";

  // ---------- Speicher auf dem Gerät ----------
  let idb = null;
  const memory = new Map();
  const opened = new Promise(resolve => {
    try {
      const req = indexedDB.open("ehfy-verwaltung", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => { idb = req.result; resolve(); };
      req.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
  function tx(mode, run) {
    return new Promise((resolve, reject) => {
      const req = run(idb.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const kvGet = k => (idb ? tx("readonly", s => s.get(k)) : Promise.resolve(memory.get(k)));
  const kvPut = (k, v) => (idb ? tx("readwrite", s => s.put(v, k)) : Promise.resolve(memory.set(k, v)));
  const kvClear = () => (idb ? tx("readwrite", s => s.clear()) : Promise.resolve(memory.clear()));

  // ---------- Zustand ----------
  const empty = () => ({ courses: [], regs: [], invoices: [], settings: {}, lastSync: null });
  let state = empty();
  let outbox = [];
  let syncing = false;
  let lastError = "";
  let newRegs = 0;

  const scope = window.EHFY_CONFIG.supabaseUrl || "demo";
  const ready = opened.then(async () => {
    if ((await kvGet("scope").catch(() => null)) !== scope) {
      await kvClear().catch(() => {});
      await kvPut("scope", scope).catch(() => {});
      localStorage.removeItem(FLAG);
    }
    state = (await kvGet("state").catch(() => null)) || empty();
    outbox = (await kvGet("outbox").catch(() => null)) || [];
  });
  const persist = () => Promise.all([kvPut("state", state), kvPut("outbox", outbox)]).catch(() => {});

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
  const isOnline = () => navigator.onLine && !window.__ehfyOffline;
  const isNetError = e => /fetch|network|load failed|offline/i.test((e && e.message) || "");
  const stripCourse = ({ booked, registrations, ...row }) => row;

  function status() {
    return { live: remote.live, online: isOnline(), pending: outbox.length, lastSync: state.lastSync, syncing, remoteHint, error: lastError, newRegs };
  }
  let remoteHint = false;
  function notify() { window.dispatchEvent(new CustomEvent("ehfy-sync", { detail: status() })); }
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);

  // ---------- Änderungen: jede wirkt sofort lokal und wartet dann auf „Synchronisieren“ ----------
  function applyOp(s, op) {
    const upsert = (list, row) => {
      const i = list.findIndex(x => x.id === row.id);
      if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
    };
    if (op.type === "course-put") upsert(s.courses, op.row);
    if (op.type === "course-del") { s.courses = s.courses.filter(c => c.id !== op.id); s.regs = s.regs.filter(r => r.course_id !== op.id); }
    if (op.type === "reg-put") upsert(s.regs, op.row);
    if (op.type === "reg-patch") { const r = s.regs.find(x => x.id === op.id); if (r) Object.assign(r, op.patch); }
    if (op.type === "reg-del") s.regs = s.regs.filter(r => r.id !== op.id);
    if (op.type === "inv-draft") upsert(s.invoices, op.row);
    if (op.type === "inv-status") {
      const inv = s.invoices.find(x => x.id === op.id);
      if (inv) { inv.status = op.status; inv.paid_on = op.status === "bezahlt" ? new Date().toISOString().slice(0, 10) : null; }
    }
    if (op.type === "settings") s.settings = op.value;
  }
  function queue(op) {
    // Mehrere Änderungen am selben Eintrag zusammenfassen
    if (op.type === "course-put") outbox = outbox.filter(o => !(o.type === "course-put" && o.row.id === op.row.id));
    if (op.type === "settings") outbox = outbox.filter(o => o.type !== "settings");
    if (op.type === "course-del") {
      const regIds = state.regs.filter(r => r.course_id === op.id).map(r => r.id);
      outbox = outbox.filter(o => !((o.type === "course-put" && o.row.id === op.id) || (o.row && o.row.course_id === op.id) || (o.type.startsWith("reg-") && regIds.includes(o.id))));
    }
    if (op.type === "reg-del") outbox = outbox.filter(o => !((o.type === "reg-put" && o.row.id === op.id) || (o.type === "reg-patch" && o.id === op.id)));
    if (op.type === "reg-patch") {
      const pending = outbox.find(o => o.type === "reg-put" && o.row.id === op.id);
      if (pending) { Object.assign(pending.row, op.patch); applyOp(state, op); return finish(); }
    }
    outbox.push(op);
    applyOp(state, op);
    return finish();
  }
  async function finish() { lastError = ""; await persist(); notify(); }

  async function pushOp(op) {
    if (op.type === "course-put") return remote.putCourse(op.row);
    if (op.type === "course-del") return remote.deleteCourse(op.id);
    if (op.type === "reg-put") return remote.putRegistration(op.row);
    if (op.type === "reg-patch") return remote.updateRegistration(op.id, op.patch);
    if (op.type === "reg-del") return remote.deleteRegistration(op.id);
    if (op.type === "inv-status") return remote.setInvoiceStatus(op.id, op.status);
    if (op.type === "settings") return remote.saveSettings(op.value);
    if (op.type === "inv-draft") {
      const { id, number, draft, seq, year, total, ...d } = op.row;
      const real = await remote.createInvoice(d);
      // Entwurf durch den Beleg mit echter Nummer ersetzen
      state.invoices = state.invoices.filter(i => i.id !== id);
      state.invoices.push(real);
      for (const o of outbox) if (o.type === "inv-status" && o.id === id) o.id = real.id;
    }
  }

  // Stand aus der Datenbank holen; noch nicht übertragene Änderungen bleiben darüber liegen
  async function pull() {
    if (!isOnline() || syncing) return;
    const [courses, regs, invoices, settings] = await Promise.all([
      remote.listCourses(), remote.listAllRegistrations(), remote.listAllInvoices(), remote.getSettings()
    ]);
    const next = { courses: courses.map(stripCourse), regs, invoices, settings: settings || {}, lastSync: new Date().toISOString() };
    // Neue Anmeldungen seit dem letzten Stand zählen
    if (state.lastSync) {
      const known = new Set(state.regs.map(r => r.id));
      newRegs += regs.filter(r => !known.has(r.id) && r.message !== "manuell eingetragen").length;
    }
    outbox.forEach(op => applyOp(next, op));
    state = next;
    remoteHint = false;
    await persist();
    notify();
  }

  async function sync() {
    if (syncing) return;
    if (!isOnline()) { lastError = "Keine Internetverbindung. Deine Änderungen bleiben auf diesem Gerät gespeichert."; notify(); throw new Error(lastError); }
    syncing = true; lastError = ""; notify();
    try {
      while (outbox.length) {
        await pushOp(outbox[0]);
        outbox.shift();
        await persist();
        notify();
      }
      syncing = false;
      await pull();
    } catch (e) {
      lastError = e.message;
      throw e;
    } finally {
      syncing = false;
      notify();
    }
  }

  // ---------- Dieselbe Schnittstelle wie EHFY_DB ----------
  window.EHFY_DB = {
    live: remote.live,
    status, sync, isOnline, pull,
    clearNew() { newRegs = 0; notify(); },
    savePushSubscription: (s, d) => remote.savePushSubscription(s, d),
    // Nächste Sehtest-Nummer: nur mit Internet (die Datenbank vergibt die Nummern)
    getNextSehtestNr: () => remote.getNextSehtestNr(),
    setNextSehtestNr: nr => remote.setNextSehtestNr(nr),
    // QR-Schlüssel für die Selbsteintragung: nur mit Internet
    async checkinToken(courseId, renew) {
      await ready;
      if (!isOnline()) throw new Error("Für den QR-Code braucht es einmal Internet.");
      if (outbox.some(o => o.type === "course-put" && o.row.id === courseId)) await sync();
      return remote.checkinToken(courseId, renew);
    },
    async checkinGeneralToken(renew) {
      await ready;
      if (!isOnline()) throw new Error("Für den QR-Code braucht es einmal Internet.");
      return remote.checkinGeneralToken(renew);
    },
    // Nummer ändern, spätere rücken nach: nur mit Internet, danach den neuen Stand holen
    async renumberSehtest(id, nr) {
      await ready;
      if (!isOnline()) throw new Error("Dafür braucht es Internet.");
      if (outbox.length) await sync();
      const list = await remote.renumberSehtest(id, nr);
      await pull();
      return list;
    },
    removePushSubscription: e => remote.removePushSubscription(e),
    isPending: id => outbox.some(o => (o.row && o.row.id === id) || o.id === id || (o.row && o.row.course_id === id)),

    async hasSession() {
      await ready;
      const known = localStorage.getItem(FLAG) === "1";
      if (!isOnline()) return known;
      let ok;
      try { ok = await remote.hasSession(); }
      catch (e) { if (isNetError(e)) return known; throw e; }
      if (!ok) { localStorage.removeItem(FLAG); return false; }
      localStorage.setItem(FLAG, "1");
      // Beim Öffnen wird nichts abgeglichen. Nur ein neues Gerät ohne Daten holt einmal den Stand.
      if (!state.lastSync) await pull().catch(() => {});
      return true;
    },
    async signIn(email, password) {
      await ready;
      await remote.signIn(email, password);
      localStorage.setItem(FLAG, "1");
      await pull().catch(() => {});
    },
    async signOut() {
      if (outbox.length && !confirm(`${outbox.length} Änderung(en) sind noch nicht online und gehen beim Abmelden verloren. Trotzdem abmelden?`)) return;
      localStorage.removeItem(FLAG);
      outbox = []; state = empty();
      await kvClear().catch(() => {});
      if (isOnline()) await remote.signOut();
    },

    // Termine
    async listCourses() {
      await ready;
      return state.courses.slice()
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
        .map(c => ({ ...c, booked: state.regs.filter(r => r.course_id === c.id && r.status !== "storniert").length }));
    },
    async saveCourse(c) {
      const row = { ...stripCourse(c), id: c.id || uid() };
      await queue({ type: "course-put", row });
      return row;
    },
    async deleteCourse(id) { await queue({ type: "course-del", id }); },

    // Teilnehmer
    // Alles für die Sicherung; vorher den aktuellen Stand holen
    async backupData() {
      await ready;
      if (isOnline()) await pull();
      return { courses: state.courses, registrations: state.regs, invoices: state.invoices, settings: state.settings || {} };
    },
    // Alte Teilnehmer direkt in die Datenbank; danach den neuen Stand holen
    async importLegacy(courses, regs, progress) {
      await ready;
      if (!isOnline()) throw new Error("Für den Import braucht es Internet.");
      await remote.importLegacy(courses, regs, progress);
      await pull();
      newRegs = 0;
      notify();
    },
    async listAllRegistrations() { await ready; return state.regs.map(r => ({ ...r })); },
    async listRegistrations(courseId) { await ready; return state.regs.filter(r => r.course_id === courseId).map(r => ({ ...r })); },
    async addRegistration(r) {
      const row = { id: uid(), status: "angemeldet", created_at: new Date().toISOString(), ...r };
      await queue({ type: "reg-put", row });
      return { ...row };
    },
    async updateRegistration(id, patch) { await queue({ type: "reg-patch", id, patch }); },
    // Nur mit Internet: z. B. eine Protokoll-Nummer von Hand ändern. Klappt es nicht (Nummer schon vergeben),
    // bleibt nichts in der Warteschlange hängen.
    async updateRegistrationOnline(id, patch) {
      await ready;
      if (!isOnline()) throw new Error("Dafür braucht es Internet.");
      if (outbox.some(o => (o.type === "reg-put" && o.row.id === id) || (o.type === "reg-patch" && o.id === id))) await sync();
      const row = await remote.updateRegistration(id, patch);
      const r = state.regs.find(x => x.id === id);
      if (r) Object.assign(r, patch, row ? { sehtest_nr: row.sehtest_nr, sehtest_nr_at: row.sehtest_nr_at } : {});
      await finish();
      return row;
    },
    // Wie oben, aber mit Internet sofort online (für Nummern, die nur die Datenbank vergibt).
    // Ohne Internet wartet die Änderung wie gewohnt auf „Synchronisieren“.
    async updateRegistrationNow(id, patch) {
      await queue({ type: "reg-patch", id, patch });
      if (!isOnline() || syncing) return false;
      try {
        if (outbox.some(o => o.type === "reg-put" && o.row.id === id)) { await sync(); return true; }
        for (const op of outbox.filter(o => o.type === "reg-patch" && o.id === id)) {
          const row = await remote.updateRegistration(id, op.patch);
          outbox = outbox.filter(o => o !== op);
          const r = state.regs.find(x => x.id === id);
          if (r && row) Object.assign(r, { sehtest_nr: row.sehtest_nr, sehtest_nr_at: row.sehtest_nr_at });
        }
        await finish();
        return true;
      } catch (e) { if (!isNetError(e)) throw e; return false; }
    },
    async deleteRegistration(id) { await queue({ type: "reg-del", id }); },

    // Bankverbindung
    async getSettings() { await ready; return state.settings || {}; },
    async saveSettings(value) { await queue({ type: "settings", value }); },

    // Vorlagen: zum Hochladen braucht es Internet, danach gehen sie auch offline
    async getTemplate(key) {
      await ready;
      if (isOnline()) {
        try {
          const bytes = await remote.getTemplate(key);
          if (bytes) { await kvPut("tpl-" + key, bytes).catch(() => {}); return bytes; }
          return null;
        } catch (e) { /* unten aus dem Gerät lesen */ }
      }
      return (await kvGet("tpl-" + key).catch(() => null)) || null;
    },
    async saveTemplate(key, file) {
      if (!isOnline()) throw new Error("Vorlagen lassen sich nur mit Internet hochladen.");
      await remote.saveTemplate(key, file);
      await kvPut("tpl-" + key, new Uint8Array(await file.arrayBuffer())).catch(() => {});
    },

    async removeTemplate(key) {
      if (!isOnline()) throw new Error("Dateien lassen sich nur mit Internet entfernen.");
      await remote.removeTemplate(key);
      await kvPut("tpl-" + key, null).catch(() => {});
    },

    // Rechnungen und Quittungen
    async listInvoices(year) { await ready; return state.invoices.filter(i => i.year === year).sort((a, b) => b.seq - a.seq); },
    async invoicesForRegistrations(ids) { await ready; return state.invoices.filter(i => ids.includes(i.registration_id) && i.status !== "storniert"); },
    async createInvoice(d) {
      await ready;
      if (isOnline()) {
        try {
          // Gehört der Beleg zu einem neuen Teilnehmer, muss der zuerst online sein
          if (d.registration_id && outbox.some(o => o.type === "reg-put" && o.row.id === d.registration_id)) await sync();
          const inv = await remote.createInvoice(d);
          state.invoices.push(inv);
          await persist();
          notify();
          return inv;
        } catch (e) { if (!isNetError(e)) throw e; }
      }
      const issued = d.issued_on || new Date().toISOString().slice(0, 10);
      const row = {
        ...d, id: uid(), draft: true, number: "ENTWURF", year: Number(issued.slice(0, 4)), seq: 1e9 + outbox.length, issued_on: issued,
        total: Math.round(d.items.reduce((s, i) => s + i.qty * i.price, 0) * 100) / 100
      };
      await queue({ type: "inv-draft", row });
      return row;
    },
    async setInvoiceStatus(id, status) {
      const draft = outbox.find(o => o.type === "inv-draft" && o.row.id === id);
      if (draft) { draft.row.status = status; }
      await (draft ? (applyOp(state, { type: "inv-status", id, status }), finish()) : queue({ type: "inv-status", id, status }));
    },
    async sendInvoiceMail(m) {
      if (!isOnline()) throw new Error("Zum Versenden braucht es Internet.");
      const res = await remote.sendInvoiceMail(m);
      const inv = state.invoices.find(i => i.id === m.invoice_id);
      if (inv) { inv.sent_at = new Date().toISOString(); inv.sent_to = m.to; await persist(); }
      return res;
    }
  };

  // Neue Anmeldungen holen: beim Zurückkehren in die App, jede Minute und bei einer Push-Mitteilung
  // Kein automatischer Abgleich: Eine Push-Mitteilung setzt nur den Hinweis, abgeglichen wird per Knopf
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => { if (ev.data === "neue-anmeldung") { remoteHint = true; notify(); } });
})();
