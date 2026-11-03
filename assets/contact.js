// Füllt alle Kontakt-Kacheln (<div id="contact-strip">) mit Telefon, WhatsApp und E-Mail.
(function () {
  const cfg = window.EHFY_CONFIG;
  const box = document.getElementById("contact-strip");
  if (!box) return;
  const icon = d => `<div class="icon" style="margin:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg></div>`;
  box.innerHTML = `
    <a class="contact-item" href="tel:${cfg.phoneIntl}">
      ${icon('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>')}
      <div><strong>Anrufen</strong>${cfg.phone}</div>
    </a>
    <a class="contact-item" href="https://wa.me/${cfg.whatsapp}" target="_blank" rel="noopener">
      ${icon('<path d="M21 11.5a8.4 8.4 0 0 1-12.5 7.4L3 21l2.1-5.5A8.5 8.5 0 1 1 21 11.5z"/>')}
      <div><strong>WhatsApp</strong>Nachricht schreiben</div>
    </a>
    <a class="contact-item" href="mailto:${cfg.email}">
      ${icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>')}
      <div><strong>E-Mail</strong>${cfg.email}</div>
    </a>`;
})();
