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
  // Gewertet wird je Test entweder das Paar 0,7-Zeilen oder das Paar 1,0-Zeilen (die 0,32-Zeile zählt nicht)
  const GROUPS = [{ visus: "0,7", rows: [1, 2] }, { visus: "1,0", rows: [3, 4] }];
  const test = n => TESTS.find(t => t.n === n);

  // Kreuze je Test: Text mit einem Zeichen je Ring: "r" = richtig, "f" = falsch, "." = noch offen
  const marksOf = (marks, n) => String((marks && marks[n]) || "").padEnd(test(n).rings.length, ".");

  // Ein Paar (zweimal 5 Ringe) ist nicht bestanden, sobald in einer Zeile mehr als 2 Fehler sind
  // (höchstens 2 + 2 = 4). Bestanden erst, wenn beide Zeilen vollständig abgefragt sind.
  // Die Verwaltung erkennt am Ankreuzen, welches Paar abgefragt wurde. Sind beide angefangen, gilt:
  // eines nicht bestanden = nicht bestanden, eines noch offen = läuft.
  function evaluate(marks, n) {
    const m = marksOf(marks, n), rings = test(n).rings;
    const groups = GROUPS.map(g => {
      const rowErr = g.rows.map(row => rings.reduce((k, ring, i) => k + (ring.row === row && m[i] === "f" ? 1 : 0), 0));
      const cells = rings.map((ring, i) => (g.rows.includes(ring.row) ? m[i] : null)).filter(x => x !== null);
      const open = cells.filter(x => x === ".").length, started = open < cells.length;
      const failed = rowErr.some(e => e > 2);
      return { visus: g.visus, rows: g.rows, rowErr, open, started, wrong: rowErr[0] + rowErr[1], state: !started ? "leer" : failed ? "nicht" : open ? "offen" : "bestanden" };
    });
    const used = groups.filter(g => g.started);
    const state = !used.length ? (m.replace(/\./g, "") ? "offen" : "leer")
      : used.some(g => g.state === "nicht") ? "nicht" : used.some(g => g.state === "offen") ? "offen" : "bestanden";
    return { state, groups, used, wrong: used.reduce((k, g) => k + g.wrong, 0) };
  }
  // Zeilen, die „Übrige als richtig“ füllen soll: die angefangenen Paare, sonst das 0,7-Paar
  function rowsToFill(marks, n) {
    const used = evaluate(marks, n).used;
    return (used.length ? used : [GROUPS[0]]).flatMap(g => g.rows);
  }

  // Zwei gleichwertige Tafeln: Test 1–3 oder alternativ Test 4–6. Bestanden, wenn alle drei Tests
  // einer Tafel bestanden sind. Welche Tafel genommen wird, ist egal.
  const SETS = [[1, 2, 3], [4, 5, 6]];
  function setState(marks, set) {
    const st = set.map(n => evaluate(marks, n).state);
    if (st.every(x => x === "bestanden")) return "bestanden";
    if (st.includes("nicht")) return "nicht";
    return st.every(x => x === "leer") ? "leer" : "offen";
  }
  function overall(marks) {
    const sets = SETS.map(set => setState(marks, set));
    let state;
    if (sets.includes("bestanden")) state = "bestanden";
    else if (sets.includes("offen") || sets.every(x => x === "leer")) state = "offen";
    else state = "nicht";
    // Hinweis, wenn die andere Tafel noch gar nicht benutzt wurde
    const otherFree = state === "nicht" && sets.includes("leer");
    return { state, sets, otherFree };
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

  root.EHFYSehtest = { VISUS, TESTS, GROUPS, SETS, test, marksOf, evaluate, rowsToFill, overall, ringPath, STRAIGHT };
})(typeof window !== "undefined" ? window : globalThis);
