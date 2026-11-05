// Verwaltungsbereich: Termine anlegen/bearbeiten, Teilnehmer verwalten.
(async function () {
  const cfg = window.EHFY_CONFIG;
  const db = window.EHFY_DB;
  const { esc, fmtShortDate, fmtDate, fmtRange, fmtTime } = window.EHFY;
  const $ = id => document.getElementById(id);

  let courses = [];
  let filter = "upcoming";
  let current = null; // Termin in der Teilnehmeransicht
  let regs = [];

  const STATUS = {
    angemeldet: "angemeldet",
    teilgenommen: "teilgenommen",
    nicht_erschienen: "nicht erschienen",
    storniert: "storniert"
  };
  const pkgLabel = p => (cfg.packages.find(x => x.key === p) || { label: p }).label;
  const pad = n => String(n).padStart(2, "0");
  const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const isPast = c => new Date(c.starts_at) < new Date(new Date().toDateString());

  // ---------- Login ----------
  async function init() {
    if (await db.hasSession()) showApp();
    else $("login-view").classList.remove("hidden");
  }

  $("login-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    $("login-error").textContent = "";
    try {
      await db.signIn($("l-email").value.trim(), $("l-pass").value);
      $("login-view").classList.add("hidden");
      showApp();
    } catch (e) {
      $("login-error").textContent = e.message.includes("Invalid login") ? "E-Mail oder Passwort ist falsch." : e.message;
    }
  });

  $("logout").onclick = async () => { await db.signOut(); location.reload(); };

  async function showApp() {
    $("app-view").classList.remove("hidden");
    renderSync();
    await loadCourses();
    askToSync(); // Noch offene Änderungen vom letzten Mal
  }

  // ---------- Terminübersicht ----------
  async function loadCourses() {
    try {
      courses = await db.listCourses();
    } catch (e) {
      alert("Fehler beim Laden: " + e.message);
      return;
    }
    renderStats();
    renderCourses();
    setupPanel();
    renderAttendance();
  }

  function renderStats() {
    const upcoming = courses.filter(c => !isPast(c) && c.status === "offen");
    const booked = upcoming.reduce((s, c) => s + c.booked, 0);
    const free = upcoming.reduce((s, c) => s + Math.max(0, c.capacity - c.booked), 0);
    const next = upcoming[0];
    $("stats").innerHTML = `
      <div class="stat"><b>${upcoming.length}</b><span>kommende Termine</span></div>
      <div class="stat"><b>${booked}</b><span>Anmeldungen (kommend)</span></div>
      <div class="stat"><b>${free}</b><span>freie Plätze</span></div>
      <div class="stat"><b>${next ? new Date(next.starts_at).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" }) : "–"}</b><span>nächster Kurs</span></div>`;
  }

  function renderCourses() {
    let list = courses;
    if (filter === "upcoming") list = courses.filter(c => !isPast(c));
    if (filter === "past") list = courses.filter(isPast).reverse();
    $("course-rows").innerHTML = list.length ? list.map(c => {
      const pill = c.status === "abgesagt" ? '<span class="pill pill-full">abgesagt</span>'
        : !c.online_booking ? '<span class="pill pill-muted">nur telefonisch</span>'
        : '<span class="pill pill-ok">offen</span>';
      return `
        <tr class="${isPast(c) ? "is-past" : ""}">
          <td><strong>${fmtShortDate(c.starts_at)}</strong></td>
          <td>${fmtRange(c.starts_at, c.ends_at)}</td>
          <td>${esc(c.location)}</td>
          <td><span class="cap"><strong>${c.booked}</strong> /
            <button class="cap-btn" data-act="cap-down" data-id="${c.id}" aria-label="Ein Platz weniger">−</button>
            <b>${c.capacity}</b>
            <button class="cap-btn" data-act="cap-up" data-id="${c.id}" aria-label="Ein Platz mehr">+</button></span></td>
          <td>${pill}${db.isPending(c.id) ? '<br><span class="small muted">noch nicht online</span>' : ""}</td>
          <td><div class="btn-row">
            <button class="btn btn-sm" data-act="people" data-id="${c.id}">Teilnehmer</button>
            ${c.booked ? `<button class="btn btn-sm btn-teal" data-act="print" data-id="${c.id}" title="Datenblätter, Bescheinigungen und Quittungen für alle Teilnehmer">Kursmappe drucken</button>` : ""}
            <button class="btn btn-sm btn-outline" data-act="edit" data-id="${c.id}">Bearbeiten</button>
            <button class="btn btn-sm btn-outline" data-act="copy" data-id="${c.id}" title="Gleicher Termin eine Woche später">+1 Woche</button>
            <button class="btn btn-sm btn-outline" data-act="del" data-id="${c.id}" title="Löschen">✕</button>
          </div></td>
        </tr>`;
    }).join("") : '<tr><td colspan="6" class="muted">Keine Termine vorhanden. Lege mit „+ Neuer Termin“ einen an.</td></tr>';
  }

  $("filter").addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    filter = b.dataset.f;
    [...$("filter").children].forEach(x => x.classList.toggle("active", x === b));
    renderCourses();
  });

  $("course-rows").addEventListener("click", async ev => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const c = courses.find(x => x.id === b.dataset.id);
    if (b.dataset.act === "edit") openCourseDialog(c);
    if (b.dataset.act === "people") openParticipants(c);
    if (b.dataset.act === "cap-up" || b.dataset.act === "cap-down") {
      const capacity = Math.max(0, c.capacity + (b.dataset.act === "cap-up" ? 1 : -1));
      try { await db.saveCourse({ ...c, capacity }); await loadCourses(); } catch (e) { alert(e.message); }
    }
    if (b.dataset.act === "print") {
      try {
        const people = (await db.listRegistrations(c.id)).filter(r => r.status !== "storniert").sort(byName);
        await runDoc("alles", people, c, msg => { if (msg) alert(msg); });
      } catch (e) { alert(e.message); }
    }
    if (b.dataset.act === "copy") {
      const shift = iso => iso && new Date(new Date(iso).getTime() + 7 * 864e5).toISOString();
      const { id, booked, created_at, ...rest } = c;
      openCourseDialog({ ...rest, starts_at: shift(c.starts_at), ends_at: shift(c.ends_at), status: "offen" }, true);
    }
    if (b.dataset.act === "del") {
      const msg = c.booked
        ? `Dieser Termin hat ${c.booked} Anmeldung(en). Termin UND alle Anmeldungen endgültig löschen?\n\nTipp: Stattdessen „Bearbeiten → Status: abgesagt“ wählen, dann bleiben die Daten erhalten.`
        : "Diesen Termin endgültig löschen?";
      if (!confirm(msg)) return;
      try { await db.deleteCourse(c.id); await loadCourses(); } catch (e) { alert(e.message); }
    }
  });

  // ---------- Termin-Dialog ----------
  const dlg = $("course-dialog");
  let editing = null;

  function openCourseDialog(c, isCopy) {
    editing = c && !isCopy ? c : null;
    $("cd-title").textContent = editing ? "Termin bearbeiten" : "Neuer Termin";
    $("cd-error").textContent = "";
    if (c) {
      const s = new Date(c.starts_at);
      $("cd-date").value = localDate(s);
      $("cd-start").value = localTime(s);
      $("cd-end").value = c.ends_at ? localTime(new Date(c.ends_at)) : "";
      $("cd-loc").value = c.location;
      $("cd-addr").value = c.address || "";
      $("cd-cap").value = c.capacity;
      $("cd-note").value = c.note || "";
      $("cd-status").value = c.status;
      $("cd-online").checked = c.online_booking;
    } else {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
      $("cd-date").value = localDate(d);
      $("cd-start").value = cfg.locations[0].start;
      $("cd-end").value = cfg.locations[0].end;
      $("cd-loc").value = cfg.defaultLocation;
      $("cd-addr").value = cfg.defaultAddress;
      $("cd-cap").value = cfg.defaultCapacity;
      $("cd-note").value = "";
      $("cd-status").value = "offen";
      $("cd-online").checked = true;
    }
    dlg.showModal();
  }

  // Orte als Vorschläge; bei bekanntem Ort die Adresse automatisch eintragen
  const locByName = name => qList.find(l => l.name.toLowerCase() === name.trim().toLowerCase());
  $("cd-loc").addEventListener("change", () => { const l = locByName($("cd-loc").value); if (l) $("cd-addr").value = l.address; });

  // ---------- Termin freigeben: Ort antippen, Tag antippen, freigeben ----------
  const NONE = -1, NEW = -2; // kein Ort gewählt / neuer Ort
  const qSel = new Set();
  let qCal = null, qIndex = NONE, qList = [];
  const todayKey = EHFYKey(new Date());
  const qFormat = k => new Date(k + "T12:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

  function courseMarks() {
    const m = {};
    for (const c of courses) {
      const k = EHFYKey(new Date(c.starts_at));
      m[k] = { cls: "has-course", label: m[k] ? "2×" : c.location.slice(0, 2).toUpperCase(), title: c.location };
    }
    return m;
  }

  // Die Orte liegen in den privaten Einstellungen und gelten damit auf jedem Gerät
  async function loadLocations() {
    const saved = (await db.getSettings().catch(() => ({}))).locations;
    // Gespeicherte Orte ohne echte Adresse bekommen die Adresse aus den Grundeinstellungen
    const known = name => cfg.locations.find(l => l.name === name);
    const list = Array.isArray(saved)
      ? saved.filter(l => l.name).map(l => (!l.address || l.address.startsWith("Adresse folgt")) && known(l.name) ? { ...l, address: known(l.name).address } : l)
      : cfg.locations;
    const selected = qIndex >= 0 && qList[qIndex] ? qList[qIndex].name : null;
    const changed = JSON.stringify(list) !== JSON.stringify(qList);
    qList = list;
    if (selected !== null) qIndex = qList.findIndex(l => l.name === selected);
    $("loc-list").innerHTML = qList.map(l => `<option value="${esc(l.name)}">`).join("");
    return changed;
  }
  function renderChips() {
    $("q-locs").innerHTML = qList.map((l, i) =>
      `<button type="button" class="chip-btn ${i === qIndex ? "active" : ""}" data-i="${i}">${esc(l.name)}</button>`).join("") +
      `<button type="button" class="chip-btn ${qIndex === NEW ? "active" : ""}" data-i="${NEW}">+ Neuer Ort</button>`;
    $("q-delete").classList.toggle("hidden", qIndex < 0);
  }
  function fillForm(l) {
    $("q-loc").value = l.name || "";
    $("q-addr").value = l.address || "";
    $("q-start").value = l.start || "10:00";
    $("q-end").value = l.end || "17:30";
    $("q-cap").value = l.capacity ?? cfg.defaultCapacity;
    $("q-note").value = "";
    $("q-online").checked = true;
    $("q-error").textContent = "";
    $("q-remember-msg").textContent = "";
  }
  const formLocation = () => ({
    name: $("q-loc").value.trim(), address: $("q-addr").value.trim(),
    start: $("q-start").value, end: $("q-end").value,
    capacity: parseInt($("q-cap").value, 10) || 0
  });
  // Orte auf diesem Gerät speichern; übertragen werden sie mit „Synchronisieren“
  async function storeLocations() {
    if (db.isOnline() && !db.status().lastSync) await db.pull();
    const settings = await db.getSettings();
    await db.saveSettings({ ...settings, locations: qList });
    bankData = null;
    $("loc-list").innerHTML = qList.map(l => `<option value="${esc(l.name)}">`).join("");
  }
  async function storeWithMessage(text) {
    try {
      await storeLocations();
      $("q-remember-msg").textContent = `${text} ✓ Bitte noch synchronisieren.`;
    } catch (e) {
      $("q-remember-msg").textContent = `Nicht gespeichert: ${e.message}`;
    }
  }
  function renderQ() {
    renderChips();
    const keys = [...qSel].sort();
    $("q-hint").textContent = qIndex === NONE ? (keys.length ? "Jetzt noch oben einen Ort antippen." : "Ort und Tag antippen, dann freigeben.") : "Tippe alle gewünschten Tage an. Bereits eingetragene Termine sind grau.";
    $("q-sel").textContent = keys.length ? `Ausgewählt: ${keys.map(qFormat).join(", ")}` : "Noch kein Tag ausgewählt.";
    $("q-save").disabled = qIndex === NONE || !keys.length;
    $("q-save").textContent = keys.length > 1 ? `${keys.length} Termine freigeben` : "Termin freigeben";
    if (qCal) qCal.render();
  }
  function setupPanel() {
    if (qCal) {
      qCal.setMarks(courseMarks());
      // Auf einem anderen Gerät geänderte Orte hier ebenfalls zeigen
      loadLocations().then(changed => { if (changed) renderChips(); });
      return;
    }
    qCal = EHFYCalendar($("q-cal"), {
      marks: courseMarks(),
      selected: qSel,
      highlightWeekdays: [0, 6],
      isPickable: key => key >= todayKey,
      onPick: key => { qSel.has(key) ? qSel.delete(key) : qSel.add(key); renderQ(); }
    });
    loadLocations().then(renderQ);
  }
  $("q-locs").addEventListener("click", ev => {
    const b = ev.target.closest("[data-i]");
    if (!b) return;
    qIndex = Number(b.dataset.i);
    if (qIndex === NEW) {
      fillForm({});
      $("q-details").open = true;
      $("q-loc").focus();
    } else {
      fillForm(qList[qIndex]);
    }
    renderQ();
  });
  $("q-loc").addEventListener("change", () => {
    const l = locByName($("q-loc").value);
    if (l && !$("q-addr").value.trim()) $("q-addr").value = l.address;
  });
  // Ort speichern: der gewählte Knopf wird geändert, sonst kommt ein neuer dazu
  $("q-remember").onclick = async () => {
    const data = formLocation();
    if (!data.name) { $("q-remember-msg").textContent = "Bitte einen Namen für den Ort eintragen."; $("q-loc").focus(); return; }
    const same = qList.findIndex(l => l.name.toLowerCase() === data.name.toLowerCase());
    if (same >= 0 && same !== qIndex) { $("q-remember-msg").textContent = `„${data.name}“ gibt es schon.`; return; }
    if (qIndex >= 0) qList[qIndex] = { ...qList[qIndex], ...data };
    else { qList.push(data); qIndex = qList.length - 1; }
    renderQ();
    await storeWithMessage("Gespeichert");
  };
  $("q-delete").onclick = async () => {
    if (qIndex < 0) return;
    if (!confirm(`„${qList[qIndex].name}“ aus der Leiste löschen? Bereits eingetragene Termine bleiben bestehen.`)) return;
    qList.splice(qIndex, 1);
    qIndex = NONE;
    fillForm({});
    $("q-details").open = false;
    renderQ();
    await storeWithMessage("Gelöscht");
  };
  $("q-save").onclick = async () => {
    const start = $("q-start").value, end = $("q-end").value, loc = $("q-loc").value.trim();
    $("q-error").textContent = "";
    if (!loc) { $("q-details").open = true; $("q-error").textContent = "Bitte einen Ort eintragen."; return; }
    if (!start) { $("q-details").open = true; $("q-error").textContent = "Bitte eine Uhrzeit eintragen."; return; }
    if (end && end <= start) { $("q-details").open = true; $("q-error").textContent = "Das Ende muss nach dem Beginn liegen."; return; }
    const keys = [...qSel].sort();
    const dupes = keys.filter(k => courses.some(c => EHFYKey(new Date(c.starts_at)) === k && c.location === loc));
    if (dupes.length && !confirm(`Am ${dupes.map(qFormat).join(", ")} gibt es in ${loc} schon einen Termin. Trotzdem freigeben?`)) return;
    $("q-save").disabled = true;
    try {
      for (const k of keys) {
        await db.saveCourse({
          starts_at: new Date(`${k}T${start}`).toISOString(),
          ends_at: end ? new Date(`${k}T${end}`).toISOString() : null,
          location: loc, address: $("q-addr").value.trim() || loc,
          capacity: parseInt($("q-cap").value, 10) || 0, note: $("q-note").value.trim() || null,
          status: "offen", online_booking: $("q-online").checked
        });
      }
      // Geänderte Angaben merkt sich der Ort; ein neuer Name wird ein neuer Knopf
      const data = formLocation();
      const before = JSON.stringify(qList);
      qIndex = qList.findIndex(l => l.name.toLowerCase() === data.name.toLowerCase());
      if (qIndex < 0) { qList.push(data); qIndex = qList.length - 1; }
      else qList[qIndex] = { ...qList[qIndex], ...data };
      if (JSON.stringify(qList) !== before) {
        await db.saveSettings({ ...(await db.getSettings()), locations: qList });
        bankData = null;
        $("loc-list").innerHTML = qList.map(l => `<option value="${esc(l.name)}">`).join("");
      }
      qSel.clear();
      // Freigeben heißt: gleich online. Ohne Internet bleibt es zum Synchronisieren gespeichert.
      if (db.isOnline()) await db.sync();
      await loadCourses();
      renderQ();
    } catch (e) {
      await loadCourses();
      $("q-error").textContent = e.message;
      renderQ();
    }
  };

  $("course-form").addEventListener("submit", async ev => {
    if (ev.submitter?.value !== "save") return;
    ev.preventDefault();
    const date = $("cd-date").value;
    const starts = new Date(`${date}T${$("cd-start").value}`);
    const ends = $("cd-end").value ? new Date(`${date}T${$("cd-end").value}`) : null;
    if (ends && ends <= starts) { $("cd-error").textContent = "Das Ende muss nach dem Beginn liegen."; return; }
    const wasOpen = editing && editing.status === "offen";
    const row = {
      starts_at: starts.toISOString(),
      ends_at: ends ? ends.toISOString() : null,
      location: $("cd-loc").value.trim(),
      address: $("cd-addr").value.trim(),
      capacity: parseInt($("cd-cap").value, 10),
      note: $("cd-note").value.trim() || null,
      status: $("cd-status").value,
      online_booking: $("cd-online").checked
    };
    if (editing) row.id = editing.id;
    try {
      await db.saveCourse(row);
      dlg.close();
      await loadCourses();
      if (wasOpen && row.status === "abgesagt" && editing.booked > 0 &&
          confirm("Der Termin ist jetzt abgesagt. Möchtest du die angemeldeten Teilnehmer per E-Mail informieren?")) {
        const list = await db.listRegistrations(editing.id);
        location.href = mailtoAll(list, { ...editing, ...row }, true);
      }
    } catch (e) {
      $("cd-error").textContent = e.message;
    }
  });

  // ---------- Teilnehmer ----------
  async function openParticipants(c) {
    current = c;
    $("courses-view").classList.add("hidden");
    $("participants-view").classList.remove("hidden");
    $("p-title").textContent = `${fmtDate(c.starts_at)}`;
    await loadRegs();
    window.scrollTo({ top: 0 });
  }

  async function loadRegs() {
    try { regs = await db.listRegistrations(current.id); } catch (e) { alert(e.message); return; }
    const active = regs.filter(r => r.status !== "storniert");
    $("p-sub").textContent = `${fmtRange(current.starts_at, current.ends_at)} · ${current.location} · ${active.length} von ${current.capacity} Plätzen belegt` +
      (current.status === "abgesagt" ? " · TERMIN ABGESAGT" : "");
    $("p-cap-value").textContent = current.capacity;
    $("p-mail").href = mailtoAll(regs, current, false);
    const sorted = [...active.sort(byName), ...regs.filter(r => r.status === "storniert").sort(byName)];
    let n = 0;
    $("p-rows").innerHTML = sorted.length ? sorted.map(r => `
      <tr class="${r.status === "storniert" ? "is-past" : ""}">
        <td>${r.status === "storniert" ? "" : ++n}</td>
        <td><strong>${esc(r.last_name)}, ${esc(r.first_name)}</strong></td>
        <td>${r.birth_date ? new Date(r.birth_date + "T12:00").toLocaleDateString("de-DE") : "–"}</td>
        <td>${pkgLabel(r.package)}</td>
        <td class="small">${r.street ? `${esc(r.street)}<br>${esc(r.zip || "")} ${esc(r.city || "")}<br>` : ""}${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ""}${r.phone ? `<br><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ""}</td>
        <td class="small">${esc(r.message || "")}</td>
        <td><select data-id="${r.id}" aria-label="Status">${Object.entries(STATUS).map(([k, v]) =>
          `<option value="${k}" ${k === r.status ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td class="no-print">${r.status === "storniert" ? "" : `<select data-print="${r.id}" aria-label="Dokument drucken">
          <option value="">Drucken …</option><option value="alles">Alles für diese Person</option><option value="bescheinigung">Bescheinigung</option><option value="datenblatt">Datenblatt</option><option value="quittung">Quittung</option><option value="rechnung">Rechnung</option>
          <option value="quittung-mail">Quittung per E-Mail senden</option><option value="rechnung-mail">Rechnung per E-Mail senden</option></select>`}</td>
        <td class="no-print"><button class="btn btn-sm btn-outline" data-del="${r.id}" title="Eintrag löschen">✕</button></td>
      </tr>`).join("") : '<tr><td colspan="9" class="muted">Noch keine Anmeldungen.</td></tr>';
  }
  const byName = (a, b) => a.last_name.localeCompare(b.last_name, "de") || a.first_name.localeCompare(b.first_name, "de");

  $("p-rows").addEventListener("change", async ev => {
    const sel = ev.target.closest("select[data-id]");
    if (!sel) return;
    const patch = { status: sel.value, cancelled_at: sel.value === "storniert" ? new Date().toISOString() : null };
    try { await db.updateRegistration(sel.dataset.id, patch); await loadRegs(); } catch (e) { alert(e.message); }
  });

  $("p-rows").addEventListener("click", async ev => {
    const b = ev.target.closest("button[data-del]");
    if (!b) return;
    const r = regs.find(x => x.id === b.dataset.del);
    if (!confirm(`Anmeldung von ${r.first_name} ${r.last_name} endgültig löschen?`)) return;
    try { await removeRegistration(r); await loadRegs(); } catch (e) { alert(e.message); }
  });

  async function changeCapacity(delta) {
    current = { ...current, capacity: Math.max(0, current.capacity + delta) };
    try { await db.saveCourse(current); await loadRegs(); } catch (e) { alert(e.message); }
  }
  $("p-cap-down").onclick = () => changeCapacity(-1);
  $("p-cap-up").onclick = () => changeCapacity(1);

  $("back").onclick = async () => {
    $("participants-view").classList.add("hidden");
    $("courses-view").classList.remove("hidden");
    await loadCourses();
  };

  $("p-print").onclick = () => window.print();

  $("p-csv").onclick = () => {
    const head = ["Nachname", "Vorname", "Geburtsdatum", "Straße", "PLZ", "Ort", "Paket", "E-Mail", "Telefon", "Status", "Nachricht", "Angemeldet am"];
    const rows = regs.slice().sort(byName).map(r => [
      r.last_name, r.first_name, r.birth_date ? new Date(r.birth_date + "T12:00").toLocaleDateString("de-DE") : "",
      r.street || "", r.zip || "", r.city || "", pkgLabel(r.package), r.email || "", r.phone || "", STATUS[r.status], r.message || "",
      r.created_at ? new Date(r.created_at).toLocaleString("de-DE") : ""
    ]);
    const csv = [head, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Teilnehmer_${localDate(new Date(current.starts_at))}_${current.location}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  function mailtoAll(list, c, cancelled) {
    const emails = list.filter(r => r.status !== "storniert" && r.email).map(r => r.email);
    const when = `${fmtDate(c.starts_at)}, ${fmtTime(c.starts_at)} Uhr`;
    const subject = cancelled ? `Absage: Erste-Hilfe-Kurs am ${fmtShortDate(c.starts_at)}` : `Dein Erste-Hilfe-Kurs am ${fmtShortDate(c.starts_at)}`;
    const body = cancelled
      ? `Hallo,\n\nleider müssen wir den Erste-Hilfe-Kurs am ${when} absagen. Es entstehen dir keine Kosten.\nNeuen Termin buchen: ${new URL("anmelden.html", location.href).href}\n\nViele Grüße\nErste Hilfe for you`
      : `Hallo,\n\nwir freuen uns auf dich beim Erste-Hilfe-Kurs am ${when}.\nOrt: ${c.address || c.location}\n\nViele Grüße\nErste Hilfe for you`;
    return `mailto:${cfg.email}?bcc=${emails.join(",")}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // Teilnehmer manuell eintragen
  const rdlg = $("reg-dialog");
  EHFY.birthField($("rd-birth"));
  $("p-add").onclick = () => { $("reg-form").reset(); $("rd-error").textContent = ""; rdlg.showModal(); };
  $("reg-form").addEventListener("submit", async ev => {
    if (ev.submitter?.value !== "save") return;
    ev.preventDefault();
    const birth = EHFY.parseBirth($("rd-birth").value);
    if ($("rd-birth").value.trim() && !birth) { $("rd-error").textContent = "Bitte das Geburtsdatum so eingeben: TT.MM.JJJJ."; return; }
    try {
      await db.addRegistration({
        course_id: current.id,
        first_name: $("rd-first").value.trim(), last_name: $("rd-last").value.trim(),
        birth_date: birth, package: $("rd-pkg").value,
        email: $("rd-email").value.trim() || null, phone: $("rd-phone").value.trim() || null,
        street: $("rd-street").value.trim() || null, zip: $("rd-zip").value.trim() || null, city: $("rd-city").value.trim() || null,
        message: "manuell eingetragen"
      });
      rdlg.close();
      await loadRegs();
    } catch (e) { $("rd-error").textContent = e.message; }
  });

  // ---------- Abgleich: lokal arbeiten, dann „Synchronisieren“ ----------
  const changes = n => `${n} Änderung${n === 1 ? "" : "en"}`;
  function renderSync() {
    const st = db.status();
    $("sync-dot").className = "sync-dot " + (st.online ? "on" : "off");
    const parts = [st.online ? "Online" : "Offline – du arbeitest auf diesem Gerät"];
    parts.push(st.pending ? `${changes(st.pending)} noch nicht synchronisiert` : "Alles übertragen");
    if (st.remoteHint) parts.unshift("Neue Anmeldung eingegangen – bitte synchronisieren");
    if (st.newRegs) parts.unshift(`${st.newRegs} neue Anmeldung${st.newRegs === 1 ? "" : "en"}`);
    if (st.lastSync) parts.push(`Letzter Abgleich ${new Date(st.lastSync).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
    if (!st.live) parts.push("Demo: nur dieses Gerät");
    $("sync-text").textContent = st.error || parts.join(" · ");
    $("sync-text").style.color = st.error ? "var(--danger)" : "";
    $("sync-btn").disabled = !st.online || st.syncing;
    $("sync-btn").textContent = st.syncing ? "Wird übertragen …" : st.pending ? `Synchronisieren (${st.pending})` : "Synchronisieren";
    renderReminder(st);
  }
  const runSync = () => { db.clearNew(); return db.sync().catch(() => {}); };
  $("sync-btn").onclick = runSync;

  // ---------- Erinnerung ans Synchronisieren ----------
  let shownPending = 0;
  function renderReminder(st) {
    const bar = $("sync-reminder");
    bar.classList.toggle("hidden", !st.pending || $("app-view").classList.contains("hidden"));
    document.body.classList.toggle("has-reminder", !bar.classList.contains("hidden"));
    $("sr-text").textContent = st.online ? `${changes(st.pending)} noch nicht synchronisiert` : `${changes(st.pending)} warten auf Internet`;
    $("sr-btn").disabled = !st.online || st.syncing;
    $("sr-btn").textContent = st.syncing ? "Wird übertragen …" : "Jetzt synchronisieren";
    // Nach jeder neuen Eingabe kurz aufleuchten
    if (st.pending > shownPending) { bar.classList.remove("pulse"); void bar.offsetWidth; bar.classList.add("pulse"); }
    shownPending = st.pending;
  }
  $("sr-btn").onclick = runSync;

  function askToSync() {
    const st = db.status();
    if (!st.pending || $("app-view").classList.contains("hidden") || document.querySelector("dialog[open]")) return;
    $("rm-text").textContent = `${changes(st.pending)} ${st.pending === 1 ? "ist" : "sind"} noch nicht synchronisiert. Teilnehmer und deine anderen Geräte sehen sie erst danach.`;
    $("rm-sync").disabled = !st.online;
    $("remind-dialog").showModal();
  }
  $("rm-sync").onclick = () => { $("remind-dialog").close(); runSync(); };
  $("rm-later").onclick = () => $("remind-dialog").close();

  async function swRegistration() {
    return "serviceWorker" in navigator ? navigator.serviceWorker.getRegistration().catch(() => null) : null;
  }
  // Beim Schließen des Fensters fragt der Browser nach
  window.addEventListener("beforeunload", ev => {
    if (db.status().pending) { ev.preventDefault(); ev.returnValue = ""; }
  });
  // Beim Minimieren: Mitteilung, sofern erlaubt. Bei der Rückkehr fragt die Verwaltung nach.
  let leftPending = false;
  document.addEventListener("visibilitychange", async () => {
    const reg = await swRegistration();
    if (document.visibilityState === "hidden") {
      const n = db.status().pending;
      leftPending = Boolean(n);
      if (n && reg && "Notification" in window && Notification.permission === "granted") {
        reg.showNotification("Bitte synchronisieren", { body: `${changes(n)} noch nicht synchronisiert.`, icon: "assets/icon-192.png", tag: "ehfy-sync-erinnerung" }).catch(() => {});
      }
      return;
    }
    if (reg && reg.getNotifications) (await reg.getNotifications({ tag: "ehfy-sync-erinnerung" }).catch(() => [])).forEach(x => x.close());
    if (leftPending) { leftPending = false; askToSync(); }
  });

  let lastView = "";
  window.addEventListener("ehfy-sync", () => {
    renderSync();
    // Listen auffrischen, aber nur wenn sich etwas geändert hat und kein Fenster offen ist
    if (document.querySelector("dialog[open]")) return;
    const view = JSON.stringify([db.status().lastSync, db.status().pending, db.status().newRegs]);
    if (view === lastView) return;
    lastView = view;
    if (!$("courses-view").classList.contains("hidden")) loadCourses();
    if (!$("participants-view").classList.contains("hidden") && current) loadRegs();
    if (!$("invoices-view").classList.contains("hidden")) loadInvoices();
    if (!$("students-view").classList.contains("hidden")) loadStudents();
  });

  // ---------- Bereiche: Termine, Rechnungen, Vorlagen ----------
  $("main-tabs").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-view]");
    if (!b) return;
    [...$("main-tabs").children].forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll("[data-section]").forEach(el => el.classList.add("hidden"));
    if (b.dataset.view === "termine") { $("courses-view").classList.remove("hidden"); loadCourses(); }
    if (b.dataset.view === "schueler") { $("students-view").classList.remove("hidden"); loadStudents(); }
    if (b.dataset.view === "rechnungen") { $("invoices-view").classList.remove("hidden"); loadInvoices(); }
    if (b.dataset.view === "vorlagen") { $("templates-view").classList.remove("hidden"); renderTemplates(); renderBank(); renderPush(); }
  });

  // ---------- Sehtest abhaken: gemacht, bestanden, Sehhilfe ----------
  function sehtestControls(r, c) {
    const on = (group, value, cur, label, cls = "") => `<button class="btn btn-sm btn-ghost att-btn ${cur === value ? cls || "on-yes" : ""}" type="button" data-st="${group}" data-val="${value}" aria-pressed="${cur === value}">${label}</button>`;
    const done = Boolean(sehtestDay(r, c));
    return `<div class="st-row">
      <div class="st-group"><span class="st-label">Sehtest:</span>${on("done", true, done, done ? "✓ gemacht" : "gemacht")}</div>
      <div class="st-group"><span class="st-label">Bestanden:</span>${on("passed", true, r.sehtest_passed, "Ja")}${on("passed", false, r.sehtest_passed, "Nein", "on-no")}</div>
      <div class="st-group"><span class="st-label">Sehhilfe:</span>${on("aid", true, r.sehtest_aid, "Mit")}${on("aid", false, r.sehtest_aid, "Ohne")}</div>
    </div>`;
  }
  async function handleSehtest(btn, r, c) {
    const value = btn.dataset.val === "true";
    if (btn.dataset.st === "done") {
      const done = Boolean(sehtestDay(r, c));
      return db.updateRegistration(r.id, done
        ? { sehtest_on: null, sehtest_none: true, sehtest_passed: null, sehtest_aid: null }
        : { sehtest_on: c ? dayOf(c.starts_at) : localDate(new Date()), sehtest_none: false });
    }
    const field = btn.dataset.st === "passed" ? "sehtest_passed" : "sehtest_aid";
    const patch = { [field]: r[field] === value ? null : value };
    // Wer ein Ergebnis hat, hat den Sehtest auch gemacht
    if (patch[field] !== null && !sehtestDay(r, c)) { patch.sehtest_on = c ? dayOf(c.starts_at) : localDate(new Date()); patch.sehtest_none = false; }
    return db.updateRegistration(r.id, patch);
  }
  const courseDone = r => (r.status === "teilgenommen" ? "Ja" : r.status === "nicht_erschienen" ? "Nein, nicht erschienen" : r.status === "storniert" ? "Nein, abgesagt" : "Noch nicht abgehakt");

  // ---------- Anwesenheit, Ausfallgebühr und zweite Chance ----------
  const FEE = cfg.documents.noShowFee;
  let attRegs = [], attById = {};
  const attOpen = new Set(); // geöffnete Ordner bleiben beim Aktualisieren offen
  const dayText = iso => new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  const shortDay = s => new Date(s.length > 10 ? s : s + "T12:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const samePerson = (a, b) => (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase())
    || (`${a.first_name}|${a.last_name}|${a.birth_date}`.toLowerCase() === `${b.first_name}|${b.last_name}|${b.birth_date}`.toLowerCase());
  const courseOf = r => attById[r.course_id];
  // Zu spät abgesagt: weniger als 48 Stunden vor Kursbeginn
  const lateCancel = r => {
    if (r.status !== "storniert" || !r.cancelled_at || !courseOf(r)) return false;
    return new Date(courseOf(r).starts_at) - new Date(r.cancelled_at) < cfg.cancelHours * 3600000;
  };
  const absent = r => r.status === "nicht_erschienen" || lateCancel(r);
  // Anmeldung für den Nachholtermin innerhalb der Frist
  const followUp = r => attRegs.find(x => x.id !== r.id && x.status !== "storniert" && samePerson(x, r) && courseOf(x)
    && courseOf(x).starts_at > courseOf(r).starts_at && x.created_at > r.fee_state_at && x.created_at.slice(0, 10) <= r.chance_until);
  // War diese Anmeldung der Nachholtermin einer zweiten Chance?
  const chanceBefore = r => attRegs.find(x => x.id !== r.id && x.fee_state === "chance" && samePerson(x, r) && courseOf(x) && followUp(x) && followUp(x).id === r.id);

  function feeControls(r) {
    if (r.fee_state === "rechnung") return `<span class="small">Rechnung gesendet am ${shortDay(r.fee_state_at)}</span>`;
    if (r.fee_state === "erlassen") return '<span class="small">Ausfallgebühr gutgeschrieben</span>';
    if (!r.email) return '<span class="small muted">Keine E-Mail hinterlegt</span>';
    const before = chanceBefore(r);
    if (before) return `<span class="small">Zweite Chance nicht genutzt.</span> <button class="btn btn-sm" type="button" data-fee="both">Rechnungen senden: 2 × ${FEE} €</button>`;
    if (r.fee_state === "chance") return `<span class="small">Zweite Chance gesendet, Frist bis ${shortDay(r.chance_until)}.</span> <button class="btn btn-sm btn-ghost" type="button" data-fee="bill">Rechnung ${FEE} € senden</button>`;
    return `<button class="btn btn-sm" type="button" data-fee="bill">Rechnung ${FEE} € senden</button>
      <button class="btn btn-sm btn-ghost" type="button" data-fee="chance">Zweite Chance senden</button>`;
  }
  function attRow(r) {
    const late = lateCancel(r);
    return `<div class="att-row" data-att="${r.id}">
      <div class="att-name">${esc(r.first_name)} ${esc(r.last_name)}${late ? ' <span class="small muted">(zu spät abgesagt)</span>' : ""}</div>
      ${late ? "" : `<div class="att-btns">
        <button class="btn btn-sm btn-ghost att-btn ${r.status === "teilgenommen" ? "on-yes" : ""}" type="button" data-mark="teilgenommen" aria-pressed="${r.status === "teilgenommen"}">✓ Da</button>
        <button class="btn btn-sm btn-ghost att-btn ${r.status === "nicht_erschienen" ? "on-no" : ""}" type="button" data-mark="nicht_erschienen" aria-pressed="${r.status === "nicht_erschienen"}">✗ Nicht da</button>
      </div>`}
      ${absent(r) ? `<div class="att-fee">${feeControls(r)}</div>` : ""}
      ${!absent(r) && (r.package === "komplett" || sehtestDay(r, courseOf(r))) ? sehtestControls(r, courseOf(r)) : ""}
    </div>`;
  }
  const attWords = () => $("att-filter").value.toLowerCase().split(/\s+/).filter(Boolean);
  const attPeople = c => {
    const words = attWords();
    return attRegs.filter(r => r.course_id === c.id && (r.status !== "storniert" || lateCancel(r))
      && words.every(w => `${r.first_name} ${r.last_name}`.toLowerCase().includes(w))).sort(byName);
  };
  function attFolder(c) {
    const list = attPeople(c);
    const yes = list.filter(r => r.status === "teilgenommen").length, no = list.filter(absent).length;
    const open = attOpen.has(c.id) || attWords().length > 0;
    return `<details class="att-folder" data-folder="${c.id}" ${open ? "open" : ""}>
      <summary>${dayText(c.starts_at)} · ${esc(c.location)} <small>${list.length} angemeldet · ${yes} da · ${no} nicht da</small></summary>
      <div class="att-body">${open ? attBody(list) : ""}</div></details>`;
  }
  const attBody = list => (list.length ? list.map(attRow).join("") : '<p class="small muted">Noch keine Anmeldungen.</p>');
  const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const attGroup = (key, label, count, inner) => `<details class="att-folder att-group" data-folder="${key}" ${attOpen.has(key) ? "open" : ""}>
    <summary>${label} <small>${count} ${count === 1 ? "Kurs" : "Kurse"}</small></summary><div class="att-body">${attOpen.has(key) ? inner() : ""}</div></details>`;
  function archiveHtml(list) {
    const years = new Map();
    for (const c of list) {
      const d = new Date(c.starts_at), y = d.getFullYear(), m = d.getMonth();
      if (!years.has(y)) years.set(y, new Map());
      if (!years.get(y).has(m)) years.get(y).set(m, []);
      years.get(y).get(m).push(c);
    }
    return [...years].map(([y, months]) => attGroup(`y${y}`, String(y), [...months.values()].flat().length, () =>
      [...months].map(([m, cs]) => attGroup(`m${y}-${m}`, MONTH_NAMES[m], cs.length, () => cs.map(attFolder).join(""))).join(""))).join("");
  }
  function chanceRow(r) {
    const c = courseOf(r), f = followUp(r);
    let info, action = "";
    if (f && f.status === "teilgenommen") { info = `Kurs am ${shortDay(courseOf(f).starts_at)} absolviert.`; action = '<button class="btn btn-sm" type="button" data-fee="waive">Ausfallgebühr gutschreiben</button>'; }
    else if (f && f.status === "nicht_erschienen") { info = `Auch am ${shortDay(courseOf(f).starts_at)} nicht erschienen. Die Knöpfe stehen bei diesem Kurs.`; }
    else if (f) { info = `Angemeldet für ${shortDay(courseOf(f).starts_at)}.`; }
    else if (localDate(new Date()) > r.chance_until) { info = `Frist am ${shortDay(r.chance_until)} abgelaufen, nicht angemeldet.`; action = `<button class="btn btn-sm" type="button" data-fee="bill">Rechnung ${FEE} € senden</button>`; }
    else { info = `Frist bis ${shortDay(r.chance_until)}.`; }
    return `<div class="att-row" data-att="${r.id}"><div class="att-name">${esc(r.first_name)} ${esc(r.last_name)} <span class="small muted">(Kurs ${shortDay(c.starts_at)})</span></div><div class="att-fee"><span class="small">${info}</span> ${action}</div></div>`;
  }
  async function renderAttendance() {
    const [regsAll] = await Promise.all([db.listAllRegistrations()]);
    attRegs = regsAll;
    attById = Object.fromEntries(courses.map(c => [c.id, c]));
    const today = localDate(new Date());
    const coming = courses.filter(c => c.status === "offen" && localDate(new Date(c.starts_at)) >= today).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    $("att-cards").innerHTML = coming.length ? coming.map(attFolder).join("") : '<p class="muted small">Keine kommenden Kurse.</p>';
    const open = attRegs.filter(r => r.fee_state === "chance" && courseOf(r));
    $("att-chances").innerHTML = open.length ? `<article class="att-card"><h3>Zweite Chancen</h3>${open.map(chanceRow).join("")}</article>` : "";
    const shown = new Set(coming.map(c => c.id));
    const past = courses.filter(c => !shown.has(c.id)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    // Beim Suchen nur die Ordner mit Treffern zeigen, sonst nach Jahr und Monat geordnet
    if (attWords().length) {
      const hits = past.filter(c => attPeople(c).length);
      $("att-archive").innerHTML = hits.length ? hits.map(attFolder).join("") : '<p class="muted small">Keine Treffer in früheren Kursen.</p>';
    } else {
      $("att-archive").innerHTML = past.length ? archiveHtml(past) : '<p class="muted small">Noch keine früheren Kurse.</p>';
    }
  }
  // Ordner: Inhalt erst beim Öffnen aufbauen, Zustand merken
  $("att-section").addEventListener("toggle", ev => {
    const box = ev.target;
    if (!box.matches || !box.matches("details[data-folder]") || attWords().length) return;
    const key = box.dataset.folder;
    if (box.open) {
      attOpen.add(key);
      if (!box.querySelector(":scope > .att-body").innerHTML.trim()) renderAttendance();
    } else attOpen.delete(key);
  }, true);
  $("att-filter").addEventListener("input", renderAttendance);

  const feeDate = r => shortDay(courseOf(r).starts_at);
  async function sendFeeBill(r) {
    const service = localDate(new Date(courseOf(r).starts_at));
    const text = `Ausfallgebühr Erste-Hilfe-Kurs am ${feeDate(r)}\nNicht erschienen oder nicht rechtzeitig abgemeldet`;
    const found = (await db.invoicesForRegistrations([r.id])).find(i => i.type === "rechnung" && String(i.items?.[0]?.text || "").startsWith("Ausfallgebühr"));
    const inv = found || await db.createInvoice({
      type: "rechnung", registration_id: r.id, status: "offen", payment: "ueberweisung",
      issued_on: localDate(new Date()), service_date: service,
      recipient: { name: `${r.first_name} ${r.last_name}`, birth_date: r.birth_date || null, street: r.street || "", zip: r.zip || "", city: r.city || "", email: r.email },
      items: [{ text, qty: 1, price: FEE }]
    });
    if (inv.draft) throw new Error("Die Rechnung konnte ohne Internet keine Nummer bekommen.");
    const days = cfg.documents.paymentDays;
    const body = [
      `Guten Tag ${r.first_name} ${r.last_name},`, "",
      `Sie waren für den Erste-Hilfe-Kurs am ${feeDate(r)} angemeldet, sind aber nicht erschienen oder haben sich nicht mindestens ${cfg.cancelHours} Stunden vorher abgemeldet.`, "",
      `Die Teilnehmerzahl unserer Kurse ist begrenzt. Ihr Platz war für Sie reserviert, und gegebenenfalls mussten wir andere Interessenten abweisen. Dadurch ist uns ein Nachteil entstanden. Die Ausfallgebühr von ${FEE},00 € fällt deshalb unabhängig vom Grund an, auch bei Krankheit.`, "",
      `Bitte bezahlen Sie die beigefügte Rechnung Nr. ${inv.number} innerhalb von ${days} Tagen per PayPal an ${cfg.issuer.paypal}.`, "",
      "Sollte die Zahlung nicht fristgerecht eingehen, behalten wir uns vor, rechtliche Schritte einzuleiten. Dadurch können weitere Kosten entstehen.", "",
      "Mit freundlichen Grüßen", cfg.issuer.owner, cfg.issuer.name, `Tel. ${cfg.issuer.phone}`
    ].join("\n");
    const bytes = await EHFYDocs.invoices([inv], await issuer(), loadFont, days);
    const filename = `Rechnung_${inv.number}.pdf`;
    await db.sendInvoiceMail({
      invoice_id: inv.id, to: r.email, subject: `Rechnung ${inv.number} – Ausfallgebühr Erste-Hilfe-Kurs am ${feeDate(r)}`, text: body,
      filename, pdfBase64: await toBase64(new File([bytes], filename, { type: "application/pdf" }))
    });
    await db.updateRegistration(r.id, { fee_state: "rechnung", fee_state_at: new Date().toISOString() });
  }
  async function sendChance(r) {
    const until = new Date(); until.setDate(until.getDate() + 7);
    const untilDay = localDate(until);
    const link = new URL("anmelden.html", location.href).href;
    const body = [
      `Guten Tag ${r.first_name} ${r.last_name},`, "",
      `Sie waren für den Erste-Hilfe-Kurs am ${feeDate(r)} angemeldet, sind aber nicht erschienen oder haben sich nicht rechtzeitig abgemeldet. Normalerweise müssten Sie dafür eine Ausfallgebühr von ${FEE},00 € bezahlen.`, "",
      "Wir geben Ihnen noch eine Chance:", "",
      `Wenn Sie sich bis zum ${shortDay(untilDay)} für den nächsten Kurs anmelden und daran teilnehmen, bezahlen Sie nur den Betrag für den absolvierten Kurs. Die Ausfallgebühr wird Ihnen dann gutgeschrieben.`, "",
      `Zur Anmeldung: ${link}`, "",
      `Melden Sie sich nicht rechtzeitig an, wird die Ausfallgebühr von ${FEE},00 € fällig. Melden Sie sich an und erscheinen wieder nicht, müssen Sie für beide Termine bezahlen.`, "",
      "Mit freundlichen Grüßen", cfg.issuer.owner, cfg.issuer.name, `Tel. ${cfg.issuer.phone}`
    ].join("\n");
    await db.sendInvoiceMail({ to: r.email, subject: `Noch eine Chance: Ihr Erste-Hilfe-Kurs am ${feeDate(r)}`, text: body, textOnly: true });
    await db.updateRegistration(r.id, { fee_state: "chance", fee_state_at: new Date().toISOString(), chance_until: untilDay });
  }
  $("att-section").addEventListener("click", async ev => {
    const row = ev.target.closest("[data-att]");
    if (!row) return;
    const r = attRegs.find(x => x.id === row.dataset.att);
    const err = $("att-error");
    err.textContent = "";
    const stBtn = ev.target.closest("[data-st]");
    if (r && stBtn) {
      try { await handleSehtest(stBtn, r, courseOf(r)); await loadCourses(); } catch (e) { err.textContent = e.message; }
      return;
    }
    const mark = ev.target.closest("[data-mark]");
    const fee = ev.target.closest("[data-fee]");
    if (!r || (!mark && !fee)) return;
    const btn = mark || fee;
    btn.disabled = true;
    try {
      if (mark) {
        const value = r.status === mark.dataset.mark ? "angemeldet" : mark.dataset.mark;
        await db.updateRegistration(r.id, { status: value });
      } else if (fee.dataset.fee === "waive") {
        if (!confirm(`Ausfallgebühr von ${r.first_name} ${r.last_name} gutschreiben?`)) return;
        await db.updateRegistration(r.id, { fee_state: "erlassen", fee_state_at: new Date().toISOString() });
      } else {
        if (!db.isOnline()) throw new Error("Zum Senden braucht es Internet.");
        await ensurePdf();
        if (fee.dataset.fee === "chance") {
          if (!confirm(`Zweite Chance per E-Mail an ${r.email} senden?`)) return;
          await sendChance(r);
        } else if (fee.dataset.fee === "both") {
          if (!confirm(`Zwei Rechnungen über je ${FEE} € an ${r.email} senden?`)) return;
          await sendFeeBill(chanceBefore(r));
          await sendFeeBill(r);
        } else {
          if (!confirm(`Rechnung über ${FEE} € an ${r.email} senden?`)) return;
          await sendFeeBill(r);
        }
      }
      await loadCourses();
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; }
  });

  // ---------- Schülerdatenbank: alle Anmeldungen aller Kurse, je Person zusammengefasst ----------
  let studentRegs = [], studentCourses = {};
  const dayOf = iso => (iso ? localDate(new Date(iso)) : "");
  const birthText = d => (d ? new Date(d + "T12:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
  // Sehtest: eigenes Datum, sonst bei Komplettpaket der Kurstag
  const sehtestDay = (r, c) => {
    if (r.sehtest_none) return "";
    if (r.sehtest_on) return r.sehtest_on;
    if (r.package === "komplett" && r.status === "teilgenommen" && c) return dayOf(c.starts_at);
    return "";
  };
  async function loadStudents() {
    const [regsAll, list] = await Promise.all([db.listAllRegistrations(), db.listCourses()]);
    studentRegs = regsAll;
    studentCourses = Object.fromEntries(list.map(c => [c.id, c]));
    renderStudents();
  }
  function renderStudents() {
    if (document.activeElement && document.activeElement.matches("#sc-list input")) return;
    const words = $("sc-search").value.toLowerCase().split(/\s+/).filter(Boolean);
    const people = new Map();
    for (const r of studentRegs) {
      const c = studentCourses[r.course_id];
      const hay = [r.first_name, r.last_name, birthText(r.birth_date), r.email, r.phone, c && c.location].join(" ").toLowerCase();
      if (!words.every(w => hay.includes(w))) continue;
      const key = `${r.last_name}|${r.first_name}|${r.birth_date || ""}`.toLowerCase();
      if (!people.has(key)) people.set(key, []);
      people.get(key).push(r);
    }
    const when = r => (studentCourses[r.course_id] ? studentCourses[r.course_id].starts_at : "");
    const sorted = [...people.values()].map(l => l.sort((a, b) => when(b).localeCompare(when(a))))
      .sort((a, b) => when(b[0]).localeCompare(when(a[0])));
    $("sc-count").textContent = `${sorted.length} ${sorted.length === 1 ? "Person" : "Personen"} · Stand vom letzten Synchronisieren`;
    const limit = 100;
    $("sc-list").innerHTML = sorted.length ? sorted.slice(0, limit).map(entries => {
      const p = entries[0];
      return `<article class="sc-person">
        <h3>${esc(p.last_name)}, ${esc(p.first_name)}</h3>
        <p class="small muted" style="margin:2px 0 0">geb. ${birthText(p.birth_date)}${p.email ? ` · <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}${p.phone ? ` · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ""}</p>
        ${entries.map(r => studentEntry(r)).join("")}
      </article>`;
    }).join("") + (sorted.length > limit ? `<p class="muted small">Es werden die neuesten ${limit} angezeigt. Bitte die Suche genauer eingeben.</p>` : "")
      : '<p class="muted">Keine Schüler gefunden.</p>';
  }
  function studentEntry(r) {
    const c = studentCourses[r.course_id];
    const off = r.status === "storniert" || !c;
    return `<div class="sc-entry" data-reg="${r.id}">
      <div class="sc-facts">
        <div><label>Erste-Hilfe-Kurs</label><strong>${c ? dayText(c.starts_at) : "Termin gelöscht"}</strong><br><span class="small">${c ? esc(c.location) + " · " : ""}Kurs gemacht: <span class="sc-done">${courseDone(r)}</span></span></div>
        <div><label for="sc-st-${r.id}">Sehtest am (leer = kein Sehtest)</label><input type="date" id="sc-st-${r.id}" data-sehtest value="${sehtestDay(r, c)}"></div>
        <div><label>Protokoll</label>${r.protocol_added_on ? `<span class="small">hinzugefügt am ${birthText(r.protocol_added_on)}</span><br><button class="btn btn-sm btn-ghost" type="button" data-proto="print">Ansehen / drucken</button> <button class="btn btn-sm btn-ghost" type="button" data-proto="remove">Entfernen</button>` : `<button class="btn btn-sm btn-ghost" type="button" data-proto="add">Protokoll hinzufügen</button>`}</div>
      </div>
      ${sehtestControls(r, c)}
      ${off ? "" : `<div class="btn-row">
        <button class="btn btn-sm btn-ghost" type="button" data-sc-print="bescheinigung">Bescheinigung</button>
        <button class="btn btn-sm btn-ghost" type="button" data-sc-print="quittung">Quittung</button>
        <button class="btn btn-sm btn-ghost" type="button" data-sc-print="rechnung">Rechnung</button>
      </div>`}
      <div><button class="btn btn-sm btn-ghost" type="button" data-sc-del style="color:var(--danger)">✕ Aus der Liste löschen</button></div>
    </div>`;
  }
  // Anmeldung löschen; ein hinterlegtes Protokoll geht mit
  async function removeRegistration(r) {
    if (r.protocol_added_on) await db.removeTemplate(`protokolle/${r.id}`);
    await db.deleteRegistration(r.id);
  }
  // Das Suchfeld oben führt von überall direkt zu den Schülern
  $("sc-search").addEventListener("input", () => {
    if ($("students-view").classList.contains("hidden") && $("sc-search").value.trim()) {
      document.querySelector('#main-tabs [data-view="schueler"]').click();
    } else renderStudents();
  });
  const protocolKey = id => `protokolle/${id}`;
  let protoFor = null;
  // Fotos werden zur PDF, damit jedes Protokoll gleich gedruckt werden kann
  async function protocolPdf(file) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return file;
    if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error("Bitte eine PDF-Datei oder ein Foto (JPG oder PNG) wählen.");
    await ensurePdf();
    const { PDFDocument } = window.PDFLib;
    const pdf = await PDFDocument.create();
    const bytes = await file.arrayBuffer();
    const img = file.type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([595.28, 841.89]);
    const scale = Math.min(555 / img.width, 800 / img.height, 1);
    page.drawImage(img, { x: (595.28 - img.width * scale) / 2, y: (841.89 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    return new File([await pdf.save()], "protokoll.pdf", { type: "application/pdf" });
  }
  $("sc-file").addEventListener("change", async ev => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file || !protoFor) return;
    $("sc-error").textContent = "";
    try {
      await db.saveTemplate(protocolKey(protoFor), await protocolPdf(file));
      await db.updateRegistration(protoFor, { protocol_added_on: localDate(new Date()) });
      await loadStudents();
    } catch (e) { $("sc-error").textContent = e.message; }
  });
  $("sc-list").addEventListener("change", async ev => {
    const input = ev.target.closest("input[data-sehtest]");
    if (!input) return;
    const id = input.closest("[data-reg]").dataset.reg;
    input.blur();
    try {
      await db.updateRegistration(id, input.value ? { sehtest_on: input.value, sehtest_none: false } : { sehtest_on: null, sehtest_none: true });
      await loadStudents();
    } catch (e) { $("sc-error").textContent = e.message; }
  });
  $("sc-list").addEventListener("click", async ev => {
    const box = ev.target.closest("[data-reg]");
    if (!box) return;
    const r = studentRegs.find(x => x.id === box.dataset.reg);
    const show = msg => { $("sc-error").textContent = msg; };
    const stBtn = ev.target.closest("[data-st]");
    if (stBtn) {
      try { await handleSehtest(stBtn, r, studentCourses[r.course_id]); await loadStudents(); } catch (e) { show(e.message); }
      return;
    }
    const printKind = ev.target.closest("[data-sc-print]");
    if (printKind) return runDoc(printKind.dataset.scPrint, [r], studentCourses[r.course_id], show);
    if (ev.target.closest("[data-sc-del]")) {
      if (!confirm(`${r.first_name} ${r.last_name} endgültig aus der Liste löschen?`)) return;
      try { await removeRegistration(r); await loadStudents(); } catch (e) { show(e.message); }
      return;
    }
    const proto = ev.target.closest("[data-proto]");
    if (!proto) return;
    show("");
    if (proto.dataset.proto === "add") { protoFor = r.id; $("sc-file").click(); return; }
    if (proto.dataset.proto === "print") {
      const win = openTab();
      try {
        const bytes = await db.getTemplate(protocolKey(r.id));
        if (!bytes) throw new Error("Das Protokoll konnte nicht geladen werden.");
        showPdf(bytes, `Protokoll_${r.last_name}_${r.first_name}.pdf`, win);
      } catch (e) { if (win) win.close(); show(e.message); }
      return;
    }
    if (proto.dataset.proto === "remove") {
      if (!confirm(`Protokoll von ${r.first_name} ${r.last_name} endgültig entfernen?`)) return;
      try {
        await db.removeTemplate(protocolKey(r.id));
        await db.updateRegistration(r.id, { protocol_added_on: null });
        await loadStudents();
      } catch (e) { show(e.message); }
    }
  });

  // ---------- Alte Teilnehmer importieren ----------
  let importPlan = null;
  const nameList = list => list.length ? `<ul>${list.map(x => `<li>${esc(x.who)}: ${esc(x.why)}</li>`).join("")}</ul>` : "";
  $("im-file").addEventListener("change", async ev => {
    const file = ev.target.files[0];
    $("im-error").textContent = "";
    $("im-preview").innerHTML = "";
    $("im-start").classList.add("hidden");
    importPlan = null;
    if (!file) return;
    try {
      const rows = JSON.parse(await file.text());
      if (!Array.isArray(rows)) throw new Error("Das ist nicht die erwartete Datei.");
      importPlan = await EHFYImport.plan(rows, { siegenAddress: cfg.defaultAddress });
      const p = importPlan;
      $("im-preview").innerHTML = `<p><strong>${p.regs.length} Teilnehmer in ${p.courses.length} Kursen</strong> werden übernommen.
        ${p.merged} doppelte Einträge werden zusammengelegt, ${p.skipped.length} nicht übernommen.</p>
        ${p.skipped.length ? `<p><strong>Nicht übernommen:</strong></p>${nameList(p.skipped)}` : ""}
        ${p.check.length ? `<p><strong>Werden übernommen, bitte prüfen:</strong></p>${nameList(p.check)}` : ""}`;
      $("im-start").classList.remove("hidden");
    } catch (e) { $("im-error").textContent = e instanceof SyntaxError ? "Die Datei konnte nicht gelesen werden." : e.message; }
  });
  $("im-start").onclick = async () => {
    const p = importPlan;
    if (!p || !confirm(`${p.regs.length} alte Teilnehmer jetzt übernehmen?`)) return;
    $("im-start").disabled = true;
    $("im-error").textContent = "";
    const note = document.createElement("p");
    $("im-preview").prepend(note);
    try {
      await db.importLegacy(p.courses, p.regs, n => { note.textContent = `${n} von ${p.regs.length} übertragen …`; });
      note.innerHTML = "<strong>Import fertig ✓</strong> Die alten Teilnehmer stehen jetzt im Bereich Schüler. Bitte lösche danach die Datei von deinem Schreibtisch.";
      $("im-start").classList.add("hidden");
      $("im-file").value = "";
      importPlan = null;
      await loadCourses();
    } catch (e) {
      note.remove();
      $("im-error").textContent = `Import nicht abgeschlossen: ${e.message} Du kannst ihn gefahrlos wiederholen.`;
    }
    $("im-start").disabled = false;
  };

  // ---------- Absender: öffentliche Angaben + Bankverbindung aus der Verwaltung ----------
  let bankData = null;
  async function issuer() {
    if (!bankData) bankData = await db.getSettings().catch(() => ({}));
    return { ...cfg.issuer, ...bankData };
  }
  const BANK_FIELDS = { bank: "st-bank", accountHolder: "st-holder", iban: "st-iban", bic: "st-bic", taxNumber: "st-tax" };
  async function renderBank() {
    bankData = await db.getSettings().catch(() => ({}));
    for (const [k, id] of Object.entries(BANK_FIELDS)) $(id).value = bankData[k] || "";
    $("st-status").textContent = "";
  }
  $("bank-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const value = { ...(await db.getSettings().catch(() => ({}))) };
    for (const [k, id] of Object.entries(BANK_FIELDS)) value[k] = $(id).value.trim();
    try {
      await db.saveSettings(value);
      bankData = value;
      $("st-status").textContent = "Gespeichert ✓";
    } catch (e) { $("st-status").textContent = e.message; }
  });

  // ---------- Dokumente als PDF ----------
  const TEMPLATES = { bescheinigung: "Bescheinigung", datenblatt: "Teilnehmerdatenblatt", quittung: "Quittung" };
  // Quittung: auf deiner Vorlage, solange keine hochgeladen ist im EHfy-Design
  const receiptPdf = async list => EHFYDocs.receipts(list, await issuer(), loadFont, await db.getTemplate("quittung").catch(() => null));
  const eur = n => Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  let pdfReady = null;
  const fontCache = {};
  const loadFont = w => (fontCache[w] = fontCache[w] || fetch(`assets/fonts/jakarta-${w}.ttf`).then(r => r.arrayBuffer()));

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const el = document.createElement("script");
      el.src = src; el.onload = ok; el.onerror = () => fail(new Error(`${src} konnte nicht geladen werden.`));
      document.head.appendChild(el);
    });
  }
  // Die PDF-Bausteine werden erst geladen, wenn sie gebraucht werden
  function ensurePdf() {
    pdfReady = pdfReady || Promise.all([loadScript("assets/vendor/pdf-lib.min.js"), loadScript("assets/vendor/fontkit.umd.min.js")])
      .then(() => loadScript("assets/docs.js"));
    return pdfReady;
  }

  async function template(key) {
    const bytes = await db.getTemplate(key);
    if (!bytes) throw new Error(`Die Vorlage „${TEMPLATES[key]}“ fehlt noch. Bitte unter „Einstellungen“ hochladen.`);
    return bytes;
  }

  // Als App auf dem iPhone gestartet? Dann keine neuen Fenster, sondern der PDF-Dialog
  const appMode = window.navigator.standalone === true;

  // PDF im vorher geöffneten Tab anzeigen (Pop-up-Blocker) oder im Dialog anbieten
  function openTab() {
    if (appMode) return null;
    const win = window.open("", "_blank");
    if (win) win.document.write("<p style='font:16px system-ui,sans-serif;padding:24px'>PDF wird erstellt …</p>");
    return win;
  }
  function showPdf(bytes, name, win) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    if (win && !win.closed) { win.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 60000); }
    else { URL.revokeObjectURL(url); pdfDialog(bytes, name); }
  }

  // ---------- PDF-Dialog und Versand per E-Mail ----------
  // Über das Teilen-Menü landet die PDF als Anhang direkt in deiner Mail-App (mit dem dort eingerichteten Konto).
  const pdlg = $("pdf-dialog");
  let pd = null;
  function pdfDialog(bytes, name, mail) {
    if (pd) URL.revokeObjectURL(pd.url);
    const file = new File([bytes], name, { type: "application/pdf" });
    pd = { file, url: URL.createObjectURL(file), mail };
    const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
    $("pd-title").textContent = mail ? "Per E-Mail senden" : "PDF ist fertig";
    $("pd-name").textContent = name;
    $("pd-open").href = pd.url;
    $("pd-download").href = pd.url;
    $("pd-download").download = name;
    $("pd-share").classList.toggle("hidden", !canShare);
    $("pd-share").textContent = mail ? "Über Mail-App (PDF im Anhang)" : "Teilen / Drucken";
    $("pd-share").className = mail ? "btn btn-ghost" : "btn";
    $("pd-mail").classList.toggle("hidden", !mail);
    $("pd-mailto").classList.toggle("hidden", !mail);
    $("pd-status").textContent = "";
    $("pd-status").className = "form-error";
    $("pd-status").style.color = "";
    $("pd-send").disabled = false;
    $("pd-send").textContent = "Jetzt senden";
    if (mail) {
      $("pd-to").value = mail.to || "";
      $("pd-subject").value = mail.subject;
      $("pd-text").value = mail.body;
      $("pd-from").textContent = `von ${cfg.email}${db.live ? "" : " (Demo: wird nicht wirklich verschickt)"}`;
    }
    $("pd-hint").textContent = "";
    pdlg.showModal();
  }
  // Aktuelle Werte aus dem Formular (falls du Betreff oder Text geändert hast)
  const mailFields = () => ({ to: $("pd-to").value.trim(), subject: $("pd-subject").value.trim(), body: $("pd-text").value });

  async function toBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // Direkt über dein Postfach info@ehfy.de senden
  $("pd-mail").addEventListener("submit", async ev => {
    ev.preventDefault();
    const m = mailFields();
    $("pd-send").disabled = true;
    $("pd-send").textContent = "Wird gesendet …";
    try {
      const res = await db.sendInvoiceMail({
        invoice_id: pd.mail.invoice_id, to: m.to, subject: m.subject, text: m.body,
        filename: pd.file.name, pdfBase64: await toBase64(pd.file)
      });
      $("pd-status").className = "small";
      $("pd-status").style.color = "var(--aid-dark)";
      $("pd-status").textContent = res && res.demo ? `Demo: Versand an ${m.to} wurde nur vermerkt.` : `Gesendet an ${m.to} ✓ – eine Kopie liegt in deinem Postfach.`;
      $("pd-send").textContent = "Gesendet ✓";
      if (!$("invoices-view").classList.contains("hidden")) loadInvoices();
    } catch (e) {
      $("pd-status").className = "form-error";
      $("pd-status").style.color = "";
      $("pd-status").textContent = e.message;
      $("pd-send").disabled = false;
      $("pd-send").textContent = "Erneut senden";
    }
  });
  $("pd-share").onclick = async () => {
    const { file, mail } = pd;
    const m = mail && mailFields();
    try {
      await navigator.share(mail ? { files: [file], title: m.subject, text: m.body } : { files: [file], title: file.name });
    } catch (e) {
      if (e.name !== "AbortError") $("pd-hint").textContent = "Teilen hat nicht geklappt: " + e.message;
    }
  };
  $("pd-mailto").onclick = () => {
    const m = mailFields();
    $("pd-mailto").href = `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  };
  $("pd-close").onclick = () => pdlg.close();

  function billMail(inv) {
    const isReceipt = inv.type === "quittung";
    const doc = isReceipt ? "Quittung" : "Rechnung";
    const subject = `${doc} ${inv.number} – Erste Hilfe for you`;
    const lines = [
      `Hallo ${inv.recipient.name},`, "",
      `anbei erhalten Sie Ihre ${doc} Nr. ${inv.number} über ${eur(inv.total)}.`,
      !isReceipt && inv.status === "offen" ? `Bitte überweisen Sie den Betrag innerhalb von ${cfg.documents.paymentDays} Tagen – Bankverbindung und PayPal finden Sie in der Rechnung.` : "",
      "", "Herzlichen Dank für Ihr Vertrauen!", "", "Viele Grüße",
      cfg.issuer.owner, cfg.issuer.name, `Tel. ${cfg.issuer.phone}`, cfg.issuer.web
    ];
    return { invoice_id: inv.id, to: inv.recipient.email || "", subject, body: lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n") };
  }

  async function sendBill(inv) {
    if (inv.draft) throw new Error("Dieser Beleg ist noch ein Entwurf ohne Nummer. Bitte zuerst „Synchronisieren“, dann senden.");
    await ensurePdf();
    const bytes = inv.type === "quittung"
      ? await receiptPdf([inv])
      : await EHFYDocs.invoice(inv, await issuer(), loadFont, cfg.documents.paymentDays);
    pdfDialog(bytes, `${inv.type === "quittung" ? "Quittung" : "Rechnung"}_${inv.number}.pdf`, billMail(inv));
  }

  // Quittungen/Rechnungen: vorhandene wiederverwenden, fehlende mit neuer Nummer anlegen
  async function billsFor(type, people, course) {
    const existing = await db.invoicesForRegistrations(people.map(r => r.id));
    const day = localDate(new Date(course.starts_at));
    // Quittung = bar am Kurstag bezahlt; Rechnung = normal mit Zahlungsziel ab heute
    const cash = type === "quittung";
    const out = [];
    for (const r of people) {
      let inv = existing.find(i => i.registration_id === r.id && i.type === type);
      if (!inv) {
        inv = await db.createInvoice({
          type, registration_id: r.id, status: cash ? "bezahlt" : "offen", payment: cash ? "bar" : "ueberweisung",
          issued_on: cash ? day : localDate(new Date()), service_date: day,
          recipient: { name: `${r.first_name} ${r.last_name}`, birth_date: r.birth_date || null, street: r.street || "", zip: r.zip || "", city: r.city || "", email: r.email || "" },
          items: EHFYDocs.receiptItems(r, course, cfg.packages)
        });
      }
      // Ältere Belege kennen das Geburtsdatum noch nicht
      out.push({ ...inv, recipient: { ...inv.recipient, birth_date: inv.recipient.birth_date || r.birth_date || null } });
    }
    return out;
  }

  // Ein Dokument-Typ als PDF-Bytes (eine Seite pro Teilnehmer, gleiche Reihenfolge)
  async function docBytes(kind, people, course) {
    const D = window.EHFYDocs;
    if (kind === "bescheinigung") return D.certificates(await template("bescheinigung"), course, people, loadFont, { infoLeafletHanded: cfg.documents.infoLeafletHanded });
    if (kind === "datenblatt") return D.datasheets(await template("datenblatt"), course, people, loadFont);
    if (kind === "quittung") return receiptPdf(await billsFor("quittung", people, course));
    if (kind === "rechnung") return D.invoices(await billsFor("rechnung", people, course), await issuer(), loadFont, cfg.documents.paymentDays);
  }
  const DOC_NAMES = { bescheinigung: "Bescheinigungen", datenblatt: "Datenblaetter", quittung: "Quittungen", rechnung: "Rechnungen", alles: "Kursmappe" };
  // „alles“: pro Teilnehmer Datenblatt, Bescheinigung und Quittung hintereinander
  const BUNDLE = ["datenblatt", "bescheinigung", "quittung"];

  async function makeDoc(kind, people, course, win) {
    await ensurePdf();
    const bytes = kind === "alles"
      ? await EHFYDocs.bundle(await Promise.all(BUNDLE.map(k => docBytes(k, people, course))))
      : await docBytes(kind, people, course);
    const who = people.length === 1 ? `_${people[0].last_name}_${people[0].first_name}` : "";
    showPdf(bytes, `${DOC_NAMES[kind]}_${localDate(new Date(course.starts_at))}_${course.location}${who}.pdf`, win);
  }

  async function runDoc(kind, people, course = current, showError = msg => { $("doc-error").textContent = msg; }) {
    showError("");
    if (!people.length) { showError("Es gibt keine angemeldeten Teilnehmer."); return; }
    const win = openTab();
    try { await makeDoc(kind, people, course, win); }
    catch (e) { if (win) win.close(); showError(e.message); }
  }

  document.querySelectorAll("[data-doc]").forEach(b => {
    b.onclick = () => runDoc(b.dataset.doc, regs.filter(r => r.status !== "storniert").sort(byName));
  });
  $("p-rows").addEventListener("change", ev => {
    const sel = ev.target.closest("select[data-print]");
    if (!sel || !sel.value) return;
    const kind = sel.value;
    sel.value = "";
    const people = regs.filter(r => r.id === sel.dataset.print);
    if (kind.endsWith("-mail")) {
      $("doc-error").textContent = "";
      (async () => {
        await ensurePdf();
        const [inv] = await billsFor(kind.replace("-mail", ""), people, current);
        await sendBill({ ...inv, recipient: { ...inv.recipient, email: inv.recipient.email || people[0].email || "" } });
      })().catch(e => { $("doc-error").textContent = e.message; });
      return;
    }
    runDoc(kind, people);
  });

  // ---------- Rechnungen ----------
  const INV_STATUS = {
    offen: '<span class="pill pill-warn">offen</span>',
    bezahlt: '<span class="pill">bezahlt</span>',
    storniert: '<span class="pill pill-muted">storniert</span>'
  };
  let invoices = [];
  const thisYear = new Date().getFullYear();
  $("inv-year").innerHTML = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2]
    .map(y => `<option value="${y}" ${y === thisYear ? "selected" : ""}>${y}</option>`).join("");
  $("inv-year").onchange = () => loadInvoices();

  async function loadInvoices() {
    try { invoices = await db.listInvoices(Number($("inv-year").value)); } catch (e) { alert(e.message); return; }
    const valid = invoices.filter(i => i.status !== "storniert");
    const open = valid.filter(i => i.status === "offen");
    const sum = list => list.reduce((s, i) => s + Number(i.total), 0);
    $("inv-stats").innerHTML = `
      <div class="stat"><b>${valid.length}</b><span>Belege ${$("inv-year").value}</span></div>
      <div class="stat"><b>${eur(sum(valid))}</b><span>Umsatz</span></div>
      <div class="stat"><b>${open.length}</b><span>offene Rechnungen</span></div>
      <div class="stat"><b>${eur(sum(open))}</b><span>noch offen</span></div>`;
    $("inv-rows").innerHTML = invoices.length ? invoices.map(i => `
      <tr class="${i.status === "storniert" ? "is-past" : ""}">
        <td><strong>${esc(i.number)}</strong>${i.draft ? '<br><span class="small muted">Nummer folgt beim Abgleich</span>' : ""}</td>
        <td>${new Date(i.issued_on + "T12:00").toLocaleDateString("de-DE")}</td>
        <td>${i.type === "quittung" ? "Quittung" : "Rechnung"}</td>
        <td>${esc(i.recipient.name)}</td>
        <td><strong>${eur(i.total)}</strong></td>
        <td>${INV_STATUS[i.status]}${i.sent_at ? `<br><span class="small muted" title="${esc(i.sent_to || "")}">✉ ${new Date(i.sent_at).toLocaleDateString("de-DE")}</span>` : ""}</td>
        <td><div class="btn-row">
          <button class="btn btn-sm btn-outline" data-inv="pdf" data-id="${i.id}">PDF</button>
          ${i.status !== "storniert" && !i.draft ? `<button class="btn btn-sm btn-outline" data-inv="mail" data-id="${i.id}">E-Mail</button>` : ""}
          ${i.status === "offen" ? `<button class="btn btn-sm btn-outline" data-inv="paid" data-id="${i.id}">bezahlt</button>` : ""}
          ${i.status !== "storniert" ? `<button class="btn btn-sm btn-outline" data-inv="cancel" data-id="${i.id}" title="Stornieren">✕</button>` : ""}
        </div></td>
      </tr>`).join("") : '<tr><td colspan="7" class="muted">In diesem Jahr gibt es noch keine Rechnungen oder Quittungen.</td></tr>';
  }

  async function invoicePdf(inv, win) {
    await ensurePdf();
    const bytes = inv.type === "quittung"
      ? await receiptPdf([inv])
      : await EHFYDocs.invoice(inv, await issuer(), loadFont, cfg.documents.paymentDays);
    showPdf(bytes, `${inv.type === "quittung" ? "Quittung" : "Rechnung"}_${inv.number}.pdf`, win);
  }

  $("inv-rows").addEventListener("click", async ev => {
    const b = ev.target.closest("button[data-inv]");
    if (!b) return;
    const inv = invoices.find(i => i.id === b.dataset.id);
    try {
      if (b.dataset.inv === "pdf") {
        const win = openTab();
        try { await invoicePdf(inv, win); } catch (e) { if (win) win.close(); throw e; }
      }
      if (b.dataset.inv === "mail") await sendBill(inv);
      if (b.dataset.inv === "paid") { await db.setInvoiceStatus(inv.id, "bezahlt"); await loadInvoices(); }
      if (b.dataset.inv === "cancel" && confirm(`${inv.number} stornieren?\n\nDie Nummer bleibt erhalten und wird als storniert markiert.`)) {
        await db.setInvoiceStatus(inv.id, "storniert"); await loadInvoices();
      }
    } catch (e) { alert(e.message); }
  });

  // Neue Rechnung mit freien Positionen
  const idlg = $("inv-dialog");
  function itemRow(it = { text: "", qty: 1, price: "" }) {
    const row = document.createElement("div");
    row.className = "iv-item";
    row.style.cssText = "display:grid;grid-template-columns:1fr 70px 100px 42px;gap:8px;align-items:end;margin-bottom:10px";
    row.innerHTML = `
      <div class="field"><label>Beschreibung</label><textarea rows="2" style="min-height:56px" required>${esc(it.text)}</textarea></div>
      <div class="field"><label>Menge</label><input type="number" min="0" step="any" value="${it.qty}" required></div>
      <div class="field"><label>Preis €</label><input type="number" min="0" step="0.01" value="${it.price}" required></div>
      <button type="button" class="btn btn-sm btn-ghost" title="Position entfernen">✕</button>`;
    row.querySelector("button").onclick = () => { row.remove(); sumItems(); };
    row.addEventListener("input", sumItems);
    $("iv-items").appendChild(row);
  }
  function readItems() {
    return [...$("iv-items").querySelectorAll(".iv-item")].map(r => {
      const [qty, price] = r.querySelectorAll("input");
      return { text: r.querySelector("textarea").value.trim(), qty: Number(qty.value), price: Number(price.value) };
    }).filter(i => i.text);
  }
  function sumItems() { $("iv-sum").textContent = eur(readItems().reduce((s, i) => s + i.qty * i.price, 0)); }

  $("iv-add").onclick = () => itemRow();
  $("inv-new").onclick = () => {
    $("inv-form").reset();
    $("iv-items").innerHTML = "";
    itemRow({ text: "Erste-Hilfe-Schulung", qty: 1, price: cfg.prices.kurs });
    $("iv-date").value = localDate(new Date());
    $("iv-error").textContent = "";
    sumItems();
    idlg.showModal();
  };
  $("inv-form").addEventListener("submit", async ev => {
    if (ev.submitter?.value !== "save") return;
    ev.preventDefault();
    const items = readItems();
    if (!items.length) { $("iv-error").textContent = "Bitte mindestens eine Position eintragen."; return; }
    const bar = $("iv-cash").checked;
    const win = openTab();
    try {
      const inv = await db.createInvoice({
        type: "rechnung", items, payment: bar ? "bar" : "ueberweisung", status: bar ? "bezahlt" : "offen",
        issued_on: $("iv-date").value, service_date: $("iv-service").value || null,
        recipient: { name: $("iv-name").value.trim(), street: $("iv-street").value.trim(), zip: $("iv-zip").value.trim(), city: $("iv-city").value.trim(), email: $("iv-email").value.trim() }
      });
      idlg.close();
      $("inv-year").value = String(inv.year);
      await loadInvoices();
      await invoicePdf(inv, win);
    } catch (e) { if (win) win.close(); $("iv-error").textContent = e.message; }
  });

  // ---------- Push-Mitteilungen auf diesem Gerät ----------
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const b64ToBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
  const pushMsg = t => { $("push-status").textContent = t; };

  async function renderPush() {
    $("push-on").classList.add("hidden");
    $("push-off").classList.add("hidden");
    $("push-test").classList.add("hidden");
    if (isIos && !appMode) return pushMsg("Auf dem iPhone gehen Mitteilungen nur in der installierten App: In Safari auf Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen.");
    if (!pushSupported) return pushMsg("Dieser Browser unterstützt keine Mitteilungen.");
    if (Notification.permission === "denied") return pushMsg("Mitteilungen sind für diese App blockiert. Du kannst sie in den Einstellungen deines Geräts wieder erlauben.");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      $("push-off").classList.remove("hidden");
      $("push-test").classList.remove("hidden");
      pushMsg("Eingeschaltet: Dieses Gerät meldet neue Anmeldungen.");
    } else {
      $("push-on").classList.remove("hidden");
      if (Notification.permission === "granted") $("push-test").classList.remove("hidden");
      pushMsg("Ausgeschaltet.");
    }
  }
  $("push-on").onclick = async () => {
    try {
      if (await Notification.requestPermission() !== "granted") return renderPush();
      if (!db.live || !cfg.vapidPublicKey) {
        pushMsg("Erlaubt. Echte Mitteilungen kommen erst, wenn Supabase eingerichtet ist – „Test-Mitteilung“ funktioniert schon.");
        $("push-test").classList.remove("hidden");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
      await db.savePushSubscription(sub.toJSON(), navigator.userAgent.slice(0, 120));
      await renderPush();
    } catch (e) { pushMsg("Hat nicht geklappt: " + e.message); }
  };
  $("push-off").onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) { await db.removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
      await renderPush();
    } catch (e) { pushMsg("Hat nicht geklappt: " + e.message); }
  };
  $("push-test").onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("Neue Anmeldung", { body: "Max Mustermann\nSo., 08.11. · Siegen (Test)", icon: "assets/icon-192.png" });
    } catch (e) { pushMsg("Hat nicht geklappt: " + e.message); }
  };

  // ---------- Vorlagen ----------
  async function renderTemplates() {
    const cards = await Promise.all(Object.entries(TEMPLATES).map(async ([key, label]) => {
      const has = Boolean(await db.getTemplate(key).catch(() => null));
      return `<div class="card">
        <h3>${label}</h3>
        <p>${has ? '<span class="pill">Vorlage vorhanden</span>' : '<span class="pill pill-warn">fehlt noch</span>'}</p>
        <div class="field" style="margin:14px 0"><label for="tpl-${key}">PDF hochladen${has ? " (ersetzt die bisherige)" : ""}</label>
          <input type="file" id="tpl-${key}" accept="application/pdf" data-tpl="${key}"></div>
        <button class="btn btn-sm btn-ghost" data-test="${key}" ${has ? "" : "disabled"}>Testdruck mit Beispieldaten</button>
        <p class="form-error" id="tpl-err-${key}"></p>
      </div>`;
    }));
    $("tpl-cards").innerHTML = cards.join("");
  }
  $("tpl-cards").addEventListener("change", async ev => {
    const input = ev.target.closest("input[data-tpl]");
    if (!input || !input.files[0]) return;
    const key = input.dataset.tpl, file = input.files[0];
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { $("tpl-err-" + key).textContent = "Bitte eine PDF-Datei wählen."; return; }
    try { await db.saveTemplate(key, file); await renderTemplates(); } catch (e) { $("tpl-err-" + key).textContent = e.message; }
  });
  $("tpl-cards").addEventListener("click", async ev => {
    const b = ev.target.closest("button[data-test]");
    if (!b) return;
    const sample = [{ first_name: "Max", last_name: "Mustermann", birth_date: "2008-01-15", street: "Musterstraße 1", zip: "57072", city: "Siegen", package: "komplett" }];
    const course = { starts_at: new Date().toISOString(), location: cfg.defaultLocation, address: cfg.defaultAddress };
    const win = openTab();
    try {
      // Testdruck der Quittung ohne echte Nummer
      if (b.dataset.test === "quittung") {
        await ensurePdf();
        const items = EHFYDocs.receiptItems(sample[0], course, cfg.packages);
        const bytes = await receiptPdf([{ number: "MUSTER", status: "bezahlt", issued_on: localDate(new Date()), total: items[0].price, items,
          recipient: { name: "Max Mustermann", birth_date: sample[0].birth_date } }]);
        showPdf(bytes, "Quittung_Muster.pdf", win);
      } else await makeDoc(b.dataset.test, sample, course, win);
    }
    catch (e) { if (win) win.close(); $("tpl-err-" + b.dataset.test).textContent = e.message; }
  });

  init();
})();
