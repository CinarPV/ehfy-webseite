// EHfy-Logo als Vektorgrafik: scharf in jeder Größe, für helle und dunkle Hintergründe, optional animiert.
// Einbinden:  <span data-logo="full|compact|mark" data-theme="light|dark|ink" data-anim></span>
// oder per JS: EHFYLogo({ variant: "full", theme: "dark", animate: true })
(function () {
  const COLORS = {
    light: { word: "#04679a", y: "#29b4b6", line: "#29b4b6", sub1: "#04679a", sub2: "#29b4b6" },
    dark:  { word: "#ffffff", y: "#46d3d1", line: "#46d3d1", sub1: "#ffffff", sub2: "#46d3d1" },
    ink:   { word: "#0a2540", y: "#ffffff", line: "#0a2540", sub1: "#0a2540", sub2: "#ffffff" }
  };
  const FONT = `"Jakarta", "Avenir Next", "Segoe UI", system-ui, sans-serif`;
  const LINE = "M6 128 H104 L122 100 L146 158 L174 38 L204 160 L224 108 L238 128 H330";
  let n = 0;

  window.EHFYLogo = function ({ variant = "full", theme = "light", animate = false } = {}) {
    const c = COLORS[theme] || COLORS.light;
    const id = "ehfy" + (++n);
    const anim = animate ? `
      <style>
        #${id} .l { stroke-dasharray: 100; stroke-dashoffset: 100; animation: ${id}d 1.3s cubic-bezier(.6,0,.2,1) forwards; }
        #${id} .w, #${id} .s { opacity: 0; animation: ${id}f .7s ease-out forwards; }
        #${id} .w { animation-delay: .9s; } #${id} .s1 { animation-delay: 1.15s; } #${id} .s2 { animation-delay: 1.35s; }
        @keyframes ${id}d { to { stroke-dashoffset: 0; } }
        @keyframes ${id}f { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { #${id} .l, #${id} .w, #${id} .s { animation: none; opacity: 1; stroke-dashoffset: 0; } }
      </style>` : "";

    if (variant === "mark") {
      // Nur Herzlinie + "EHfy" in einer Box – für Icons und kleine Flächen
      return `<svg id="${id}" viewBox="0 0 200 200" role="img" aria-label="EHfy"><rect width="200" height="200" rx="44" fill="${theme === "dark" ? "#0a2540" : "#04679a"}"/>
        <path d="M22 92 H62 L72 74 L86 110 L102 44 L118 116 L130 84 L138 92 H178" fill="none" stroke="#46d3d1" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="100" y="168" text-anchor="middle" font-family='${FONT}' font-weight="800" font-size="52" letter-spacing="-2" fill="#fff">EHf<tspan fill="#46d3d1">y</tspan></text></svg>`;
    }

    const full = variant === "full";
    const h = full ? 256 : 180;
    return `<svg id="${id}" viewBox="0 0 640 ${h}" role="img" aria-label="EHfy – Erste Hilfe for you${full ? " – Be a second chance" : ""}" style="display:block;width:100%;height:auto;overflow:visible">${anim}
      <path class="l" d="${LINE}" pathLength="100" fill="none" stroke="${c.line}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <text class="w" x="290" y="138" font-family='${FONT}' font-weight="800" font-size="142" letter-spacing="-7" fill="${c.word}">EHf<tspan fill="${c.y}">y</tspan></text>
      ${full ? `
      <text class="s s1" x="300" y="204" font-family='${FONT}' font-weight="800" font-size="36" letter-spacing="-.4" fill="${c.sub1}">Erste Hilfe for you</text>
      <text class="s s2" x="300" y="246" font-family='${FONT}' font-weight="400" font-size="36" letter-spacing="-.4" fill="${c.sub2}">Be a second chance</text>` : ""}
    </svg>`;
  };

  function mount(root) {
    (root || document).querySelectorAll("[data-logo]").forEach(el => {
      el.innerHTML = EHFYLogo({ variant: el.dataset.logo || "full", theme: el.dataset.theme || "light", animate: "anim" in el.dataset });
    });
  }
  window.EHFYMountLogos = mount;

  // Nie zweimal gleichzeitig: Solange das große Logo (data-logo-hero) sichtbar ist,
  // bleibt das kleine Logo in der Kopfleiste (data-logo-header) ausgeblendet.
  function pairLogos() {
    const hero = document.querySelector("[data-logo-hero]");
    const head = document.querySelector("[data-logo-header]");
    if (!hero || !head || !("IntersectionObserver" in window)) return;
    head.style.transition = "opacity .35s ease, transform .35s ease";
    new IntersectionObserver(([e]) => {
      head.style.opacity = e.isIntersecting ? "0" : "1";
      head.style.transform = e.isIntersecting ? "translateY(-6px)" : "none";
      head.style.pointerEvents = e.isIntersecting ? "none" : "";
    }, { rootMargin: "-80px 0px 0px 0px" }).observe(hero);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pairLogos);
  else pairLogos();
  // Erst nach dem Laden der Schrift zeichnen, damit nichts springt
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('800 40px "Jakarta"'), document.fonts.load('400 40px "Jakarta"')]).catch(() => {}).then(() => mount());
  } else mount();
})();
