// Einnahmen & Ausgaben: grobe Übersicht je Kurstag, AED, Ausgaben und Fahrtenbuch.
// Nichts läuft automatisch: Kurstage und Fahrten werden per Klick übernommen und beim erneuten Klick überschrieben.
// Die Daten liegen in den privaten Einstellungen und werden mit „Synchronisieren“ übertragen.
(function () {
  const db = window.EHFY_DB, cfg = window.EHFY_CONFIG;
  const root = document.getElementById("finance-view");
  if (!root) return;
  const esc = s => window.EHFY.esc(s);
  const CATEGORIES = ["Internet", "Fahrtkosten", "Bankgebühren", "Handy", "Abschreibungen", "Sonstiges"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayKey(new Date());
  const shiftDay = (key, days) => { const d = new Date(key + "T12:00"); d.setDate(d.getDate() + days); return dayKey(d); };
  const dateText = key => new Date(key + "T12:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  const eur = n => (Number(n) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const num = v => { const n = parseFloat(String(v ?? "").replace(/\s|€/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const round2 = n => Math.round(n * 100) / 100;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`);

  let settings = {}, fin = null, courses = [], regs = [];
  let year = new Date().getFullYear();
  const picked = new Set();
  const pickedTrips = new Set();

  const blank = () => ({ rate: 0.3, home: "", km: {}, incomes: {}, aed: [], expenses: [], trips: [] });
  const inYear = key => String(key || "").slice(0, 4) === String(year);
  const sum = (list, f) => round2(list.reduce((s, x) => s + num(f(x)), 0));

  async function save() {
    settings = { ...(await db.getSettings()), finance: fin };
    await db.saveSettings(settings);
    if (window.EHFYAdmin) window.EHFYAdmin.settingsChanged();
    draw();
  }

  // Teilnehmer mit ✓ Da und ihr Betrag: alter Preis aus der Notiz, sonst das gebuchte Paket
  function attendance(course) {
    const here = regs.filter(r => r.course_id === course.id && r.status === "teilgenommen");
    const price = r => {
      const old = /Preis:\s*([\d.,]+)\s*€/.exec(r.message || "");
      if (old) return num(old[1]);
      const p = cfg.packages.find(x => x.key === r.package);
      return p ? p.price : 0;
    };
    return { count: here.length, amount: round2(here.reduce((s, r) => s + price(r), 0)) };
  }
  const coursesOfYear = () => courses
    .filter(c => { const k = dayKey(new Date(c.starts_at)); return inYear(k) && k <= today(); })
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));

  function locationNames() {
    const names = new Set((Array.isArray(settings.locations) ? settings.locations : cfg.locations).map(l => l.name));
    coursesOfYear().forEach(c => names.add(c.location));
    return [...names];
  }

  // ---------- Darstellung ----------
  function monthGroups(rows, cell, cols) {
    const months = new Map();
    for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
      const m = r.date.slice(5, 7);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(r);
    }
    return [...months].map(([m, list]) => `
      <tr class="fin-month"><td colspan="${cols}">${MONTHS[Number(m) - 1]}</td></tr>
      ${list.map(cell).join("")}
      <tr class="fin-sub"><td colspan="${cols - 2}">Zwischensumme ${MONTHS[Number(m) - 1]}</td><td class="fin-num">${eur(sum(list, x => x.amount))}</td><td></td></tr>`).join("");
  }
  const table = (head, body) => `<div class="table-wrap"><table class="fin-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  const removeBtn = (kind, id) => `<button class="btn btn-sm btn-outline" type="button" data-fin-del="${kind}" data-id="${esc(id)}" title="Aus der Übersicht entfernen">✕</button>`;

  function draw() {
    const incomes = Object.entries(fin.incomes).map(([id, x]) => ({ id, ...x })).filter(x => inYear(x.date));
    const aed = fin.aed.filter(x => inYear(x.date));
    const expenses = fin.expenses.filter(x => inYear(x.date));
    const trips = fin.trips.filter(x => inYear(x.date)).sort((a, b) => a.date.localeCompare(b.date));
    const list = coursesOfYear();
    const totalIn = sum(incomes, x => x.amount), totalAed = sum(aed, x => x.amount), totalOut = sum(expenses, x => x.amount);
    const kmTotal = round2(trips.reduce((s, t) => s + num(t.km), 0));

    const years = [...new Set([new Date().getFullYear(), year, ...courses.map(c => new Date(c.starts_at).getFullYear())])].sort((a, b) => b - a);
    root.innerHTML = `
      <div class="admin-bar" style="margin-bottom:14px">
        <h2 style="margin:0;font-size:1.4rem">Einnahmen &amp; Ausgaben</h2>
        <select id="fin-year" class="chip-btn" aria-label="Jahr">${years.map(y => `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select>
      </div>
      <p class="form-error" id="fin-error" role="alert"></p>

      <div class="card fin-card">
        <h3>Ergebnis ${year}</h3>
        ${resultTable(incomes, aed, expenses)}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn" type="button" id="fin-print">Drucken</button>
          <button class="btn btn-ghost" type="button" id="fin-download">Als PDF herunterladen</button>
        </div>
      </div>

      <div class="card fin-card">
        <h3>Kurstage übernehmen</h3>
        <p class="small muted">Tage anhaken und übernehmen. Gezählt werden Teilnehmer mit ✓ Da. Erneutes Übernehmen überschreibt den Tag, auch deine Änderungen daran.</p>
        <div class="btn-row" style="margin-bottom:10px">
          <button class="btn btn-sm btn-ghost" type="button" id="fin-pick-all">Alle auswählen</button>
          <button class="btn btn-sm btn-ghost" type="button" id="fin-pick-none">Auswahl leeren</button>
          <button class="btn btn-sm" type="button" id="fin-take">In die Rechnung übernehmen (${[...picked].filter(id => list.some(c => c.id === id)).length})</button>
          <button class="btn btn-sm btn-ghost" type="button" id="fin-trips">Fahrten ins Fahrtenbuch (${[...picked].filter(id => list.some(c => c.id === id)).length})</button>
        </div>
        ${list.length ? `<div class="fin-scroll">${table(["", "Kurstag", "Ort", "Schüler", "Betrag", "Stand"], list.map(c => {
          const key = dayKey(new Date(c.starts_at)), a = attendance(c), done = fin.incomes[c.id];
          return `<tr><td><input type="checkbox" data-pick="${c.id}" aria-label="${dateText(key)} auswählen" ${picked.has(c.id) ? "checked" : ""}></td>
            <td>${dateText(key)}</td><td>${esc(c.location)}</td><td class="fin-num">${a.count}</td><td class="fin-num">${eur(a.amount)}</td>
            <td class="small">${done ? "übernommen" : "–"}${fin.trips.some(t => t.courseId === c.id) ? " · Fahrten" : ""}</td></tr>`;
        }).join(""))}</div>` : '<p class="muted small">In diesem Jahr gibt es noch keine vergangenen Kurstage.</p>'}
      </div>

      <div class="card fin-card">
        <h3>Einnahmen aus Kursen: ${eur(totalIn)}</h3>
        ${incomes.length ? table(["Tag", "Ort", "Schüler", "Betrag", ""], monthGroups(incomes, x => `<tr>
            <td>${dateText(x.date)}</td><td>${esc(x.location)}</td>
            <td><input class="fin-input-sm" inputmode="numeric" data-income="${x.id}" data-field="count" value="${x.count}" aria-label="Schüler"></td>
            <td><input class="fin-input" inputmode="decimal" data-income="${x.id}" data-field="amount" value="${String(x.amount).replace(".", ",")}" aria-label="Betrag"></td>
            <td>${removeBtn("income", x.id)}</td></tr>`, 5) + `<tr class="fin-total"><td colspan="3">Gesamt</td><td class="fin-num">${eur(totalIn)}</td><td></td></tr>`)
          : '<p class="muted small">Noch keine Kurstage übernommen.</p>'}
      </div>

      <div class="card fin-card">
        <h3>AED-Einweisung und Inbetriebnahme: ${eur(totalAed)}</h3>
        <form class="fin-form" id="fin-aed-form">
          <label>Datum<input type="date" name="date" value="${today()}" required></label>
          <label class="grow">Bezeichnung<input name="text" required maxlength="120" placeholder="z. B. Einweisung bei Firma Muster"></label>
          <label>Betrag<input name="amount" inputmode="decimal" required placeholder="0,00"></label>
          <button class="btn btn-sm" type="submit">Hinzufügen</button>
        </form>
        ${aed.length ? table(["Tag", "Bezeichnung", "Betrag", ""], monthGroups(aed, x => `<tr><td>${dateText(x.date)}</td><td>${esc(x.text)}</td><td class="fin-num">${eur(x.amount)}</td><td>${removeBtn("aed", x.id)}</td></tr>`, 4)) : ""}
      </div>

      <div class="card fin-card">
        <h3>Ausgaben: ${eur(totalOut)}</h3>
        <form class="fin-form" id="fin-expense-form">
          <label>Datum<input type="date" name="date" value="${today()}" required></label>
          <label>Art<select name="category">${CATEGORIES.map(c => `<option>${c}</option>`).join("")}</select></label>
          <label class="grow">Bezeichnung<input name="text" maxlength="120" placeholder="optional"></label>
          <label>Betrag<input name="amount" inputmode="decimal" required placeholder="0,00"></label>
          <button class="btn btn-sm" type="submit">Hinzufügen</button>
        </form>
        ${expenses.length ? table(["Tag", "Art", "Bezeichnung", "Betrag", ""], monthGroups(expenses, x => `<tr><td>${dateText(x.date)}</td><td>${esc(x.category)}</td><td>${esc(x.text || "")}</td><td class="fin-num">${eur(x.amount)}</td><td>${x.source === "trips" ? '<span class="small muted">aus Fahrtenbuch</span>' : removeBtn("expense", x.id)}</td></tr>`, 5)) : ""}
      </div>

      <div class="card fin-card">
        <h3>Fahrtenbuch: ${kmTotal.toLocaleString("de-DE")} km</h3>
        <p class="small muted">Pro Kurs werden drei Hin- und Rückfahrten angelegt: Vorbereitung am Vortag, Kurstag und Abbau am Folgetag. Trag dafür hier einmal deine Startadresse und die einfache Entfernung je Ort ein.</p>
        <form class="fin-form" id="fin-trip-settings">
          <label class="grow">Startadresse<input name="home" value="${esc(fin.home)}" placeholder="deine Adresse" maxlength="160"></label>
          <label>Euro pro km<input name="rate" inputmode="decimal" value="${String(fin.rate).replace(".", ",")}"></label>
          ${locationNames().map(n => `<label>${esc(n)} (einfach, km)<input data-km="${esc(n)}" inputmode="decimal" value="${fin.km[n] ?? ""}" placeholder="km"></label>`).join("")}
          <button class="btn btn-sm btn-ghost" type="submit">Speichern</button>
        </form>
        <div class="btn-row" style="margin:12px 0">
          <button class="btn btn-sm" type="button" id="fin-trips-transfer">Fahrtkosten in die Rechnung übernehmen</button>
        </div>
        <form class="fin-form" id="fin-trip-form">
          <label>Datum<input type="date" name="date" value="${today()}" required></label>
          <label class="grow">Ziel<input name="to" required maxlength="160" placeholder="z. B. Einkauf Verbandsmaterial"></label>
          <label>Zweck<input name="purpose" maxlength="80" placeholder="optional"></label>
          <label>km gesamt<input name="km" inputmode="decimal" required placeholder="0"></label>
          <button class="btn btn-sm btn-ghost" type="submit">Fahrt eintragen</button>
        </form>
        ${trips.length ? `<div class="fin-scroll">${table(["Tag", "Von", "Nach", "Zweck", "km", ""], trips.map(t => `<tr>
            <td>${dateText(t.date)}</td><td>${esc(t.from || "")}</td><td>${esc(t.to)}</td><td>${esc(t.purpose || "")}</td>
            <td><input class="fin-input-sm" inputmode="decimal" data-trip="${t.id}" value="${String(t.km).replace(".", ",")}" aria-label="Kilometer"></td>
            <td>${removeBtn("trip", t.id)}</td></tr>`).join(""))}</div>` : ""}
      </div>`;
  }

  function monthlyResult(incomes, aed, expenses) {
    const rows = MONTHS.map((name, i) => {
      const m = pad(i + 1), of = list => sum(list.filter(x => x.date.slice(5, 7) === m), x => x.amount);
      const a = of(incomes), b = of(aed), c = of(expenses);
      return { name, a, b, c, r: round2(a + b - c) };
    }).filter(x => x.a || x.b || x.c);
    const t = rows.reduce((s, x) => ({ a: s.a + x.a, b: s.b + x.b, c: s.c + x.c, r: s.r + x.r }), { a: 0, b: 0, c: 0, r: 0 });
    return { rows, total: { a: round2(t.a), b: round2(t.b), c: round2(t.c), r: round2(t.r) } };
  }
  function resultTable(incomes, aed, expenses) {
    const { rows, total } = monthlyResult(incomes, aed, expenses);
    if (!rows.length) return '<p class="muted small">Noch keine Einträge in diesem Jahr.</p>';
    return table(["Monat", "Kurse", "AED", "Ausgaben", "Überschuss"], rows.map(x =>
      `<tr><td>${x.name}</td><td class="fin-num">${eur(x.a)}</td><td class="fin-num">${eur(x.b)}</td><td class="fin-num">${eur(x.c)}</td><td class="fin-num">${eur(x.r)}</td></tr>`).join("") +
      `<tr class="fin-total"><td>Gesamt</td><td class="fin-num">${eur(total.a)}</td><td class="fin-num">${eur(total.b)}</td><td class="fin-num">${eur(total.c)}</td><td class="fin-num">${eur(total.r)}</td></tr>`);
  }

  // ---------- Übernehmen ----------
  const selected = () => coursesOfYear().filter(c => picked.has(c.id));
  function fail(msg) { const e = document.getElementById("fin-error"); if (e) e.textContent = msg; }

  async function takeIncomes() {
    const list = selected();
    if (!list.length) return fail("Bitte zuerst Kurstage anhaken.");
    for (const c of list) {
      const a = attendance(c);
      fin.incomes[c.id] = { date: dayKey(new Date(c.starts_at)), location: c.location, count: a.count, amount: a.amount };
    }
    await save();
  }
  async function takeTrips() {
    const list = selected();
    if (!list.length) return fail("Bitte zuerst Kurstage anhaken.");
    const missing = [...new Set(list.map(c => c.location))].filter(n => !num(fin.km[n]));
    if (missing.length) return fail(`Bitte zuerst die Entfernung eintragen für: ${missing.join(", ")}.`);
    for (const c of list) {
      const key = dayKey(new Date(c.starts_at)), km = round2(num(fin.km[c.location]) * 2);
      fin.trips = fin.trips.filter(t => t.courseId !== c.id);
      [[-1, "Vorbereitung"], [0, "Kurstag"], [1, "Abbau"]].forEach(([shift, purpose]) => fin.trips.push({
        id: newId(), courseId: c.id, date: shiftDay(key, shift), from: fin.home, to: `${c.location} und zurück`, purpose: `Erste-Hilfe-Kurs: ${purpose}`, km
      }));
    }
    await save();
  }
  // Fahrten je Monat als Ausgabe: erneutes Drücken ersetzt die Beträge dieses Jahres
  async function transferTrips() {
    const rate = num(fin.rate);
    fin.expenses = fin.expenses.filter(x => !(x.source === "trips" && inYear(x.date)));
    const months = new Map();
    for (const t of fin.trips.filter(x => inYear(x.date))) {
      const m = t.date.slice(0, 7);
      months.set(m, (months.get(m) || 0) + num(t.km));
    }
    for (const [m, km] of months) {
      const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
      fin.expenses.push({ id: newId(), source: "trips", date: `${m}-${pad(last)}`, category: "Fahrtkosten", text: `${round2(km).toLocaleString("de-DE")} km × ${rate.toLocaleString("de-DE")} €`, amount: round2(km * rate) });
    }
    await save();
  }

  // ---------- PDF ----------
  async function resultPdf() {
    const A = window.EHFYAdmin;
    await A.ensurePdf();
    const { PDFDocument, rgb } = window.PDFLib;
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(window.fontkit);
    const [regular, bold] = await Promise.all(["400", "700"].map(async w => pdf.embedFont(await A.loadFont(w), { subset: true })));
    const ink = rgb(0.06, 0.12, 0.17), M = 50, W = 595.28, H = 841.89;
    let page = pdf.addPage([W, H]), y = H - 56;
    const room = need => { if (y - need < 60) { page = pdf.addPage([W, H]); y = H - 56; } };
    const text = (s, x, f = regular, size = 10) => page.drawText(String(s), { x, y, size, font: f, color: ink });
    const right = (s, x, f = regular, size = 10) => text(s, x - f.widthOfTextAtSize(String(s), size), f, size);
    const line = () => { page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.5, color: rgb(0.8, 0.84, 0.87) }); };
    const heading = s => { room(50); y -= 14; text(s, M, bold, 12); y -= 18; };

    text("Einnahmen und Ausgaben " + year, M, bold, 18); y -= 18;
    text(`${cfg.issuer.name} · ${cfg.issuer.owner} · Übersicht, keine amtliche Einnahmenüberschussrechnung`, M, regular, 9); y -= 18;

    const incomes = Object.values(fin.incomes).filter(x => inYear(x.date));
    const aed = fin.aed.filter(x => inYear(x.date));
    const expenses = fin.expenses.filter(x => inYear(x.date));
    const { rows, total } = monthlyResult(incomes, aed, expenses);
    heading("Ergebnis");
    const res = (a, b, c, d, e, f = regular) => { room(18); text(a, M, f); right(b, 300, f); right(c, 380, f); right(d, 465, f); right(e, W - M, f); y -= 16; };
    res("Monat", "Kurse", "AED", "Ausgaben", "Überschuss", bold); line(); y -= 4;
    rows.forEach(x => res(x.name, eur(x.a), eur(x.b), eur(x.c), eur(x.r)));
    line(); y -= 4; res("Gesamt", eur(total.a), eur(total.b), eur(total.c), eur(total.r), bold);

    const block = (title, list, label) => {
      if (!list.length) return;
      heading(title);
      const months = new Map();
      [...list].sort((a, b) => a.date.localeCompare(b.date)).forEach(x => { const m = x.date.slice(5, 7); months.set(m, [...(months.get(m) || []), x]); });
      for (const [m, group] of months) {
        room(36); text(MONTHS[Number(m) - 1], M, bold); y -= 15;
        group.forEach(x => { room(16); text(dateText(x.date), M); text(label(x), 150); right(eur(x.amount), W - M); y -= 14; });
        room(18); line(); y -= 3; text("Zwischensumme", M, bold, 9.5); right(eur(sum(group, x => x.amount)), W - M, bold, 9.5); y -= 18;
      }
      room(18); text("Gesamt", M, bold); right(eur(sum(list, x => x.amount)), W - M, bold); y -= 18;
    };
    block("Einnahmen aus Kursen", incomes, x => `${x.location} · ${x.count} Schüler`);
    block("AED-Einweisung und Inbetriebnahme", aed, x => x.text);
    block("Ausgaben", expenses, x => [x.category, x.text].filter(Boolean).join(" · "));

    const trips = fin.trips.filter(x => inYear(x.date)).sort((a, b) => a.date.localeCompare(b.date));
    if (trips.length) {
      heading("Fahrtenbuch");
      trips.forEach(t => { room(16); text(dateText(t.date), M, regular, 9); text(`${t.to}${t.purpose ? " · " + t.purpose : ""}`, 150, regular, 9); right(`${num(t.km).toLocaleString("de-DE")} km`, W - M, regular, 9); y -= 13; });
      room(18); y -= 3; line(); y -= 3; text("Gesamt", M, bold); right(`${round2(trips.reduce((s, t) => s + num(t.km), 0)).toLocaleString("de-DE")} km`, W - M, bold); y -= 16;
    }
    return pdf.save();
  }

  // ---------- Bedienung ----------
  root.addEventListener("change", async ev => {
    const t = ev.target;
    if (t.id === "fin-year") { year = Number(t.value); picked.clear(); draw(); return; }
    if (t.dataset.pick) { t.checked ? picked.add(t.dataset.pick) : picked.delete(t.dataset.pick); draw(); return; }
    if (t.dataset.income) {
      const row = fin.incomes[t.dataset.income];
      row[t.dataset.field] = t.dataset.field === "count" ? Math.max(0, Math.round(num(t.value))) : round2(num(t.value));
      await save();
      return;
    }
    if (t.dataset.trip) {
      const row = fin.trips.find(x => x.id === t.dataset.trip);
      if (row) { row.km = round2(num(t.value)); await save(); }
    }
  });
  root.addEventListener("click", async ev => {
    const t = ev.target;
    const del = t.closest("[data-fin-del]");
    try {
      if (del) {
        const id = del.dataset.id, kind = del.dataset.finDel;
        if (kind === "income") delete fin.incomes[id];
        if (kind === "aed") fin.aed = fin.aed.filter(x => x.id !== id);
        if (kind === "expense") fin.expenses = fin.expenses.filter(x => x.id !== id);
        if (kind === "trip") fin.trips = fin.trips.filter(x => x.id !== id);
        await save();
        return;
      }
      if (t.id === "fin-pick-all") { coursesOfYear().forEach(c => picked.add(c.id)); draw(); }
      if (t.id === "fin-pick-none") { picked.clear(); draw(); }
      if (t.id === "fin-take") await takeIncomes();
      if (t.id === "fin-trips") await takeTrips();
      if (t.id === "fin-trips-transfer") await transferTrips();
      if (t.id === "fin-print") {
        const win = window.EHFYAdmin.openTab();
        try { window.EHFYAdmin.showPdf(await resultPdf(), `Einnahmen_Ausgaben_${year}.pdf`, win); }
        catch (e) { if (win) win.close(); throw e; }
      }
      if (t.id === "fin-download") window.EHFYAdmin.saveFile(await resultPdf(), `Einnahmen_Ausgaben_${year}.pdf`);
    } catch (e) { fail(e.message); }
  });
  root.addEventListener("submit", async ev => {
    ev.preventDefault();
    const f = ev.target.elements;
    if (ev.target.id === "fin-aed-form") {
      fin.aed.push({ id: newId(), date: f.date.value, text: f.text.value.trim(), amount: round2(num(f.amount.value)) });
    } else if (ev.target.id === "fin-expense-form") {
      fin.expenses.push({ id: newId(), date: f.date.value, category: f.category.value, text: f.text.value.trim(), amount: round2(num(f.amount.value)) });
    } else if (ev.target.id === "fin-trip-form") {
      fin.trips.push({ id: newId(), date: f.date.value, from: fin.home, to: f.to.value.trim(), purpose: f.purpose.value.trim(), km: round2(num(f.km.value)) });
    } else if (ev.target.id === "fin-trip-settings") {
      fin.home = f.home.value.trim();
      fin.rate = num(f.rate.value);
      ev.target.querySelectorAll("[data-km]").forEach(i => { fin.km[i.dataset.km] = i.value.trim() ? num(i.value) : ""; });
    } else return;
    await save();
  });

  window.EHFYFinance = {
    async render() {
      settings = await db.getSettings().catch(() => ({}));
      fin = { ...blank(), ...(settings.finance || {}) };
      [courses, regs] = await Promise.all([db.listCourses(), db.listAllRegistrations()]);
      draw();
    }
  };
})();
