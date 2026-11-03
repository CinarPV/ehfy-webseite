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
        <a class="brand" href="index.html" aria-label="Erste Hilfe for you – Startseite">
          <span data-logo="compact"></span>
        </a>
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
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    footer.innerHTML = `
      <div class="stripes" aria-hidden="true"></div>
      <div class="container">
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
    seatsPill(c) {
      const free = Math.max(0, c.capacity - c.booked);
      if (free === 0) return '<span class="pill pill-full">ausgebucht</span>';
      if (free <= 3) return `<span class="pill pill-warn">nur noch ${free} ${free === 1 ? "Platz" : "Plätze"}</span>`;
      return `<span class="pill pill-ok">${free} Plätze frei</span>`;
    }
  };
})();
