// Teilnehmer aus der alten Mac-App in Kurse und Anmeldungen umwandeln.
// Die Datei mit den Daten wird in der Verwaltung ausgewählt und bleibt auf dem Gerät.
(function (root) {
  const UNKNOWN = "Ort unbekannt";
  const validDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !isNaN(Date.parse(d));
  const validTime = t => /^\d{2}:\d{2}$/.test(t || "");

  // Gleiche Eingabe ergibt immer dieselbe Kennung, damit ein zweiter Import nichts verdoppelt
  async function stableId(text) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  async function plan(rows, opts = {}) {
    const siegenAddress = opts.siegenAddress || "";
    const minDay = opts.minDay || "2021-01-01";
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const skipped = [], check = [], seen = new Set(), groups = new Map();
    let merged = 0;
    for (const x of rows) {
      const c = x.course || {};
      const who = `${x.name || ""} ${x.surname || ""}`.trim();
      const day = c.courseDate;
      if (!x.name || !x.surname) { skipped.push({ who: who || "(ohne Namen)", why: "Name fehlt" }); continue; }
      if (!validDay(day) || day < minDay || day > today) { skipped.push({ who, why: `Kursdatum unklar: ${day || "fehlt"}` }); continue; }
      const key = [x.name, x.surname, x.birthDate, day].join("|").trim().toLowerCase();
      if (seen.has(key)) { merged++; continue; }
      seen.add(key);
      const year = Number(String(x.birthDate || "").slice(0, 4));
      if (!year || year < 1930 || year > Number(day.slice(0, 4)) - 14) check.push({ who, why: `Geburtsdatum prüfen: ${x.birthDate || "fehlt"}` });
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(x);
    }
    const courses = [], regs = [];
    for (const [day, people] of groups) {
      const sunday = new Date(`${day}T12:00:00`).getDay() === 0;
      const location = sunday ? "Siegen" : UNKNOWN;
      const start = validTime(people[0].course.startTime) ? people[0].course.startTime : "10:00";
      const end = validTime(people[0].course.endTime) && people[0].course.endTime > start ? people[0].course.endTime : "17:30";
      const startsAt = new Date(`${day}T${start}:00`).toISOString();
      const courseId = await stableId(`alte-app:kurs:${day}`);
      courses.push({
        id: courseId, starts_at: startsAt, ends_at: new Date(`${day}T${end}:00`).toISOString(),
        location, address: sunday ? siegenAddress : "–", capacity: Math.min(Math.max(people.length, 12), 999),
        online_booking: false, status: "offen", note: "Aus der alten App übernommen"
      });
      for (const x of people) {
        const c = x.course;
        const note = [c.description, c.payment !== "" && c.payment != null ? `Preis: ${c.payment} €` : ""].filter(Boolean).join(" · ");
        regs.push({
          id: await stableId(`alte-app:teilnehmer:${x.id}`), course_id: courseId,
          first_name: String(x.name).trim().slice(0, 80), last_name: String(x.surname).trim().slice(0, 80),
          birth_date: /^\d{4}-\d{2}-\d{2}$/.test(x.birthDate || "") ? x.birthDate : null,
          email: null, phone: x.phoneNumber || null,
          street: [x.street, x.houseNumber].filter(Boolean).join(" ") || null, zip: x.zipCode || null, city: x.city || null,
          package: c.courseType === "full" ? "komplett" : "kurs", message: note || null,
          status: "teilgenommen",
          // Altes Datum: So gilt der Eintrag nicht als neue Anmeldung und löst keine Mail aus
          created_at: startsAt
        });
      }
    }
    return { courses, regs, skipped, check, merged, total: rows.length };
  }

  // ---------- WordPress-Export (CSV) ----------
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift() || [];
    return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  }
  const iso = (y, m, d) => {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const t = new Date(key + "T12:00:00");
    return t.getFullYear() === Number(y) && t.getMonth() + 1 === Number(m) && t.getDate() === Number(d) ? key : null;
  };
  // Kurstag aus WordPress: TT/MM/JJJJ
  const wpDay = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim()); return m ? iso(m[3], m[2], m[1]) : null; };
  // Geburtsdatum in den vielen eingegebenen Schreibweisen
  function wpBirth(s) {
    const raw = String(s).trim();
    let m = /^(\d{1,2})[.\/,\- ]+(\d{1,2})[.\/,\- ]+(\d{2}|\d{4})$/.exec(raw) || /^(\d{2})\.?(\d{2})(\d{4})$/.exec(raw);
    if (!m) return null;
    const y = m[3].length === 2 ? (Number(m[3]) > 26 ? 1900 : 2000) + Number(m[3]) : Number(m[3]);
    return y >= 1920 && y <= 2020 ? iso(y, m[2], m[1]) : null;
  }
  const person = (a, b, c) => `${a}|${b}|${c || ""}`.trim().toLowerCase().replace(/\s+/g, " ");

  async function planWordpress(rows, opts) {
    const today = opts.today || new Date().toISOString().slice(0, 10);
    if (!rows.length || !("app_date_1" in rows[0]) || !("Vorname:" in rows[0])) throw new Error("Das ist nicht der erwartete WordPress-Export.");
    const known = new Set(opts.existing.map(r => person(r.first_name, r.last_name, r.birth_date)));
    const inCourse = new Set(opts.existing.filter(r => r.course_id).map(r => `${r.course_id}|${person(r.first_name, r.last_name, r.birth_date)}`));
    const byDay = new Map(opts.courses.map(c => [new Date(c.starts_at).toLocaleDateString("sv-SE"), c]));
    const courses = [], regs = [], check = [], skipped = [];
    let duplicates = 0, coming = 0, card = 0;
    // Neueste Kurstage zuerst, damit bei Mehrfachanmeldungen der letzte Termin in der Kartei steht
    const list = rows.map(r => ({ r, day: wpDay(r.app_date_1) })).sort((a, b) => String(b.day).localeCompare(String(a.day)));
    for (const { r, day } of list) {
      const first = String(r["Vorname:"]).trim().slice(0, 80), last = String(r["Name:"]).trim().slice(0, 80);
      const who = `${first} ${last}`.trim();
      if (!first || !last) { skipped.push({ who: who || "(ohne Namen)", why: "Name fehlt" }); continue; }
      if (!day) { skipped.push({ who, why: `Kursdatum unklar: ${r.app_date_1}` }); continue; }
      const rawBirth = String(r["Geburtsdatum:"]).trim(), birth = wpBirth(rawBirth);
      if (!birth) check.push({ who, why: `Geburtsdatum prüfen: ${rawBirth || "fehlt"}` });
      const key = person(first, last, birth);
      const answer = String(r.fieldname11 || "").trim();
      const note = ["Aus WordPress", !/^(ja|nein|nien|yes|evet|no|\?+|)$/i.test(answer) ? answer : "", !birth && rawBirth ? `Geburtsdatum laut Anmeldung: ${rawBirth}` : ""].filter(Boolean).join(" · ").slice(0, 1000);
      let created = new Date(String(r.Time).replace(" ", "T"));
      if (isNaN(created)) created = new Date(`${day}T12:00:00`);
      if (Date.now() - created.getTime() < 3600000) created = new Date(Date.now() - 7200000); // alt genug: keine Mail
      const row = {
        id: await stableId(`wordpress:${r.ID}`), first_name: first, last_name: last, birth_date: birth,
        email: String(r.Email || r.email || "").trim().slice(0, 120) || null, phone: String(r["Telefonnummer:"] || "").trim().slice(0, 40) || null,
        street: null, zip: null, city: null, package: "kurs", message: note, created_at: created.toISOString()
      };
      if (day >= today) {
        let c = byDay.get(day);
        if (!c) {
          const start = new Date(`${day}T10:00:00`);
          c = { id: await stableId(`wordpress:kurs:${day}`), starts_at: start.toISOString(), ends_at: new Date(`${day}T17:30:00`).toISOString(), location: "Siegen", address: opts.siegenAddress || "Siegen",
            capacity: 12, online_booking: true, status: "offen", note: null };
          courses.push(c); byDay.set(day, c);
        }
        const k = `${c.id}|${key}`;
        if (inCourse.has(k)) { duplicates++; continue; }
        inCourse.add(k); known.add(key); coming++;
        regs.push({ ...row, course_id: c.id, status: "angemeldet" });
      } else {
        // Vergangene Anmeldungen: nur Schülerkartei, Vorhandenes bleibt unverändert
        if (known.has(key)) { duplicates++; continue; }
        known.add(key); card++;
        regs.push({ ...row, course_id: null, legacy_course_date: day, status: "angemeldet" });
      }
    }
    return { courses, regs, check, skipped, duplicates, coming, card, total: rows.length };
  }

  // ---------- Papier-Teilnehmerlisten (von Fotos abgeschrieben) ----------
  // Datei: { format: "ehfy-papierlisten", courses: [{ day, note, people: [{ last, first, birth, street, zip, city, sehtest, pay, discount }] }] }
  // Jede Person wird mit den Schülern im System verglichen. Erkannte bekommen die Schreibweise aus dem System
  // und werden dem Kurs zugeordnet; alle anderen werden neu angelegt. Alle kommen auf die Teilnehmerliste.
  const nrm = s => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const flat = s => nrm(s).replace(/ /g, "");
  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  const sim = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);
  const tokens = s => nrm(s).split(" ").filter(Boolean).sort().join(" ");
  // Ähnlichkeit 0…1; berücksichtigt vertauschte Vor-/Nachnamen und Tippfehler
  function nameSim(p, r) {
    const pl = flat(p.last), pf = flat(p.first), rl = flat(r.last_name), rf = flat(r.first_name);
    const straight = sim(pl, rl) * 0.6 + sim(pf, rf) * 0.4;
    const swapped = sim(pl, rf) * 0.6 + sim(pf, rl) * 0.4;
    const firstWord = sim(pl, rl) * 0.6 + sim(pf.slice(0, rf.length), rf) * 0.4; // „Sarah K.“ ↔ „Sarah“
    return Math.max(straight, swapped, firstWord, sim(tokens(`${p.first} ${p.last}`), tokens(`${r.first_name} ${r.last_name}`)));
  }

  async function planPaper(data, opts) {
    if (!data || data.format !== "ehfy-papierlisten" || !Array.isArray(data.courses)) throw new Error("Das ist nicht die erwartete Papierlisten-Datei.");
    const price = (st, disc) => Math.max(0, (opts.prices[st ? "komplett" : "kurs"] || 0) - (Number(disc) || 0));
    const dayOf = iso => new Date(iso).toLocaleDateString("sv-SE");
    const byDay = new Map(opts.courses.filter(c => c.status !== "abgesagt").map(c => [dayOf(c.starts_at), c]));
    const courseDay = new Map(opts.courses.map(c => [c.id, dayOf(c.starts_at)]));
    const existing = opts.existing.filter(r => r.first_name && r.last_name);
    const used = new Set();
    const courses = [], items = [], skipped = [], totals = [];
    for (const k of data.courses) {
      const day = k.day;
      if (!validDay(day)) { skipped.push({ who: `Kurs ${day}`, why: "Datum unklar" }); continue; }
      let c = byDay.get(day), isNew = false;
      if (!c) {
        c = { id: await stableId(`papier:kurs:${day}`), starts_at: new Date(`${day}T10:00:00`).toISOString(), ends_at: new Date(`${day}T17:30:00`).toISOString(),
          location: "Siegen", address: opts.siegenAddress || "Siegen", capacity: Math.min(Math.max(k.people.length, 12), 999),
          online_booking: false, status: "offen", note: ["Aus Papierliste übernommen", k.note].filter(Boolean).join(" · ") };
        courses.push(c); byDay.set(day, c); isNew = true;
      }
      // Tagessumme laut Papierliste (z. B. wenn eine Seite mit Namen fehlt): gilt für die Jahresrechnung
      if (Number(k.total) > 0) totals.push({ course: c, total: Number(k.total) });
      for (const p of k.people || []) {
        if (!p.last || !p.first) { skipped.push({ who: `${p.first || ""} ${p.last || ""}`.trim() || "(ohne Namen)", why: "Name fehlt" }); continue; }
        // Bester Treffer im System
        let best = null;
        for (const r of existing) {
          if (used.has(r.id)) continue;
          const s = nameSim(p, r), sameBirth = !!p.birth && r.birth_date === p.birth;
          const rDay0 = r.course_id ? courseDay.get(r.course_id) : r.legacy_course_date;
          let level = null;
          if (sameBirth && s >= 0.72) level = "sicher";
          // Nachtrag: gleicher Kurstag, Name (fast) gleich, im System noch ohne Geburtsdatum → derselbe Eintrag
          else if (!r.birth_date && rDay0 === day && s >= 0.9) level = "sicher";
          else if (sameBirth && s >= 0.45) level = "pruefen";
          else if (s >= 0.93) level = "pruefen";
          if (!level) continue;
          const rDay = r.course_id ? courseDay.get(r.course_id) : r.legacy_course_date;
          const score = (level === "sicher" ? 2 : 1) + s + (rDay === day ? 1 : 0) + (r.course_id === c.id ? 1 : 0) + (r.status === "storniert" ? -0.5 : 0);
          if (!best || score > best.score) best = { r, level, s, score };
        }
        const it = { day, course: c, courseNew: isNew, p, amount: price(p.sehtest, p.discount), match: best ? best.r : null, level: best ? best.level : null, take: best ? best.level === "sicher" : false };
        if (best) used.add(best.r.id);
        items.push(it);
      }
    }
    // Firmenkurse (Rechnungen an Firmen) für Finanzen → „Firmenkurse“
    const firm = (Array.isArray(data.firm) ? data.firm : []).filter(f => validDay(f.date) && Number(f.amount) > 0)
      .map(f => ({ id: `papier-firma-${nrm(f.text).replace(/ /g, "-").slice(0, 60)}`, date: f.date, text: String(f.text || "").slice(0, 120), amount: Math.round(Number(f.amount) * 100) / 100 }));
    return { courses, items, skipped, totals, firm, total: items.length };
  }
  // Aus dem Plan (mit den Häkchen der Vorschau) die Schreibvorgänge machen
  async function buildPaper(plan) {
    const regs = [], updates = [];
    for (const it of plan.items) {
      const p = it.p, r = it.take ? it.match : null;
      // Nicht erschienen mit bezahlter Ausfallgebühr: nicht auf die Teilnehmerliste, Gebühr beim Kurs
      const base = p.noShow
        ? { on_list: false, status: "nicht_erschienen", fee_state: "bezahlt", fee_state_at: it.course.starts_at, ...(p.fee ? { message: `Aus Papierliste übernommen · Ausfallgebühr: ${p.fee} €` } : {}) }
        : { on_list: true, status: "teilgenommen", package: p.sehtest ? "komplett" : "kurs", discount: Number(p.discount) || null };
      if (r && (!r.course_id || r.course_id === it.course.id)) {
        // Vorhandenen Eintrag diesem Kurs zuordnen; Name aus dem System bleibt, Leeres wird ergänzt
        const patch = { ...base, course_id: it.course.id };
        if (r.legacy_course_date) patch.legacy_course_date = null;
        if (!r.payment_method && !p.noShow) patch.payment_method = p.pay;
        if (!r.birth_date && p.birth) patch.birth_date = p.birth;
        // Korrigierte Schreibweise nur bei Einträgen, die selbst aus einer Papierliste stammen
        if (p.fixName && r.message === "Aus Papierliste übernommen") Object.assign(patch, { first_name: String(p.first).trim().slice(0, 80), last_name: String(p.last).trim().slice(0, 80) });
        if (!r.street && !r.zip && !r.city) Object.assign(patch, { street: p.street || null, zip: p.zip || null, city: p.city || null });
        updates.push({ id: r.id, patch });
      } else {
        regs.push({
          id: await stableId(`papier:${it.day}:${nrm(p.last)}|${nrm(p.first)}|${p.birth || ""}`), course_id: it.course.id,
          first_name: String(r ? r.first_name : p.first).trim().slice(0, 80), last_name: String(r ? r.last_name : p.last).trim().slice(0, 80),
          birth_date: (r && r.birth_date) || p.birth || null, email: (r && r.email) || null, phone: (r && r.phone) || null,
          street: p.street || (r && r.street) || null, zip: p.zip || (r && r.zip) || null, city: p.city || (r && r.city) || null,
          payment_method: p.noShow ? null : p.pay, message: "Aus Papierliste übernommen", ...base, package: base.package || "kurs", created_at: it.course.starts_at
        });
      }
    }
    // Tagessumme in die Kursnotiz (neue Kurse direkt, vorhandene per Änderung)
    const MARK = /\s*·?\s*Summe laut Papierliste: [\d.,]+ €/;
    const courseNotes = [];
    for (const { course, total } of plan.totals || []) {
      const rest = String(course.note || "").replace(MARK, "").trim();
      const note = `${rest ? rest + " · " : ""}Summe laut Papierliste: ${total} €`;
      if (plan.courses.includes(course)) course.note = note; else courseNotes.push({ id: course.id, note });
    }
    return { courses: plan.courses, regs, updates, courseNotes };
  }

  root.EHFYImport = { plan, planWordpress, planPaper, buildPaper, parseCsv, UNKNOWN };
})(typeof window !== "undefined" ? window : globalThis);
