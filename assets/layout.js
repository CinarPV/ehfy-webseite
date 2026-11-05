// Kopf- und Fußbereich für alle Seiten + kleine Hilfsfunktionen.
(function () {
  const cfg = window.EHFY_CONFIG;
  const page = document.body.dataset.page || "";

  const links = [
    ["index.html", "Start", "start"],
    ["kurs.html", "Kursinfos", "kurs"],
    ["preise.html", "Preise", "preise"],
    ["ersatzbescheinigung.html", "Ersatzbescheinigung", "ersatz"],
    ["absage.html", "Absage", "absage"],
    ["anmelden.html", "Termine & Anmeldung", "anmelden", "nav-cta"]
  ];

  const header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header";
    header.innerHTML = `
      <div class="container">
        <div class="header-left">
          <button class="back-btn no-print" id="back-btn" type="button" hidden>← Zurück</button>
          <a class="brand" href="index.html" aria-label="Erste Hilfe for you – Startseite">
            <span data-logo="compact"></span>
          </a>
        </div>
        <button class="nav-toggle" aria-expanded="false" aria-controls="main-nav">Menü</button>
        <nav class="nav" id="main-nav">
          ${links.map(([href, label, key, cls]) =>
            `<a href="${href}" class="${[cls, key === page ? "active" : ""].filter(Boolean).join(" ")}"${key === page ? ' aria-current="page"' : ""}>${label}</a>`
          ).join("")}
        </nav>
      </div>
      <div class="stripes" aria-hidden="true"></div>`;
    const toggle = header.querySelector(".nav-toggle");
    const nav = header.querySelector(".nav");
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open);
    });

    // Zurück-Knopf: erst innerhalb der Seite (z. B. Verwaltung), dann zur vorigen Seite oder zum Start
    const back = header.querySelector("#back-btn");
    const steps = [];
    const cameFromSite = document.referrer.startsWith(location.origin) && document.referrer !== location.href;
    const refresh = () => { back.hidden = !(steps.length || cameFromSite || !["start", "admin"].includes(page)); };
    back.addEventListener("click", () => {
      if (steps.length) { steps.pop()(); refresh(); window.scrollTo(0, 0); }
      else if (cameFromSite) history.back();
      else location.href = "index.html";
    });
    window.EHFYNav = {
      push(step) { steps.push(step); refresh(); },
      remove(step) { const i = steps.lastIndexOf(step); if (i >= 0) steps.splice(i, 1); refresh(); }
    };
    refresh();
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    footer.innerHTML = `
      <div class="stripes" aria-hidden="true"></div>
      <div class="container">
        <div class="symbol-row" aria-hidden="true"><svg class="sym"><use href="assets/symbole.svg#kreuz"/></svg><svg class="sym"><use href="assets/symbole.svg#herz"/></svg><svg class="sym"><use href="assets/symbole.svg#aed"/></svg><svg class="sym"><use href="assets/symbole.svg#ekg"/></svg><svg class="sym"><use href="assets/symbole.svg#notruf"/></svg><svg class="sym"><use href="assets/symbole.svg#verband"/></svg><svg class="sym"><use href="assets/symbole.svg#warnung"/></svg><svg class="sym"><use href="assets/symbole.svg#seitenlage"/></svg><svg class="sym"><use href="assets/symbole.svg#auge"/></svg></div>
        <div class="footer-grid">
          <div>
            <div class="footer-logo" data-logo="full" data-theme="dark"></div>
            <p>Erste-Hilfe-Kurse, Sehtests und Passbilder in Siegen, Burbach, Netphen und Wilnsdorf – mit Kompetenz und einer großen Portion Humor.</p>
            <a class="btn btn-teal btn-sm" href="anmelden.html" style="margin-top:6px">Termin sichern</a>
          </div>
          <div>
            <h4>Kontakt</h4>
            <ul>
              <li><a href="tel:${cfg.phoneIntl}">${cfg.phone}</a></li>
              <li><a href="https://wa.me/${cfg.whatsapp}" target="_blank" rel="noopener">WhatsApp</a></li>
              <li><a href="mailto:${cfg.email}">${cfg.email}</a></li>
            </ul>
          </div>
          <div>
            <h4>Rechtliches</h4>
            <ul>
              <li><a href="impressum.html">Impressum</a></li>
              <li><a href="datenschutz.html">Datenschutz</a></li>
              <li><a href="absage.html">Absagebedingungen</a></li>
              <li><a href="admin.html">Verwaltung</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} Erste Hilfe for you Siegen</span>
          <span>Zugelassen durch die Bezirksregierung Arnsberg</span>
        </div>
      </div>`;
  }

  // Logo-Grafik nachladen (zeichnet alle Elemente mit data-logo)
  if (!window.EHFYLogo) {
    const s = document.createElement("script");
    s.src = "assets/brand.js";
    document.body.appendChild(s);
  }

  // Hilfsfunktionen für alle Seiten
  const TZ = "Europe/Berlin";
  window.EHFY = {
    esc(s) {
      return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    },
    fmtDate(iso) {
      return new Date(iso).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
    },
    fmtShortDate(iso) {
      return new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
    },
    fmtTime(iso) {
      return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
    },
    fmtRange(start, end) {
      return end ? `${EHFY.fmtTime(start)} – ${EHFY.fmtTime(end)} Uhr` : `ab ${EHFY.fmtTime(start)} Uhr`;
    },
    // Geburtsdatum: „TT.MM.JJJJ“ (oder JJJJ-MM-TT vom automatischen Ausfüllen) → JJJJ-MM-TT, sonst null
    parseBirth(value) {
      const s = String(value || "").trim();
      const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/) || s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const [y, mo, d] = m[1].length === 4 ? [+m[1], +m[2], +m[3]] : [+m[3], +m[2], +m[1]];
      const date = new Date(Date.UTC(y, mo - 1, d));
      if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null; // z. B. 31.02.
      if (y < 1900 || date > new Date()) return null;
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    },
    // Punkte beim Tippen automatisch setzen: 01022008 → 01.02.2008, 1.2. → 01.02.
    birthField(el) {
      el.addEventListener("input", () => {
        const raw = el.value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) { // automatisches Ausfüllen
          const [y, m, d] = raw.split("-");
          el.value = `${d}.${m}.${y}`;
          return;
        }
        const parts = raw.replace(/[^\d.]/g, "").split(".");
        const digits = parts.map((p, i) => (i < parts.length - 1 && i < 2 && p.length === 1 ? "0" + p : p)).join("").slice(0, 8);
        el.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join(".");
      });
    },
    // Öffentlich gibt es nur eine Einstufung, keine Platzzahlen
    seatLevel(c) {
      if (c.seats) return c.seats;
      const free = Math.max(0, (c.capacity || 0) - (c.booked || 0));
      return free === 0 ? "voll" : free <= 2 ? "letzte" : free <= 5 ? "wenige" : "frei";
    },
    seatText(c) {
      return { frei: "Noch Plätze frei", wenige: "Noch wenige Plätze frei", letzte: "Die letzten Plätze", voll: "Ausgebucht" }[EHFY.seatLevel(c)];
    },
    seatsPill(c) {
      const cls = { frei: "pill-ok", wenige: "pill-warn", letzte: "pill-warn", voll: "pill-full" }[EHFY.seatLevel(c)];
      return `<span class="pill ${cls}">${EHFY.seatText(c)}</span>`;
    }
  };
})();
