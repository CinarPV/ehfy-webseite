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
  $("loc-list").innerHTML = cfg.locations.map(l => `<option value="${esc(l.name)}">`).join("");
  const locByName = name => cfg.locations.find(l => l.name.toLowerCase() === name.trim().toLowerCase());
  $("cd-loc").addEventListener("change", () => { const l = locByName($("cd-loc").value); if (l) $("cd-addr").value = l.address; });

  // ---------- Termin freigeben: Ort antippen, Tag antippen, freigeben ----------
  const FREE = { free: true, name: "", weekday: 6, start: cfg.locations[0].start, end: cfg.locations[0].end, address: "" };
  const qSel = new Set();
  let qCal = null, qIndex = -1, qList = [];
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

  async function loadLocations() {
    const saved = (await db.getSettings().catch(() => ({}))).locations;
    qList = saved && saved.length ? saved : [...cfg.locations, FREE];
    if (!qList.some(l => l.free)) qList = [...qList, FREE];
  }
  function renderChips() {
    $("q-locs").innerHTML = qList.map((l, i) =>
      `<button type="button" class="chip-btn ${i === qIndex ? "active" : ""}" data-i="${i}">${esc(l.name || "Frei")}</button>`).join("");
  }
  function renderQ() {
    renderChips();
    const keys = [...qSel].sort();
    $("q-hint").textContent = qIndex < 0 ? "Zuerst einen Ort antippen, dann im Kalender den Tag." : "Tippe alle gewünschten Tage an. Bereits eingetragene Termine sind grau.";
    $("q-sel").textContent = keys.length ? `Ausgewählt: ${keys.map(qFormat).join(", ")}` : "Noch kein Tag ausgewählt.";
    $("q-save").disabled = qIndex < 0 || !keys.length;
    $("q-save").textContent = keys.length > 1 ? `${keys.length} Termine freigeben` : "Termin freigeben";
    if (qCal) qCal.render();
  }
  function setupPanel() {
    if (qCal) { qCal.setMarks(courseMarks()); return; }
    qCal = EHFYCalendar($("q-cal"), {
      marks: courseMarks(),
      selected: qSel,
      highlightWeekdays: [0, 6],
      isPickable: key => qIndex >= 0 && key >= todayKey,
      onPick: key => { qSel.has(key) ? qSel.delete(key) : qSel.add(key); renderQ(); }
    });
    loadLocations().then(renderQ);
  }
  $("q-locs").addEventListener("click", ev => {
    const b = ev.target.closest("[data-i]");
    if (!b) return;
    qIndex = Number(b.dataset.i);
    const l = qList[qIndex];
    $("q-loc").value = l.name || "";
    $("q-addr").value = l.address || "";
    $("q-start").value = l.start;
    $("q-end").value = l.end;
    $("q-cap").value = l.capacity ?? cfg.defaultCapacity;
    $("q-note").value = "";
    $("q-online").checked = true;
    $("q-error").textContent = "";
    $("q-remember-msg").textContent = "";
    // Der freie Knopf braucht zuerst einen Namen
    if (l.free && !l.name) { $("q-details").open = true; $("q-loc").focus(); }
    renderQ();
  });
  $("q-loc").addEventListener("change", () => {
    const l = qList.find(x => x.name && x.name.toLowerCase() === $("q-loc").value.trim().toLowerCase());
    if (l && !$("q-addr").value.trim()) $("q-addr").value = l.address;
  });
  // Angaben dauerhaft für den gewählten Knopf merken (auch der freie Knopf)
  $("q-remember").onclick = async () => {
    if (qIndex < 0) return;
    qList[qIndex] = { ...qList[qIndex], name: $("q-loc").value.trim(), address: $("q-addr").value.trim(), start: $("q-start").value, end: $("q-end").value, capacity: parseInt($("q-cap").value, 10) || 0 };
    const settings = await db.getSettings().catch(() => ({}));
    await db.saveSettings({ ...settings, locations: qList });
    bankData = null;
    $("q-remember-msg").textContent = "Gespeichert ✓ – kommt mit „Online stellen“ auf deine anderen Geräte.";
    renderQ();
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
      qSel.clear();
      // Freigeben heißt: gleich online. Ohne Internet bleibt es für „Online stellen“ gespeichert.
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
    try { await db.deleteRegistration(r.id); await loadRegs(); } catch (e) { alert(e.message); }
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

  // ---------- Abgleich: lokal arbeiten, dann „Online stellen“ ----------
  function renderSync() {
    const st = db.status();
    $("sync-dot").className = "sync-dot " + (st.online ? "on" : "off");
    const parts = [st.online ? "Online" : "Offline – du arbeitest auf diesem Gerät"];
    parts.push(st.pending ? `${st.pending} Änderung${st.pending === 1 ? "" : "en"} noch nicht online` : "Alles online");
    if (st.newRegs) parts.unshift(`${st.newRegs} neue Anmeldung${st.newRegs === 1 ? "" : "en"}`);
    if (st.lastSync) parts.push(`Stand ${new Date(st.lastSync).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
    if (!st.live) parts.push("Demo: nur dieses Gerät");
    $("sync-text").textContent = st.error || parts.join(" · ");
    $("sync-text").style.color = st.error ? "var(--danger)" : "";
    $("sync-btn").disabled = !st.online || st.syncing;
    $("sync-btn").textContent = st.syncing ? "Wird übertragen …" : st.pending ? `Online stellen (${st.pending})` : "Aktualisieren";
  }
  $("sync-btn").onclick = () => { db.clearNew(); db.sync().catch(() => {}); };
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
  });

  // ---------- Bereiche: Termine, Rechnungen, Vorlagen ----------
  $("main-tabs").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-view]");
    if (!b) return;
    [...$("main-tabs").children].forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll("[data-section]").forEach(el => el.classList.add("hidden"));
    if (b.dataset.view === "termine") { $("courses-view").classList.remove("hidden"); loadCourses(); }
    if (b.dataset.view === "rechnungen") { $("invoices-view").classList.remove("hidden"); loadInvoices(); }
    if (b.dataset.view === "vorlagen") { $("templates-view").classList.remove("hidden"); renderTemplates(); renderBank(); renderPush(); }
  });

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
  const TEMPLATES = { bescheinigung: "Bescheinigung", datenblatt: "Teilnehmerdatenblatt" };
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
    if (!bytes) throw new Error(`Die Vorlage „${TEMPLATES[key]}“ fehlt noch. Bitte unter „Vorlagen“ hochladen.`);
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
  // Über das Teilen-Menü landet die PDF als Anhang direkt in deiner Mail-App (mit deinem web.de-Konto).
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

  // Direkt über dein web.de-Postfach senden
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
    if (inv.draft) throw new Error("Dieser Beleg ist noch ein Entwurf ohne Nummer. Bitte zuerst „Online stellen“, dann senden.");
    await ensurePdf();
    const bytes = inv.type === "quittung"
      ? await EHFYDocs.receipts([inv], await issuer(), loadFont)
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
          recipient: { name: `${r.first_name} ${r.last_name}`, street: r.street || "", zip: r.zip || "", city: r.city || "", email: r.email || "" },
          items: EHFYDocs.receiptItems(r, course, cfg.packages)
        });
      }
      out.push(inv);
    }
    return out;
  }

  // Ein Dokument-Typ als PDF-Bytes (eine Seite pro Teilnehmer, gleiche Reihenfolge)
  async function docBytes(kind, people, course) {
    const D = window.EHFYDocs;
    if (kind === "bescheinigung") return D.certificates(await template("bescheinigung"), course, people, loadFont, { infoLeafletHanded: cfg.documents.infoLeafletHanded });
    if (kind === "datenblatt") return D.datasheets(await template("datenblatt"), course, people, loadFont);
    if (kind === "quittung") return D.receipts(await billsFor("quittung", people, course), await issuer(), loadFont);
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
      ? await EHFYDocs.receipts([inv], await issuer(), loadFont)
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
    try { await makeDoc(b.dataset.test, sample, course, win); }
    catch (e) { if (win) win.close(); $("tpl-err-" + b.dataset.test).textContent = e.message; }
  });

  init();
})();
