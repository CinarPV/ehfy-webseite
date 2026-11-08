// Datenzugriff: Supabase (live) oder Demo-Modus (nur im eigenen Browser).
(function () {
  const cfg = window.EHFY_CONFIG;
  const live = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);

  if (!live) {
    const banner = document.createElement("div");
    banner.className = "demo-banner";
    banner.textContent = "Demo-Modus: Termine und Anmeldungen werden nur in diesem Browser gespeichert. (Admin-Passwort: demo)";
    document.body.prepend(banner);
  }

  const countBooked = regs => regs.filter(r => r.status !== "storniert").length;
  const hoursUntil = iso => (new Date(iso) - Date.now()) / 36e5;

  // ---------- Live (Supabase) ----------
  function liveApi() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const check = ({ data, error }) => {
      if (error) throw new Error(error.message || "Unbekannter Fehler");
      return data;
    };
    // Die Datenbank liefert höchstens 1000 Zeilen je Abruf, darum seitenweise holen
    const fetchAll = async build => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const page = check(await build().range(from, from + 999));
        out.push(...page);
        if (page.length < 1000) return out;
      }
    };
    return {
      live: true,
      async getOpenCourses() {
        return check(await sb.rpc("get_open_courses"));
      },
      async register(d) {
        return check(await sb.rpc("register_for_course", {
          p_course_id: d.course_id, p_first_name: d.first_name, p_last_name: d.last_name,
          p_birth_date: d.birth_date || null, p_email: d.email, p_phone: d.phone,
          p_street: d.street ?? null, p_zip: d.zip ?? null, p_city: d.city ?? null,
          p_package: d.package, p_message: d.message
        }));
      },
      async getRegistration(token) {
        return check(await sb.rpc("get_registration", { p_token: token }));
      },
      async cancelRegistration(token) {
        return check(await sb.rpc("cancel_registration", { p_token: token }));
      },
      // Admin
      async signIn(email, password) {
        check(await sb.auth.signInWithPassword({ email, password }));
        const isAdmin = check(await sb.rpc("is_admin"));
        if (!isAdmin) { await sb.auth.signOut(); throw new Error("Dieses Konto hat keine Verwaltungsrechte."); }
      },
      async signOut() { await sb.auth.signOut(); },
      async hasSession() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return false;
        return Boolean(check(await sb.rpc("is_admin")));
      },
      async listCourses() {
        const rows = check(await sb.from("courses").select("*, registrations(status)").order("starts_at", { ascending: true }));
        return rows.map(c => ({ ...c, booked: countBooked(c.registrations || []), registrations: undefined }));
      },
      async saveCourse(c) {
        const row = { ...c };
        delete row.booked;
        if (row.id) return check(await sb.from("courses").update(row).eq("id", row.id).select().single());
        delete row.id;
        return check(await sb.from("courses").insert(row).select().single());
      },
      async deleteCourse(id) { check(await sb.from("courses").delete().eq("id", id)); },
      async listRegistrations(courseId) {
        return check(await sb.from("registrations").select("*").eq("course_id", courseId).order("created_at"));
      },
      async addRegistration(r) {
        check(await sb.from("registrations").insert(r));
      },
      // Geräte für Push-Mitteilungen
      async savePushSubscription(subscription, device) {
        check(await sb.from("push_subscriptions").upsert({ endpoint: subscription.endpoint, subscription, device }));
      },
      async removePushSubscription(endpoint) {
        check(await sb.from("push_subscriptions").delete().eq("endpoint", endpoint));
      },
      // Für den Abgleich der Verwaltung (assets/sync.js)
      async putCourse(row) { check(await sb.from("courses").upsert(row)); },
      async putRegistration(row) { check(await sb.from("registrations").upsert(row)); },
      async listAllRegistrations() { return fetchAll(() => sb.from("registrations").select("*").order("created_at").order("id")); },
      async listAllInvoices() { return fetchAll(() => sb.from("invoices").select("*").order("seq", { ascending: false }).order("id")); },
      // Alte Teilnehmer: vorhandene Einträge bleiben unverändert
      async importLegacy(courses, regs, progress) {
        for (let i = 0; i < courses.length; i += 200) check(await sb.from("courses").upsert(courses.slice(i, i + 200), { ignoreDuplicates: true }));
        for (let i = 0; i < regs.length; i += 200) {
          check(await sb.from("registrations").upsert(regs.slice(i, i + 200), { ignoreDuplicates: true }));
          if (progress) progress(Math.min(i + 200, regs.length));
        }
      },
      async updateRegistration(id, patch) {
        // Gibt die gespeicherte Zeile zurück (z. B. mit der von der Datenbank vergebenen Sehtest-Nummer)
        return check(await sb.from("registrations").update(patch).eq("id", id).select("id, sehtest_nr, sehtest_nr_at").maybeSingle());
      },
      async deleteRegistration(id) { check(await sb.from("registrations").delete().eq("id", id)); },
      // Bankverbindung und Steuernummer (nur für das Verwaltungs-Konto lesbar)
      async getSettings() {
        const row = check(await sb.from("app_settings").select("value").eq("key", "issuer").maybeSingle());
        return (row && row.value) || {};
      },
      async saveSettings(value) {
        check(await sb.from("app_settings").upsert({ key: "issuer", value }));
      },
      // Vorlagen (privater Speicher)
      async getTemplate(key) {
        const { data, error } = await sb.storage.from("vorlagen").download(key + ".pdf");
        if (error) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
      async saveTemplate(key, file) {
        check(await sb.storage.from("vorlagen").upload(key + ".pdf", file, { upsert: true, contentType: "application/pdf" }));
      },
      async removeTemplate(key) {
        check(await sb.storage.from("vorlagen").remove([key + ".pdf"]));
      },
      // Rechnungen und Quittungen
      async listInvoices(year) {
        return check(await sb.from("invoices").select("*").eq("year", year).order("seq", { ascending: false }));
      },
      async invoicesForRegistrations(ids) {
        if (!ids.length) return [];
        return check(await sb.from("invoices").select("*").in("registration_id", ids).neq("status", "storniert"));
      },
      async createInvoice(d) {
        return check(await sb.rpc("create_invoice", {
          p_type: d.type, p_registration_id: d.registration_id || null, p_recipient: d.recipient, p_items: d.items,
          p_issued_on: d.issued_on, p_service_date: d.service_date || null, p_payment: d.payment, p_status: d.status
        }));
      },
      async setInvoiceStatus(id, status) {
        check(await sb.from("invoices").update({ status, paid_on: status === "bezahlt" ? new Date().toISOString().slice(0, 10) : null }).eq("id", id));
      },
      // Beleg direkt über dein Postfach info@ehfy.de senden (Funktion "beleg-mail")
      async sendInvoiceMail(m) {
        const { data, error } = await sb.functions.invoke("beleg-mail", { body: m });
        if (error) {
          let msg = error.message;
          try { msg = (await error.context.json()).error || msg; } catch (e) { /* Standardtext */ }
          throw new Error(msg);
        }
        return data;
      }
    };
  }

  // ---------- Demo (localStorage) ----------
  function demoApi() {
    const KEY = "ehfy-demo-v5";
    let memory = null;
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

    const seed = () => ({ courses: [], regs: [] });
    function load() {
      // Immer frisch lesen: Eine Anmeldung aus einem anderen Tab soll beim Aktualisieren erscheinen
      try { memory = JSON.parse(localStorage.getItem(KEY)) || memory; } catch (e) { /* bleibt im Speicher */ }
      if (!memory) { memory = seed(); save(); }
      return memory;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (e) { /* nur im Speicher */ } }
    const withBooked = (db, c) => ({ ...c, booked: countBooked(db.regs.filter(r => r.course_id === c.id)) });
    const byDate = (a, b) => new Date(a.starts_at) - new Date(b.starts_at);
    const authKey = "ehfy-demo-admin";

    return {
      live: false,
      async getOpenCourses() {
        const db = load();
        return db.courses.filter(c => c.status === "offen" && new Date(c.starts_at) > new Date())
          .sort(byDate).map(c => { const { address, ...rest } = withBooked(db, c); return rest; });
      },
      async register(d) {
        const db = load();
        const c = db.courses.find(x => x.id === d.course_id);
        if (!c || c.status !== "offen" || new Date(c.starts_at) <= new Date()) throw new Error("Dieser Termin ist nicht mehr buchbar.");
        if (!c.online_booking) throw new Error("Für diesen Termin ist nur eine telefonische Anmeldung möglich.");
        if (withBooked(db, c).booked >= c.capacity) throw new Error("Dieser Termin ist leider ausgebucht.");
        const r = { id: uid(), ...d, status: "angemeldet", cancel_token: uid(), created_at: new Date().toISOString(), cancelled_at: null };
        db.regs.push(r); save();
        return { cancel_token: r.cancel_token, starts_at: c.starts_at, ends_at: c.ends_at, location: c.location, address: c.address };
      },
      async getRegistration(token) {
        const db = load();
        const r = db.regs.find(x => x.cancel_token === token);
        if (!r) throw new Error("Anmeldung nicht gefunden. Bitte prüfe deinen Link.");
        const c = db.courses.find(x => x.id === r.course_id);
        return { first_name: r.first_name, last_name: r.last_name, status: r.status, package: r.package, starts_at: c.starts_at, ends_at: c.ends_at, location: c.location, course_status: c.status };
      },
      async cancelRegistration(token) {
        const db = load();
        const r = db.regs.find(x => x.cancel_token === token);
        if (!r) throw new Error("Anmeldung nicht gefunden. Bitte prüfe deinen Link.");
        if (r.status !== "angemeldet") throw new Error("Diese Anmeldung wurde bereits storniert.");
        const c = db.courses.find(x => x.id === r.course_id);
        if (new Date(c.starts_at) <= new Date()) throw new Error("Der Kurs hat bereits begonnen. Bitte melde dich telefonisch.");
        r.status = "storniert"; r.cancelled_at = new Date().toISOString(); save();
        return { late: hoursUntil(c.starts_at) < cfg.cancelHours, starts_at: c.starts_at };
      },
      async signIn(email, password) {
        if (password !== "demo") throw new Error("Falsches Passwort. (Demo-Passwort: demo)");
        try { sessionStorage.setItem(authKey, "1"); } catch (e) { /* egal */ }
        this._authed = true;
      },
      async signOut() { try { sessionStorage.removeItem(authKey); } catch (e) { /* egal */ } this._authed = false; },
      async hasSession() {
        try { return this._authed || sessionStorage.getItem(authKey) === "1"; } catch (e) { return Boolean(this._authed); }
      },
      async listCourses() { const db = load(); return db.courses.slice().sort(byDate).map(c => withBooked(db, c)); },
      async saveCourse(c) {
        const db = load();
        const row = { ...c }; delete row.booked;
        if (row.id) { const i = db.courses.findIndex(x => x.id === row.id); db.courses[i] = { ...db.courses[i], ...row }; }
        else { row.id = uid(); db.courses.push(row); }
        save(); return row;
      },
      async deleteCourse(id) { const db = load(); db.courses = db.courses.filter(c => c.id !== id); db.regs = db.regs.filter(r => r.course_id !== id); save(); },
      async listRegistrations(courseId) { return load().regs.filter(r => r.course_id === courseId); },
      async savePushSubscription() { /* im Demo-Modus nur Test-Mitteilung */ },
      async removePushSubscription() { },
      async putCourse(row) {
        const db = load(), i = db.courses.findIndex(c => c.id === row.id);
        if (i >= 0) db.courses[i] = { ...db.courses[i], ...row }; else db.courses.push(row);
        save();
      },
      async putRegistration(row) {
        const db = load(), i = db.regs.findIndex(r => r.id === row.id);
        const full = { status: "angemeldet", cancel_token: uid(), created_at: new Date().toISOString(), cancelled_at: null, ...row };
        if (i >= 0) db.regs[i] = { ...db.regs[i], ...row }; else db.regs.push(full);
        // Wie in der Datenbank: Sehtest-Nummer beim ersten Ergebnis
        const r = db.regs.find(x => x.id === row.id);
        if (r.sehtest_passed != null && !r.sehtest_nr) r.sehtest_nr = `S${String(new Date().getFullYear()).slice(2)}-${String(db.regs.filter(x => x.sehtest_nr).length + 1).padStart(3, "0")}`;
        save();
      },
      async listAllRegistrations() { return load().regs.map(r => ({ ...r })); },
      async importLegacy(courses, regs, progress) {
        const db = load();
        for (const c of courses) if (!db.courses.some(x => x.id === c.id)) db.courses.push(c);
        for (const r of regs) if (!db.regs.some(x => x.id === r.id)) db.regs.push({ cancel_token: uid(), cancelled_at: null, ...r });
        save();
        if (progress) progress(regs.length);
      },
      async listAllInvoices() { return (load().invoices || []).map(i => ({ ...i })); },
      async addRegistration(r) {
        const db = load();
        db.regs.push({ id: uid(), status: "angemeldet", cancel_token: uid(), created_at: new Date().toISOString(), cancelled_at: null, ...r });
        save();
      },
      async updateRegistration(id, patch) {
        const db = load(), r = db.regs.find(x => x.id === id);
        const first = r.sehtest_passed == null;
        Object.assign(r, patch);
        // Wie in der Datenbank: Nummer erst beim ersten Ergebnis
        if (r.sehtest_passed != null && !r.sehtest_nr && first) {
          const n = db.regs.filter(x => x.sehtest_nr).length + 1;
          r.sehtest_nr = `S${String(new Date().getFullYear()).slice(2)}-${String(n).padStart(3, "0")}`;
        }
        save();
        return { id, sehtest_nr: r.sehtest_nr || null };
      },
      async deleteRegistration(id) { const db = load(); db.regs = db.regs.filter(r => r.id !== id); save(); },
      async getSettings() {
        try { return JSON.parse(localStorage.getItem("ehfy-demo-settings")) || {}; } catch (e) { return {}; }
      },
      async saveSettings(value) {
        try { localStorage.setItem("ehfy-demo-settings", JSON.stringify(value)); } catch (e) { /* nur für diese Sitzung */ }
      },
      // Vorlagen nur in diesem Browser
      async getTemplate(key) {
        try {
          const b64 = localStorage.getItem("ehfy-demo-tpl-" + key);
          if (!b64) return null;
          const bin = atob(b64), out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        } catch (e) { return null; }
      },
      async saveTemplate(key, file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        try { localStorage.setItem("ehfy-demo-tpl-" + key, btoa(bin)); }
        catch (e) { throw new Error("Die Vorlage ist zu groß für den Demo-Speicher dieses Browsers."); }
      },
      async removeTemplate(key) { try { localStorage.removeItem("ehfy-demo-tpl-" + key); } catch (e) { /* egal */ } },
      async listInvoices(year) {
        return (load().invoices || []).filter(i => i.year === year).sort((a, b) => b.seq - a.seq);
      },
      async invoicesForRegistrations(ids) {
        return (load().invoices || []).filter(i => ids.includes(i.registration_id) && i.status !== "storniert");
      },
      async createInvoice(d) {
        const db = load();
        db.invoices = db.invoices || []; db.counters = db.counters || {};
        if (!d.items || !d.items.length) throw new Error("Die Rechnung braucht mindestens eine Position.");
        const issued = d.issued_on || new Date().toISOString().slice(0, 10);
        const year = Number(issued.slice(0, 4));
        const seq = (db.counters[year] || (cfg.documents.lastNumberBefore || {})[year] || 0) + 1;
        db.counters[year] = seq;
        const inv = {
          id: uid(), number: `${String(year).slice(2)}-${String(seq).padStart(2, "0")}`, year, seq, type: d.type,
          registration_id: d.registration_id || null, recipient: d.recipient, items: d.items,
          total: Math.round(d.items.reduce((s, i) => s + i.qty * i.price, 0) * 100) / 100,
          issued_on: issued, service_date: d.service_date || null, payment: d.payment || "bar",
          status: d.status || "offen", paid_on: d.status === "bezahlt" ? issued : null, created_at: new Date().toISOString()
        };
        db.invoices.push(inv); save();
        return inv;
      },
      async setInvoiceStatus(id, status) {
        const inv = (load().invoices || []).find(i => i.id === id);
        inv.status = status; inv.paid_on = status === "bezahlt" ? new Date().toISOString().slice(0, 10) : null; save();
      },
      async sendInvoiceMail(m) {
        // Im Demo-Modus wird nichts verschickt – nur vermerkt
        await new Promise(r => setTimeout(r, 600));
        const inv = (load().invoices || []).find(i => i.id === m.invoice_id);
        if (inv) { inv.sent_at = new Date().toISOString(); inv.sent_to = m.to; save(); }
        return { ok: true, demo: true };
      }
    };
  }

  window.EHFY_DB = live ? liveApi() : demoApi();
})();
