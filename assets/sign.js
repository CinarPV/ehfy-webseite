// Großes Unterschriftsfeld über den ganzen Bildschirm, im Querformat.
// Hält man das Handy hochkant, wird das Feld um 90° gedreht angezeigt – einfach das Handy quer drehen.
// EHFYSign.big({ title, ok, extra }) → Promise: PNG (zugeschnitten, durchsichtig), "extra" (zweiter Knopf) oder null („Zurück“)
(function (root) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function big(opts = {}) {
    return new Promise(resolve => {
      const d = document.createElement("dialog");
      d.className = "sign-big";
      d.innerHTML = `<div class="sb-wrap">
        <div class="sb-bar"><button class="btn btn-sm btn-ghost" type="button" data-sb="back">← Zurück</button>
          <strong>${esc(opts.title || "Unterschrift")}</strong><button class="btn btn-sm btn-ghost" type="button" data-sb="clear">Löschen</button></div>
        <div class="sb-area"><canvas></canvas><div class="sb-line"></div><span class="sb-hint">Hier groß unterschreiben</span></div>
        <div class="sb-foot">${opts.extra ? `<button class="btn btn-ghost" type="button" data-sb="extra">${esc(opts.extra)}</button>` : ""}<button class="btn" type="button" data-sb="ok">${esc(opts.ok || "Unterschrift bestätigen")}</button></div>
      </div>`;
      document.body.appendChild(d);
      const area = d.querySelector(".sb-area"), cv = d.querySelector("canvas"), ctx = cv.getContext("2d");
      const hint = d.querySelector(".sb-hint");
      const strokes = []; let cur = null;
      const portrait = () => window.innerHeight > window.innerWidth;

      const drawAll = (c, list) => {
        c.lineWidth = 3; c.lineCap = c.lineJoin = "round"; c.strokeStyle = "#0a2a8a";
        for (const s of list) {
          c.beginPath();
          s.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
          if (s.length === 1) c.lineTo(s[0][0] + 0.1, s[0][1]);
          c.stroke();
        }
      };
      const paint = () => {
        const r = window.devicePixelRatio || 1;
        ctx.setTransform(r, 0, 0, r, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        drawAll(ctx, strokes);
        hint.style.display = strokes.length ? "none" : "";
      };
      const size = () => {
        d.classList.toggle("sb-turn", portrait());
        const w = area.clientWidth, h = area.clientHeight, r = window.devicePixelRatio || 1;
        cv.width = Math.round(w * r); cv.height = Math.round(h * r);
        cv.style.width = w + "px"; cv.style.height = h + "px";
        paint();
      };
      // Bildschirmpunkt → Punkt im (eventuell gedrehten) Feld
      const pos = e => {
        const b = cv.getBoundingClientRect();
        return d.classList.contains("sb-turn") ? [e.clientY - b.top, b.right - e.clientX] : [e.clientX - b.left, e.clientY - b.top];
      };
      cv.addEventListener("pointerdown", e => { cur = [pos(e)]; strokes.push(cur); cv.setPointerCapture(e.pointerId); paint(); e.preventDefault(); });
      cv.addEventListener("pointermove", e => { if (!cur) return; cur.push(pos(e)); paint(); e.preventDefault(); });
      const up = () => { cur = null; };
      cv.addEventListener("pointerup", up);
      cv.addEventListener("pointercancel", up);

      const finish = v => { window.removeEventListener("resize", size); d.close(); d.remove(); resolve(v); };
      d.oncancel = e => { e.preventDefault(); finish(null); };
      d.addEventListener("click", e => {
        const b = e.target.closest("[data-sb]");
        if (!b) return;
        const act = b.dataset.sb;
        if (act === "back") return finish(null);
        if (act === "extra") return finish("extra");
        if (act === "clear") { strokes.length = 0; hint.textContent = "Hier groß unterschreiben"; return paint(); }
        if (act === "ok") {
          if (!strokes.length) { hint.textContent = "Bitte zuerst unterschreiben."; return; }
          // Auf die Unterschrift zuschneiden, scharf und mit durchsichtigem Hintergrund
          const pts = strokes.flat(), pad = 6, k = opts.scale || 2;
          const x0 = Math.min(...pts.map(p => p[0])) - pad, y0 = Math.min(...pts.map(p => p[1])) - pad;
          const w = Math.max(...pts.map(p => p[0])) + pad - x0, h = Math.max(...pts.map(p => p[1])) + pad - y0;
          const out = document.createElement("canvas");
          out.width = Math.ceil(w * k); out.height = Math.ceil(h * k);
          const o = out.getContext("2d");
          o.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
          drawAll(o, strokes);
          finish(out.toDataURL("image/png"));
        }
      });
      d.showModal();
      window.addEventListener("resize", size);
      requestAnimationFrame(size);
    });
  }

  root.EHFYSign = { big };
})(window);
