// Sehtest nach DIN 58220 Teil 6: Ringtafeln und Bewertung.
// Wird von der Verwaltung (Ankreuzen am Computer) und vom Protokoll-PDF genutzt.
(function (root) {
  // Öffnung der Landoltringe je Zeile. O = oben, OR = oben rechts, R = rechts, UR = unten rechts,
  // U = unten, UL = unten links, L = links, OL = oben links
  const VISUS = ["0,32", "0,7", "0,7", "1,0", "1,0"];
  const TESTS = [
    { n: 1, title: "Test 1 (monokular – rechts)", short: "rechts", rows: ["OR L OL U", "O UR OR R OL", "OL U L UL R", "L OL O OR UL", "O OR R U UR"] },
    { n: 2, title: "Test 2 (monokular – links)", short: "links", rows: ["OR L OL U", "OR UL U O OL", "UL R UR U L", "U OR L UR R", "OL L UR O UL"] },
    { n: 3, title: "Test 3 (binokular)", short: "beide Augen", rows: ["OR L OL U", "O UL U OR UR", "UL R OL U L", "O OR L UR UL", "R OL U OR L"] },
    { n: 4, title: "Test 4 (monokular – rechts)", short: "rechts", rows: ["UR L UL O", "U OR UR R UL", "UL O L OL R", "L UL U UR OL", "U UR R O OR"] },
    { n: 5, title: "Test 5 (monokular – links)", short: "links", rows: ["UR L UL O", "OL R OR U UL", "U OR O UR L", "O UR L OR R", "UL L OR U OL"] },
    { n: 6, title: "Test 6 (binokular)", short: "beide Augen", rows: ["UR L UL O", "U OL O UR OR", "OL R UL O L", "U UR L OR OL", "R UL O UR L"] }
  ].map(t => ({ ...t, rings: t.rows.map((r, row) => r.split(" ").map(dir => ({ dir, row }))).flat() }));
  const DIR = { R: 0, OR: 45, O: 90, OL: 135, L: 180, UL: 225, U: 270, UR: 315 };
  const STRAIGHT = new Set(["O", "U", "L", "R"]);
  // Gewertet werden je Test genau zwei Zeilen: 2× 0,7, 1× 0,7 + 1× 1,0 oder 2× 1,0 (die 0,32-Zeile zählt nicht).
  const COUNTED = [1, 2, 3, 4];
  const ROW_NAME = { 1: "0,7 (1)", 2: "0,7 (2)", 3: "1,0 (1)", 4: "1,0 (2)" };
  const GROUPS = [{ visus: "0,7", rows: [1, 2] }, { visus: "1,0", rows: [3, 4] }];
  const test = n => TESTS.find(t => t.n === n);

  // Kreuze je Test: Text mit einem Zeichen je Ring: "r" = richtig, "f" = falsch, "." = noch offen
  const marksOf = (marks, n) => String((marks && marks[n]) || "").padEnd(test(n).rings.length, ".");

  // Je Test werden zwei Zeilen abgefragt (10 Ringe): 2× 0,7 (Mindestmaß), 0,7 + 1,0 oder 2× 1,0.
  // Bestanden mit höchstens 4 Fehlern bei diesen 10 Ringen (mindestens 6 richtig), nicht bestanden ab 5 Fehlern.
  const MAX_ERR = 4;
  function rowInfo(m, rings, row) {
    const cells = rings.map((ring, i) => ({ ring, mk: m[i] })).filter(x => x.ring.row === row);
    const wrong = cells.filter(x => x.mk === "f");
    const open = cells.filter(x => x.mk === ".").length;
    return { row, visus: VISUS[row], name: ROW_NAME[row], err: wrong.length,
      straight: wrong.filter(x => STRAIGHT.has(x.ring.dir)).length, oblique: wrong.filter(x => !STRAIGHT.has(x.ring.dir)).length,
      open, started: open < cells.length, complete: open === 0 };
  }
  function pairInfo(a, b) {
    const straight = a.straight + b.straight, oblique = a.oblique + b.oblique;
    const failed = a.err + b.err > MAX_ERR;
    return { rows: [a, b], straight, oblique, err: a.err + b.err, failed, complete: a.complete && b.complete,
      pass: a.complete && b.complete && !failed };
  }
  const visusText = rows => {
    const v = rows.map(r => r.visus);
    return v.length === 2 && v[0] === v[1] ? `2× ${v[0]}` : v.join(" + ");
  };
  function evaluate(marks, n) {
    const m = marksOf(marks, n), rings = test(n).rings;
    const rows = COUNTED.map(row => rowInfo(m, rings, row));
    const started = rows.filter(r => r.started);
    const pairs = [];
    for (let i = 0; i < started.length; i++) for (let j = i + 1; j < started.length; j++) pairs.push(pairInfo(started[i], started[j]));
    let state, used = started, pair = null;
    const passing = pairs.find(p => p.pass);
    if (passing) { state = "bestanden"; pair = passing; used = passing.rows; }
    else if (!started.length) state = m.replace(/\./g, "") ? "offen" : "leer";
    else if (started.length === 1) {
      const r = started[0];
      state = r.err > MAX_ERR ? "nicht" : "offen";
    } else if (pairs.some(p => !p.failed)) {
      state = "offen";
      pair = pairs.find(p => !p.failed);
    } else { state = "nicht"; pair = pairs[0]; }
    const shown = pair ? pair.rows : used;
    const straight = shown.reduce((k, r) => k + r.straight, 0), oblique = shown.reduce((k, r) => k + r.oblique, 0);
    // Hinweis, wenn ein weiterer Fehler den Test kippen würde
    const wrongNow = shown.reduce((k, r) => k + r.err, 0);
    const warn = state === "offen" && wrongNow === MAX_ERR;
    return { state, rows, used: shown, pair, wrong: shown.reduce((k, r) => k + r.err, 0), straight, oblique, warn,
      visusText: visusText(shown), groups: shown };
  }
  // Zeilen, die „Übrige als richtig“ füllen soll: die angefangenen Zeilen, mindestens zwei (sonst die passende zweite)
  function rowsToFill(marks, n) {
    const started = evaluate(marks, n).rows.filter(r => r.started).map(r => r.row);
    if (!started.length) return [1, 2];
    if (started.length === 1) return [started[0], { 1: 2, 2: 1, 3: 4, 4: 3 }[started[0]]];
    return started;
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

  root.EHFYSehtest = { MAX_ERR, VISUS, TESTS, GROUPS, SETS, test, marksOf, evaluate, rowsToFill, overall, ringPath, STRAIGHT };
})(typeof window !== "undefined" ? window : globalThis);
