// Dokumente als PDF: Bescheinigung und Teilnehmerdatenblatt (aus deinen Vorlagen),
// Quittung und Rechnung (im EHfy-Design neu erzeugt). Alles passiert im Browser.
// Benötigt pdf-lib und fontkit (assets/vendor).
(function (root) {
  const TZ = "Europe/Berlin";
  const C = {
    ink: [0.039, 0.145, 0.251], muted: [0.373, 0.443, 0.502], line: [0.89, 0.918, 0.933],
    aid: [0.043, 0.482, 0.498], blue: [0.016, 0.404, 0.604], teal: [0.161, 0.706, 0.714], soft: [0.957, 0.973, 0.976]
  };
  const rgb = a => root.PDFLib.rgb(a[0], a[1], a[2]);

  const fmtDate = d => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const fmtBirth = s => (s ? new Date(s + "T12:00:00Z").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "");
  const fmtLongDate = d => new Date(d).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const eur = n => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

  // Schriften einmal laden und je Dokument einbetten (enthält ä, ö, ü, ß, ş, ı, ğ …)
  async function fonts(pdf, loadFont) {
    pdf.registerFontkit(root.fontkit);
    const [r, b, x] = await Promise.all(["400", "700", "800"].map(w => loadFont(w)));
    return {
      regular: await pdf.embedFont(r, { subset: true }),
      bold: await pdf.embedFont(b, { subset: true }),
      black: await pdf.embedFont(x, { subset: true })
    };
  }

  // Positionen in den Vorlagen (Punkte, Ursprung unten links, A4 = 595 × 842)
  const CERT = {
    // Linien: von x1 bis x2, der Text steht immer mittig darauf
    name: { x1: 145.5, x2: 376, y: 464.5, size: 12 },
    birth: { x1: 414, x2: 494.5, y: 464.5, size: 12 },
    date: { x1: 112.5, x2: 275.5, y: 418.5, size: 12 },
    infoYes: { x: 389.6, y: 350.7 },
    issued: { x1: 146.5, x2: 247.5, y: 67, size: 11 }
  };
  const SHEET = {
    date: { x: 166, y: 652, size: 12 },
    last: { x: 92, y: 451, size: 12 },
    first: { x: 106, y: 396, size: 12 },
    birth: { x: 130, y: 342, size: 12 },
    street: { x: 108, y: 287, size: 12 },
    city: { x: 348, y: 287, size: 12 },
    signDate: { x: 60, y: 82, size: 11 }
  };

  const text = (page, s, p, font, color = C.ink) => page.drawText(String(s || ""), { x: p.x, y: p.y, size: p.size, font, color: rgb(color) });

  // Mittig auf eine Linie schreiben; zu langer Text wird kleiner, damit er auf die Linie passt
  function centered(page, s, line, font) {
    const value = String(s || "");
    const room = line.x2 - line.x1 - 4;
    let size = line.size;
    while (size > 6 && font.widthOfTextAtSize(value, size) > room) size -= 0.25;
    const width = font.widthOfTextAtSize(value, size);
    page.drawText(value, { x: line.x1 + (line.x2 - line.x1 - width) / 2, y: line.y, size, font, color: rgb(C.ink) });
  }

  // Eine Seite der Vorlage pro Teilnehmer, ausgefüllt
  async function fillTemplate(templateBytes, people, loadFont, fill) {
    const { PDFDocument } = root.PDFLib;
    const tpl = await PDFDocument.load(templateBytes);
    const out = await PDFDocument.create();
    const f = await fonts(out, loadFont);
    // Seite 1 der Vorlage einmal je Teilnehmer übernehmen
    const pages = await out.copyPages(tpl, people.map(() => 0));
    pages.forEach((page, i) => { out.addPage(page); fill(page, people[i], f); });
    return out.save();
  }

  function certificates(templateBytes, course, people, loadFont, opts) {
    return fillTemplate(templateBytes, people, loadFont, (page, r, f) => {
      centered(page, `${r.first_name} ${r.last_name}`, CERT.name, f.bold);
      centered(page, fmtBirth(r.birth_date), CERT.birth, f.bold);
      centered(page, fmtDate(course.starts_at), CERT.date, f.bold);
      // Die Anschrift der Ausbildungsstelle (Siegen) steht fest in der Vorlage und bleibt immer gleich
      if (opts.infoLeafletHanded) text(page, "X", { x: CERT.infoYes.x - 4.6, y: CERT.infoYes.y - 3.6, size: 10 }, f.bold);
      // Oben steht der Kurstag, unten das Ausstellungsdatum (Tag des Ausdrucks)
      centered(page, fmtDate(new Date()), CERT.issued, f.bold);
    });
  }

  function datasheets(templateBytes, course, people, loadFont) {
    return fillTemplate(templateBytes, people, loadFont, (page, r, f) => {
      text(page, fmtDate(course.starts_at), SHEET.date, f.bold);
      text(page, r.last_name, SHEET.last, f.bold);
      text(page, r.first_name, SHEET.first, f.bold);
      text(page, fmtBirth(r.birth_date), SHEET.birth, f.bold);
      text(page, r.street, SHEET.street, f.bold);
      text(page, [r.zip, r.city].filter(Boolean).join(" "), SHEET.city, f.bold);
      text(page, fmtDate(course.starts_at), SHEET.signDate, f.regular);
    });
  }

  // Quittung auf der hochgeladenen Vorlage: Name und Geburtsdatum statt Anschrift
  const RECEIPT = {
    date: { x: 126, y: 565, size: 10 },
    number: { x: 320, y: 563.5, size: 10 },
    name: { x: 174, y: 490, size: 11 },
    birthLabel: { x: 90.1, y: 463.5, size: 10 },
    birth: { x: 170, y: 464.5, size: 11 },
    service: { x: 90.1, y: 364.5, size: 10 },
    detail: { x: 90.1, y: 349, size: 9 },
    amount: { x: 122, y: 292, size: 10 },
    confirm: { x: 247, y: 267, size: 9.5 },
    place: { x: 112, y: 196, size: 10 }
  };
  function receiptsFromTemplate(templateBytes, list, issuer, loadFont) {
    const { rgb: color } = root.PDFLib;
    const white = color(1, 1, 1), plain = n => eur(n).replace(" €", "");
    return fillTemplate(templateBytes, list, loadFont, (page, inv, f) => {
      const r = inv.recipient || {};
      const [service = "", detail = ""] = String((inv.items && inv.items[0] && inv.items[0].text) || "").split("\n");
      text(page, fmtDate(inv.issued_on), RECEIPT.date, f.bold);
      text(page, `Quittungs-Nr.: ${inv.number}`, RECEIPT.number, f.bold);
      text(page, r.name, RECEIPT.name, f.bold);
      // Zeilen „Adresse“ und „PLZ / Wohnort“ der Vorlage überdecken
      page.drawRectangle({ x: 85, y: 431, width: 347, height: 43, color: white });
      page.drawText("Geburtsdatum:", { ...RECEIPT.birthLabel, font: f.regular, color: color(0, 0, 0) });
      page.drawLine({ start: { x: 166, y: 462 }, end: { x: 423, y: 462 }, thickness: 0.6, color: color(0, 0, 0) });
      text(page, fmtBirth(r.birth_date), RECEIPT.birth, f.bold);
      // Die feste Zeile der Vorlage durch die gebuchte Leistung ersetzen
      page.drawRectangle({ x: 85, y: 358, width: 347, height: 18, color: white });
      page.drawText(service, { ...RECEIPT.service, font: f.regular, color: color(0, 0, 0) });
      text(page, detail, RECEIPT.detail, f.regular);
      text(page, eur(inv.total), RECEIPT.amount, f.bold);
      text(page, plain(inv.total), RECEIPT.confirm, f.bold);
      text(page, issuer.city, RECEIPT.place, f.bold);
      if (inv.status === "storniert") page.drawText("STORNIERT", { x: 150, y: 400, size: 64, font: f.black, color: color(0.85, 0.2, 0.15), opacity: 0.25, rotate: root.PDFLib.degrees(25) });
    });
  }

  // ---------- Quittung & Rechnung im EHfy-Design ----------
  const A4 = [595.28, 841.89];
  const M = 56; // Rand

  function logo(page, f, x, y, s = 1) {
    // Herzlinie + "EHfy" wie im Logo
    page.drawSvgPath("M0 0 H42 L49 -11 L58 11 L69 -36 L81 12 L89 -8 L95 0 H120", {
      x, y, borderColor: rgb(C.teal), borderWidth: 3.6 * s, scale: 0.42 * s, borderLineCap: 1
    });
    const size = 30 * s, wEH = f.black.widthOfTextAtSize("EHf", size);
    page.drawText("EHf", { x: x + 49 * s, y: y - 4 * s, size, font: f.black, color: rgb(C.blue) });
    page.drawText("y", { x: x + 49 * s + wEH, y: y - 4 * s, size, font: f.black, color: rgb(C.teal) });
    page.drawText("Erste Hilfe for you", { x: x + 51 * s, y: y - 18 * s, size: 8.5 * s, font: f.bold, color: rgb(C.blue) });
  }

  function stripes(page, h = 9) {
    // Rettungsstreifen am oberen Rand
    for (let x = -h * 2; x < A4[0] + h; x += h * 2) {
      page.drawSvgPath(`M${x} 0 L${x + h} 0 L${x + h * 2} ${h} L${x + h} ${h} Z`, { x: 0, y: A4[1], color: rgb(C.teal) });
    }
  }

  function frame(page, f, issuer, title, rows) {
    stripes(page);
    logo(page, f, M, A4[1] - 62);
    // Absender rechts
    const right = [issuer.name, issuer.owner, issuer.street, `${issuer.zip} ${issuer.city}`, `Tel. ${issuer.phone}`, issuer.email].filter(Boolean);
    right.forEach((t, i) => {
      const w = f.regular.widthOfTextAtSize(t, 8.5);
      page.drawText(t, { x: A4[0] - M - w, y: A4[1] - 40 - i * 11.5, size: 8.5, font: i === 0 ? f.bold : f.regular, color: rgb(i === 0 ? C.ink : C.muted) });
    });
    page.drawText(title, { x: M, y: A4[1] - 170, size: 30, font: f.black, color: rgb(C.ink) });
    // Kenndaten rechts neben dem Titel
    rows.forEach(([k, v], i) => {
      const y = A4[1] - 152 - i * 15;
      const wk = f.regular.widthOfTextAtSize(k, 9), wv = f.bold.widthOfTextAtSize(v, 9);
      page.drawText(k, { x: A4[0] - M - 150, y, size: 9, font: f.regular, color: rgb(C.muted) });
      page.drawText(v, { x: A4[0] - M - wv, y, size: 9, font: f.bold, color: rgb(C.ink) });
    });
  }

  function footer(page, f, issuer, extra) {
    page.drawLine({ start: { x: M, y: 64 }, end: { x: A4[0] - M, y: 64 }, thickness: 0.8, color: rgb(C.line) });
    const parts = [`${issuer.name} · ${issuer.owner} · ${issuer.street} · ${issuer.zip} ${issuer.city}`,
      [issuer.phone && `Tel. ${issuer.phone}`, issuer.email, issuer.web, issuer.taxNumber && `St.-Nr. ${issuer.taxNumber}`].filter(Boolean).join(" · "),
      [issuer.bank, issuer.iban && `IBAN ${issuer.iban}`, issuer.bic && `BIC ${issuer.bic}`, issuer.paypal && `PayPal ${issuer.paypal}`].filter(Boolean).join(" · ")].filter(Boolean);
    if (extra) parts.push(extra);
    parts.forEach((t, i) => {
      const w = f.regular.widthOfTextAtSize(t, 7.5);
      page.drawText(t, { x: (A4[0] - w) / 2, y: 50 - i * 10, size: 7.5, font: f.regular, color: rgb(C.muted) });
    });
  }

  function addressBlock(page, f, label, r, y) {
    page.drawText(label.toUpperCase(), { x: M, y, size: 7.5, font: f.bold, color: rgb(C.aid) });
    [r.name, r.street, [r.zip, r.city].filter(Boolean).join(" ")].filter(Boolean).forEach((t, i) => {
      page.drawText(t, { x: M, y: y - 16 - i * 15, size: i === 0 ? 12 : 11, font: i === 0 ? f.bold : f.regular, color: rgb(C.ink) });
    });
  }

  function itemsTable(page, f, items, y, withQty) {
    const cols = withQty ? [M, M + 290, M + 340, A4[0] - M] : [M, A4[0] - M];
    page.drawRectangle({ x: M, y: y - 6, width: A4[0] - 2 * M, height: 22, color: rgb(C.soft) });
    const head = withQty ? ["Leistung", "Menge", "Einzelpreis", "Betrag"] : ["Leistung", "Betrag"];
    head.forEach((h, i) => {
      const last = i === head.length - 1, size = 8.5, w = f.bold.widthOfTextAtSize(h, size);
      const x = last ? cols[cols.length - 1] - 8 - w : (withQty && i > 0 ? cols[i] : cols[i] + 8);
      page.drawText(h, { x, y, size, font: f.bold, color: rgb(C.muted) });
    });
    let yy = y - 28;
    for (const it of items) {
      const lines = String(it.text).split("\n");
      lines.forEach((t, k) => page.drawText(t, { x: M + 8, y: yy - k * 13, size: k ? 9 : 10.5, font: k ? f.regular : f.bold, color: rgb(k ? C.muted : C.ink) }));
      const sum = eur(it.qty * it.price), ws = f.bold.widthOfTextAtSize(sum, 10.5);
      page.drawText(sum, { x: A4[0] - M - 8 - ws, y: yy, size: 10.5, font: f.bold, color: rgb(C.ink) });
      if (withQty) {
        page.drawText(String(it.qty).replace(".", ","), { x: cols[1], y: yy, size: 10.5, font: f.regular, color: rgb(C.ink) });
        page.drawText(eur(it.price), { x: cols[2], y: yy, size: 10.5, font: f.regular, color: rgb(C.ink) });
      }
      yy -= 14 + lines.length * 13;
      page.drawLine({ start: { x: M, y: yy + 12 }, end: { x: A4[0] - M, y: yy + 12 }, thickness: 0.6, color: rgb(C.line) });
    }
    return yy;
  }

  function totalBox(page, f, total, y, label) {
    const w = 210, x = A4[0] - M - w;
    page.drawRectangle({ x, y: y - 14, width: w, height: 40, color: rgb(C.ink) });
    page.drawText(label, { x: x + 14, y: y + 2, size: 9.5, font: f.bold, color: root.PDFLib.rgb(0.75, 0.83, 0.88) });
    const t = eur(total), wt = f.black.widthOfTextAtSize(t, 17);
    page.drawText(t, { x: x + w - 14 - wt, y: y - 1, size: 17, font: f.black, color: root.PDFLib.rgb(1, 1, 1) });
  }

  const KLEIN = "Gemäß § 19 UStG (Kleinunternehmerregelung) wird keine Umsatzsteuer berechnet.";

  // Auf der Quittung steht nie der Kursort, nur das Datum (gilt auch für ältere Belege)
  const withoutPlace = inv => ({ ...inv, items: (inv.items || []).map(i => ({ ...i, text: String(i.text || "").replace(/^(Kurs am [^\n]*?\d{4}) in [^\n]*$/m, "$1") })) });
  async function receipts(list, issuer, loadFont, templateBytes) {
    const invoices = list.map(withoutPlace);
    if (templateBytes) return receiptsFromTemplate(templateBytes, invoices, issuer, loadFont);
    const { PDFDocument } = root.PDFLib;
    const pdf = await PDFDocument.create();
    const f = await fonts(pdf, loadFont);
    for (const inv of invoices) {
      const page = pdf.addPage(A4);
      frame(page, f, issuer, "Quittung", [["Quittungs-Nr.", inv.number], ["Datum", fmtDate(inv.issued_on)], ["Zahlungsart", "Bar"]]);
      addressBlock(page, f, "Erhalten von", { name: inv.recipient.name, street: inv.recipient.birth_date ? `geb. ${fmtBirth(inv.recipient.birth_date)}` : "" }, A4[1] - 230);
      const y = itemsTable(page, f, inv.items, A4[1] - 340, false);
      totalBox(page, f, inv.total, y - 20, "Gesamtbetrag");
      const yy = y - 80;
      page.drawText(`Den Betrag von ${eur(inv.total)} habe ich heute in bar erhalten.`, { x: M, y: yy, size: 11, font: f.regular, color: rgb(C.ink) });
      page.drawText(KLEIN, { x: M, y: yy - 18, size: 8.5, font: f.regular, color: rgb(C.muted) });
      // Ort/Datum, Unterschrift und Stempelfeld
      const sy = 170;
      page.drawText(`${issuer.city}, ${fmtDate(inv.issued_on)}`, { x: M, y: sy + 6, size: 11, font: f.regular, color: rgb(C.ink) });
      page.drawLine({ start: { x: M, y: sy }, end: { x: M + 200, y: sy }, thickness: 0.8, color: rgb(C.ink) });
      page.drawText("Ort, Datum · Unterschrift", { x: M, y: sy - 13, size: 8, font: f.regular, color: rgb(C.muted) });
      page.drawRectangle({ x: A4[0] - M - 170, y: sy - 20, width: 170, height: 90, borderColor: rgb(C.line), borderWidth: 1, borderDashArray: [4, 3] });
      page.drawText("Stempelfeld", { x: A4[0] - M - 160, y: sy - 12, size: 8, font: f.regular, color: rgb(C.muted) });
      if (inv.status === "storniert") page.drawText("STORNIERT", { x: 150, y: 420, size: 64, font: f.black, color: root.PDFLib.rgb(0.85, 0.2, 0.15), opacity: 0.25, rotate: root.PDFLib.degrees(30) });
      footer(page, f, issuer);
    }
    return pdf.save();
  }

  async function invoices(list, issuer, loadFont, paymentDays) {
    const { PDFDocument } = root.PDFLib;
    const pdf = await PDFDocument.create();
    const f = await fonts(pdf, loadFont);
    for (const inv of list) invoicePage(pdf, f, inv, issuer, paymentDays);
    return pdf.save();
  }
  const invoice = (inv, issuer, loadFont, paymentDays) => invoices([inv], issuer, loadFont, paymentDays);

  function invoicePage(pdf, f, inv, issuer, paymentDays) {
    const page = pdf.addPage(A4);
    const rows = [["Rechnungs-Nr.", inv.number], ["Rechnungsdatum", fmtDate(inv.issued_on)]];
    if (inv.service_date) rows.push(["Leistungsdatum", fmtDate(inv.service_date)]);
    if (issuer.taxNumber) rows.push(["Steuernummer", issuer.taxNumber]);
    frame(page, f, issuer, "Rechnung", rows);
    addressBlock(page, f, "Rechnung an", inv.recipient, A4[1] - 230);
    const y = itemsTable(page, f, inv.items, A4[1] - 340, true);
    totalBox(page, f, inv.total, y - 20, "Rechnungsbetrag");
    let yy = y - 80;
    const due = new Date(inv.issued_on); due.setDate(due.getDate() + (paymentDays || 14));
    const pay = inv.payment === "bar"
      ? [`Den Rechnungsbetrag haben wir am ${fmtDate(inv.issued_on)} in bar erhalten.`]
      : [`Bitte überweisen Sie den Betrag bis zum ${fmtDate(due)} (14 Tage ab Rechnungsdatum).`, `Verwendungszweck: Rechnung ${inv.number}`,
         issuer.iban ? `${issuer.bank ? issuer.bank + " · " : ""}Kontoinhaber: ${issuer.accountHolder || issuer.owner}` : "",
         issuer.iban ? `IBAN ${issuer.iban}${issuer.bic ? " · BIC " + issuer.bic : ""}` : "",
         issuer.paypal ? `Oder per PayPal an ${issuer.paypal}` : ""];
    pay.filter(Boolean).forEach(t => { page.drawText(t, { x: M, y: yy, size: 10.5, font: f.regular, color: rgb(C.ink) }); yy -= 16; });
    page.drawText(KLEIN, { x: M, y: yy - 4, size: 8.5, font: f.regular, color: rgb(C.muted) });
    page.drawText("Herzlichen Dank für Ihr Vertrauen!", { x: M, y: yy - 34, size: 11, font: f.bold, color: rgb(C.aid) });
    if (inv.status === "storniert") page.drawText("STORNIERT", { x: 150, y: 420, size: 64, font: f.black, color: root.PDFLib.rgb(0.85, 0.2, 0.15), opacity: 0.25, rotate: root.PDFLib.degrees(30) });
    footer(page, f, issuer);
  }

  // Mehrere PDFs mit je einer Seite pro Teilnehmer zu einer Mappe verschränken:
  // Teilnehmer 1 (Datenblatt, Bescheinigung, Quittung), Teilnehmer 2 (…) usw.
  async function bundle(parts) {
    const { PDFDocument } = root.PDFLib;
    const out = await PDFDocument.create();
    const docs = await Promise.all(parts.map(b => PDFDocument.load(b)));
    const copies = await Promise.all(docs.map(d => out.copyPages(d, d.getPageIndices())));
    const n = Math.max(...copies.map(c => c.length));
    for (let i = 0; i < n; i++) for (const c of copies) if (c[i]) out.addPage(c[i]);
    return out.save();
  }

  // Inhalt der Quittung für eine Anmeldung
  function receiptItems(reg, course, packages) {
    const p = packages.find(x => x.key === reg.package) || packages[0];
    const when = course.location === "Ort unbekannt" ? fmtLongDate(course.starts_at) : `${fmtLongDate(course.starts_at)} in ${course.location}`;
    const name = p.key === "komplett" ? "Erste-Hilfe-Kurs Komplettpaket (mit Sehtest und 2 Passbildern gratis)" : "Erste-Hilfe-Kurs";
    const text = `${name}\nKurs am ${when}`;
    return [{ text, qty: 1, price: p.price }];
  }

  // ---------- Sehtest-Protokoll (DIN 58220 Teil 6) im EHfy-Design ----------
  const ST = () => root.EHFYSehtest;
  // Landoltring als gefüllte Fläche (Form aus assets/sehtest.js)
  function landolt(page, cx, cy, d, dir, color) {
    page.drawSvgPath(ST().ringPath(d, dir), { x: cx, y: cy, color: rgb(color) });
  }
  // Kreuz im Kästchen am Ring: Haken = richtig, X = falsch
  function ringMark(page, x, y, s, mark) {
    const ink = rgb(C.ink), w = 1.1;
    if (mark === "r") {
      page.drawLine({ start: { x: x + s * 0.18, y: y + s * 0.5 }, end: { x: x + s * 0.42, y: y + s * 0.2 }, thickness: w, color: ink });
      page.drawLine({ start: { x: x + s * 0.42, y: y + s * 0.2 }, end: { x: x + s * 0.85, y: y + s * 0.85 }, thickness: w, color: ink });
    }
    if (mark === "f") {
      page.drawLine({ start: { x: x + s * 0.18, y: y + s * 0.18 }, end: { x: x + s * 0.82, y: y + s * 0.82 }, thickness: w, color: ink });
      page.drawLine({ start: { x: x + s * 0.18, y: y + s * 0.82 }, end: { x: x + s * 0.82, y: y + s * 0.18 }, thickness: w, color: ink });
    }
  }
  const TEST_WORD = { bestanden: "bestanden", nicht: "nicht bestanden", offen: "noch offen" };

  const box = (page, x, y, s, checked, f) => {
    page.drawRectangle({ x, y, width: s, height: s, borderColor: rgb(C.ink), borderWidth: 0.8, color: root.PDFLib.rgb(1, 1, 1) });
    if (checked) page.drawText("X", { x: x + s * 0.18, y: y + s * 0.16, size: s * 0.9, font: f.black, color: rgb(C.ink) });
  };
  // Kästchen mit Beschriftung; gibt die Breite zurück
  function choice(page, f, x, y, label, checked) {
    box(page, x, y - 1.5, 10, checked, f);
    page.drawText(label, { x: x + 15, y, size: 10, font: f.regular, color: rgb(C.ink) });
    return 15 + f.regular.widthOfTextAtSize(label, 10) + 16;
  }
  function field(page, f, x, y, w, label, value) {
    page.drawText(label, { x, y, size: 8, font: f.bold, color: rgb(C.aid) });
    page.drawLine({ start: { x, y: y - 20 }, end: { x: x + w, y: y - 20 }, thickness: 0.7, color: rgb(C.muted) });
    if (value) {
      let size = 12;
      while (size > 7 && f.bold.widthOfTextAtSize(value, size) > w - 4) size -= 0.25;
      page.drawText(value, { x: x + 2, y: y - 16, size, font: f.bold, color: rgb(C.ink) });
    }
  }

  function sehtestPage(pdf, f, p, issuer) {
    const page = pdf.addPage(A4);
    const W = A4[0];
    const rows = [["Protokoll-Nr.", p.nr || (p.nrDraft ? `${p.nrDraft} (vorläufig)` : "–")], ["Datum", p.date ? fmtDate(p.date) : "–"]];
    frame(page, f, issuer, "Sehtest-Protokoll", rows);
    page.drawText("zum straßenverkehrsbezogenen Sehtest gemäß DIN 58220 Teil 6", { x: M, y: A4[1] - 188, size: 10, font: f.bold, color: rgb(C.muted) });

    // Angaben zur Person
    let y = A4[1] - 216;
    const half = (W - 2 * M - 20) / 2;
    field(page, f, M, y, half, "NAME", p.last_name);
    field(page, f, M + half + 20, y, half, "VORNAME", p.first_name);
    y -= 38;
    field(page, f, M, y, 120, "GEBURTSDATUM", fmtBirth(p.birth_date));
    field(page, f, M + 140, y, 110, "FÜHRERSCHEINKLASSE", p.license || "");
    page.drawText("SEHHILFE", { x: M + 270, y, size: 8, font: f.bold, color: rgb(C.aid) });
    let x = M + 270;
    x += choice(page, f, x, y - 16, "keine", p.aid === "ohne");
    x += choice(page, f, x, y - 16, "Brille", p.aid === "brille");
    choice(page, f, x, y - 16, "Kontaktlinse", p.aid === "linse");
    y -= 38;
    page.drawText("AUSWEISDOKUMENT", { x: M, y, size: 8, font: f.bold, color: rgb(C.aid) });
    x = M;
    [["personalausweis", "Personalausweis"], ["reisepass", "Reisepass"], ["fuehrerschein", "Führerschein"], ["aufenthaltstitel", "Aufenthaltstitel"]]
      .forEach(([k, label]) => { x += choice(page, f, x, y - 16, label, p.idDoc === k); });
    page.drawText("Nr.", { x: x - 4, y: y - 16, size: 10, font: f.regular, color: rgb(C.ink) });
    page.drawLine({ start: { x: x + 14, y: y - 18 }, end: { x: W - M, y: y - 18 }, thickness: 0.7, color: rgb(C.muted) });

    // Ringtafeln: links Prüfung, rechts Wiederholungsprüfung
    const top = y - 36, visW = 30, colW = (W - 2 * M - visW) / 2, cellH = 104, headH = 18, rowH = 16.5;
    const gx = M, gy = top - headH - 3 * cellH;
    page.drawRectangle({ x: gx, y: top - headH, width: W - 2 * M, height: headH, color: rgb(C.ink) });
    const white = root.PDFLib.rgb(1, 1, 1);
    page.drawText("Visus", { x: gx + 4, y: top - 13, size: 8.5, font: f.bold, color: white });
    ["Prüfung", "Wiederholungsprüfung"].forEach((t, i) => {
      const w = f.bold.widthOfTextAtSize(t, 9.5);
      page.drawText(t, { x: gx + visW + colW * i + (colW - w) / 2, y: top - 13, size: 9.5, font: f.bold, color: white });
    });
    const shade = { 0: [0.93, 0.95, 0.96], 3: [0.86, 0.9, 0.92], 4: [0.86, 0.9, 0.92] };
    for (let r = 0; r < 3; r++) {
      const cy0 = top - headH - r * cellH; // Oberkante der Zelle
      for (let col = 0; col < 2; col++) {
        const t = ST().test(r + 1 + col * 3), x0 = gx + visW + col * colW;
        const marks = ST().marksOf(p.marks, t.n), ev = ST().evaluate(p.marks, t.n);
        page.drawText(t.title, { x: x0 + 8, y: cy0 - 13, size: 8.5, font: f.bold, color: rgb(C.ink) });
        if (TEST_WORD[ev.state]) {
          const vis = ev.used.map(g => g.visus).join(" + ");
          const note = `${TEST_WORD[ev.state]}${vis ? ` (Visus ${vis})` : ""}${ev.wrong ? ` · ${ev.wrong} Fehler` : ""}`, wn = f.bold.widthOfTextAtSize(note, 7.5);
          page.drawText(note, { x: x0 + colW - 8 - wn, y: cy0 - 13, size: 7.5, font: f.bold, color: rgb(ev.state === "nicht" ? [0.75, 0.2, 0.15] : C.aid) });
        }
        let idx = 0;
        t.rows.forEach((row, k) => {
          const ry = cy0 - 26 - k * rowH; // Mitte der Zeile
          if (shade[k]) page.drawRectangle({ x: x0 + 3, y: ry - rowH / 2 + 0.5, width: colW - 6, height: rowH - 1, color: rgb(shade[k]) });
          row.split(" ").forEach((dir, i) => {
            const rx = x0 + 18 + i * ((colW - 24) / 5);
            landolt(page, rx, ry, 11, dir, C.ink);
            box(page, rx + 9, ry - 4.5, 9, false, f);
            ringMark(page, rx + 9, ry - 4.5, 9, marks[idx++]);
          });
          if (col === 0) {
            if (shade[k]) page.drawRectangle({ x: gx + 3, y: ry - rowH / 2 + 0.5, width: visW - 6, height: rowH - 1, color: rgb(shade[k]) });
            page.drawText(ST().VISUS[k], { x: gx + 6, y: ry - 3, size: 8.5, font: f.bold, color: rgb(C.ink) });
          }
        });
      }
      page.drawLine({ start: { x: gx, y: cy0 - cellH }, end: { x: W - M, y: cy0 - cellH }, thickness: 0.7, color: rgb(C.muted) });
    }
    // Rahmen und Spaltenlinien
    page.drawRectangle({ x: gx, y: gy, width: W - 2 * M, height: headH + 3 * cellH, borderColor: rgb(C.ink), borderWidth: 1 });
    [gx + visW, gx + visW + colW].forEach(lx => page.drawLine({ start: { x: lx, y: gy }, end: { x: lx, y: top }, thickness: 0.7, color: rgb(C.ink) }));

    // Ergebnis und Verlauf
    y = gy - 26;
    page.drawText("ERGEBNIS", { x: M, y: y + 14, size: 8, font: f.bold, color: rgb(C.aid) });
    x = M;
    x += choice(page, f, x, y, "bestanden", p.passed === true);
    choice(page, f, x, y, "nicht bestanden", p.passed === false);
    page.drawText("VERLAUF", { x: M + 260, y: y + 14, size: 8, font: f.bold, color: rgb(C.aid) });
    x = M + 260;
    x += choice(page, f, x, y, "flüssig", p.flow === "fluessig");
    choice(page, f, x, y, "zögerlich", p.flow === "zoegerlich");

    // Datum, Prüfer, Unterschrift
    const sy = 104, w3 = (W - 2 * M - 40) / 3;
    [["Datum", p.date ? fmtDate(p.date) : ""], ["Prüfer", p.examiner || ""], ["Unterschrift", ""]].forEach(([label, value], i) => {
      const lx = M + i * (w3 + 20);
      if (value) page.drawText(value, { x: lx + 2, y: sy + 5, size: 11, font: f.regular, color: rgb(C.ink) });
      page.drawLine({ start: { x: lx, y: sy }, end: { x: lx + w3, y: sy }, thickness: 0.8, color: rgb(C.ink) });
      page.drawText(label, { x: lx, y: sy - 12, size: 8, font: f.regular, color: rgb(C.muted) });
    });
    // Fußzeile ohne Bankverbindung und Steuernummer
    const foot = `${issuer.name} · ${issuer.owner} · ${issuer.street} · ${issuer.zip} ${issuer.city}${issuer.phone ? " · Tel. " + issuer.phone : ""}`;
    page.drawLine({ start: { x: M, y: 64 }, end: { x: W - M, y: 64 }, thickness: 0.8, color: rgb(C.line) });
    page.drawText(foot, { x: (W - f.regular.widthOfTextAtSize(foot, 7.5)) / 2, y: 50, size: 7.5, font: f.regular, color: rgb(C.muted) });
  }

  async function sehtestProtocols(list, issuer, loadFont) {
    const { PDFDocument } = root.PDFLib;
    const pdf = await PDFDocument.create();
    const f = await fonts(pdf, loadFont);
    for (const p of list) sehtestPage(pdf, f, p, issuer);
    return pdf.save();
  }

  root.EHFYDocs = { certificates, datasheets, receipts, invoice, invoices, bundle, receiptItems, fmtDate, sehtestProtocols };
})(typeof window !== "undefined" ? window : globalThis);
