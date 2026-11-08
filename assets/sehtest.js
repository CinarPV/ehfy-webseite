// Sehtest nach DIN 58220 Teil 6: Ringtafeln und Bewertung.
// Wird von der Verwaltung (Ankreuzen am Computer) und vom Protokoll-PDF genutzt.
(function (root) {
  // Öffnung der Landoltringe je Zeile. O = oben, OR = oben rechts, R = rechts, UR = unten rechts,
  // U = unten, UL = unten links, L = links, OL = oben links
  const VISUS = ["0,32", "0,7", "0,7", "1,0", "1,0"];
  const TESTS = [
    { n: 1, title: "Test 1 (monokular – rechts)", short: "rechts", rows: ["R L OL U", "O UR OR R OL", "OL U L UL R", "L OL O OR UL", "O OR R U UR"] },
    { n: 2, title: "Test 2 (monokular – links)", short: "links", rows: ["R L OL U", "OR UL U O L", "UL R UR U L", "U OR L UR R", "OL L UR O UL"] },
    { n: 3, title: "Test 3 (binokular)", short: "beide Augen", rows: ["R L OL U", "O UL UR OR R", "UL R OL U L", "O OR L UR UL", "R OL U OR L"] },
    { n: 4, title: "Test 4 (monokular – rechts)", short: "rechts", rows: ["R L UL O", "U OR UR R UL", "UL O L OL R", "L UL U UR OL", "U UR R O OR"] },
    { n: 5, title: "Test 5 (monokular – links)", short: "links", rows: ["R L UL O", "OL R OR U UL", "U OR O UL L", "O UR L OR R", "UL L OR U OL"] },
    { n: 6, title: "Test 6 (binokular)", short: "beide Augen", rows: ["R L UL O", "U OL O UR OR", "OL R UL O L", "U UR L OR OL", "R UL O UR L"] }
  ].map(t => ({ ...t, rings: t.rows.map((r, row) => r.split(" ").map(dir => ({ dir, row }))).flat() }));
  const DIR = { R: 0, OR: 45, O: 90, OL: 135, L: 180, UL: 225, U: 270, UR: 315 };
  const STRAIGHT = new Set(["O", "U", "L", "R"]);
  const COUNTED_ROWS = new Set([1, 2]); // die beiden 0,7-Zeilen
  const test = n => TESTS.find(t => t.n === n);

  // Kreuze je Test: Text mit einem Zeichen je Ring: "r" = richtig, "f" = falsch, "." = noch offen
  const marksOf = (marks, n) => String((marks && marks[n]) || "").padEnd(test(n).rings.length, ".");

  // Je Test werden die beiden 0,7-Zeilen (je 5 Ringe) gewertet.
  // Nicht bestanden, sobald in einer 0,7-Zeile mehr als 2 Fehler sind (also höchstens 2 + 2 = 4 Fehler).
  // Bestanden erst, wenn beide 0,7-Zeilen vollständig abgefragt sind.
  function evaluate(marks, n) {
    const m = marksOf(marks, n);
    const rows = { 1: 0, 2: 0 };
    let open = 0, touched = false;
    test(n).rings.forEach((ring, i) => {
      if (m[i] !== ".") touched = true;
      if (!COUNTED_ROWS.has(ring.row)) return;
      if (m[i] === ".") open++;
      if (m[i] === "f") rows[ring.row]++;
    });
    const wrong = rows[1] + rows[2];
    const failed = rows[1] > 2 || rows[2] > 2 || wrong > 4;
    const state = failed ? "nicht" : open ? (touched ? "offen" : "leer") : "bestanden";
    return { state, row1: rows[1], row2: rows[2], wrong, open };
  }

  // Gesamtergebnis: Test 1, 2 und 3 müssen bestanden sein. Die Wiederholung (4, 5, 6) ersetzt einen nicht bestandenen Test.
  function overall(marks) {
    const parts = [[1, 4], [2, 5], [3, 6]].map(([a, b]) => {
      const main = evaluate(marks, a), again = evaluate(marks, b);
      if (main.state === "bestanden") return "bestanden";
      if (main.state === "nicht") return again.state === "bestanden" ? "bestanden" : again.state === "nicht" ? "nicht" : "wiederholung";
      return "offen";
    });
    if (parts.every(p => p === "bestanden")) return { state: "bestanden", parts };
    if (parts.includes("offen")) return { state: "offen", parts };
    return { state: parts.includes("nicht") ? "nicht" : "nicht-wiederholung", parts };
  }

  // Landoltring als Umriss: Ring mit gerader Lücke (Lücke = Strichstärke = 1/5 des Durchmessers).
  // Punkte im mathematischen Sinn (y nach oben), Mitte bei 0/0.
  function ringPoints(d, dir) {
    const ro = d / 2, ri = ro * 0.6, g = d / 5;
    const ao = Math.asin(g / 2 / ro), ai = Math.asin(g / 2 / ri), rot = (DIR[dir] || 0) * Math.PI / 180, n = 40;
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = ao + (2 * Math.PI - 2 * ao) * i / n; pts.push([ro * Math.cos(a), ro * Math.sin(a)]); }
    for (let i = n; i >= 0; i--) { const a = ai + (2 * Math.PI - 2 * ai) * i / n; pts.push([ri * Math.cos(a), ri * Math.sin(a)]); }
    return pts.map(([x, y]) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  // Als SVG-Pfad (y nach unten)
  const ringPath = (d, dir, cx = 0, cy = 0) =>
    ringPoints(d, dir).map(([x, y], i) => `${i ? "L" : "M"}${(cx + x).toFixed(2)} ${(cy - y).toFixed(2)}`).join(" ") + " Z";

  root.EHFYSehtest = { VISUS, TESTS, test, marksOf, evaluate, overall, ringPath, STRAIGHT };
})(typeof window !== "undefined" ? window : globalThis);
