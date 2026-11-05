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

  root.EHFYImport = { plan, UNKNOWN };
})(typeof window !== "undefined" ? window : globalThis);
