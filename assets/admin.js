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
    db.startAuto(); // Änderungen gehen sofort raus, Neues kommt sofort rein
    askToSync(); // Noch offene Änderungen vom letzten Mal
    setTimeout(() => askCertificates(), 800); // Bescheinigungen, die noch nicht geschrieben sind
  }

  // ---------- Uhrzeit-Felder: vier Ziffern, danach fängt die nächste Ziffer von vorne an ----------
  function timeField(el) {
    el.type = "text"; el.inputMode = "numeric"; el.placeholder = "HH:MM"; el.maxLength = 5; el.autocomplete = "off";
    el.pattern = "[0-2][0-9]:[0-5][0-9]"; el.title = "Uhrzeit, z. B. 09:30";
    const fmt = d => (d.length > 2 ? d.slice(0, 2) + ":" + d.slice(2) : d);
    // Beim Antippen alles markieren: die erste Ziffer ersetzt die alte Uhrzeit
    el.addEventListener("focus", () => setTimeout(() => el.select(), 0));
    el.addEventListener("beforeinput", ev => {
      if (ev.inputType !== "insertText") return;
      const typed = (ev.data || "").replace(/\D/g, "");
      if (!typed) { ev.preventDefault(); return; } // nur Ziffern
      const full = el.value.replace(/\D/g, "").length >= 4, selected = el.selectionEnd > el.selectionStart;
      if (full && !selected) { ev.preventDefault(); el.value = fmt(typed.slice(0, 4)); }
    });
    el.addEventListener("input", () => { el.value = fmt(el.value.replace(/\D/g, "").slice(0, 4)); });
    // Kurze Eingaben ergänzen: 9 → 09:00, 930 → 09:30
    el.addEventListener("blur", () => {
      const d = el.value.replace(/\D/g, "");
      if (!d) return;
      const [h, m] = d.length <= 2 ? [d, "0"] : d.length === 3 ? [d.slice(0, 1), d.slice(1)] : [d.slice(0, 2), d.slice(2)];
      el.value = String(Math.min(23, +h)).padStart(2, "0") + ":" + String(Math.min(59, +m)).padStart(2, "0");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  ["q-start", "q-end", "cd-start", "cd-end"].forEach(id => $(id) && timeField($(id)));

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
    await renderAttendance();
    // Ist gerade eine Teilnehmerliste offen, diese mit auffrischen
    if (current && !$("participants-view").classList.contains("hidden")) {
      current = courses.find(c => c.id === current.id) || current;
      await loadRegs();
    }
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
        <tr class="${isPast(c) ? "is-past" : ""} row-link" data-open="${c.id}" title="Teilnehmerliste öffnen">
          <td><strong>${fmtShortDate(c.starts_at)}</strong><br><button class="del-mini" data-act="del" data-id="${c.id}" title="Termin löschen">🗑 Löschen</button></td>
          <td>${fmtRange(c.starts_at, c.ends_at)}</td>
          <td>${esc(c.location)}</td>
          <td><span class="cap"><strong>${c.booked}</strong> /
            <button class="cap-btn" data-act="cap-down" data-id="${c.id}" aria-label="Ein Platz weniger">−</button>
            <b>${c.capacity}</b>
            <button class="cap-btn" data-act="cap-up" data-id="${c.id}" aria-label="Ein Platz mehr">+</button></span></td>
          <td>${pill}${db.isPending(c.id) ? '<br><span class="small muted">noch nicht online</span>' : ""}</td>
          <td><div class="btn-row">
            <button class="btn btn-sm" data-act="people" data-id="${c.id}">Teilnehmerliste</button>
            <button class="btn btn-sm btn-outline" data-act="qr" data-id="${c.id}" title="Schüler tragen sich mit dem eigenen Handy ein">QR-Code</button>
            ${c.booked ? `<button class="btn btn-sm btn-teal" data-act="print" data-id="${c.id}" title="Datenblätter, Bescheinigungen und Quittungen für alle Teilnehmer">Kursmappe drucken</button>` : ""}
            <details class="row-more"><summary class="btn btn-sm btn-ghost">Mehr</summary><div class="row-more-box">
              <button class="btn btn-sm btn-outline" data-act="edit" data-id="${c.id}">Bearbeiten</button>
              <button class="btn btn-sm btn-outline" data-act="copy" data-id="${c.id}" title="Gleicher Termin eine Woche später">+1 Woche kopieren</button></div></details>
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
    if (!b) {
      // Antippen der Zeile öffnet die Teilnehmerliste
      const tr = ev.target.closest("tr[data-open]");
      if (tr && !ev.target.closest("a,input,select,details")) openParticipants(courses.find(x => x.id === tr.dataset.open));
      return;
    }
    const c = courses.find(x => x.id === b.dataset.id);
    if (b.dataset.act === "edit") openCourseDialog(c);
    if (b.dataset.act === "people") openParticipants(c);
    if (b.dataset.act === "qr") openQr(c);
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
      try {
        // Abgeschlossene Sehtest-Protokolle bleiben erhalten (als „nur Sehtest“)
        for (const r of await db.listRegistrations(c.id)) if (protoDone(r)) await keepProtocolOnly(r, c);
        await db.deleteCourse(c.id); await window.EHFYFinance.courseCancelled(c.id); await loadCourses();
      } catch (e) { alert(e.message); }
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
  const participantsStep = () => $("back").click();
  async function openParticipants(c) {
    current = c;
    window.EHFYNav.push(participantsStep);
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
    $("p-tools").innerHTML = courseTools(current);
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
        <td class="no-print">${r.status === "storniert" && !lateCancel(r) ? "" : `<div data-att="${r.id}" class="p-att">
          ${lateCancel(r) ? '<span class="small muted">zu spät abgesagt</span>' : `<div class="att-btns">
            <button class="btn btn-sm btn-ghost att-btn ${r.status === "teilgenommen" ? "on-yes" : ""}" type="button" data-mark="teilgenommen" aria-pressed="${r.status === "teilgenommen"}">✓ Da</button>
            <button class="btn btn-sm btn-ghost att-btn ${r.status === "nicht_erschienen" ? "on-no" : ""}" type="button" data-mark="nicht_erschienen" aria-pressed="${r.status === "nicht_erschienen"}">✗ Nicht da</button></div>`}
          ${absent(r) ? `<div class="att-fee">${feeControls(r)}</div>` : sehtestQuick(r)}</div>`}</td>
        <td><select data-id="${r.id}" aria-label="Status">${Object.entries(STATUS).map(([k, v]) =>
          `<option value="${k}" ${k === r.status ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td class="no-print">${r.status === "storniert" ? "" : `<select data-print="${r.id}" aria-label="Dokument drucken">
          <option value="">Drucken …</option><option value="alles">Alles für diese Person</option><option value="bescheinigung">Bescheinigung</option><option value="datenblatt">Datenblatt</option><option value="quittung">Quittung</option><option value="rechnung">Rechnung</option>
          <option value="quittung-mail">Quittung per E-Mail senden</option><option value="rechnung-mail">Rechnung per E-Mail senden</option><option value="bescheinigung-mail">Bescheinigung per E-Mail senden</option><option value="datenblatt-mail">Datenblatt per E-Mail senden</option></select>`}</td>
        <td class="no-print"><button class="btn btn-sm btn-outline" data-del="${r.id}" title="Eintrag löschen">✕</button></td>
      </tr>`).join("") : '<tr><td colspan="10" class="muted">Noch keine Anmeldungen.</td></tr>';
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
    askToSync(true);
    window.EHFYNav.remove(participantsStep);
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
  let addCourse = null, addId = null;
  function openAdd(c) {
    addCourse = c; addId = null;
    $("reg-form").reset(); $("rd-error").textContent = ""; $("rd-idinfo").innerHTML = "";
    $("rd-course").textContent = `Kurs: ${dayText(c.starts_at)} · ${c.location}`;
    // Am Kurstag oder danach: gleich als „da“ eintragen
    const started = localDate(new Date(c.starts_at)) <= localDate(new Date());
    $("rd-here-box").classList.toggle("hidden", !started);
    $("rd-here").checked = started;
    rdlg.showModal();
  }
  $("p-add").onclick = () => openAdd(current);
  $("rd-scan").onclick = () => scanId($("rd-idinfo"), res => {
    addId = res;
    $("rd-first").value = res.firstName; $("rd-last").value = res.lastName;
    if (res.birth) $("rd-birth").value = birthText(res.birth);
    return `Übernommen: ${esc(res.firstName)} ${esc(res.lastName)} · geb. ${res.birth ? birthText(res.birth) : "?"} · Ausweis-Nr. ${esc(res.docNumber)}. Bitte die Namen kurz prüfen: Umlaute stehen im Ausweis als AE/OE/UE.`;
  });
  $("reg-form").addEventListener("submit", async ev => {
    const mode = ev.submitter?.value;
    if (mode !== "save" && mode !== "sehtest") return;
    ev.preventDefault();
    const birth = EHFY.parseBirth($("rd-birth").value);
    if ($("rd-birth").value.trim() && !birth) { $("rd-error").textContent = "Bitte das Geburtsdatum so eingeben: TT.MM.JJJJ."; return; }
    try {
      const c = addCourse || current;
      const row = await db.addRegistration({
        course_id: c.id,
        first_name: $("rd-first").value.trim(), last_name: $("rd-last").value.trim(),
        birth_date: birth, package: mode === "sehtest" ? "komplett" : $("rd-pkg").value,
        ...(!$("rd-here-box").classList.contains("hidden") && $("rd-here").checked ? { status: "teilgenommen" } : {}),
        ...(addId ? { sehtest_id_doc: addId.idDoc, sehtest_id_no: addId.docNumber } : {}),
        email: $("rd-email").value.trim() || null, phone: $("rd-phone").value.trim() || null,
        street: $("rd-street").value.trim() || null, zip: $("rd-zip").value.trim() || null, city: $("rd-city").value.trim() || null,
        message: "manuell eingetragen"
      });
      rdlg.close();
      // Liste neu laden, wo du gerade bist (Teilnehmerliste oder Anwesenheit)
      const refresh = async () => { if (current && current.id === c.id && !$("participants-view").classList.contains("hidden")) await loadRegs(); await loadCourses(); };
      await refresh();
      if (mode === "sehtest") await openSehtest(row || {}, c, refresh);
    } catch (e) { $("rd-error").textContent = e.message; }
  });

  // ---------- QR-Ausdruck (A4-PDF): großer Code fürs Datenblatt, kleiner Code für die Google-Bewertung ----------
  async function qrSheetPdf(qr, when) {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    const C = { ink: hex("#0a2a35"), aid: hex("#29b4b6"), aidD: hex("#0b7b7f"), aidL: hex("#dcf5f4"), line: hex("#d9ecec"), soft: hex("#f1f7f8"), mu: hex("#4f6b76"), star: hex("#fbbc04"), white: rgb(1, 1, 1) };
    const pdf = await PDFDocument.create();
    pdf.setTitle("QR-Code Teilnehmerdatenblatt");
    const page = pdf.addPage([595.28, 841.89]);
    const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, mid = W / 2;
    const text = (t, y, size, font, color, x) => {
      const w = font.widthOfTextAtSize(t, size);
      page.drawText(t, { x: x == null ? mid - w / 2 : x, y, size, font, color });
      return w;
    };
    // Rechteck mit runden Ecken (SVG-Pfad: Ursprung oben links, y nach unten)
    const round = (x, top, w, h, r, o) => page.drawSvgPath(
      `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`, { x, y: top, ...o });
    const drawQr = (q, x, top, size) => {
      const n = q.getModuleCount(), cell = size / n;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!q.isDark(r, c)) continue;
          let e = c; while (e + 1 < n && q.isDark(r, e + 1)) e++;
          page.drawRectangle({ x: x + c * cell, y: top - (r + 1) * cell, width: (e - c + 1) * cell + 0.2, height: cell + 0.5, color: C.ink });
          c = e;
        }
      }
    };
    const star = (x, top, s, color) => {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.2 : s / 2;
        pts.push(`${(s / 2 + rr * Math.cos(a)).toFixed(2)},${(s / 2 + rr * Math.sin(a)).toFixed(2)}`);
      }
      page.drawSvgPath(`M${pts.join(" L")} Z`, { x, y: top, color });
    };

    // Rahmen mit dunklem Kopfband
    const L = 56.6, SW = 482, TOP = 806, BOT = 52;
    round(L, TOP, SW, TOP - BOT, 28, { color: C.white, borderColor: C.aid, borderWidth: 3 });
    page.drawSvgPath(`M28,0 H${SW - 28} Q${SW},0 ${SW},28 V30 H0 V28 Q0,0 28,0 Z`, { x: L, y: TOP, color: C.ink });

    // Logo
    try {
      const png = await pdf.embedPng(await (await fetch(new URL("assets/logo.png", location.href).href)).arrayBuffer());
      const lw = 190, lh = lw * png.height / png.width;
      page.drawImage(png, { x: mid - lw / 2, y: 760 - lh, width: lw, height: lh });
    } catch (e) { text(cfg.name || "Erste Hilfe for you", 715, 24, bold, C.ink); }

    text("Teilnehmerdatenblatt", 648, 28, bold, C.ink);
    text(when, 624, 13, bold, C.aidD);

    // Großer QR-Code
    const QS = 250, QB = QS + 24;
    round(mid - QB / 2, 606, QB, QB, 16, { color: C.white, borderColor: C.line, borderWidth: 2 });
    drawQr(qr, mid - QS / 2, 606 - 12, QS);

    // Drei Schritte
    const steps = ["QR-Code scannen", "Daten eintragen", "Unterschreiben"], sz = 11.5, gap = 14;
    const ws = steps.map(t => bold.widthOfTextAtSize(t, sz) + 44);
    let x = mid - (ws.reduce((a, b) => a + b, 0) + gap * 2) / 2;
    steps.forEach((t, i) => {
      round(x, 316, ws[i], 26, 13, { color: C.aidL });
      text(String(i + 1), 299, sz, bold, C.aidD, x + 14);
      text(t, 299, sz, bold, C.ink, x + 30);
      x += ws[i] + gap;
    });

    // Kleiner Bewertungs-Code
    const review = cfg.googleReviewUrl;
    if (review) {
      const g = window.qrcode(0, "M"); g.addData(review); g.make();
      const bx = L + 30, bw = SW - 60, btop = 272, bh = 118, rq = 86;
      round(bx, btop, bw, bh, 16, { color: C.soft, borderColor: C.line, borderWidth: 1.5 });
      round(bx + 16, btop - 16, rq + 10, rq + 10, 8, { color: C.white });
      drawQr(g, bx + 21, btop - 21, rq);
      const tx = bx + 16 + rq + 10 + 22;
      text("Hat dir der Kurs gefallen?", btop - 38, 15, bold, C.ink, tx);
      for (let i = 0; i < 5; i++) star(tx + i * 19, btop - 46, 16, C.star);
      // „Google“ in den bekannten Farben
      let gx = tx + 5 * 19 + 8;
      [["G", "#4285f4"], ["o", "#ea4335"], ["o", "#fbbc04"], ["g", "#4285f4"], ["l", "#34a853"], ["e", "#ea4335"]].forEach(([ch, col]) => {
        page.drawText(ch, { x: gx, y: btop - 59, size: 14, font: bold, color: hex(col) });
        gx += bold.widthOfTextAtSize(ch, 14);
      });
      text("Bewerte uns auf Google – das hilft uns sehr.", btop - 82, 11, reg, C.ink, tx);
      text("Kamera auf den kleinen Code halten.", btop - 98, 9.5, reg, C.mu, tx);
    }

    text("Erste Hilfe for you · Erste-Hilfe-Kurse für Führerschein & Beruf", 100, 10.5, bold, C.ink);
    text(`Tel. ${cfg.phone || ""} · www.ehfy.de`, 85, 10.5, reg, C.mu);
    return pdf.save();
  }

  // ---------- QR-Code: Schüler tragen sich mit dem eigenen Handy ein und unterschreiben mit dem Finger ----------
  function qrDialog() {
    let d = $("qr-dialog");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "qr-dialog"; d.className = "qr-dlg";
    d.innerHTML = `<h3 id="qr-title" style="margin:0 0 4px"></h3>
      <p class="small muted" style="margin:0 0 10px">Schüler scannen den Code mit der Handy-Kamera, tragen ihre Daten ein und unterschreiben mit dem Finger. Sie stehen danach sofort in der Teilnehmerliste.</p>
      <div id="qr-img" class="qr-img"></div>
      <p class="small" id="qr-msg" role="status"></p>
      <div class="btn-row"><button class="btn btn-sm btn-ghost" type="button" id="qr-print">Drucken</button><button class="btn btn-sm btn-ghost" type="button" id="qr-copy">Link kopieren</button><button class="btn btn-sm btn-ghost" type="button" id="qr-new">Neuer Code (alter wird ungültig)</button><button class="btn btn-sm" type="button" id="qr-close">Schließen</button></div>`;
    document.body.appendChild(d);
    $("qr-close").onclick = () => d.close();
    d.addEventListener("close", () => loadCourses().catch(() => {}));
    return d;
  }
  // c = Kurs; ohne Kurs: fester QR-Code, der immer gilt (Schüler wählen das Kursdatum selbst)
  async function openQr(c, renew) {
    const d = qrDialog();
    $("qr-title").textContent = c ? `${dayText(c.starts_at)} · ${fmtRange(c.starts_at, c.ends_at)}` : "Fester QR-Code (immer gültig)";
    $("qr-img").innerHTML = '<p class="muted">QR-Code wird erstellt …</p>';
    $("qr-msg").textContent = "";
    if (!d.open) d.showModal();
    try {
      const token = c ? await db.checkinToken(c.id, renew) : await db.checkinGeneralToken(renew);
      const link = new URL(`vor-ort.html?${c ? "k" : "g"}=${token}`, location.href).href;
      const qr = window.qrcode(0, "M");
      qr.addData(link); qr.make();
      $("qr-img").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
      $("qr-copy").onclick = async () => { try { await navigator.clipboard.writeText(link); $("qr-msg").textContent = "Link kopiert ✓"; } catch (e) { $("qr-msg").textContent = link; } };
      $("qr-new").onclick = () => { if (confirm(`Neuen QR-Code erstellen? Der bisherige Code funktioniert dann nicht mehr${c ? "" : " – auch nicht mehr auf Ausdrucken"}.`)) openQr(c, true); };
      $("qr-msg").textContent = c ? "Gültig von 2 Tagen vor bis 14 Tage nach dem Kurstag. Es geht keine Anmelde-Mail raus."
        : "Gilt immer. Die Schüler wählen das Kursdatum aus (Kurse der letzten 7 und nächsten 30 Tage). Es geht keine Anmelde-Mail raus.";
      // Als PDF: so geht es auch am iPhone (in der App über „Teilen / Drucken“)
      $("qr-print").onclick = async () => {
        const win = openTab();
        $("qr-msg").textContent = "PDF wird erstellt …";
        try {
          await ensurePdf();
          const bytes = await qrSheetPdf(qr, c ? `Kurs am ${dayText(c.starts_at)} in Siegen` : "Erste-Hilfe-Kurs in Siegen");
          showPdf(bytes, "QR-Code Teilnehmerdatenblatt.pdf", win);
          $("qr-msg").textContent = "";
        } catch (e) { if (win) win.close(); $("qr-msg").textContent = "PDF konnte nicht erstellt werden: " + e.message; }
      };
    } catch (e) { $("qr-img").innerHTML = ""; $("qr-msg").textContent = e.message; }
  }

  // ---------- Schüler vor Ort erfassen (vor allem am Handy) ----------
  // Ausweis/Pass oder Teilnehmerdatenblatt fotografieren, Angaben prüfen, speichern, nächster.
  // Kursdatum ist heute, lässt sich aber ändern. Gibt es an dem Tag noch keinen Kurs, wird er beim Speichern angelegt.
  let cap = null; // { idRes, sheetFile, done: [registrations] }
  const CAP_FIELDS = [["first", "Vorname"], ["last", "Nachname"], ["birth", "Geburtsdatum", "TT.MM.JJJJ"], ["idno", "Ausweis-Nr. (freiwillig)"]];
  const CAP_MORE = [["street", "Straße und Nr."], ["zip", "PLZ"], ["city", "Ort"], ["phone", "Telefon"], ["email", "E-Mail"]];
  const capInput = ([k, l, ph]) => `<div class="field"><label for="cap-${k}">${l}</label><input id="cap-${k}" autocomplete="off"${ph ? ` placeholder="${ph}" inputmode="numeric"` : ""}${k === "email" ? ' type="email"' : k === "phone" ? ' type="tel"' : ""}></div>`;
  function capDialog() {
    let d = $("cap-dialog");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "cap-dialog"; d.className = "cap-dlg";
    d.innerHTML = `<div class="cap-head"><h3>Schüler vor Ort erfassen</h3><button class="btn btn-sm btn-ghost" type="button" id="cap-close">Fertig</button></div>
      <div class="cap-grid">
        <div class="field"><label for="cap-date">Kursdatum</label><input type="date" id="cap-date"></div>
        <div class="field"><label for="cap-loc">Ort</label><input id="cap-loc" list="loc-list" autocomplete="off"></div>
      </div>
      <p class="small" id="cap-course-info"></p>
      <button class="btn btn-sm btn-outline hidden" type="button" id="cap-qr" style="margin-bottom:10px">QR-Code: Schüler tragen sich selbst ein</button>
      <div class="cap-grid hidden" id="cap-times">
        <div class="field"><label for="cap-start">Beginn</label><input id="cap-start"></div>
        <div class="field"><label for="cap-end">Ende</label><input id="cap-end"></div>
      </div>
      <button class="btn cap-read" type="button" id="cap-read">📷 Daten auslesen</button>
      <p class="small muted" style="margin:4px 0 0">Ausweis (Vorder- und Rückseite), Teilnehmerdatenblatt oder Zettel fotografieren.</p>
      <p class="small" id="cap-info" role="status"></p>
      <div class="cap-grid">${CAP_FIELDS.map(capInput).join("")}</div>
      <details class="cap-more"><summary>Adresse, Telefon, E-Mail</summary><div class="cap-grid">${CAP_MORE.map(capInput).join("")}</div></details>
      <div class="cap-grid">
        <div class="field"><label for="cap-pkg">Gebucht</label><select id="cap-pkg"><option value="kurs">Erste-Hilfe-Kurs</option><option value="komplett">Kurs + Sehtest</option></select></div>
        <label class="check-line" id="cap-here-box"><input type="checkbox" id="cap-here" checked> Ist da (als „✓ Da“ eintragen)</label>
      </div>
      <p class="form-error" id="cap-error"></p>
      <button class="btn cap-save" type="button" id="cap-save">Speichern und nächster Schüler</button>
      <div id="cap-done"></div>`;
    document.body.appendChild(d);
    timeField($("cap-start")); timeField($("cap-end"));
    $("cap-close").onclick = () => d.close();
    d.addEventListener("close", () => { if (cap && cap.done.length) loadCourses().catch(() => {}); });
    $("cap-date").addEventListener("change", capCourseInfo);
    $("cap-loc").addEventListener("input", capCourseInfo);
    $("cap-read").onclick = () => pickPhoto(async file => {
      const btn = $("cap-read");
      btn.disabled = true; btn.textContent = "⏳ Foto wird gelesen …";
      try { await capRead(file); }
      catch (e) { $("cap-info").innerHTML = `<strong style="color:var(--danger)">Das Foto konnte nicht gelesen werden:</strong> ${esc(e.message || String(e))}`; }
      finally { btn.disabled = false; btn.textContent = "📷 Daten auslesen"; }
    });
    $("cap-save").onclick = capSave;
    $("cap-qr").onclick = () => { const c = capCourse(); if (c) openQr(c); };
    $("cap-done").addEventListener("click", async ev => {
      const b = ev.target.closest("[data-cap-del]");
      if (!b) return;
      const r = cap.done.find(x => x.id === b.dataset.capDel);
      if (!r || !confirm(`${r.first_name} ${r.last_name} wieder löschen?`)) return;
      try { await removeRegistration(r); cap.done = cap.done.filter(x => x !== r); capRenderDone(); await loadCourses(); } catch (e) { $("cap-error").textContent = e.message; }
    });
    return d;
  }
  // Ein Foto, automatisch erkannt: Ausweis-Rückseite / Reisepass (Lesezeile), Ausweis-Vorderseite oder Datenblatt/Zettel
  async function capRead(file) {
    const info = $("cap-info"), A = window.EHFYAusweis;
    const set = (k, v) => { if (v) $("cap-" + k).value = v; };
    const put = (k, v) => { if (v && !$("cap-" + k).value.trim()) $("cap-" + k).value = v; };
    info.textContent = "Foto wird gelesen … (beim ersten Mal lädt die Texterkennung, das dauert etwas)";
    const small = await shrinkPhoto(file);
    const mrz = await A.read(file, pct => { info.textContent = `Foto wird gelesen … ${pct} %`; });
    if (mrz) {
      // Ausweis oder Pass: die Angaben aus der Lesezeile sind verlässlich und ersetzen alles andere
      cap.idRes = mrz;
      set("first", mrz.firstName); set("last", mrz.lastName); set("birth", mrz.birth && birthText(mrz.birth)); set("idno", mrz.docNumber);
      const unsure = mrz.allOk ? "" : " <strong style=\"color:var(--danger)\">Nummer oder Geburtsdatum unsicher gelesen – bitte mit dem Ausweis vergleichen.</strong>";
      if (mrz.idDoc === "reisepass") {
        info.innerHTML = `✓ <strong>Reisepass erkannt:</strong> ${esc(mrz.firstName)} ${esc(mrz.lastName)}. Im Reisepass steht keine Adresse – bitte unten eintragen.${unsure}`;
        $("cap-dialog").querySelector(".cap-more").open = true;
        return;
      }
      info.textContent = "Ausweis erkannt – Adresse wird gelesen …";
      const back = await A.readSheet(small).catch(() => ({}));
      set("street", back.street); set("zip", back.zip); set("city", back.city);
      $("cap-dialog").querySelector(".cap-more").open = true;
      info.innerHTML = `✓ <strong>Ausweis erkannt:</strong> ${esc(mrz.firstName)} ${esc(mrz.lastName)}, Ausweis-Nr. ${esc(mrz.docNumber)}. `
        + (back.zip || back.street ? "Adresse übernommen – bitte kurz prüfen." : "Die Adresse wurde nicht erkannt – bitte eintragen.")
        + " Umlaute stehen im Ausweis als AE/OE/UE." + unsure;
      return;
    }
    const res = await A.readSheet(small, pct => { info.textContent = `Foto wird gelesen … ${pct} %`; });
    if (/personalausweis|identity\s*card|carte\s*d.identit|bundesrepublik|reisepass|passport|aufenthaltstitel/i.test(res.text)) {
      // Vorderseite: Nummer steht oben rechts, der Rest kommt sicherer von der Rückseite
      const nr = res.text.toUpperCase().match(/\b[CFGHJKLMNPRTVWXYZ][CFGHJKLMNPRTVWXYZ0-9]{8}\b/);
      if (nr) set("idno", nr[0]);
      put("first", res.firstName); put("last", res.lastName); put("birth", res.birth && birthText(res.birth));
      info.innerHTML = `✓ <strong>Ausweis erkannt (Vorderseite).</strong> 👉 Bitte jetzt die <strong>Rückseite</strong> fotografieren – dort stehen die Adresse und die Lesezeile mit Name, Geburtsdatum und Ausweisnummer.`;
      return;
    }
    // Teilnehmerdatenblatt oder Zettel: Angaben vorschlagen, Foto beim Schüler speichern
    cap.sheetFile = small;
    put("first", res.firstName); put("last", res.lastName); put("birth", res.birth && birthText(res.birth));
    put("street", res.street); put("zip", res.zip); put("city", res.city); put("phone", res.phone); put("email", res.email);
    const got = ["firstName", "lastName", "birth", "street", "zip", "phone", "email"].filter(k => res[k]).length;
    if (res.street || res.zip || res.phone || res.email) $("cap-dialog").querySelector(".cap-more").open = true;
    const tips = "Tipps: nah ran, sodass Ausweis oder Zettel das Bild füllt · gerade von oben · gutes Licht, keine Spiegelung · beim Ausweis die Rückseite mit den „&lt;&lt;&lt;“-Zeilen.";
    info.innerHTML = got ? `✓ <strong>Datenblatt/Zettel:</strong> ${got} Angaben erkannt – bitte prüfen und ergänzen. Das Foto wird beim Schüler gespeichert.`
      : `<strong style="color:var(--danger)">Nicht lesbar.</strong> Bitte noch einmal fotografieren oder eintippen. ${tips}`;
  }
  // Große Handyfotos verkleinern: schneller zu lesen und kleiner gespeichert
  async function shrinkPhoto(file) {
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.85));
      return blob ? new File([blob], "datenblatt.jpg", { type: "image/jpeg" }) : file;
    } catch (e) { return file; }
  }
  const capDay = c => localDate(new Date(c.starts_at));
  function capCourse() {
    const day = $("cap-date").value, loc = $("cap-loc").value.trim().toLowerCase();
    const same = courses.filter(c => capDay(c) === day && c.status !== "abgesagt");
    return same.find(c => c.location.toLowerCase() === loc) || (!loc && same[0]) || null;
  }
  function capCourseInfo() {
    const c = capCourse(), day = $("cap-date").value;
    $("cap-times").classList.toggle("hidden", Boolean(c));
    $("cap-qr").classList.toggle("hidden", !c);
    $("cap-here-box").classList.toggle("hidden", !day || day > localDate(new Date()));
    if (c) { $("cap-course-info").innerHTML = `✓ Kurs vorhanden: <strong>${fmtRange(c.starts_at, c.ends_at)} · ${esc(c.location)}</strong>`; return; }
    const l = qList.find(x => x.name.toLowerCase() === $("cap-loc").value.trim().toLowerCase());
    if (l && !$("cap-start").dataset.touched) { $("cap-start").value = l.start || "10:00"; $("cap-end").value = l.end || "17:30"; }
    $("cap-course-info").textContent = "An diesem Tag gibt es hier noch keinen Kurs. Er wird beim ersten Speichern angelegt.";
  }
  function capReset() {
    cap.idRes = null; cap.sheetFile = null;
    [...CAP_FIELDS, ...CAP_MORE].forEach(([k]) => { $("cap-" + k).value = ""; });
    $("cap-dialog").querySelector(".cap-more").open = false;
    $("cap-error").textContent = "";
  }
  function capRenderDone() {
    $("cap-done").innerHTML = cap.done.length ? `<h4>Gerade erfasst (${cap.done.length})</h4>` + cap.done.slice().reverse().map(r =>
      `<div class="cap-row"><span>${esc(r.last_name)}, ${esc(r.first_name)}${r.birth_date ? ` <span class="small muted">· ${birthText(r.birth_date)}</span>` : ""}</span><button class="btn btn-sm btn-ghost" type="button" data-cap-del="${r.id}" style="color:var(--danger)">Löschen</button></div>`).join("") : "";
  }
  function openCapture() {
    const d = capDialog(), today = localDate(new Date());
    cap = { idRes: null, sheetFile: null, done: [] };
    capReset();
    $("cap-date").value = today;
    // Ort ist in der Regel Siegen
    $("cap-loc").value = cfg.defaultLocation || "Siegen";
    $("cap-start").value = "10:00"; $("cap-end").value = "17:30";
    $("cap-info").textContent = ""; $("cap-done").innerHTML = "";
    capCourseInfo();
    d.showModal();
    d.scrollTop = 0;
  }
  async function capSave() {
    const err = $("cap-error"), btn = $("cap-save");
    err.textContent = "";
    const first = $("cap-first").value.trim(), last = $("cap-last").value.trim();
    if (!first || !last) { err.textContent = "Bitte Vor- und Nachname eintragen."; return; }
    const birth = EHFY.parseBirth($("cap-birth").value);
    if ($("cap-birth").value.trim() && !birth) { err.textContent = "Bitte das Geburtsdatum so eingeben: TT.MM.JJJJ."; return; }
    const day = $("cap-date").value, loc = $("cap-loc").value.trim();
    if (!day) { err.textContent = "Bitte das Kursdatum eintragen."; return; }
    btn.disabled = true;
    try {
      let c = capCourse();
      if (!c) {
        if (!loc) throw new Error("Bitte den Ort eintragen.");
        const start = $("cap-start").value || "10:00", end = $("cap-end").value;
        const l = qList.find(x => x.name.toLowerCase() === loc.toLowerCase());
        c = await db.saveCourse({
          starts_at: new Date(`${day}T${start}`).toISOString(), ends_at: end && end > start ? new Date(`${day}T${end}`).toISOString() : null,
          location: loc, address: (l && l.address) || loc, capacity: (l && l.capacity) || cfg.defaultCapacity || 12,
          note: null, status: "offen", online_booking: false
        });
        courses.push({ ...c, booked: 0 });
      }
      const idno = $("cap-idno").value.trim();
      const here = $("cap-here").checked && day <= localDate(new Date());
      const row = await db.addRegistration({
        course_id: c.id, first_name: first, last_name: last, birth_date: birth, package: $("cap-pkg").value,
        ...(here ? { status: "teilgenommen" } : {}),
        ...(idno ? { sehtest_id_no: idno, sehtest_id_doc: cap.idRes ? cap.idRes.idDoc : null } : {}),
        email: $("cap-email").value.trim() || null, phone: $("cap-phone").value.trim() || null,
        street: $("cap-street").value.trim() || null, zip: $("cap-zip").value.trim() || null, city: $("cap-city").value.trim() || null,
        message: "manuell eingetragen" // keine Anmelde-Mail
      });
      let note = "";
      if (cap.sheetFile) {
        try {
          await db.saveTemplate(protocolKey(row.id), await protocolPdf(cap.sheetFile));
          await db.updateRegistration(row.id, { protocol_added_on: localDate(new Date()) });
          row.protocol_added_on = localDate(new Date());
        } catch (e) { note = " Das Foto vom Datenblatt konnte nicht gespeichert werden (kein Internet?). Die Angaben sind gespeichert."; }
      }
      cap.done.push(row);
      capReset();
      capRenderDone();
      capCourseInfo();
      $("cap-info").textContent = `✓ ${first} ${last} gespeichert.${note} Nächster Schüler:`;
      $("cap-dialog").scrollTop = 0;
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; }
  }
  $("cap-open").onclick = openCapture;
  $("qr-general").onclick = () => openQr(null);

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
    if (!st.pending) askedAt = 0;
    renderReminder(st);
    if (courses.length) renderStart();
  }
  const runSync = () => { db.clearNew(); return db.sync().catch(() => {}); };

  // ---------- Herunterziehen zum Aktualisieren (Handy): ganz oben nach unten ziehen und loslassen ----------
  (function pullToRefresh() {
    const bar = document.createElement("div");
    bar.className = "ptr no-print";
    bar.innerHTML = '<span class="ptr-icon">↻</span><span class="ptr-text">Zum Aktualisieren ziehen</span>';
    document.body.appendChild(bar);
    const LIMIT = 80;
    let startY = null, dy = 0, busy = false;
    const reset = () => { startY = null; dy = 0; bar.style.transform = ""; bar.classList.remove("ready"); };
    document.addEventListener("touchstart", ev => {
      if (busy || ev.touches.length !== 1 || window.scrollY > 0 || document.querySelector("dialog[open]")
        || $("app-view").classList.contains("hidden") || ev.target.closest("canvas, input, select, textarea, .table-wrap")) return;
      startY = ev.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchmove", ev => {
      if (startY === null) return;
      dy = ev.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) { reset(); return; }
      const pull = Math.min(dy * 0.5, LIMIT + 20);
      bar.style.transform = `translate(-50%, ${pull}px)`;
      bar.classList.toggle("ready", dy * 0.5 >= LIMIT);
      bar.querySelector(".ptr-text").textContent = dy * 0.5 >= LIMIT ? "Loslassen zum Aktualisieren" : "Zum Aktualisieren ziehen";
    }, { passive: true });
    document.addEventListener("touchend", async () => {
      if (startY === null) return;
      const go = dy * 0.5 >= LIMIT;
      if (!go) { reset(); return; }
      busy = true; startY = null;
      bar.classList.add("busy");
      bar.querySelector(".ptr-text").textContent = "Wird aktualisiert …";
      bar.style.transform = `translate(-50%, ${LIMIT * 0.6}px)`;
      try { await runSync(); await loadCourses(); refreshViews(); } catch (e) { /* Meldung zeigt die Sync-Leiste */ }
      setTimeout(() => { bar.classList.remove("busy"); busy = false; reset(); }, 400);
    });
  })();
  $("sync-btn").onclick = runSync;

  // ---------- Erinnerung ans Synchronisieren ----------
  let shownPending = 0;
  function renderReminder(st) {
    const bar = $("sync-reminder");
    // Nicht bei jeder Eingabe stören: Die Leiste erscheint nur ohne Internet. Gefragt wird beim Wechseln oder Verlassen.
    bar.classList.toggle("hidden", !st.pending || st.online || $("app-view").classList.contains("hidden"));
    document.body.classList.toggle("has-reminder", !bar.classList.contains("hidden"));
    $("sr-text").textContent = st.online ? `${changes(st.pending)} noch nicht synchronisiert` : `${changes(st.pending)} warten auf Internet`;
    $("sr-btn").disabled = !st.online || st.syncing;
    $("sr-btn").textContent = st.syncing ? "Wird übertragen …" : "Jetzt synchronisieren";
    shownPending = st.pending;
  }
  $("sr-btn").onclick = runSync;

  var askedAt = 0; // Bei so vielen offenen Änderungen wurde zuletzt gefragt
  function askToSync(onlyNew) {
    const st = db.status();
    if (onlyNew && st.pending <= askedAt) return;
    askedAt = st.pending;
    // Mit Internet wird ohnehin automatisch übertragen: nur ohne Internet nachfragen
    if (st.online && st.pending) { runSync(); return; }
    if (!st.pending || $("app-view").classList.contains("hidden") || document.querySelector("dialog[open]")) return;
    $("rm-text").textContent = `${changes(st.pending)} ${st.pending === 1 ? "ist" : "sind"} noch nicht synchronisiert. Teilnehmer und deine anderen Geräte sehen sie erst danach.`;
    $("rm-sync").disabled = !st.online;
    $("remind-dialog").showModal();
  }
  $("rm-sync").onclick = () => { $("remind-dialog").close(); runSync(); };
  $("rm-later").onclick = () => $("remind-dialog").close();
  // Nach der Sync-Frage gleich nach offenen Sehtest-Bescheinigungen fragen
  $("remind-dialog").addEventListener("close", () => setTimeout(() => askCertificates(), 300));

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
    setTimeout(() => askCertificates(), 500);
  });

  let lastView = "";
  window.addEventListener("ehfy-sync", () => {
    renderSync();
    // Listen auffrischen, aber nur wenn sich etwas geändert hat und kein Fenster offen ist
    if (document.querySelector("dialog[open]")) return;
    const view = JSON.stringify([db.status().lastSync, db.status().pending, db.status().newRegs]);
    if (view === lastView) return;
    lastView = view;
    if (!$("start-view").classList.contains("hidden") || !$("courses-view").classList.contains("hidden") || !$("attendance-view").classList.contains("hidden") || !$("fee-view").classList.contains("hidden")) loadCourses();
    if (!$("participants-view").classList.contains("hidden") && current) loadRegs();
    if (!$("invoices-view").classList.contains("hidden")) loadInvoices();
    if (!$("students-view").classList.contains("hidden")) loadStudents();
    if (!$("sehtest-view").classList.contains("hidden")) loadSehtests();
  });

  // ---------- Bereiche: Termine, Rechnungen, Vorlagen ----------
  let navRestoring = false;
  $("main-tabs").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-view]");
    if (!b) return;
    // Für den Zurück-Knopf merken, woher du kommst
    const was = $("main-tabs").querySelector("button.active");
    // Beim Wechsel in einen anderen Bereich einmal fragen, ob synchronisiert werden soll
    if (was && was !== b) { askToSync(true); setTimeout(() => askCertificates(), 300); }
    if (was && was !== b && !navRestoring) window.EHFYNav.push(() => { navRestoring = true; was.click(); navRestoring = false; });
    $("main-tabs").querySelectorAll("button[data-view]").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll("[data-section]").forEach(el => el.classList.add("hidden"));
    $("nav-more").classList.toggle("hidden", !b.closest("#nav-more"));
    $("nav-more-btn").setAttribute("aria-expanded", String(!$("nav-more").classList.contains("hidden")));
    $("nav-more-btn").classList.toggle("active", Boolean(b.closest("#nav-more")));
    if (b.dataset.view === "start") { $("start-view").classList.remove("hidden"); loadCourses(); }
    if (b.dataset.view === "termine") { $("courses-view").classList.remove("hidden"); loadCourses(); }
    if (b.dataset.view === "anwesenheit") { $("attendance-view").classList.remove("hidden"); loadCourses(); }
    if (b.dataset.view === "schueler") { $("students-view").classList.remove("hidden"); loadStudents(); }
    if (b.dataset.view === "sehtests") { $("sehtest-view").classList.remove("hidden"); loadSehtests(); }
    if (b.dataset.view === "gebuehren") { $("fee-view").classList.remove("hidden"); loadCourses(); }
    if (b.dataset.view === "finanzen") { $("finance-view").classList.remove("hidden"); window.EHFYFinance.render(); }
    if (b.dataset.view === "rechnungen") { $("invoices-view").classList.remove("hidden"); loadInvoices(); }
    if (b.dataset.view === "vorlagen") { $("templates-view").classList.remove("hidden"); renderTemplates(); renderBank(); renderPush(); }
  });

  $("nav-more-btn").onclick = () => {
    const open = $("nav-more").classList.toggle("hidden");
    $("nav-more-btn").setAttribute("aria-expanded", String(!open));
  };

  // ---------- Start: heute, zu erledigen, nächste Kurse ----------
  let uncheckedCount = 0, feeTotal = 0;
  const goView = v => document.querySelector(`#main-tabs [data-view="${v}"]`).click();
  function goCourse(id) {
    const c = courses.find(x => x.id === id);
    if (!c) return;
    goView("termine");
    openParticipants(c);
  }
  function renderStart() {
    if (!$("start-today")) return;
    const today = localDate(new Date()), day = c => localDate(new Date(c.starts_at));
    $("start-date").textContent = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const todays = courses.filter(c => day(c) === today);
    const upcoming = courses.filter(c => day(c) > today && c.status !== "abgesagt").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const people = c => attRegs.filter(r => r.course_id === c.id && r.status !== "storniert");
    $("start-today").innerHTML = `<h2>Heute</h2>` + (todays.length ? todays.map(c => {
      const list = people(c), da = list.filter(r => r.status === "teilgenommen").length;
      const seh = list.filter(r => r.package === "komplett" || r.sehtest_passed != null), sehDone = seh.filter(r => r.sehtest_passed != null).length;
      return `<p class="start-big">${esc(c.location)} · ${fmtRange(c.starts_at, c.ends_at)}${c.status === "abgesagt" ? " · ABGESAGT" : ""}</p>
        <p class="small muted">${list.length} angemeldet · ${da} da${seh.length ? ` · Sehtests ${sehDone} von ${seh.length}` : ""}</p>
        <div class="btn-row"><button class="btn" type="button" data-go="anwesenheit">Kurstag öffnen</button><button class="btn btn-ghost" type="button" data-qr="${c.id}">QR-Code zum Eintragen</button><button class="btn btn-ghost" type="button" data-open="${c.id}">Teilnehmerliste</button></div>`;
    }).join("") : `<p class="start-big">Heute ist kein Kurs.</p>${upcoming[0] ? `<p class="small muted">Nächster Kurs: ${dayText(upcoming[0].starts_at)} in ${esc(upcoming[0].location)}</p>` : ""}`);
    const st = db.status(), unwritten = attRegs.filter(r => r.sehtest_nr && !r.sehtest_issued_at && !r.sehtest_void_at).length;
    const todo = [
      [unwritten, unwritten === 1 ? "Sehtest-Bescheinigung noch nicht geschrieben" : "Sehtest-Bescheinigungen noch nicht geschrieben", 'data-go="sehtests"'],
      [uncheckedCount, uncheckedCount === 1 ? "Schüler noch nicht abgehakt" : "Schüler noch nicht abgehakt", 'data-unchecked'],
      [feeTotal, feeTotal === 1 ? "Ausfallgebühr offen" : "Ausfallgebühren offen", 'data-go="gebuehren"'],
      [st.pending, st.pending === 1 ? "Änderung nicht synchronisiert" : "Änderungen nicht synchronisiert", "data-sync"]
    ].filter(x => x[0]);
    $("start-todo").innerHTML = `<h2>Zu erledigen</h2>` + (todo.length
      ? todo.map(([n, text, attr]) => `<button class="todo-item" type="button" ${attr}><b>${n}</b><span>${text}</span><span aria-hidden="true">›</span></button>`).join("")
      : '<p class="start-big">✓ Alles erledigt</p>');
    $("start-next").innerHTML = (upcoming.length ? upcoming.slice(0, 5).map(c => `<button class="next-row" type="button" data-open="${c.id}">
        <strong>${dayText(c.starts_at)}</strong><span>${esc(c.location)} · ${fmtRange(c.starts_at, c.ends_at)}</span><span class="next-cap">${c.booked} / ${c.capacity}</span></button>`).join("")
      : '<p class="muted">Keine kommenden Kurse.</p>') + '<button class="btn btn-ghost" type="button" data-go="termine" style="margin-top:8px">Alle Termine und neuen Termin freigeben</button>';
  }
  $("start-view").addEventListener("click", ev => {
    const go = ev.target.closest("[data-go]"), open = ev.target.closest("[data-open]");
    if (go) return goView(go.dataset.go);
    const qr = ev.target.closest("[data-qr]");
    if (qr) return openQr(courses.find(c => c.id === qr.dataset.qr));
    if (open) return goCourse(open.dataset.open);
    if (ev.target.closest("[data-sync]")) return runSync();
    if (ev.target.closest("[data-unchecked]")) {
      const d = $("att-unchecked").querySelector("details");
      if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }
  });
  $("start-search").addEventListener("keydown", ev => { if (ev.key === "Enter") ev.preventDefault(); });
  $("start-search").addEventListener("input", () => {
    const v = $("start-search").value;
    if (!v.trim()) return;
    $("start-search").value = "";
    goView("schueler");
    $("sc-search").value = v;
    $("sc-search").focus();
    $("sc-search").dispatchEvent(new Event("input"));
  });

  // ---------- Sehtest abhaken: gemacht, Ergebnis, Verlauf, Sehhilfe, Ausweis, Protokoll ----------
  const ID_DOCS = [["personalausweis", "Personalausweis"], ["reisepass", "Reisepass"], ["aufenthaltstitel", "Aufenthaltstitel"], ["sonstiges", "Sonstiges (z. B. Duldung)"]];
  const aidKind = r => r.sehtest_aid_kind || (r.sehtest_aid === false ? "ohne" : null);
  // Nur Anzeige: Alle Angaben (Ergebnis, Verlauf, Sehhilfe, Ausweis, Datum) werden im Protokoll eingetragen
  function sehtestControls(r, c) {
    const day = sehtestDay(r, c);
    const res = r.sehtest_passed === true ? '<strong style="color:var(--ok)">bestanden</strong>'
      : r.sehtest_passed === false ? '<strong style="color:var(--danger)">nicht bestanden</strong>'
      : stStarted(r) ? "zwischengespeichert, noch kein Ergebnis" : "—";
    return `<div class="st-row st-sum">
      <div class="st-group"><span class="st-label">Sehtest:</span><strong>${r.sehtest_passed != null ? "gemacht" : stStarted(r) ? "angefangen" : "nicht gemacht"}</strong>${r.sehtest_passed != null && day ? ` <span class="small muted">am ${birthText(day)}</span>` : ""}</div>
      <div class="st-group"><span class="st-label">Ergebnis:</span>${res}${r.sehtest_nr ? ` <span class="small muted">· Nr. ${esc(r.sehtest_nr)}</span>` : ""}${issuedTag(r)}</div>
      <div class="st-group"><button class="btn btn-sm" type="button" data-st-run>${stRunLabel(r)}</button>${issuedBtn(r)}<button class="btn btn-sm btn-ghost" type="button" data-st-print>Protokoll (PDF)</button>${r.sehtest_nr ? '<button class="btn btn-sm btn-ghost" type="button" data-st-nr>Nr. ändern</button><button class="btn btn-sm btn-ghost" type="button" data-st-again>Neuer Sehtest (neue Nr.)</button>' : ""}</div>
    </div>`;
  }
  async function handleSehtest(btn, r, c) {
    const today = () => (c ? dayOf(c.starts_at) : localDate(new Date()));
    const group = btn.dataset.st, raw = btn.dataset.val;
    if (group === "done") {
      const done = Boolean(sehtestDay(r, c));
      // Eine schon vergebene Protokoll-Nummer bleibt erhalten
      return db.updateRegistration(r.id, done
        ? { sehtest_on: null, sehtest_none: true, sehtest_passed: null, sehtest_aid: null, sehtest_aid_kind: null, sehtest_flow: null, sehtest_id_doc: null }
        : { sehtest_on: today(), sehtest_none: false });
    }
    const field = { passed: "sehtest_passed", flow: "sehtest_flow", aid: "sehtest_aid_kind", iddoc: "sehtest_id_doc" }[group];
    const value = group === "passed" ? raw === "true" : raw;
    const cur = group === "aid" ? aidKind(r) : r[field];
    const patch = { [field]: cur === value ? null : value };
    if (group === "aid") patch.sehtest_aid = patch.sehtest_aid_kind ? patch.sehtest_aid_kind !== "ohne" : null;
    // Wer Angaben zum Sehtest hat, hat ihn auch gemacht
    if (patch[field] !== null && !sehtestDay(r, c)) { patch.sehtest_on = today(); patch.sehtest_none = false; }
    // Die fortlaufende Nummer vergibt die Datenbank beim ersten Ergebnis, deshalb mit Internet sofort online
    if (group === "passed" && patch.sehtest_passed !== null && !r.sehtest_nr) return db.updateRegistrationNow(r.id, patch);
    return db.updateRegistration(r.id, patch);
  }
  // Nächste Protokoll-Nummer, nur als Vorschau. Die endgültige vergibt die Datenbank beim Ergebnis.
  async function draftNr() {
    // Eingestellte Startnummer (aus der Datenbank), sonst wie bisher S26-…
    try { const next = await db.getNextSehtestNr(); if (next) return next; } catch (e) { /* offline: Schätzung unten */ }
    const yy = String(new Date().getFullYear()).slice(2);
    const used = (await db.listAllRegistrations()).map(x => (String(x.sehtest_nr || "").match(new RegExp(`^S${yy}-(\\d+)$`)) || [])[1]).filter(Boolean).map(Number);
    return `S${yy}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
  }
  const nrTaken = async (nr, id) => (await db.listAllRegistrations()).some(x => x.id !== id && x.sehtest_nr === nr);
  const nrError = (e, nr) => (/duplicate|unique/i.test(e.message || "") ? new Error(`Die Protokoll-Nummer ${nr} ist schon vergeben.`) : e);
  // Sehtest wiederholen: neuer Eintrag „nur Sehtest“ mit denselben Personendaten.
  // Er bekommt beim Ergebnis die nächste Nummer, das alte Protokoll mit seiner Nummer bleibt erhalten.
  async function againSehtest(r, done) {
    if (!confirm(`Neuen Sehtest für ${r.first_name} ${r.last_name} anlegen?\n\nEr bekommt beim Ergebnis die nächste fortlaufende Nummer. Das bisherige Protokoll${r.sehtest_nr ? ` (Nr. ${r.sehtest_nr})` : ""} bleibt erhalten.`)) return;
    const row = await db.addRegistration({
      course_id: null, first_name: r.first_name, last_name: r.last_name, birth_date: r.birth_date || null,
      phone: r.phone || null, email: r.email || null, street: r.street || null, zip: r.zip || null, city: r.city || null,
      package: "kurs", sehtest_only: true, sehtest_on: localDate(new Date()), sehtest_none: false,
      sehtest_id_doc: r.sehtest_id_doc || null, sehtest_id_no: r.sehtest_id_no || null,
      message: "manuell eingetragen" // keine Anmelde-Mail
    });
    if (done) await done();
    await openSehtest(row, null, done);
  }
  // Nummer ändern: Nur diese eine Nummer ändert sich, bestätigte Nummern anderer Sehtests bleiben.
  // Ist die gewünschte Nummer belegt, warnen und anbieten, den anderen Eintrag als Ausschuss zu markieren.
  async function changeNr(r, nrIn) {
    if (r.sehtest_issued_at && !confirm(`Achtung: Für Nr. ${r.sehtest_nr} (${r.first_name} ${r.last_name}) ist die Sehtest-Bescheinigung schon geschrieben. Die Nummer steht auf der Bescheinigung und sollte nicht mehr geändert werden.\n\nTrotzdem ändern?`)) return false;
    const nr = nrIn || (prompt("Neue Protokoll-Nummer:", r.sehtest_nr || "") || "").trim();
    if (!nr || nr === r.sehtest_nr) return false;
    try { await db.setSehtestNr(r.id, nr, false); }
    catch (e) {
      const m = String(e.message || "").match(/BELEGT\|([^|]*)\|(\w+)/);
      if (!m) throw e;
      const ok = confirm(`Achtung: Die Nummer ${nr} ist schon belegt – ${m[1]} (Bescheinigung ${m[2] === "ja" ? "schon geschrieben" : "noch nicht geschrieben"}).\n\n`
        + `Soll der Sehtest von ${m[1]} als AUSSCHUSS markiert werden (Schüler wollte doch keinen / Bescheinigung verschrieben)? Dann ist die Nummer frei und wird hier vergeben.`);
      if (!ok) return false;
      await db.setSehtestNr(r.id, nr, true);
    }
    if (r.sehtest_issued_at) await db.updateRegistration(r.id, { sehtest_issued_at: null });
    return true;
  }
  // Als Ausschuss markieren: Nummer wird frei, der Eintrag bleibt zur Nachvollziehbarkeit
  async function voidAsk(r) {
    const reason = prompt(`Sehtest von ${r.first_name} ${r.last_name}${r.sehtest_nr ? ` (Nr. ${r.sehtest_nr})` : ""} als AUSSCHUSS markieren?\n\nDie Nummer wird dann frei. Grund (freiwillig), z. B. „Schüler wollte keinen“ oder „Bescheinigung verschrieben“:`, "");
    if (reason === null) return false;
    await db.voidSehtest(r.id, reason.trim());
    return true;
  }
  // „Bescheinigung geschrieben“: auf Anhieb erkennbar, ob die Bescheinigung schon geschrieben ist
  const issuedOk = r => Boolean(r.sehtest_issued_at);
  const issuedTag = r => r.sehtest_void_at ? ` <span class="st-void">Ausschuss${r.sehtest_void_nr ? ` (Nr. ${esc(r.sehtest_void_nr)})` : ""}${r.sehtest_void_reason ? ` · ${esc(r.sehtest_void_reason)}` : ""}</span>`
    : !r.sehtest_nr ? "" : r.sehtest_issued_at ? ' <span class="st-fix">✓ Bescheinigung geschrieben</span>' : ' <span class="st-reissue">✗ Bescheinigung noch nicht geschrieben</span>';
  const issuedBtn = r => r.sehtest_nr && !r.sehtest_void_at ? `<button class="btn btn-sm btn-ghost att-btn ${issuedOk(r) ? "on-yes" : ""}" type="button" data-st-issued aria-pressed="${issuedOk(r)}">${issuedOk(r) ? "✓ Bescheinigung geschrieben" : "Bescheinigung geschrieben?"}</button>`
    + '<button class="btn btn-sm btn-ghost" type="button" data-st-void style="color:var(--danger)">Ausschuss</button>' : "";
  async function toggleIssued(r) {
    if (r.sehtest_issued_at) {
      if (!confirm(`Haken „Bescheinigung geschrieben“ bei Nr. ${r.sehtest_nr} entfernen?`)) return;
      return db.updateRegistration(r.id, { sehtest_issued_at: null });
    }
    return db.updateRegistration(r.id, { sehtest_issued_at: new Date().toISOString() });
  }
  // ---------- Nachfragen: Sehtest-Bescheinigung schon geschrieben? (bis „Ja“ kommt) ----------
  const openCerts = async () => (await db.listAllRegistrations()).filter(r => r.sehtest_nr && !r.sehtest_issued_at && !r.sehtest_void_at);
  function certDialog() {
    let d = $("cert-dialog");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "cert-dialog"; d.className = "qr-dlg";
    d.innerHTML = `<h3 style="margin:0 0 6px">Sehtest-Bescheinigung schon geschrieben?</h3>
      <div id="cert-list"></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost" type="button" id="cert-later">Nein, noch nicht</button></div>`;
    document.body.appendChild(d);
    $("cert-later").onclick = () => d.close();
    $("cert-list").addEventListener("click", async ev => {
      const b = ev.target.closest("[data-cert]");
      if (!b) return;
      b.disabled = true;
      await db.updateRegistration(b.dataset.cert, { sehtest_issued_at: new Date().toISOString() });
      b.closest(".cert-row").remove();
      if (!$("cert-list").children.length) { d.close(); refreshViews(); }
    });
    d.addEventListener("close", refreshViews);
    return d;
  }
  async function askCertificates(onlyIds) {
    if ($("app-view").classList.contains("hidden") || document.querySelector("dialog[open]")) return;
    let list = await openCerts().catch(() => []);
    if (onlyIds) list = list.filter(r => onlyIds.includes(r.id));
    if (!list.length) return;
    const d = certDialog();
    $("cert-list").innerHTML = list.map(r => `<div class="cert-row"><span><strong>Nr. ${esc(r.sehtest_nr)}</strong> · ${esc(r.last_name)}, ${esc(r.first_name)}${r.sehtest_on ? ` <span class="small muted">· ${birthText(r.sehtest_on)}</span>` : ""}</span>
      <button class="btn btn-sm" type="button" data-cert="${r.id}">Ja, geschrieben</button></div>`).join("");
    d.showModal();
  }
  function refreshViews() {
    if (!$("sehtest-view").classList.contains("hidden")) loadSehtests();
    if (!$("students-view").classList.contains("hidden")) loadStudents();
    if (!$("start-view").classList.contains("hidden") || !$("attendance-view").classList.contains("hidden")) loadCourses();
  }

  // Sehtest-Protokoll als PDF-Bytes, mit allem, was schon eingetragen ist
  async function protocolBytes(r, c) {
    await ensurePdf();
    const day = sehtestDay(r, c) || (c ? dayOf(c.starts_at) : "");
    return EHFYDocs.sehtestProtocols([{
      first_name: r.first_name, last_name: r.last_name, birth_date: r.birth_date, nr: r.sehtest_nr,
      nrDraft: r.sehtest_nr ? "" : await draftNr(), marks: r.sehtest_marks,
      date: day ? `${day}T12:00:00` : null, passed: r.sehtest_passed, flow: r.sehtest_flow, aid: aidKind(r), idDoc: r.sehtest_id_doc, idNo: r.sehtest_id_no,
      signature: r.sehtest_passed != null || r.sehtest_signed_at ? await signatureBytes() : null
    }], await issuer(), loadFont);
  }
  async function sehtestPdf(r, c, showError) {
    showError("");
    const win = openTab();
    try {
      const bytes = await protocolBytes(r, c);
      showPdf(bytes, `Sehtest-Protokoll${r.sehtest_nr ? "_" + r.sehtest_nr : ""}_${r.last_name}_${r.first_name}.pdf`, win);
    } catch (e) { if (win) win.close(); showError(e.message); }
  }

  // ---------- Sehtest am Computer: Ringe ankreuzen, Ergebnis wird berechnet ----------
  const S = window.EHFYSehtest;
  const RESULT_TEXT = {
    bestanden: "Sehtest bestanden", nicht: "Sehtest nicht bestanden",
    offen: "Noch nicht fertig"
  };
  const STATE_TEXT = { bestanden: "bestanden", nicht: "nicht bestanden", offen: "läuft", leer: "offen" };
  // ---------- Ausweis fotografieren: nur Vorname, Nachname, Geburtsdatum, Ausweisnummer ----------
  // Die Erkennung läuft auf dem Gerät; das Foto wird weder hochgeladen noch gespeichert.
  const norm = t => String(t || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  // Kamera öffnen und das Foto zurückgeben. Das Feld hängt sichtbar-unsichtbar an der Seite:
  // Sonst meldet das iPhone (Safari) das aufgenommene Foto manchmal gar nicht zurück.
  function pickPhoto(onFile) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.setAttribute("capture", "environment");
    input.style.cssText = "position:fixed;left:-1000px;top:0;width:1px;height:1px;opacity:0";
    (document.querySelector("dialog[open]") || document.body).appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      setTimeout(() => input.remove(), 1000);
      if (file) onFile(file);
    });
    input.click();
  }
  function scanId(info, apply) {
    pickPhoto(async file => {
      info.innerHTML = "Ausweis wird gelesen … (beim ersten Mal lädt die Texterkennung, das dauert etwas)";
      try {
        const res = await window.EHFYAusweis.read(file, pct => { info.textContent = `Ausweis wird gelesen … ${pct} %`; });
        if (!res) { info.innerHTML = '<strong style="color:var(--danger)">Keine maschinenlesbare Zeile gefunden.</strong> Bitte die Seite mit den Zeilen voller „&lt;&lt;&lt;“ gerade, scharf und ohne Spiegelung fotografieren (beim Personalausweis die Rückseite). Führerscheine haben diese Zeilen nicht – dann bitte von Hand eintragen.'; return; }
        info.innerHTML = apply(res) + (res.allOk ? "" : ' <br><strong style="color:var(--danger)">Nummer oder Geburtsdatum unsicher gelesen – bitte mit dem Ausweis vergleichen.</strong>');
      } catch (e) { info.textContent = e.message; }
    });
  }

  let stRun = null; // { r, c, marks, set, flow, aid, idDoc, birth, draft, done }
  const SET_LABEL = ["Test 1–3", "Test 4–6"];
  function stDialog() {
    let d = $("st-dialog");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "st-dialog"; d.className = "wide";
    d.innerHTML = `<div class="st-dlg">
      <div class="st-head"><div><h3 id="sd-name"></h3><p class="small muted" id="sd-birth"></p></div>
        <div class="field st-nr"><label for="sd-nr">Protokoll-Nr. <span class="small muted" id="sd-nr-hint"></span></label><input id="sd-nr" autocomplete="off"></div></div>
      <div class="st-extra st-top">
        <div class="st-group"><span class="st-label">Sehhilfe:</span><button class="btn btn-sm btn-ghost att-btn" type="button" data-pick="aid" data-val="ohne">Keine</button><button class="btn btn-sm btn-ghost att-btn" type="button" data-pick="aid" data-val="brille">Brille</button><button class="btn btn-sm btn-ghost att-btn" type="button" data-pick="aid" data-val="linse">Kontaktlinse</button></div>
        <div class="st-group"><span class="st-label">Ausweis:</span>${ID_DOCS.map(([k, l]) => `<button class="btn btn-sm btn-ghost att-btn" type="button" data-pick="idDoc" data-val="${k}">${l}</button>`).join("")}</div>
        <div class="st-group" id="sd-pay"><span class="st-label">Bezahlt:</span>${PAY_KINDS.map(([k, l]) => `<button class="btn btn-sm btn-ghost att-btn" type="button" data-sdpay="${k}">${l}</button>`).join("")}</div>
        <div class="st-group"><label class="st-label" for="sd-idno">Ausweis-Nr.:</label><input id="sd-idno" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="60" placeholder="beliebig, wie auf dem Dokument"><button class="btn btn-sm" type="button" id="sd-scan">📷 Ausweis fotografieren</button></div>
        <p class="small" id="sd-idinfo" role="status"></p>
        <div class="st-group"><label class="st-label" for="sd-date">Datum:</label><input type="date" id="sd-date"></div>
        <div class="st-group"><span class="st-label">Unterschrift:</span><span class="small" id="sd-signinfo"></span></div>
      </div>
      <div class="st-sets" id="sd-sets" role="tablist"></div>
      <p class="small muted" style="margin:6px 0 8px">Ring antippen: 1× = richtig ✓, 2× = falsch ✗, 3× = wieder leer. Gewertet werden je Test zwei Zeilen: 2× 0,7, 0,7 + 1,0 oder 2× 1,0. Nicht bestanden bei mehr als 2 Fehlern in einer Zeile oder mehr als 2 Fehlern bei geraden bzw. bei schrägen Öffnungen. Die 0,32-Zeile ist zum Üben.</p>
      <div id="sd-grid"></div>
      <p class="st-result" id="sd-result"></p>
      <div class="st-extra">
        <div class="st-group"><span class="st-label">Verlauf:</span><button class="btn btn-sm btn-ghost att-btn" type="button" data-pick="flow" data-val="fluessig">Flüssig</button><button class="btn btn-sm btn-ghost att-btn" type="button" data-pick="flow" data-val="zoegerlich">Zögerlich</button></div>
      </div>
      <p class="small" id="sd-error" style="color:var(--danger)"></p>
      <div class="btn-row"><button class="btn" type="button" id="sd-save">Ergebnis übernehmen und Protokoll erstellen</button>
        <button class="btn btn-ghost" type="button" id="sd-keep">Zwischenspeichern</button><button class="btn btn-ghost" type="button" id="sd-close">Schließen</button></div>
    </div>`;
    document.body.appendChild(d);
    d.addEventListener("click", ev => {
      const ring = ev.target.closest("[data-ring]");
      if (ring) {
        const n = Number(ring.dataset.t), i = Number(ring.dataset.ring), m = S.marksOf(stRun.marks, n).split("");
        m[i] = m[i] === "." ? "r" : m[i] === "r" ? "f" : ".";
        stRun.marks[n] = m.join("");
        return stRender();
      }
      const set = ev.target.closest("[data-set]");
      if (set) { stRun.set = Number(set.dataset.set); return stRender(); }
      const rest = ev.target.closest("[data-rest]");
      if (rest) {
        const n = Number(rest.dataset.rest), rows = S.rowsToFill(stRun.marks, n), t = S.test(n);
        stRun.marks[n] = S.marksOf(stRun.marks, n).split("").map((x, i) => (x === "." && rows.includes(t.rings[i].row) ? "r" : x)).join("");
        return stRender();
      }
      const clear = ev.target.closest("[data-clear]");
      if (clear) { delete stRun.marks[clear.dataset.clear]; return stRender(); }
      const pick = ev.target.closest("[data-pick]");
      if (pick) { const k = pick.dataset.pick; stRun[k] = stRun[k] === pick.dataset.val ? null : pick.dataset.val; return stRender(); }
    });
    $("sd-scan").onclick = () => scanId($("sd-idinfo"), res => {
      stRun.idDoc = res.idDoc;
      $("sd-idno").value = res.docNumber;
      const r = stRun.r, same = norm(`${r.first_name} ${r.last_name}`) === norm(`${res.firstName} ${res.lastName}`);
      const birthOk = !r.birth_date || !res.birth || r.birth_date === res.birth;
      if (!r.birth_date && res.birth) stRun.birth = res.birth;
      stRender();
      return `Gelesen: ${esc(res.lastName)}, ${esc(res.firstName)} · geb. ${res.birth ? birthText(res.birth) : "?"} · Nr. ${esc(res.docNumber)}`
        + (same && birthOk ? ' <strong style="color:var(--ok)">✓ passt zur Person</strong>' : ' <strong style="color:var(--danger)">Name oder Geburtsdatum weichen ab – bitte prüfen</strong>')
        + (!r.birth_date && res.birth ? " · Geburtsdatum wird übernommen" : "");
    });
    $("sd-close").onclick = () => d.close();
    $("sd-keep").onclick = () => stSave(false);
    $("sd-save").onclick = () => stSave(true);
    return d;
  }
  // Ein Test als Block: Überschrift mit Stand, darunter die Ringzeilen
  function stBlock(n) {
    const t = S.test(n), m = S.marksOf(stRun.marks, n), ev = S.evaluate(stRun.marks, n);
    let i = 0;
    const rows = t.rows.map((row, k) => `<div class="st-line ${k === 0 ? "practice" : "counted"}"><span class="st-visus">${S.VISUS[k]}${k === 0 ? "<small>Übung</small>" : ""}</span>${row.split(" ").map(dir => {
      const idx = i++, mk = m[idx];
      return `<button type="button" class="st-ring m-${mk === "." ? "leer" : mk}" data-t="${n}" data-ring="${idx}" aria-label="Test ${n}, Ring ${idx + 1}: ${mk === "r" ? "richtig" : mk === "f" ? "falsch" : "offen"}">
        <svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="${S.ringPath(20, dir)}"/></svg><span>${mk === "r" ? "✓" : mk === "f" ? "✗" : ""}</span></button>`;
    }).join("")}</div>`).join("");
    const rowText = r => `${r.name}: ${r.err} Fehler${r.open ? ` (${r.open} offen)` : ""}`;
    const info = ev.used.length ? ev.used.map(rowText).join(" · ") + (ev.wrong ? ` · gerade ${ev.straight}, schräg ${ev.oblique}` : "")
      : "Zwei Zeilen abfragen: 2× 0,7, 0,7 + 1,0 oder 2× 1,0.";
    const warn = ev.warn ? '<p class="small st-warn">Achtung: Ein weiterer Fehler (in derselben Zeile, bei geraden oder bei schrägen Öffnungen) und der Test ist nicht bestanden.</p>' : "";
    return `<section class="st-block is-${ev.state}">
      <div class="st-block-head"><h4>${t.title}</h4><span class="st-badge">${STATE_TEXT[ev.state]}</span></div>
      <p class="small muted" style="margin:0 0 6px">${info}</p>
      <div class="st-grid">${rows}</div>${warn}
      <div class="btn-row" style="margin-top:6px"><button class="btn btn-sm btn-ghost" type="button" data-rest="${n}">Übrige der abgefragten Zeilen richtig</button><button class="btn btn-sm btn-ghost" type="button" data-clear="${n}">Leeren</button></div>
    </section>`;
  }
  function stRender() {
    const { r, marks } = stRun, all = S.overall(marks);
    $("sd-sets").innerHTML = S.SETS.map((set, k) => `<button type="button" role="tab" class="st-set ${k === stRun.set ? "active" : ""} is-${all.sets[k]}" data-set="${k}" aria-selected="${k === stRun.set}">
      <strong>${SET_LABEL[k]}</strong><em>${STATE_TEXT[all.sets[k]]}</em></button>`).join("");
    $("sd-grid").innerHTML = S.SETS[stRun.set].map(stBlock).join("");
    $("sd-result").className = `st-result is-${all.state}`;
    $("sd-result").innerHTML = `${RESULT_TEXT[all.state]}${all.otherFree ? ` <span class="small">(alternativ ${all.sets[0] === "leer" ? "Test 1–3" : "Test 4–6"} noch möglich)</span>` : ""}`;
    document.querySelectorAll("#st-dialog [data-pick]").forEach(b => { const on = stRun[b.dataset.pick] === b.dataset.val; b.classList.toggle("on-yes", on); b.setAttribute("aria-pressed", on); });
    $("sd-save").disabled = all.state === "offen";
    $("sd-name").textContent = `${r.first_name} ${r.last_name}`;
  }
  async function openSehtest(r, c, done) {
    const d = stDialog();
    stRun = { r, c, done, marks: { ...(r.sehtest_marks || {}) }, set: 0, flow: r.sehtest_flow || null, aid: aidKind(r), idDoc: r.sehtest_id_doc || null, signed: r.sehtest_signed_at ? "ja" : null, draft: r.sehtest_nr ? "" : await draftNr() };
    const noSig = !(await signatureBytes());
    $("sd-signinfo").textContent = noSig ? "Noch keine Unterschrift hinterlegt – bitte unter Mehr → Einstellungen → Unterschrift erfassen." : "✍ Deine hinterlegte Unterschrift und das Datum kommen automatisch aufs Protokoll.";
    $("sd-signinfo").style.color = noSig ? "var(--danger)" : "var(--muted)";
    // Mit der Tafel weitermachen, die schon angefangen ist
    const sets = S.overall(stRun.marks).sets;
    if (sets[0] === "leer" && sets[1] !== "leer") stRun.set = 1;
    $("sd-date").value = sehtestDay(r, c) || (c ? dayOf(c.starts_at) : localDate(new Date()));
    $("sd-idno").value = r.sehtest_id_no || "";
    const payMark = () => $("sd-pay").querySelectorAll("[data-sdpay]").forEach(b => b.classList.toggle("on-yes", r.payment_method === b.dataset.sdpay));
    payMark();
    $("sd-pay").onclick = async e => {
      const b = e.target.closest("[data-sdpay]");
      if (!b) return;
      r.payment_method = r.payment_method === b.dataset.sdpay ? null : b.dataset.sdpay;
      payMark();
      try { await db.updateRegistration(r.id, { payment_method: r.payment_method }); } catch (err) { $("sd-error").textContent = err.message; }
    };
    $("sd-idinfo").innerHTML = "";
    $("sd-birth").textContent = r.birth_date ? `geb. ${birthText(r.birth_date)}` : "";
    $("sd-nr").value = r.sehtest_nr || stRun.draft;
    $("sd-nr-hint").textContent = r.sehtest_reissue ? "(geändert – Bescheinigung neu ausstellen)" : r.sehtest_issued_at ? "(fest – Bescheinigung ausgestellt)" : r.sehtest_nr ? "(änderbar, spätere rücken nach)" : "(vorläufig – fest erst bei „Ergebnis übernehmen“)";
    $("sd-error").textContent = "";
    stRender();
    d.showModal();
    d.scrollTop = 0;
  }
  async function stSave(withResult) {
    const { r, c, marks, flow, aid, idDoc, draft } = stRun;
    const btn = withResult ? $("sd-save") : $("sd-keep");
    $("sd-error").textContent = "";
    const all = S.overall(marks);
    const patch = {
      sehtest_marks: marks, sehtest_flow: flow, sehtest_aid_kind: aid, sehtest_aid: aid ? aid !== "ohne" : null, sehtest_id_doc: idDoc,
      sehtest_id_no: $("sd-idno").value.trim() || null,
      ...(stRun.birth ? { birth_date: stRun.birth } : {}),
      sehtest_on: $("sd-date").value || (c ? dayOf(c.starts_at) : localDate(new Date())), sehtest_none: false,
      // Mit Ergebnis ist das Protokoll von dir unterschrieben (hinterlegte Unterschrift, automatisch)
      sehtest_signed_at: withResult ? r.sehtest_signed_at || new Date().toISOString() : r.sehtest_signed_at || null
    };
    const typed = $("sd-nr").value.trim();
    // Eigene Nummer nur, wenn sie von der vorgeschlagenen abweicht; sonst vergibt die Datenbank sie
    // Zwischenspeichern vergibt nie eine Nummer: Fest wird sie erst beim Übernehmen des Ergebnisses
    // (dann die zu diesem Zeitpunkt nächste freie Nummer, auch wenn inzwischen ein anderer Sehtest fertig wurde)
    const own = typed && typed !== (r.sehtest_nr || draft) && (withResult || r.sehtest_nr) ? typed : "";
    if (withResult) patch.sehtest_passed = all.state === "bestanden";
    btn.disabled = true;
    try {
      if (own && r.sehtest_nr) {
        if (!(await changeNr(r, own))) return;
        await db.updateRegistration(r.id, patch);
      } else if (own) {
        if (await nrTaken(own, r.id)) throw new Error(`Die Protokoll-Nummer ${own} ist schon vergeben.`);
        try { await db.updateRegistrationOnline(r.id, { ...patch, sehtest_nr: own }); } catch (e) { throw nrError(e, own); }
      } else if (withResult && !r.sehtest_nr) await db.updateRegistrationNow(r.id, patch);
      else await db.updateRegistration(r.id, patch);
      $("st-dialog").close();
      const fresh = (await db.listAllRegistrations()).find(x => x.id === r.id) || { ...r, ...patch };
      if (stRun.done) await stRun.done();
      if (withResult) await sehtestPdf(fresh, c, msg => { if (msg) alert(msg); });
      // Gleich nach dem Bestätigen fragen, ob die Bescheinigung schon geschrieben ist
      if (withResult) setTimeout(() => askCertificates([r.id]), 600);
    } catch (e) { $("sd-error").textContent = e.message; }
    finally { btn.disabled = withResult ? S.overall(stRun.marks).state === "offen" : false; }
  }
  // Knopf je nach Stand: bestätigt → Protokoll öffnen; etwas zwischengespeichert → weitermachen; sonst durchführen
  const stStarted = r => !!(r.sehtest_marks && Object.keys(r.sehtest_marks).length) || !!r.sehtest_flow || !!r.sehtest_id_doc || !!r.sehtest_id_no || !!r.sehtest_aid_kind;
  const stRunLabel = r => r.sehtest_passed != null ? "Protokoll öffnen" : stStarted(r) ? "Sehtest weitermachen" : "Sehtest durchführen";
  // Kurzer Stand und sichtbarer Knopf „Sehtest durchführen“
  function sehtestState(r) {
    if (r.sehtest_void_at) return "";
    if (r.sehtest_passed === true) return `bestanden${r.sehtest_nr ? " · " + esc(r.sehtest_nr) : ""}`;
    if (r.sehtest_passed === false) return `nicht bestanden${r.sehtest_nr ? " · " + esc(r.sehtest_nr) : ""}`;
    return stStarted(r) ? "zwischengespeichert" : "";
  }
  // Bezahlt (bar / PayPal / Überweisung) und Häkchen „auf die Teilnehmerliste“
  const PAY_KINDS = [["bar", "Bar"], ["paypal", "PayPal"], ["ueberweisung", "Überweisung"]];
  const payRow = r => `<div class="att-btns pay-row"><span class="small">Bezahlt:</span>${PAY_KINDS.map(([k, l]) =>
      `<button class="btn btn-sm btn-ghost att-btn ${r.payment_method === k ? "on-yes" : ""}" type="button" data-pay="${k}" aria-pressed="${r.payment_method === k}">${l}</button>`).join("")}
    <label class="small onlist"><input type="checkbox" data-onlist ${r.on_list ? "checked" : ""}> Auf Teilnehmerliste</label></div>`;
  async function payClick(ev, r) {
    const pay = ev.target.closest("[data-pay]");
    if (pay) { await db.updateRegistration(r.id, { payment_method: r.payment_method === pay.dataset.pay ? null : pay.dataset.pay }); return true; }
    const box = ev.target.closest("[data-onlist]");
    if (box) { await db.updateRegistration(r.id, { on_list: box.checked }); return true; }
    return false;
  }
  const sehtestQuick = r => payRow(r) + `<div class="att-btns st-quick"><button class="btn btn-sm" type="button" data-st-run>${stRunLabel(r)}</button>${sehtestState(r) ? `<span class="small">Sehtest: <strong>${sehtestState(r)}</strong></span>${issuedTag(r)}${issuedBtn(r)}` : ""}<button class="btn btn-sm btn-ghost" type="button" data-st-print>Protokoll</button>${r.sehtest_nr ? '<button class="btn btn-sm btn-ghost" type="button" data-st-again>Neuer Sehtest (neue Nr.)</button>' : ""}</div>`;
  const courseDone = r => (r.status === "teilgenommen" ? "Ja" : r.status === "nicht_erschienen" ? "Nein, nicht erschienen" : r.status === "storniert" ? "Nein, abgesagt" : "Noch nicht abgehakt");

  // ---------- Gutschein oder Rabatt je Teilnehmer ----------
  function discountControls(r) {
    return `<div class="st-row"><span class="st-label">Gutschein:</span>
      <input class="fin-input" data-discount inputmode="decimal" placeholder="0,00" value="${r.discount ? String(r.discount).replace(".", ",") : ""}" aria-label="Gutschein in Euro"> €
      <input class="disc-note" data-discount-note maxlength="80" placeholder="z. B. Flyer Fahrschule" value="${esc(r.discount_note || "")}" aria-label="Grund für den Gutschein">
    </div>`;
  }
  const discountField = target => target.closest("input[data-discount],input[data-discount-note]");
  async function saveDiscount(input, id) {
    const row = input.closest(".st-row");
    const amount = parseFloat(row.querySelector("[data-discount]").value.replace(",", "."));
    await db.updateRegistration(id, {
      discount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
      discount_note: row.querySelector("[data-discount-note]").value.trim() || null
    });
  }

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
    if (r.fee_state === "bezahlt") return `<span class="small">Ausfallgebühr bezahlt${r.fee_state_at ? " am " + shortDay(r.fee_state_at) : ""}</span>`;
    if (r.fee_state === "erledigt") return '<span class="small">Als erledigt abgehakt</span>';
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
      ${!absent(r) ? sehtestQuick(r) : ""}
      ${!absent(r) ? `<details class="att-more"><summary>Mehr: Gutschein</summary>
        ${discountControls(r)}</details>` : ""}
    </div>`;
  }
  const attWords = () => $("att-filter").value.toLowerCase().split(/\s+/).filter(Boolean);
  const attPeople = c => {
    const words = attWords();
    return attRegs.filter(r => r.course_id === c.id && (r.status !== "storniert" || lateCancel(r))
      && words.every(w => `${r.first_name} ${r.last_name}`.toLowerCase().includes(w))).sort(byName);
  };
  // Kurs absagen, Absage aufheben, Teilnehmer informieren (in Anwesenheit und Teilnehmerliste)
  function courseTools(c) {
    const off = c.status === "abgesagt";
    const withMail = attRegs.filter(r => r.course_id === c.id && r.email && r.status !== "storniert").length;
    return off
      ? `<div class="att-row" data-course="${c.id}"><span class="small"><strong>Abgesagt${c.cancel_reason ? ": " + esc(c.cancel_reason) : ""}</strong>${c.cancel_notified_at ? ` · informiert am ${shortDay(c.cancel_notified_at)}` : ""}</span>
          <div class="att-btns">${withMail && !c.cancel_notified_at ? `<button class="btn btn-sm" type="button" data-course-act="notify">Teilnehmer informieren (${withMail})</button>` : ""}
          <button class="btn btn-sm btn-ghost" type="button" data-course-act="reopen">Absage aufheben</button></div></div>`
      : `<div class="att-row" data-course="${c.id}"><button class="btn btn-sm btn-teal" type="button" data-course-act="add">+ Schüler nachträglich eintragen</button>
          <button class="btn btn-sm btn-ghost" type="button" data-course-act="cancel">Kurs absagen</button></div>`;
  }
  function attFolder(c) {
    const list = attPeople(c);
    const yes = list.filter(r => r.status === "teilgenommen").length, no = list.filter(absent).length;
    const open = true; // Am Kurstag ist die Liste immer offen
    const off = c.status === "abgesagt";
    const tools = courseTools(c);
    return `<details class="att-folder" data-folder="${c.id}" ${open ? "open" : ""}>
      <summary>${dayText(c.starts_at)} · ${esc(c.location)} <small>${off ? "ABGESAGT" : `${list.length} angemeldet · ${yes} da · ${no} nicht da`}</small></summary>
      <div class="att-body">${open ? tools + (off ? list.map(r => `<div class="att-row"><div class="att-name">${esc(r.first_name)} ${esc(r.last_name)}</div></div>`).join("") : attBody(list)) : ""}</div></details>`;
  }
  const attBody = list => (list.length ? list.map(attRow).join("") : '<p class="small muted">Noch keine Anmeldungen.</p>');
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
    // Nicht neu aufbauen, solange du in einem Feld tippst
    if (document.activeElement && document.activeElement.matches("#att-section input[data-discount],#att-section input[data-discount-note]")) return;
    const [regsAll] = await Promise.all([db.listAllRegistrations()]);
    attRegs = regsAll;
    attById = Object.fromEntries(courses.map(c => [c.id, c]));
    const today = localDate(new Date());
    // Die Anwesenheit zeigt nur den Kurstag. Abgehakt wird danach unter „Termine“.
    const folders = courses.filter(c => localDate(new Date(c.starts_at)) === today);
    const next = courses.filter(c => localDate(new Date(c.starts_at)) > today && c.status !== "abgesagt").sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    $("att-cards").innerHTML = folders.length ? folders.map(attFolder).join("")
      : `<p class="muted">Heute ist kein Kurs.${next ? ` Nächster Kurs: <strong>${dayText(next.starts_at)} in ${esc(next.location)}</strong>.` : ""} Teilnehmer abhaken und Sehtests machen geht jederzeit unter „Termine“ → Kurs antippen.</p>`;
    // Ältere Kurse ohne Häkchen: stehen unter „Termine“, bis ✓ Da oder ✗ Nicht da gesetzt ist
    const unchecked = attRegs.filter(r => r.status === "angemeldet" && courseOf(r)
      && courseOf(r).status !== "abgesagt" && localDate(new Date(courseOf(r).starts_at)) < today)
      .sort((a, b) => courseOf(b).starts_at.localeCompare(courseOf(a).starts_at));
    uncheckedCount = unchecked.length;
    $("att-unchecked").innerHTML = unchecked.length ? `<details class="card att-card" style="margin-bottom:18px"><summary><strong>Noch nicht abgehakt (${unchecked.length})</strong> <span class="small muted">– bitte eintragen, wer da war</span></summary>
      ${unchecked.slice(0, 40).map(r => `<div class="small muted" style="margin-top:8px">Kurs ${shortDay(courseOf(r).starts_at)} · ${esc(courseOf(r).location)}</div>${attRow(r)}`).join("")}</details>` : "";
    renderFees();
    renderStart();
  }

  // ---------- Rubrik „Ausfallgebühren“: wer nicht da war, bis bezahlt oder erledigt ----------
  function renderFees() {
    const today = localDate(new Date());
    const past = r => courseOf(r) && localDate(new Date(courseOf(r).starts_at)) < today;
    const notYet = attRegs.filter(r => absent(r) && past(r) && !r.fee_state && !followUpOf(r));
    const chances = attRegs.filter(r => r.fee_state === "chance" && courseOf(r));
    const bills = attRegs.filter(r => r.fee_state === "rechnung" && courseOf(r));
    const total = notYet.length + chances.length + bills.length;
    feeTotal = total;
    $("nav-more-btn").innerHTML = `<span class="dots" aria-hidden="true">•••</span>Mehr${total ? ` <span class="nav-badge">${total}</span>` : ""}`;
    const tab = document.querySelector('#main-tabs [data-view="gebuehren"]');
    if (tab) tab.innerHTML = `Ausfallgebühren${total ? ` <span class="nav-badge">${total}</span>` : ""}`;
    const byDay = (a, b) => courseOf(b).starts_at.localeCompare(courseOf(a).starts_at);
    const done = '<button class="btn btn-sm btn-ghost" type="button" data-fee="done">Erledigt, aus der Liste</button>';
    const row = (r, inner) => `<div class="att-row" data-att="${r.id}"><div class="att-name">${esc(r.first_name)} ${esc(r.last_name)} <span class="small muted">(Kurs ${shortDay(courseOf(r).starts_at)})</span></div><div class="att-fee">${inner}</div></div>`;
    const section = (title, hint, list, html) => `<article class="card att-card" style="margin-bottom:14px"><h3 style="margin-top:0">${title} (${list.length})</h3><p class="small muted" style="margin:0 0 6px">${hint}</p>${list.length ? list.sort(byDay).map(html).join("") : '<p class="small muted">Niemand.</p>'}</article>`;
    $("fee-list").innerHTML =
      section("Rechnung gesendet – Zahlung offen", "Wenn bezahlt ist: „Bezahlt“ drücken. Dann verschwindet die Person aus der Liste, und die Rechnung steht auf bezahlt.", bills,
        r => row(r, `${feeControls(r)} <button class="btn btn-sm" type="button" data-fee="paid">✓ Bezahlt</button>`))
      + section("Zweite Chance läuft", "Die Person darf sich innerhalb der Frist für einen neuen Kurs anmelden.", chances, r => chanceRow(r).replace('<div class="att-fee">', `<div class="att-fee">`))
      + section("Nicht erschienen – noch nicht angeschrieben", "Rechnung oder zweite Chance per E-Mail senden. Ohne E-Mail-Adresse: anrufen und danach „Erledigt“.", notYet,
        r => row(r, `${feeControls(r)} ${done}`));
  }
  // Wurde für einen Nicht-Erschienenen schon ein Nachholtermin gebucht (ohne zweite Chance)? Dann nicht anmahnen.
  const followUpOf = r => attRegs.find(x => x.id !== r.id && x.status !== "storniert" && samePerson(x, r) && courseOf(x) && courseOf(x).starts_at > courseOf(r).starts_at);

  // Ordner: Inhalt erst beim Öffnen aufbauen, Zustand merken
  $("att-section").addEventListener("toggle", ev => {
    const box = ev.target;
    if (!box.matches || !box.matches("details[data-folder]") || attWords().length) return;
    const key = box.dataset.folder;
    if (box.open) {
      if (attOpen.has(key)) return; // beim Neuaufbau bleibt alles, wie es ist
      attOpen.clear();
      attOpen.add(key);
      renderAttendance().then(() => {
        const now = document.querySelector(`details[data-folder="${key}"]`);
        if (now) { now.scrollIntoView({ block: "start" }); window.scrollBy(0, -90); }
      });
    } else attOpen.delete(key);
  }, true);
  $("att-filter").addEventListener("input", renderAttendance);
  $("att-section").addEventListener("change", async ev => {
    const input = discountField(ev.target);
    if (!input) return;
    input.blur();
    try { await saveDiscount(input, input.closest("[data-att]").dataset.att); await loadCourses(); }
    catch (e) { $("att-error").textContent = e.message; }
  });

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
      "Diese Rechnung wurde maschinell erstellt und ist mit der eingefügten digitalen Unterschrift gültig.", "",
      "Mit freundlichen Grüßen", cfg.issuer.owner, cfg.issuer.name, `Tel. ${cfg.issuer.phone}`
    ].join("\n");
    const bytes = await EHFYDocs.invoices([inv], await issuer(true), loadFont, days);
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
  // Knöpfe für Anwesenheit und Ausfallgebühr, in beiden Bereichen dieselben
  async function attendanceAction(target, r, err) {
    err.textContent = "";
    const mark = target.closest("[data-mark]");
    const fee = target.closest("[data-fee]");
    if (!r || (!mark && !fee)) return false;
    const btn = mark || fee;
    btn.disabled = true;
    try {
      if (mark) {
        const value = r.status === mark.dataset.mark ? "angemeldet" : mark.dataset.mark;
        await db.updateRegistration(r.id, { status: value });
        await window.EHFYFinance.autoTrips();
      } else if (fee.dataset.fee === "paid") {
        if (!confirm(`Ausfallgebühr von ${r.first_name} ${r.last_name} ist bezahlt?`)) return true;
        await db.updateRegistration(r.id, { fee_state: "bezahlt", fee_state_at: new Date().toISOString() });
        for (const inv of await db.invoicesForRegistrations([r.id])) {
          if (inv.type === "rechnung" && inv.status === "offen" && String(inv.items?.[0]?.text || "").startsWith("Ausfallgebühr")) await db.setInvoiceStatus(inv.id, "bezahlt");
        }
      } else if (fee.dataset.fee === "done") {
        if (!confirm(`${r.first_name} ${r.last_name} als erledigt aus der Liste nehmen?`)) return true;
        await db.updateRegistration(r.id, { fee_state: "erledigt", fee_state_at: new Date().toISOString() });
      } else if (fee.dataset.fee === "waive") {
        if (!confirm(`Ausfallgebühr von ${r.first_name} ${r.last_name} gutschreiben?`)) return true;
        await db.updateRegistration(r.id, { fee_state: "erlassen", fee_state_at: new Date().toISOString() });
      } else {
        if (!db.isOnline()) throw new Error("Zum Senden braucht es Internet.");
        await ensurePdf();
        if (fee.dataset.fee === "chance") {
          if (!confirm(`Zweite Chance per E-Mail an ${r.email} senden?`)) return true;
          await sendChance(r);
        } else if (fee.dataset.fee === "both") {
          if (!confirm(`Zwei Rechnungen über je ${FEE} € an ${r.email} senden?`)) return true;
          await sendFeeBill(chanceBefore(r));
          await sendFeeBill(r);
        } else {
          if (!confirm(`Rechnung über ${FEE} € an ${r.email} senden?`)) return true;
          await sendFeeBill(r);
        }
      }
      await loadCourses();
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; }
    return true;
  }
  // ---------- Kurs absagen ----------
  let cancelCourse = null;
  const reasonText = { "Zu wenig Teilnehmer": "wegen zu weniger Teilnehmer", "Krankheitsfall": "wegen eines Krankheitsfalls" };
  $("cc-no").onclick = () => $("cancel-dialog").close();
  $("cc-ok").onclick = async () => {
    const c = cancelCourse;
    $("cancel-dialog").close();
    try {
      await db.saveCourse({ ...c, status: "abgesagt", cancel_reason: $("cc-reason").value, cancel_notified_at: null });
      await window.EHFYFinance.courseCancelled(c.id);
      attOpen.add(c.id);
      await loadCourses();
    } catch (e) { $("att-error").textContent = e.message; }
  };
  async function notifyCancelled(c) {
    const list = attRegs.filter(r => r.course_id === c.id && r.email && r.status !== "storniert");
    if (!db.isOnline()) throw new Error("Zum Senden braucht es Internet.");
    if (!confirm(`Absage per E-Mail an ${list.length} Teilnehmer senden?`)) return;
    const link = new URL("anmelden.html", location.href).href;
    const day = shortDay(c.starts_at);
    let done = 0;
    try {
      for (const r of list) {
        await db.sendInvoiceMail({
          to: r.email, textOnly: true, subject: `Absage: Ihr Erste-Hilfe-Kurs am ${day}`,
          text: [`Guten Tag ${r.first_name} ${r.last_name},`, "",
            `leider müssen wir den Erste-Hilfe-Kurs am ${day} in ${c.location} ${reasonText[c.cancel_reason] || "absagen"}${reasonText[c.cancel_reason] ? " absagen" : ""}. Wir bitten um Entschuldigung.`, "",
            "Für Sie entstehen dadurch keine Kosten.", "",
            `Einen neuen Termin können Sie hier auswählen: ${link}`, "",
            "Mit freundlichen Grüßen", cfg.issuer.owner, cfg.issuer.name, `Tel. ${cfg.issuer.phone}`].join("\n")
        });
        done++;
      }
    } catch (e) { throw new Error(`Nur ${done} von ${list.length} E-Mails wurden gesendet. ${e.message}`); }
    await db.saveCourse({ ...c, cancel_notified_at: new Date().toISOString() });
    await loadCourses();
  }

  async function attClick(ev) {
    const errBox = $(ev.currentTarget.dataset.err || "att-error");
    const act = ev.target.closest("[data-course-act]");
    if (act) {
      const c = attById[act.closest("[data-course]").dataset.course];
      errBox.textContent = "";
      try {
        if (act.dataset.courseAct === "cancel") {
          cancelCourse = c;
          $("cc-info").textContent = `${dayText(c.starts_at)} · ${c.location}`;
          $("cancel-dialog").showModal();
        }
        if (act.dataset.courseAct === "reopen") {
          await db.saveCourse({ ...c, status: "offen", cancel_reason: null, cancel_notified_at: null });
          await loadCourses();
        }
        if (act.dataset.courseAct === "notify") await notifyCancelled(c);
        if (act.dataset.courseAct === "add") openAdd(c);
      } catch (e) { errBox.textContent = e.message; }
      return;
    }
    const row = ev.target.closest("[data-att]");
    if (!row) return;
    const r = attRegs.find(x => x.id === row.dataset.att) || regs.find(x => x.id === row.dataset.att);
    if (r) {
      try { if (await payClick(ev, r)) { await loadCourses(); return; } } catch (e) { errBox.textContent = e.message; return; }
    }
    if (r && ev.target.closest("[data-st-print]")) return sehtestPdf(r, courseOf(r), msg => { errBox.textContent = msg; });
    if (r && ev.target.closest("[data-st-run]")) return openSehtest(r, courseOf(r), loadCourses).catch(e => { errBox.textContent = e.message; });
    if (r && ev.target.closest("[data-st-again]")) return againSehtest(r, loadCourses).catch(e => { errBox.textContent = e.message; });
    if (r && ev.target.closest("[data-st-nr]")) return changeNr(r).then(loadCourses).catch(e => { errBox.textContent = e.message; });
    if (r && ev.target.closest("[data-st-issued]")) return toggleIssued(r).then(loadCourses).catch(e => { errBox.textContent = e.message; });
    if (r && ev.target.closest("[data-st-void]")) return voidAsk(r).then(loadCourses).catch(e => { errBox.textContent = e.message; });
    const stBtn = ev.target.closest("[data-st]");
    if (r && stBtn) {
      try { await handleSehtest(stBtn, r, courseOf(r)); await loadCourses(); } catch (e) { errBox.textContent = e.message; }
      return;
    }
    await attendanceAction(ev.target, r, errBox);
  }
  ["att-section", "att-unchecked", "fee-list", "p-tools", "p-rows"].forEach(id => $(id).addEventListener("click", attClick));

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
  // Einträge aus der Schülerkartei ohne angelegten Kurs (WordPress): nur Datum
  const courseFor = r => studentCourses[r.course_id] || (r.legacy_course_date
    ? { id: null, virtual: true, starts_at: new Date(`${r.legacy_course_date}T10:00:00`).toISOString(), ends_at: new Date(`${r.legacy_course_date}T17:30:00`).toISOString(), location: "Ort unbekannt", status: "offen" }
    : null);
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
      const c = courseFor(r);
      const hay = [r.first_name, r.last_name, birthText(r.birth_date), r.email, r.phone, c && c.location].join(" ").toLowerCase();
      if (!words.every(w => hay.includes(w))) continue;
      const key = `${r.last_name}|${r.first_name}|${r.birth_date || ""}`.toLowerCase();
      if (!people.has(key)) people.set(key, []);
      people.get(key).push(r);
    }
    const when = r => { const c = courseFor(r); return c ? c.starts_at : ""; };
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
    // Eigene Spalte: abgeschlossene Sehtest-Protokolle (auch von gelöschten Schülern)
    const protos = studentRegs.filter(r => protoDone(r) && words.every(w => [r.first_name, r.last_name, birthText(r.birth_date), r.sehtest_nr, r.sehtest_on && birthText(r.sehtest_on)].join(" ").toLowerCase().includes(w)))
      .sort((a, b) => String(b.sehtest_on || "").localeCompare(String(a.sehtest_on || "")));
    $("sc-protos").innerHTML = `<h3 style="margin:0 0 8px">Sehtest-Protokolle <span class="small muted">(${protos.length})</span></h3>` + (protos.length ? protos.slice(0, 100).map(r => `<div class="sc-proto" data-proto-id="${r.id}">
        <div><strong>${r.sehtest_nr ? "Nr. " + esc(r.sehtest_nr) : "ohne Nr."}</strong> · ${esc(r.last_name)}, ${esc(r.first_name)}<br>
        <span class="small muted">${r.sehtest_on ? birthText(r.sehtest_on) : ""} · ${r.sehtest_passed === true ? "bestanden" : r.sehtest_passed === false ? "nicht bestanden" : "hochgeladen"}${r.sehtest_only && !r.course_id ? " · nur Sehtest" : ""}</span></div>
        <button class="btn btn-sm btn-ghost" type="button" data-proto-open>Protokoll</button></div>`).join("") : '<p class="small muted">Keine Protokolle gefunden.</p>');
  }
  $("sc-protos").addEventListener("click", ev => {
    const b = ev.target.closest("[data-proto-open]");
    if (!b) return;
    const r = studentRegs.find(x => x.id === b.closest("[data-proto-id]").dataset.protoId);
    if (!r) return;
    const show = m => { $("sc-error").textContent = m; };
    if (r.sehtest_passed == null && r.protocol_added_on) {
      const win = openTab();
      return db.getTemplate(`protokolle/${r.id}`).then(async bytes => showPdf(new Uint8Array(await new Response(bytes).arrayBuffer()), `Sehtest-Protokoll_${r.last_name}_${r.first_name}.pdf`, win)).catch(e => { if (win) win.close(); show(e.message); });
    }
    sehtestPdf(r, courseFor(r), show);
  });
  // Andere Kurstage zur Auswahl (letzte 60 und nächste 120 Tage, dazu der aktuelle)
  function moveOptions(cur) {
    const from = Date.now() - 60 * 864e5, to = Date.now() + 120 * 864e5;
    const list = courses.filter(x => x.id === cur.id || (x.status !== "abgesagt" && new Date(x.starts_at) >= from && new Date(x.starts_at) <= to));
    return list.map(x => `<option value="${x.id}"${x.id === cur.id ? " selected" : ""}>${dayText(x.starts_at)} · ${esc(x.location)}</option>`).join("");
  }
  function studentEntry(r) {
    const c = courseFor(r);
    const off = r.status === "storniert" || !c || c.status === "abgesagt";
    return `<div class="sc-entry" data-reg="${r.id}">
      <div class="sc-facts">
        <div><label>Erste-Hilfe-Kurs</label><strong>${c ? dayText(c.starts_at) : r.sehtest_only ? "Nur Sehtest, kein Kurs" : "Termin gelöscht"}</strong>${!c && r.sehtest_only ? "" : `<br><span class="small">${c ? esc(c.location) + " · " : ""}Kurs gemacht: <span class="sc-done">${c && c.virtual ? "nicht belegt, nur angemeldet" : c && c.status === "abgesagt" ? "Nein, Kurs abgesagt" : courseDone(r)}</span></span>`}</div>
        ${c && !c.virtual ? `<div><label for="sc-mv-${r.id}">Kurstag ändern</label><select id="sc-mv-${r.id}" data-sc-move>${moveOptions(c)}</select></div>` : ""}
        ${r.checkin_at ? `<div><label>Datenblatt</label><span class="small">✍ selbst eingetragen und unterschrieben (QR-Code) am ${birthText(r.checkin_at.slice(0, 10))}</span></div>` : ""}
        <div><label>Protokoll</label>${r.protocol_added_on ? `<span class="small">hinzugefügt am ${birthText(r.protocol_added_on)}</span><br><button class="btn btn-sm btn-ghost" type="button" data-proto="print">Ansehen / drucken</button> <button class="btn btn-sm btn-ghost" type="button" data-proto="remove">Entfernen</button>` : `<button class="btn btn-sm btn-ghost" type="button" data-proto="add">Protokoll hinzufügen</button>`}</div>
      </div>
      ${!off && !c.virtual ? `<div class="att-btns">
        <button class="btn btn-sm btn-ghost att-btn ${r.status === "teilgenommen" ? "on-yes" : ""}" type="button" data-mark="teilgenommen" aria-pressed="${r.status === "teilgenommen"}">✓ Da</button>
        <button class="btn btn-sm btn-ghost att-btn ${r.status === "nicht_erschienen" ? "on-no" : ""}" type="button" data-mark="nicht_erschienen" aria-pressed="${r.status === "nicht_erschienen"}">✗ Nicht da</button>
      </div>` : ""}
      ${c && !c.virtual && absent(r) ? `<div class="att-fee">${feeControls(r)}</div>` : ""}
      ${sehtestControls(r, c)}
      ${off ? "" : discountControls(r)}
      ${off ? "" : `<div class="btn-row">
        <button class="btn btn-sm btn-ghost" type="button" data-sc-print="bescheinigung">Bescheinigung</button>
        <button class="btn btn-sm btn-ghost" type="button" data-sc-print="datenblatt">Datenblatt</button>
        <button class="btn btn-sm btn-ghost" type="button" data-sc-print="quittung">Quittung</button>
        <button class="btn btn-sm btn-ghost" type="button" data-sc-print="rechnung">Rechnung</button>
      </div>`}
      <div><button class="btn btn-sm btn-ghost" type="button" data-sc-del style="color:var(--danger)">✕ Aus der Liste löschen</button></div>
    </div>`;
  }
  // Anmeldung löschen. Hat die Person den Sehtest abgeschlossen (oder ein hochgeladenes Protokoll),
  // bleibt das Protokoll erhalten: Der Eintrag wird zu „nur Sehtest“ und steht weiter unter Sehtests.
  const protoDone = r => (r.sehtest_passed != null && !r.sehtest_void_at) || !!r.protocol_added_on;
  async function keepProtocolOnly(r, c) {
    c = c || attById[r.course_id] || studentCourses[r.course_id] || null;
    await db.updateRegistration(r.id, {
      course_id: null, sehtest_only: true, status: "teilgenommen", on_list: false,
      sehtest_on: r.sehtest_on || (c ? dayOf(c.starts_at) : localDate(new Date())), sehtest_none: false
    });
  }
  async function removeRegistration(r) {
    if (protoDone(r)) return keepProtocolOnly(r);
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
    const disc = discountField(ev.target);
    if (disc) {
      disc.blur();
      try { await saveDiscount(disc, disc.closest("[data-reg]").dataset.reg); await loadStudents(); }
      catch (e) { $("sc-error").textContent = e.message; }
      return;
    }
    const mv = ev.target.closest("select[data-sc-move]");
    if (mv) {
      const r = studentRegs.find(x => x.id === mv.closest("[data-reg]").dataset.reg), to = courses.find(x => x.id === mv.value);
      if (!r || !to || to.id === r.course_id) return;
      if (!confirm(`${r.first_name} ${r.last_name} auf ${dayText(to.starts_at)} (${to.location}) verschieben?`)) { mv.value = r.course_id; return; }
      try { await db.updateRegistration(r.id, { course_id: to.id }); await loadStudents(); await loadCourses(); }
      catch (e) { $("sc-error").textContent = e.message; }
      return;
    }
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
    if (ev.target.closest("[data-st-print]")) return sehtestPdf(r, courseFor(r), show);
    if (ev.target.closest("[data-st-run]")) return openSehtest(r, courseFor(r), loadStudents).catch(e => show(e.message));
    if (ev.target.closest("[data-st-again]")) return againSehtest(r, loadStudents).catch(e => show(e.message));
    if (ev.target.closest("[data-st-nr]")) return changeNr(r).then(loadStudents).catch(e => show(e.message));
    if (ev.target.closest("[data-st-issued]")) return toggleIssued(r).then(loadStudents).catch(e => show(e.message));
    if (ev.target.closest("[data-st-void]")) return voidAsk(r).then(loadStudents).catch(e => show(e.message));
    const stBtn = ev.target.closest("[data-st]");
    if (stBtn) {
      try { await handleSehtest(stBtn, r, courseFor(r)); await loadStudents(); } catch (e) { show(e.message); }
      return;
    }
    if (ev.target.closest("[data-mark],[data-fee]")) {
      await attendanceAction(ev.target, r, $("sc-error"));
      await loadStudents();
      return;
    }
    const printKind = ev.target.closest("[data-sc-print]");
    if (printKind) return runDoc(printKind.dataset.scPrint, [r], courseFor(r), show);
    if (ev.target.closest("[data-sc-del]")) {
      if (!confirm(`${r.first_name} ${r.last_name} endgültig aus der Liste löschen?${protoDone(r) ? "\n\nDas Sehtest-Protokoll bleibt erhalten (unter Sehtests)." : ""}`)) return;
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

  // ---------- Reiter „Sehtests“: alle Sehtests mit Nummer und Datum, Personen nur für den Sehtest ----------
  let seRegs = [], seCourses = {}, seOld = false;
  const seOpen = new Set(), seShut = new Set();
  const seCourse = r => seCourses[r.course_id] || null;
  // Gehört in die Sehtest-Liste: gebucht, nur Sehtest oder schon angefangen
  const seRelevant = r => r.sehtest_only || r.package === "komplett" || r.sehtest_nr || r.sehtest_passed != null
    || (r.sehtest_marks && Object.keys(r.sehtest_marks).length) || sehtestDay(r, seCourse(r));
  async function showNextNr() {
    $("se-next-msg").textContent = "";
    try {
      const next = await db.getNextSehtestNr();
      $("se-next").value = next || "";
      $("se-next-info").textContent = next ? `Der nächste bestätigte Sehtest bekommt die Nummer ${next}.` : `Noch keine Startnummer eingestellt. Ohne Startnummer: ${await draftNr()}.`;
    } catch (e) { $("se-next-info").textContent = "Die nächste Nummer kann nur mit Internet angezeigt werden."; }
  }
  $("se-next-save").onclick = async () => {
    const nr = $("se-next").value.trim();
    $("se-next-msg").textContent = "";
    if (!nr) { $("se-next-msg").textContent = "Bitte eine Nummer eintragen."; return; }
    if (!confirm(`Ab jetzt bekommt der nächste bestätigte Sehtest die Nummer ${nr}, danach geht es fortlaufend weiter. Speichern?`)) return;
    try { await db.setNextSehtestNr(nr); await showNextNr(); $("se-next-msg").textContent = "✓ Gespeichert."; }
    catch (e) { $("se-next-msg").textContent = e.message; }
  };
  async function loadSehtests() {
    showNextNr();
    const [regsAll, list] = await Promise.all([db.listAllRegistrations(), db.listCourses()]);
    seCourses = Object.fromEntries(list.map(c => [c.id, c]));
    // Auch die übrigen Kursteilnehmer laden: Sie stehen im Ordner unter „Weitere“, falls jemand spontan den Sehtest macht
    seRegs = regsAll.filter(r => r.status !== "storniert" && (seRelevant(r) || seCourse(r)));
    renderSehtests();
  }
  function seRow(r) {
    const c = seCourse(r), state = sehtestState(r), day = sehtestDay(r, c);
    return `<article class="se-row" data-se="${r.id}">
        <div class="se-nr">${r.sehtest_nr ? esc(r.sehtest_nr) : '<span class="muted">ohne Nr.</span>'}</div>
        <div class="se-who"><strong>${esc(r.last_name)}, ${esc(r.first_name)}</strong><br><span class="small muted">geb. ${birthText(r.birth_date)}${r.package === "komplett" ? " · Sehtest gebucht" : ""}</span></div>
        <div class="se-day small">${day ? birthText(day) : "–"}</div>
        <div class="se-res small ${r.sehtest_passed === true ? "ok" : r.sehtest_passed === false ? "no" : ""}">${r.sehtest_void_at ? "" : state || "noch offen"}${issuedTag(r)}</div>
        <div class="se-act"><button class="btn btn-sm" type="button" data-st-run>${stRunLabel(r)}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-st-print>Protokoll drucken</button>${issuedBtn(r)}
          ${r.sehtest_nr ? '<button class="btn btn-sm btn-ghost" type="button" data-st-nr>Nr. ändern</button><button class="btn btn-sm btn-ghost" type="button" data-st-again>Neuer Sehtest (neue Nr.)</button>' : ""}
          ${r.sehtest_only && !protoDone(r) ? '<button class="btn btn-sm btn-ghost" type="button" data-se-del style="color:var(--danger)">Löschen</button>' : ""}</div>
      </article>`;
  }
  // Ordner: ein Kurs (Kursdatum) oder ein Tag mit Personen nur für den Sehtest
  function seGroups(list) {
    const today = localDate(new Date()), map = new Map();
    for (const r of list) {
      const c = seCourse(r), day = c ? dayOf(c.starts_at) : (sehtestDay(r, null) || "");
      const key = c ? c.id : `nur-${day}`;
      if (!map.has(key)) map.set(key, { key, c, day, main: [], more: [] });
      map.get(key)[seRelevant(r) ? "main" : "more"].push(r);
    }
    // Kurse ohne Sehtest-Buchung nur zeigen, wenn heute Kurs ist (für spontane Sehtests)
    const groups = [...map.values()].filter(g => g.main.length || g.day === today);
    const now = groups.filter(g => g.day >= today).sort((a, b) => a.day.localeCompare(b.day) || (a.c ? 0 : 1));
    const past = groups.filter(g => g.day < today).sort((a, b) => b.day.localeCompare(a.day));
    return { now, past, today };
  }
  function seFolder(g, open) {
    const done = g.main.filter(r => r.sehtest_passed != null), ok = g.main.filter(r => r.sehtest_passed === true).length;
    const title = g.c ? `${dayText(g.c.starts_at)} · ${esc(g.c.location)}${g.c.status === "abgesagt" ? " · ABGESAGT" : ""}`
      : `Nur Sehtest · ${g.day ? dayText(g.day + "T12:00") : "ohne Datum"}`;
    const info = `${g.main.length} Sehtest${g.main.length === 1 ? "" : "s"} · ${ok} bestanden${done.length - ok ? ` · ${done.length - ok} nicht bestanden` : ""}${g.main.length - done.length ? ` · ${g.main.length - done.length} offen` : ""}`;
    return `<details class="att-folder se-folder" data-se-folder="${g.key}" ${open ? "open" : ""}>
      <summary>${title} <small>${info}</small></summary>
      <div class="att-body">${open ? seFolderBody(g) : ""}</div></details>`;
  }
  function seFolderBody(g) {
    const main = g.main.slice().sort(byName), more = g.more.slice().sort(byName);
    return `<div class="se-list">${main.length ? main.map(seRow).join("") : '<p class="small muted">Niemand hat den Sehtest gebucht.</p>'}</div>
      ${more.length ? `<details class="se-more"${seSearching() ? " open" : ""}><summary class="small">Weitere Kursteilnehmer ohne gebuchten Sehtest (${more.length})</summary><div class="se-list">${more.map(seRow).join("")}</div></details>` : ""}`;
  }
  const seWords = () => $("se-search").value.toLowerCase().split(/\s+/).filter(Boolean);
  const seSearching = () => seWords().length > 0;
  let seLast = { now: [], past: [] };
  function renderSehtests() {
    const words = seWords();
    const day = r => sehtestDay(r, seCourse(r)) || "";
    const list = seRegs.filter(r => {
      const c = seCourse(r);
      const hay = [r.first_name, r.last_name, r.sehtest_nr, birthText(r.birth_date), r.phone, r.email, day(r) && birthText(day(r)), c && birthText(dayOf(c.starts_at)), c && c.location].join(" ").toLowerCase();
      return words.every(w => hay.includes(w));
    });
    const relevant = list.filter(seRelevant);
    $("se-count").textContent = `${relevant.length} ${relevant.length === 1 ? "Sehtest" : "Sehtests"} · nach Kurstag in Ordnern. Ordner antippen, dann nacheinander testen.`;
    const { now, past, today } = seGroups(list);
    seLast = { now, past };
    // Offen: heutiger Kurs; beim Suchen alle Treffer
    const isOpen = g => words.length > 0 || seOpen.has(g.key) || (g.day === today && !seShut.has(g.key));
    const pastShown = words.length || seOld ? past : past.slice(0, 12);
    $("se-list").innerHTML = (now.length || past.length)
      ? (now.length ? `<h3 class="se-head">Heute und demnächst</h3>${now.map(g => seFolder(g, isOpen(g))).join("")}` : "")
        + (pastShown.length ? `<h3 class="se-head">Frühere Kurse</h3>${pastShown.map(g => seFolder(g, isOpen(g))).join("")}` : "")
        + (pastShown.length < past.length ? `<button class="btn btn-ghost" type="button" data-se-old>Ältere Kurse zeigen (${past.length - pastShown.length})</button>` : "")
      : `<p class="muted">${words.length ? "Nichts gefunden." : "Noch keine Sehtests."}</p>`;
  }
  // Ordner beim Öffnen füllen und Zustand merken
  $("se-list").addEventListener("toggle", ev => {
    const f = ev.target.closest && ev.target.closest("[data-se-folder]");
    if (!f || ev.target !== f) return;
    const key = f.dataset.seFolder;
    if (f.open) { seOpen.add(key); seShut.delete(key); } else { seOpen.delete(key); seShut.add(key); }
    if (f.open) {
      const g = [...seLast.now, ...seLast.past].find(x => x.key === key);
      if (g) f.querySelector(".att-body").innerHTML = seFolderBody(g);
    }
  }, true);
  $("se-search").addEventListener("input", renderSehtests);
  let seId = null; // gelesene Ausweisdaten für die neue Person
  $("se-new").onclick = () => { seId = null; $("se-idinfo").innerHTML = ""; $("se-form").classList.remove("hidden"); $("se-first").focus(); };
  $("se-scan").onclick = () => scanId($("se-idinfo"), res => {
    seId = res;
    $("se-first").value = res.firstName; $("se-last").value = res.lastName;
    if (res.birth) $("se-birth").value = res.birth;
    return `Übernommen: ${esc(res.firstName)} ${esc(res.lastName)} · geb. ${res.birth ? birthText(res.birth) : "?"} · Ausweis-Nr. ${esc(res.docNumber)}. Bitte die Namen kurz prüfen: Umlaute stehen im Ausweis als AE/OE/UE, und einzelne Buchstaben können falsch gelesen sein.`;
  });
  $("se-cancel").onclick = () => { $("se-form").reset(); $("se-form").classList.add("hidden"); };
  $("se-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    $("se-error").textContent = "";
    const first = $("se-first").value.trim(), last = $("se-last").value.trim();
    if (!first || !last) { $("se-error").textContent = "Bitte Vor- und Nachnamen eintragen."; return; }
    try {
      const row = await db.addRegistration({
        course_id: null, first_name: first, last_name: last, birth_date: $("se-birth").value || null,
        phone: $("se-phone").value.trim() || null, email: $("se-mail").value.trim() || null,
        street: $("se-street").value.trim() || null, zip: $("se-zip").value.trim() || null, city: $("se-city").value.trim() || null,
        package: "kurs", sehtest_only: true, sehtest_on: localDate(new Date()), sehtest_none: false,
        ...(seId ? { sehtest_id_doc: seId.idDoc, sehtest_id_no: seId.docNumber } : {}),
        message: "manuell eingetragen" // keine Anmelde-Mail
      });
      $("se-form").reset(); $("se-form").classList.add("hidden");
      await loadSehtests();
      await openSehtest(row, null, loadSehtests);
    } catch (e) { $("se-error").textContent = e.message; }
  });
  $("se-blank").onclick = async () => {
    const win = openTab();
    try {
      await ensurePdf();
      showPdf(await EHFYDocs.sehtestProtocols([{}], await issuer(), loadFont), "Sehtest-Protokoll_leer.pdf", win);
    } catch (e) { if (win) win.close(); $("se-error").textContent = e.message; }
  };
  $("se-list").addEventListener("click", async ev => {
    if (ev.target.closest("[data-se-old]")) { seOld = true; renderSehtests(); return; }
    const box = ev.target.closest("[data-se]");
    if (!box) return;
    const r = seRegs.find(x => x.id === box.dataset.se), c = seCourse(r), show = msg => { $("se-error").textContent = msg; };
    show("");
    if (ev.target.closest("[data-st-run]")) return openSehtest(r, c, loadSehtests).catch(e => show(e.message));
    if (ev.target.closest("[data-st-again]")) return againSehtest(r, loadSehtests).catch(e => show(e.message));
    if (ev.target.closest("[data-st-print]")) return sehtestPdf(r, c, show);
    if (ev.target.closest("[data-st-nr]")) return changeNr(r).then(loadSehtests).catch(e => show(e.message));
    if (ev.target.closest("[data-st-issued]")) return toggleIssued(r).then(loadSehtests).catch(e => show(e.message));
    if (ev.target.closest("[data-st-void]")) return voidAsk(r).then(loadSehtests).catch(e => show(e.message));
    if (ev.target.closest("[data-se-del]")) {
      if (!confirm(`${r.first_name} ${r.last_name} (nur Sehtest) endgültig löschen?${r.sehtest_nr ? `\n\nDie Protokoll-Nr. ${r.sehtest_nr} wird frei. War es die zuletzt vergebene Nummer, bekommt der nächste Sehtest wieder diese Nummer.` : ""}`)) return;
      try { await db.deleteRegistration(r.id); await loadSehtests(); } catch (e) { show(e.message); }
    }
  });

  // ---------- Sicherung ----------
  const BK_KEY = "ehfy-letzte-sicherung";
  function showLastBackup() {
    let last = null;
    try { last = localStorage.getItem(BK_KEY); } catch (e) { /* ohne Speicher */ }
    $("bk-last").textContent = last ? `Letzte Sicherung auf diesem Gerät: ${new Date(last).toLocaleDateString("de-DE")}` : "Auf diesem Gerät wurde noch keine Sicherung gespeichert.";
  }
  showLastBackup();
  $("bk-save").onclick = async ev => {
    const btn = ev.target, label = btn.textContent;
    $("bk-error").textContent = "";
    btn.disabled = true; btn.textContent = "Wird erstellt …";
    try {
      const pending = db.status().pending;
      if (pending && !confirm(`${pending} Änderung(en) sind noch nicht synchronisiert. Sie sind in der Sicherung enthalten, aber noch nicht online. Trotzdem sichern?`)) return;
      const data = await db.backupData();
      const now = new Date();
      const file = JSON.stringify({ app: "ehfy", version: 1, created_at: now.toISOString(), ...data });
      bkReady = new File([file], "EHfy-Sicherung-Daten.json", { type: "application/json" });
      $("bk-done").textContent = "✓ Daten-Sicherung ist fertig. Jetzt speichern und die alte ersetzen:";
      $("bk-store").classList.remove("hidden");
    } catch (e) { $("bk-error").textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = label; }
  };
  // ---------- Sicherung mit allen Dokumenten als ZIP (Ordner je Dokumentart, darin je Kurstag) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  // Einfache ZIP-Datei ohne Kompression (PDFs sind schon gepackt); Dateinamen in UTF-8
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h, name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(c, name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((n, x) => n + x.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, e], { type: "application/zip" });
  }
  const fileSafe = t => String(t || "").replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

  async function backupZip(progress) {
    await ensurePdf();
    const data = await db.backupData(), now = new Date();
    const files = [{ name: "EHfy-Daten (zum Wiederherstellen).json", data: new TextEncoder().encode(JSON.stringify({ app: "ehfy", version: 1, created_at: now.toISOString(), ...data })) }];
    const notes = [];
    const courses = new Map((data.courses || []).map(c => [c.id, c]));
    const regs = (data.registrations || []).filter(r => r.status !== "storniert");
    const who = r => fileSafe(`${r.last_name}, ${r.first_name}`);
    const folderDay = (r, c) => c ? `${dayOf(c.starts_at)} ${fileSafe(c.location || "")}`.trim() : (r.sehtest_on || r.legacy_course_date || "ohne Datum");
    const tpl = {};
    for (const k of ["bescheinigung", "datenblatt"]) tpl[k] = await db.getTemplate(k).catch(() => null);
    const jobs = [];
    for (const r of regs) {
      const c = courses.get(r.course_id) || null;
      // Sehtest-Protokoll: nur abgeschlossene (Ergebnis übernommen), nicht Ausschuss
      if (r.sehtest_passed != null && !r.sehtest_void_at) {
        jobs.push(async () => files.push({ name: `Sehtest-Protokolle/${folderDay(r, c)}/${r.sehtest_nr ? "Nr " + fileSafe(r.sehtest_nr) + " - " : ""}${who(r)}.pdf`, data: await protocolBytes(r, c) }));
      }
      // Hochgeladene (eingescannte) Protokolle
      if (r.protocol_added_on) {
        jobs.push(async () => { const b = await db.getTemplate(`protokolle/${r.id}`).catch(() => null); if (b) files.push({ name: `Sehtest-Protokolle/${folderDay(r, c)}/${who(r)} (hochgeladen).pdf`, data: new Uint8Array(await new Response(b).arrayBuffer()) }); });
      }
      if (!c || c.virtual) continue;
      // Teilnehmerdatenblatt für jeden im Kurs, Erste-Hilfe-Bescheinigung für alle, die teilgenommen haben
      if (tpl.datenblatt) jobs.push(async () => files.push({ name: `Teilnehmerdatenblaetter/${folderDay(r, c)}/${who(r)}.pdf`, data: await EHFYDocs.datasheets(tpl.datenblatt, c, [r], loadFont) }));
      if (tpl.bescheinigung && r.status === "teilgenommen") jobs.push(async () => files.push({ name: `Erste-Hilfe-Bescheinigungen/${folderDay(r, c)}/${who(r)}.pdf`, data: await EHFYDocs.certificates(tpl.bescheinigung, c, [r], loadFont, { infoLeafletHanded: cfg.documents.infoLeafletHanded }) }));
    }
    // Teilnehmerlisten je Kurs (nur markierte Teilnehmer)
    for (const c of courses.values()) {
      const list = regs.filter(r => r.course_id === c.id && r.on_list).sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "de"));
      if (list.length) jobs.push(async () => files.push({ name: `Teilnehmerlisten/${dayOf(c.starts_at)} ${fileSafe(c.location || "")}.pdf`, data: await EHFYDocs.participantList(c, list, await issuer(), loadFont, cfg.packages) }));
    }
    if (!tpl.datenblatt) notes.push("Teilnehmerdatenblätter fehlen: Die Vorlage „Teilnehmerdatenblatt“ ist noch nicht hochgeladen.");
    if (!tpl.bescheinigung) notes.push("Bescheinigungen fehlen: Die Vorlage „Bescheinigung“ ist noch nicht hochgeladen.");
    // Vorhandene Rechnungen und Quittungen (ohne Unterschrift, wie gedruckt)
    for (const inv of (data.invoices || []).filter(i => !i.draft && i.number)) {
      const folder = inv.type === "quittung" ? "Quittungen" : "Rechnungen";
      const year = String(inv.issued_on || "").slice(0, 4) || "ohne Jahr";
      jobs.push(async () => files.push({
        name: `${folder}/${year}/${fileSafe(inv.number)} - ${fileSafe((inv.recipient && inv.recipient.name) || "")}${inv.status === "storniert" ? " (storniert)" : ""}.pdf`,
        data: inv.type === "quittung" ? await receiptPdf([inv]) : await EHFYDocs.invoice(inv, await issuer(), loadFont, cfg.documents.paymentDays)
      }));
    }
    for (let i = 0; i < jobs.length; i++) {
      progress(i + 1, jobs.length);
      try { await jobs[i](); } catch (e) { notes.push(`Ein Dokument konnte nicht erstellt werden: ${e.message}`); }
    }
    files.push({ name: "LIESMICH.txt", data: new TextEncoder().encode([
      `EHfy-Sicherung vom ${now.toLocaleString("de-DE")}`, "",
      "Ordner:", "- Sehtest-Protokolle: abgeschlossene Protokolle, je Kurstag",
      "- Erste-Hilfe-Bescheinigungen und Teilnehmerdatenblaetter: je Kurstag",
      "- Rechnungen und Quittungen: je Jahr", "- EHfy-Daten (zum Wiederherstellen).json: alle Daten für „Aus einer Sicherung wiederherstellen“", "",
      "Die Datei enthält persönliche Daten. Bitte sicher aufbewahren.", ...(notes.length ? ["", "Hinweise:", ...notes] : [])
    ].join("\r\n")) });
    // Immer derselbe Name: Beim Speichern wird die alte Sicherung ersetzt
    return { blob: makeZip(files), count: files.length - 2, name: "EHfy-Sicherung.zip" };
  }
  // Speichern mit festem Namen, damit die alte Sicherung ersetzt wird:
  // Computer: Speichern-Fenster (gleiche Datei wählen → ersetzen); iPhone: Teilen → „In Dateien sichern“ → „Ersetzen“
  let bkReady = null;
  async function storeBackup(file) {
    if (window.showSaveFilePicker) {
      const h = await window.showSaveFilePicker({ suggestedName: file.name, types: [{ description: file.type === "application/zip" ? "ZIP-Datei" : "Sicherung", accept: { [file.type]: [file.name.slice(file.name.lastIndexOf("."))] } }] });
      const w = await h.createWritable(); await w.write(file); await w.close();
    } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
    } else {
      const url = URL.createObjectURL(file), a = document.createElement("a");
      a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }
    try { localStorage.setItem(BK_KEY, new Date().toISOString()); } catch (e) { /* ohne Speicher */ }
    showLastBackup();
  }
  $("bk-store").onclick = async () => {
    if (!bkReady) return;
    $("bk-error").textContent = "";
    try {
      await storeBackup(bkReady);
      $("bk-done").textContent = `✓ ${bkReady.name} gespeichert.`;
      $("bk-store").classList.add("hidden");
    } catch (e) { if (e.name !== "AbortError") $("bk-error").textContent = e.message; }
  };
  $("bk-zip").onclick = async ev => {
    const btn = ev.target, label = btn.textContent;
    $("bk-error").textContent = "";
    btn.disabled = true; btn.textContent = "Wird erstellt …";
    try {
      const pending = db.status().pending;
      if (pending && !confirm(`${pending} Änderung(en) sind noch nicht synchronisiert. Trotzdem sichern?`)) return;
      const res = await backupZip((i, n) => { btn.textContent = `Dokumente ${i} von ${n} …`; });
      bkReady = new File([res.blob], res.name, { type: "application/zip" });
      $("bk-done").innerHTML = `✓ Sicherung mit ${res.count} Dokumenten ist fertig. Jetzt speichern und die alte ersetzen:`;
      $("bk-store").classList.remove("hidden");
    } catch (e) { $("bk-error").textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = label; }
  };

  // Aus unserer eigenen ZIP-Sicherung die Daten-Datei (.json) lesen (ohne Kompression gespeichert)
  function jsonFromZip(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder();
    for (let p = 0; p + 30 <= b.length && v.getUint32(p, true) === 0x04034b50;) {
      const method = v.getUint16(p + 8, true), size = v.getUint32(p + 18, true), nl = v.getUint16(p + 26, true), xl = v.getUint16(p + 28, true);
      const name = dec.decode(b.subarray(p + 30, p + 30 + nl)), start = p + 30 + nl + xl;
      if (/\.json$/i.test(name) && method === 0) return dec.decode(b.subarray(start, start + size));
      p = start + size;
    }
    throw new Error("In dieser ZIP-Datei ist keine EHfy-Sicherung.");
  }
  let bkData = null;
  $("bk-file").addEventListener("change", async ev => {
    const file = ev.target.files[0];
    bkData = null;
    $("bk-error").textContent = ""; $("bk-preview").textContent = "";
    $("bk-restore").classList.add("hidden");
    if (!file) return;
    try {
      const data = JSON.parse(/\.zip$/i.test(file.name) ? jsonFromZip(new Uint8Array(await file.arrayBuffer())) : await file.text());
      if (data.app !== "ehfy" || !Array.isArray(data.courses) || !Array.isArray(data.registrations)) throw new Error("Das ist keine EHfy-Sicherung.");
      bkData = data;
      $("bk-preview").innerHTML = `<p>Sicherung vom ${new Date(data.created_at).toLocaleString("de-DE")}: <strong>${data.courses.length} Kurse</strong>, <strong>${data.registrations.length} Anmeldungen</strong>, ${(data.invoices || []).length} Belege.</p>
        <p class="muted">Es werden nur fehlende Kurse und Anmeldungen ergänzt. Vorhandene Einträge bleiben unverändert. Belege lassen sich hier nicht einspielen, sie bleiben in der Datei.</p>`;
      $("bk-restore").classList.remove("hidden");
    } catch (e) { $("bk-error").textContent = e instanceof SyntaxError ? "Die Datei konnte nicht gelesen werden." : e.message; }
  });
  $("bk-restore").onclick = async ev => {
    const d = bkData;
    if (!d || !confirm(`Fehlende Daten aus dieser Sicherung ergänzen?`)) return;
    ev.target.disabled = true;
    $("bk-error").textContent = "";
    try {
      const courseRows = d.courses.map(({ booked, registrations, ...row }) => row);
      await db.importLegacy(courseRows, d.registrations);
      // Einstellungen: Vorhandenes hat Vorrang, Fehlendes kommt aus der Sicherung
      const current = await db.getSettings();
      const merged = { ...(d.settings || {}), ...current };
      if (Object.keys(merged).length !== Object.keys(current).length) await db.saveSettings(merged);
      bankData = null;
      $("bk-preview").innerHTML = "<strong>Wiederherstellung fertig ✓</strong> Fehlende Einträge wurden ergänzt.";
      $("bk-restore").classList.add("hidden");
      $("bk-file").value = "";
      bkData = null;
      await loadCourses();
    } catch (e) { $("bk-error").textContent = `Nicht abgeschlossen: ${e.message}`; }
    ev.target.disabled = false;
  };

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
      if (/\.csv$/i.test(file.name)) {
        // WordPress: oft Windows-Zeichensatz
        const bytes = await file.arrayBuffer();
        let text;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (x) { text = new TextDecoder("windows-1252").decode(bytes); }
        importPlan = await EHFYImport.planWordpress(EHFYImport.parseCsv(text), { existing: await db.listAllRegistrations(), courses, siegenAddress: cfg.defaultAddress });
        const p = importPlan;
        const days = [...new Set(p.courses.map(c => new Date(c.starts_at).toLocaleDateString("de-DE")))];
        $("im-preview").innerHTML = `<p><strong>${p.card} Personen</strong> kommen in die Schülerkartei, <strong>${p.coming}</strong> auf kommende Kurse.
          ${p.duplicates} Doppelte bleiben unverändert, ${p.skipped.length} werden nicht übernommen.</p>
          ${days.length ? `<p><strong>Neue Kurse werden angelegt (Siegen, 10:00 bis 17:30):</strong> ${days.join(", ")}</p>` : ""}
          ${p.skipped.length ? `<p><strong>Nicht übernommen:</strong></p>${nameList(p.skipped.slice(0, 30))}` : ""}
          ${p.check.length ? `<p><strong>Werden übernommen, bitte prüfen (${p.check.length}):</strong></p>${nameList(p.check.slice(0, 30))}` : ""}`;
      } else {
        const rows = JSON.parse(await file.text());
        if (!Array.isArray(rows)) throw new Error("Das ist nicht die erwartete Datei.");
        importPlan = await EHFYImport.plan(rows, { siegenAddress: cfg.defaultAddress });
        const p = importPlan;
        $("im-preview").innerHTML = `<p><strong>${p.regs.length} Teilnehmer in ${p.courses.length} Kursen</strong> werden übernommen.
          ${p.merged} doppelte Einträge werden zusammengelegt, ${p.skipped.length} nicht übernommen.</p>
          ${p.skipped.length ? `<p><strong>Nicht übernommen:</strong></p>${nameList(p.skipped)}` : ""}
          ${p.check.length ? `<p><strong>Werden übernommen, bitte prüfen:</strong></p>${nameList(p.check)}` : ""}`;
      }
      $("im-start").classList.remove("hidden");
    } catch (e) { $("im-error").textContent = e instanceof SyntaxError ? "Die Datei konnte nicht gelesen werden." : e.message; }
  });
  $("im-start").onclick = async () => {
    const p = importPlan;
    if (!p || !confirm(`${p.regs.length} Teilnehmer jetzt übernehmen?`)) return;
    $("im-start").disabled = true;
    $("im-error").textContent = "";
    const note = document.createElement("p");
    $("im-preview").prepend(note);
    try {
      await db.importLegacy(p.courses, p.regs, n => { note.textContent = `${n} von ${p.regs.length} übertragen …`; });
      note.innerHTML = "<strong>Import fertig ✓</strong> Die Teilnehmer stehen jetzt im Bereich Schüler. Bitte speichere eine neue Sicherung und lösche danach die Importdatei.";
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
  async function issuer(forMail) {
    if (!bankData) bankData = await db.getSettings().catch(() => ({}));
    // Deine hinterlegte Unterschrift nur auf Belegen, die per E-Mail rausgehen. Gedruckt unterschreibst du selbst.
    return { ...cfg.issuer, ...bankData, signature: forMail ? await signatureBytes() : null };
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
  const TEMPLATES = { bescheinigung: "Bescheinigung", datenblatt: "Teilnehmerdatenblatt" };
  // Quittung: auf deiner Vorlage, solange keine hochgeladen ist im EHfy-Design
  // Quittung immer im EHfy-Design (eine hochgeladene Quittungs-Vorlage wird nicht mehr benutzt)
  const receiptPdf = async (list, forMail) => EHFYDocs.receipts(list, await issuer(forMail), loadFont, null);
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
  function pdfDialog(bytes, name, mail, fix) {
    $("pd-fix").classList.toggle("hidden", !fix);
    $("pd-fix").textContent = fix ? fix.label : "";
    $("pd-fix").disabled = false;
    $("pd-fix").onclick = fix ? async () => {
      $("pd-fix").disabled = true; $("pd-fix").textContent = "Wird angelegt …";
      try { await fix.run(); } catch (e) { $("pd-status").textContent = e.message; $("pd-fix").disabled = false; $("pd-fix").textContent = fix.label; }
    } : null;
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
      "", `Diese ${doc} wurde maschinell erstellt und ist mit der eingefügten digitalen Unterschrift gültig.`,
      "", "Herzlichen Dank für Ihr Vertrauen!", "", "Viele Grüße",
      cfg.issuer.owner, cfg.issuer.name, `Tel. ${cfg.issuer.phone}`, cfg.issuer.web
    ];
    return { invoice_id: inv.id, to: inv.recipient.email || "", subject, body: lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n") };
  }

  // Bescheinigung (mit deiner Unterschrift) oder Datenblatt (ohne, das unterschreibt der Schüler) per E-Mail
  async function docMail(kind, r, course) {
    await ensurePdf();
    const bytes = await docBytes(kind, [r], course, true);
    const isCert = kind === "bescheinigung", day = EHFYDocs.fmtDate(course.starts_at);
    const doc = isCert ? "Ihre Teilnahmebescheinigung" : "Ihr Teilnehmerdatenblatt";
    const lines = [
      `Hallo ${r.first_name} ${r.last_name},`, "",
      `anbei erhalten Sie ${doc} zum Erste-Hilfe-Kurs am ${day}.`,
      isCert ? "Die Bescheinigung wurde maschinell erstellt und ist mit der eingefügten digitalen Unterschrift gültig." : "Bitte prüfen Sie Ihre Angaben und melden Sie sich, falls etwas nicht stimmt.",
      "", "Viele Grüße", cfg.issuer.owner, cfg.issuer.name, `Tel. ${cfg.issuer.phone}`, cfg.issuer.web
    ];
    const name = `${isCert ? "Bescheinigung" : "Datenblatt"}_${r.last_name}_${r.first_name}.pdf`;
    pdfDialog(bytes, name, { to: r.email || "", subject: `${isCert ? "Teilnahmebescheinigung" : "Teilnehmerdatenblatt"} Erste-Hilfe-Kurs am ${day} – Erste Hilfe for you`, body: lines.join("\n") });
  }

  async function sendBill(inv) {
    if (inv.draft) throw new Error("Dieser Beleg ist noch ein Entwurf ohne Nummer. Bitte zuerst „Synchronisieren“, dann senden.");
    await ensurePdf();
    const bytes = inv.type === "quittung"
      ? await receiptPdf([inv], true)
      : await EHFYDocs.invoice(inv, await issuer(true), loadFont, cfg.documents.paymentDays);
    pdfDialog(bytes, `${inv.type === "quittung" ? "Quittung" : "Rechnung"}_${inv.number}.pdf`, billMail(inv));
  }

  // Quittungen/Rechnungen: vorhandene wiederverwenden, fehlende mit neuer Nummer anlegen
  // preview = true: fehlende Belege nur als Vorschau ohne Nummer (die Nummer wird erst beim Drucken oder Senden fest vergeben)
  async function billsFor(type, people, course, preview) {
    const existing = await db.invoicesForRegistrations(people.map(r => r.id));
    const day = localDate(new Date(course.starts_at));
    // Quittung = bar am Kurstag bezahlt; Rechnung = normal mit Zahlungsziel ab heute
    const cash = type === "quittung";
    const out = [];
    for (const r of people) {
      let inv = existing.find(i => i.registration_id === r.id && i.type === type);
      if (!inv) {
        const data = {
          type, registration_id: r.id, status: cash ? "bezahlt" : "offen", payment: cash ? "bar" : "ueberweisung",
          issued_on: cash ? day : localDate(new Date()), service_date: day,
          recipient: { name: `${r.first_name} ${r.last_name}`, birth_date: r.birth_date || null, street: r.street || "", zip: r.zip || "", city: r.city || "", email: r.email || "" },
          items: [...EHFYDocs.receiptItems(r, course, cfg.packages),
            ...(Number(r.discount) > 0 ? [{ text: `Gutschein${r.discount_note ? ": " + r.discount_note : ""}`, qty: 1, price: -Number(r.discount) }] : [])]
        };
        inv = preview
          ? { ...data, preview: true, number: "Vorschau", total: data.items.reduce((n, i) => n + i.qty * i.price, 0) }
          : await db.createInvoice(data);
      }
      // Ältere Belege kennen das Geburtsdatum noch nicht
      out.push({ ...inv, recipient: { ...inv.recipient, birth_date: inv.recipient.birth_date || r.birth_date || null } });
    }
    return out;
  }

  // Ein Dokument-Typ als PDF-Bytes (eine Seite pro Teilnehmer, gleiche Reihenfolge)
  async function docBytes(kind, people, course, forMail, preview) {
    const D = window.EHFYDocs;
    // Deine Unterschrift kommt nur auf Bescheinigungen, die per E-Mail rausgehen
    if (kind === "bescheinigung") return D.certificates(await template("bescheinigung"), course, people, loadFont, { infoLeafletHanded: cfg.documents.infoLeafletHanded, signature: forMail ? await signatureBytes() : null });
    if (kind === "datenblatt") return D.datasheets(await template("datenblatt"), course, people, loadFont);
    if (kind === "quittung") return receiptPdf(await billsFor("quittung", people, course, preview));
    if (kind === "rechnung") return D.invoices(await billsFor("rechnung", people, course, preview), await issuer(), loadFont, cfg.documents.paymentDays);
    if (kind === "teilnehmerliste") {
      const list = people.filter(r => r.on_list && r.status !== "storniert");
      if (!list.length) throw new Error("Noch niemand für die Teilnehmerliste markiert. Bitte bei den Teilnehmern „Auf Teilnehmerliste“ ankreuzen.");
      return D.participantList(course, list, await issuer(), loadFont, cfg.packages);
    }
  }
  const DOC_NAMES = { teilnehmerliste: "Teilnehmerliste", bescheinigung: "Bescheinigungen", datenblatt: "Datenblaetter", quittung: "Quittungen", rechnung: "Rechnungen", alles: "Kursmappe" };
  // „alles“: pro Teilnehmer Datenblatt, Bescheinigung und Quittung hintereinander
  const BUNDLE = ["datenblatt", "bescheinigung", "quittung"];

  async function makeDoc(kind, people, course, win) {
    await ensurePdf();
    const who = people.length === 1 ? `_${people[0].last_name}_${people[0].first_name}` : "";
    const name = `${DOC_NAMES[kind]}_${localDate(new Date(course.starts_at))}_${course.location}${who}.pdf`;
    const build = preview => kind === "alles"
      ? Promise.all(BUNDLE.map(k => docBytes(k, people, course, false, preview))).then(parts => EHFYDocs.bundle(parts))
      : docBytes(kind, people, course, false, preview);
    // Quittung/Rechnung: Fehlt noch ein Beleg, erst fragen – Nummern werden nur beim Drucken fest vergeben
    const type = kind === "rechnung" ? "rechnung" : ["quittung", "alles"].includes(kind) ? "quittung" : null;
    if (type) {
      const existing = await db.invoicesForRegistrations(people.map(r => r.id));
      const missing = people.filter(r => !existing.some(i => i.registration_id === r.id && i.type === type)).length;
      if (missing) {
        if (win && !win.closed) win.close();
        const label = type === "rechnung" ? "Rechnung" : "Quittung";
        const many = missing > 1 ? `${missing} ${label}en` : label;
        const choice = await askChoice(`${many} erstellen?`,
          `${missing === 1 ? "Für diese Person gibt es noch keine " + label : "Für " + missing + " Personen gibt es noch keine " + label}. Erst mit „${many} erstellen“ wird die Nummer fest vergeben.`,
          [["print", `${many} erstellen (Nummer fest vergeben)`], ["preview", "Nur ansehen (Vorschau ohne Nummer)"]]);
        if (!choice) return;
        if (choice === "preview") {
          return pdfDialog(await build(true), name.replace(".pdf", "_Vorschau.pdf"), null, {
            label: `${many} erstellen (Nummer fest vergeben)`,
            run: async () => pdfDialog(await build(false), name)
          });
        }
        return pdfDialog(await build(false), name);
      }
    }
    showPdf(await build(false), name, win);
  }
  // Kleines Auswahlfenster; Ergebnis: Wert des Knopfes oder null (Abbrechen)
  function askChoice(title, text, buttons) {
    return new Promise(resolve => {
      const d = document.createElement("dialog");
      d.className = "qr-dlg";
      d.innerHTML = `<h3 style="margin:0 0 6px">${esc(title)}</h3><p class="small" style="margin:0 0 12px">${esc(text)}</p>
        <div class="btn-row">${buttons.map(([v, l], i) => `<button class="btn ${i ? "btn-ghost" : ""}" type="button" data-v="${v}">${esc(l)}</button>`).join("")}<button class="btn btn-ghost" type="button" data-v="">Abbrechen</button></div>`;
      document.body.appendChild(d);
      const done = v => { d.close(); d.remove(); resolve(v || null); };
      d.oncancel = e => { e.preventDefault(); done(null); };
      d.onclick = e => { const b = e.target.closest("[data-v]"); if (b) done(b.dataset.v); };
      d.showModal();
    });
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
    if (kind === "bescheinigung-mail" || kind === "datenblatt-mail") {
      $("doc-error").textContent = "";
      docMail(kind.replace("-mail", ""), people[0], current).catch(e => { $("doc-error").textContent = e.message; });
      return;
    }
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
  $("inv-year").onchange = () => { invMonth = ""; loadInvoices(); };
  const INV_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  let invMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  const inMonth = i => !invMonth || i.issued_on.slice(5, 7) === invMonth;
  $("inv-month").onchange = () => { invMonth = $("inv-month").value; renderInvoiceRows(); };
  // Alle Belege des gewählten Monats als eine PDF, in Nummernfolge
  async function printMonth(type, label) {
    $("inv-print-error").textContent = "";
    const list = invoices.filter(i => i.type === type && inMonth(i) && !i.draft).sort((a, b) => a.seq - b.seq);
    if (!list.length) { $("inv-print-error").textContent = `Für diese Auswahl gibt es keine ${label}.`; return; }
    const win = openTab();
    try {
      await ensurePdf();
      const bytes = type === "quittung" ? await receiptPdf(list) : await EHFYDocs.invoices(list, await issuer(), loadFont, cfg.documents.paymentDays);
      showPdf(bytes, `${label}_${$("inv-year").value}${invMonth ? "-" + invMonth : ""}.pdf`, win);
    } catch (e) { if (win) win.close(); $("inv-print-error").textContent = e.message; }
  }
  // Rechnungen und Quittungen zusammen, in Nummernfolge, als eine PDF
  async function allBelegePdf(list) {
    await ensurePdf();
    const { PDFDocument } = window.PDFLib;
    const receiptsList = list.filter(i => i.type === "quittung"), billsList = list.filter(i => i.type !== "quittung");
    const load = async (bytes) => PDFDocument.load(bytes);
    const fromReceipts = receiptsList.length ? await load(await receiptPdf(receiptsList)) : null;
    const fromBills = billsList.length ? await load(await EHFYDocs.invoices(billsList, await issuer(), loadFont, cfg.documents.paymentDays)) : null;
    const out = await PDFDocument.create();
    for (const inv of list) {
      const isReceipt = inv.type === "quittung";
      const [page] = await out.copyPages(isReceipt ? fromReceipts : fromBills, [(isReceipt ? receiptsList : billsList).indexOf(inv)]);
      out.addPage(page);
    }
    return out.save();
  }
  const belegeOf = all => (all ? invoices : invoices.filter(inMonth)).filter(i => !i.draft).sort((a, b) => a.seq - b.seq);
  function saveFile(bytes, name) {
    // In der iPhone-App geht das Speichern über den PDF-Dialog
    if (appMode) return pdfDialog(bytes, name);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function belegeAction(list, name, button, run) {
    const err = $("inv-print-error");
    err.textContent = "";
    if (!list.length) { err.textContent = "Für diese Auswahl gibt es keine Belege."; return; }
    const label = button.textContent;
    button.disabled = true; button.textContent = "Wird erstellt …";
    try { run(await allBelegePdf(list), name); }
    catch (e) { err.textContent = e.message; }
    finally { button.disabled = false; button.textContent = label; }
  }
  const periodName = all => `Belege_${$("inv-year").value}${!all && invMonth ? "-" + invMonth : ""}.pdf`;
  window.EHFYAdmin = { ensurePdf, showPdf, saveFile, openTab, loadFont, settingsChanged() { bankData = null; } };
  $("inv-print-all").onclick = async ev => {
    const list = belegeOf(false);
    if (!list.length) { $("inv-print-error").textContent = "Für diese Auswahl gibt es keine Belege."; return; }
    const win = openTab();
    await belegeAction(list, periodName(false), ev.target, (bytes, name) => showPdf(bytes, name, win));
    if (win && $("inv-print-error").textContent) win.close();
  };
  $("inv-dl-all").onclick = ev => belegeAction(belegeOf(false), periodName(false), ev.target, saveFile);
  $("inv-dl-year").onclick = ev => belegeAction(belegeOf(true), periodName(true), ev.target, saveFile);
  $("inv-print-bills").onclick = () => printMonth("rechnung", "Rechnungen");
  $("inv-print-receipts").onclick = () => printMonth("quittung", "Quittungen");

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
    renderInvoiceRows();
  }
  function renderInvoiceRows() {
    const counts = {};
    for (const i of invoices) counts[i.issued_on.slice(5, 7)] = (counts[i.issued_on.slice(5, 7)] || 0) + 1;
    $("inv-month").innerHTML = `<option value="">Ganzes Jahr (${invoices.length})</option>` + INV_MONTHS.map((m, n) => {
      const key = String(n + 1).padStart(2, "0");
      return `<option value="${key}" ${key === invMonth ? "selected" : ""}>${m} (${counts[key] || 0})</option>`;
    }).join("");
    const shown = invoices.filter(inMonth);
    const of = t => shown.filter(i => i.type === t && !i.draft).length;
    $("inv-print-bills").textContent = `Nur Rechnungen (${of("rechnung")})`;
    $("inv-print-receipts").textContent = `Nur Quittungen (${of("quittung")})`;
    $("inv-print-all").textContent = `Alles drucken (${of("rechnung") + of("quittung")})`;
    $("inv-dl-all").textContent = `Herunterladen (${of("rechnung") + of("quittung")})`;
    $("inv-dl-year").textContent = `Ganzes Jahr herunterladen (${invoices.filter(i => !i.draft).length})`;
    $("inv-rows").innerHTML = shown.length ? shown.map(i => `
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
      </tr>`).join("") : '<tr><td colspan="7" class="muted">Für diese Auswahl gibt es keine Rechnungen oder Quittungen.</td></tr>';
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

  // ---------- Unterschrift: einmal mit Finger oder Maus zeichnen, geschützt gespeichert (als kleine PDF) ----------
  const signatureBytes = () => db.getTemplate("unterschrift").catch(() => null);
  // Gezeichnete Unterschrift (PNG) als eine PDF-Seite, wie die hinterlegte Unterschrift
  async function sigToPdf(png) {
    await ensurePdf();
    const { PDFDocument } = window.PDFLib, pdf = await PDFDocument.create();
    const img = await pdf.embedPng(png);
    pdf.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    return pdf.save();
  }
  const bigSign = title => EHFYSign.big({ title, ok: "Unterschrift bestätigen" });

  // Einstellungen: Tippen aufs Feld öffnet das große Unterschriftsfeld, danach wird gespeichert
  // Einstellungen: Knopf öffnet sofort das große Feld (quer); nach „Unterschrift bestätigen“ wird gleich gespeichert
  function signaturePad() {
    $("sig-open").onclick = async () => {
      $("sig-msg").textContent = "";
      const png = await bigSign("Deine Unterschrift");
      if (!png) return;
      $("sig-preview").innerHTML = `<img src="${png}" alt="Deine Unterschrift">`;
      $("sig-preview").classList.remove("hidden");
      $("sig-msg").textContent = "Wird gespeichert …";
      try {
        await db.saveTemplate("unterschrift", new Blob([await sigToPdf(png)], { type: "application/pdf" }));
        $("sig-msg").textContent = "✓ Unterschrift gespeichert.";
        await showSignature();
      } catch (e) { $("sig-msg").textContent = e.message; }
    };
  }
  async function showSignature() {
    const has = !!(await signatureBytes());
    $("sig-state").innerHTML = has ? '<span class="pill">Unterschrift hinterlegt</span> Neu unterschreiben ersetzt sie.' : '<span class="pill pill-warn">fehlt noch</span>';
    $("sig-open").textContent = has ? "✍ Neu unterschreiben (großes Feld, quer)" : "✍ Unterschreiben (großes Feld, quer)";
  }
  if ($("sig-open")) { signaturePad(); }

  // ---------- Vorlagen ----------
  async function renderTemplates() {
    showSignature().catch(() => {});
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
