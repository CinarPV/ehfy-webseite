// Ausweis lesen: maschinenlesbare Zone (MRZ) von Reisepass, Personalausweis und Aufenthaltstitel.
// Übernommen werden NUR Vorname, Nachname, Geburtsdatum und Ausweisnummer (dazu die Ausweisart zum Ankreuzen),
// bei der Schnellerfassung zusätzlich die Anschrift von der Rückseite des Personalausweises.
// Alles andere (Ablaufdatum, Geschlecht, Staatsangehörigkeit, Zugangsnummer …) wird nicht ausgewertet.
// Die Texterkennung läuft komplett auf dem Gerät (Tesseract). Das Foto wird nirgends hochgeladen und nicht gespeichert.
// Aufbau nach ICAO 9303: TD1 = 3 Zeilen à 30 Zeichen (Ausweiskarten), TD2 = 2 × 36, TD3 = 2 × 44 (Reisepass).
(function (root) {
  const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  let loading = null, worker = null;

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const el = document.createElement("script");
      el.src = src; el.onload = ok; el.onerror = () => fail(new Error("Die Texterkennung konnte nicht geladen werden. Beim ersten Mal braucht es Internet."));
      document.head.appendChild(el);
    });
  }
  async function getWorker(progress) {
    loading = loading || loadScript(TESSERACT);
    await loading;
    if (!worker) {
      worker = await root.Tesseract.createWorker("eng", 1, {
        logger: m => { if (progress && m.status === "recognizing text") progress(Math.round(m.progress * 100)); }
      });
      await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", tessedit_pageseg_mode: "6" });
    }
    return worker;
  }

  // ---------- Prüfziffern ----------
  const val = ch => (ch === "<" ? 0 : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55);
  const check = s => String([...s].reduce((sum, ch, i) => sum + val(ch) * [7, 3, 1][i % 3], 0) % 10);
  // Typische Verwechslungen der Texterkennung
  const TO_DIGIT = { O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", T: "1", Z: "2", S: "5", B: "8", G: "6" };
  const TO_LETTER = { 0: "O", 1: "I", 2: "Z", 5: "S", 8: "B", 6: "G" };
  const digits = s => [...s].map(c => TO_DIGIT[c] || c).join("");
  const letters = s => [...s].map(c => TO_LETTER[c] || c).join("");
  // Feld mit Prüfziffer. Ausweisnummern enthalten praktisch nie O oder I, deshalb zuerst O→0, Q→0, I→1.
  // Danach einzelne Verwechslungen probieren. Passen mehrere Varianten, gilt das Feld als unsicher.
  function fixed(field, digit, numeric) {
    const d = digits(digit);
    const f = numeric ? digits(field) : field.replace(/[OQ]/g, "0").replace(/I/g, "1");
    if (check(f) === d) return { value: f, ok: true };
    if (numeric) return { value: f, ok: false };
    const swaps = { 0: ["O", "D"], 1: ["I"], 8: ["B"], 5: ["S"], 2: ["Z"], 6: ["G"], B: ["8"], S: ["5"], Z: ["2"], G: ["6"], D: ["0"] };
    const hits = [];
    for (let i = 0; i < f.length; i++) for (const alt of swaps[f[i]] || []) {
      const g = f.slice(0, i) + alt + f.slice(i + 1);
      if (check(g) === d) hits.push(g);
    }
    return hits.length === 1 ? { value: hits[0], ok: true } : { value: f, ok: false };
  }

  const nameOf = s => {
    // Füllzeichen am Ende entfernen; die Erkennung liest „<“ dort oft als L oder K
    // „<<“ zwischen Nach- und Vorname liest die Erkennung manchmal als „<K<“ oder „<L<“
    const [last, ...rest] = letters(s).replace(/<[<LK]*$/, "").replace(/<[KL]</g, "<<").split("<<");
    const nice = t => t.replace(/</g, " ").trim().toLowerCase().replace(/(^|[\s-])\S/g, m => m.toUpperCase());
    return { lastName: nice(last || ""), firstName: nice(rest.join(" ")) };
  };
  function isoDate(yymmdd, future) {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    const yy = Number(yymmdd.slice(0, 2)), now = new Date().getFullYear() % 100;
    const year = future ? 2000 + yy : (yy > now ? 1900 + yy : 2000 + yy);
    return `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  }
  function docType(code) {
    if (code[0] === "P") return "reisepass";
    // Aufenthaltstitel: z. B. AR (Deutschland), IR, RP, RT
    if (/^(AR|IR|RP|RT|IT|AT|CR)/.test(code)) return "aufenthaltstitel";
    return "personalausweis";
  }

  // Nur die vier benötigten Angaben (plus Ausweisart aus dem Dokumentcode)
  function parseTD1(l) {
    const nr = fixed(l[0].slice(5, 14), l[0][14], false), birth = fixed(l[1].slice(0, 6), l[1][6], true);
    return { code: l[0].slice(0, 2).replace(/<$/, ""), docNumber: nr.value.replace(/<+$/, ""), birth: isoDate(birth.value), ...nameOf(l[2]), checks: [nr.ok, birth.ok] };
  }
  function parseTD23(l) {
    const nr = fixed(l[1].slice(0, 9), l[1][9], false), birth = fixed(l[1].slice(13, 19), l[1][19], true);
    return { code: l[0].slice(0, 2).replace(/<$/, ""), docNumber: nr.value.replace(/<+$/, ""), birth: isoDate(birth.value), ...nameOf(l[0].slice(5)), checks: [nr.ok, birth.ok] };
  }

  // Aus dem erkannten Text die MRZ-Zeilen suchen und auswerten
  function fromText(text) {
    const lines = text.split(/\n/).map(x => x.toUpperCase().replace(/[«‹(\[{]/g, "<").replace(/[^A-Z0-9<]/g, "")).filter(x => x.length >= 26 && (x.match(/</g) || []).length >= 2);
    const fit = (s, n) => (s.length >= n ? s.slice(0, n) : s.padEnd(n, "<"));
    const found = [];
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i], b = lines[i + 1], c = lines[i + 2];
      if (b && /^P/.test(a) && a.length >= 40) found.push(parseTD23([fit(a, 44), fit(b, 44)]));
      if (b && c && a.length <= 34 && /^[ACI]/.test(a)) found.push(parseTD1([fit(a, 30), fit(b, 30), fit(c, 30)]));
      if (b && a.length > 34 && a.length < 40 && /^[ACIPV]/.test(a)) found.push(parseTD23([fit(a, 36), fit(b, 36)]));
    }
    // Das Ergebnis mit den meisten stimmenden Prüfziffern
    found.sort((x, y) => y.checks.filter(Boolean).length - x.checks.filter(Boolean).length);
    const best = found[0];
    if (!best || !best.lastName) return null;
    return { firstName: best.firstName, lastName: best.lastName, birth: best.birth, docNumber: best.docNumber, idDoc: docType(best.code), checks: best.checks, allOk: best.checks.every(Boolean) };
  }

  // Bild für die Erkennung vorbereiten: verkleinern, Graustufen, kräftiger Kontrast; optional nur unterer Teil
  async function prepare(file, part) {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const y0 = part ? Math.round(h * (1 - part)) : 0;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h - y0;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, -y0, w, h);
    const px = ctx.getImageData(0, 0, cv.width, cv.height), d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(px, 0, 0);
    img.close && img.close();
    return cv;
  }

  async function read(file, progress) {
    const w = await getWorker(progress);
    let best = null;
    // Zuerst nur der untere Teil (dort steht die MRZ), dann das ganze Bild
    for (const part of [0.45, 0]) {
      const { data } = await w.recognize(await prepare(file, part));
      const res = fromText(data.text);
      if (res && (!best || res.checks.filter(Boolean).length > best.checks.filter(Boolean).length)) best = res;
      if (best && best.allOk) break;
    }
    return best;
  }

  // ---------- Teilnehmerdatenblatt: Text erkennen und typische Angaben herauslesen ----------
  // Läuft ebenfalls auf dem Gerät. Handschrift wird nur teilweise erkannt: Ergebnis immer prüfen.
  let sheetWorker = null;
  async function readSheet(file, progress) {
    loading = loading || loadScript(TESSERACT);
    await loading;
    if (!sheetWorker) sheetWorker = await root.Tesseract.createWorker("deu", 1, {
      logger: m => { if (progress && m.status === "recognizing text") progress(Math.round(m.progress * 100)); }
    });
    const { data } = await sheetWorker.recognize(file);
    return { ...parseSheet(data.text || ""), text: data.text || "" };
  }
  function parseSheet(text) {
    const lines = text.split(/\n/).map(l => l.replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const out = {};
    const after = (re) => {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (!m) continue;
        const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:.,-]+/, "").trim();
        if (rest) return rest;
        if (lines[i + 1]) return lines[i + 1];
      }
      return "";
    };
    const nice = t => t.replace(/[^A-Za-zÄÖÜäöüßÀ-ÿ' -]/g, "").trim().toLowerCase().replace(/(^|[\s-])\S/g, m => m.toUpperCase());
    out.firstName = nice(after(/vorname/i).split(/\s{2,}|nachname|name/i)[0] || "");
    out.lastName = nice(after(/(nach|familien)name|(^|\s)name(?!n)/i).split(/\s{2,}|vorname/i)[0] || "");
    const all = lines.join("\n");
    const date = all.match(/\b(\d{1,2})[.,/ ]\s?(\d{1,2})[.,/ ]\s?((?:19|20)\d{2})\b/);
    if (date) out.birth = `${date[3]}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
    const mail = all.replace(/\s?@\s?/g, "@").match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    if (mail) out.email = mail[0].toLowerCase();
    const phone = all.match(/(\+49|0)[\d /-]{7,}\d/);
    if (phone) out.phone = phone[0].replace(/[^\d+]/g, "");
    const zip = all.match(/\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß. -]{2,})/);
    const cap = t => t.toLowerCase().replace(/(^|[\s-])\S/g, m => m.toUpperCase());
    if (zip) { out.zip = zip[1]; out.city = cap(zip[2].trim()); }
    const street = all.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring) ?\d+ ?[a-z]?\b)/i);
    if (street) out.street = /[a-zäöü]/.test(street[1]) ? street[1] : cap(street[1]);
    // Zettel ohne Beschriftung: Geburtsdatum auch mit zweistelligem Jahr
    if (!out.birth) {
      const d2 = all.match(/\b(\d{1,2})[.,/]\s?(\d{1,2})[.,/]\s?(\d{2})\b/);
      if (d2) { const y = Number(d2[3]); out.birth = `${y > (new Date().getFullYear() % 100) ? 1900 + y : 2000 + y}-${d2[2].padStart(2, "0")}-${d2[1].padStart(2, "0")}`; }
    }
    // Straße ohne „straße/weg …“: die Zeile mit Hausnummer direkt über der PLZ
    const zipAt = lines.findIndex(l => /\b\d{5}\b/.test(l));
    if (!out.street && zipAt > 0 && /^[A-Za-zÄÖÜäöüß. -]{3,}\s?\d+\s?[a-zA-Z]?$/.test(lines[zipAt - 1])) out.street = lines[zipAt - 1];
    // Namen ohne Beschriftung: die ersten Zeilen nur aus Buchstaben (vor Adresse und Datum)
    if (!out.firstName && !out.lastName) {
      const skip = /teilnehmer|datenblatt|erste\s*hilfe|kurs|name|anschrift|adresse|geburt|datum|telefon|e-?mail|unterschrift/i;
      const words = lines.filter((l, i) => (zipAt < 0 || i < zipAt) && /^[A-Za-zÄÖÜäöüßÀ-ÿ' -]{2,}$/.test(l) && !skip.test(l) && l !== out.street)
        .map(l => nice(l)).filter(Boolean);
      if (words.length >= 2) { out.firstName = words[0]; out.lastName = words[1]; }
      else if (words.length === 1 && words[0].includes(" ")) { const p = words[0].split(" "); out.lastName = p.pop(); out.firstName = p.join(" "); }
    }
    return out;
  }

  root.EHFYAusweis = { read, fromText, check, readSheet, parseSheet };
})(typeof window !== "undefined" ? window : globalThis);
