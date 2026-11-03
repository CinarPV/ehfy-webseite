// Supabase Edge Function "anmeldung-mail"
// Schickt bei jeder neuen Online-Anmeldung eine E-Mail an dich.
// Wird von einem Database Webhook (Tabelle "registrations", Ereignis INSERT) aufgerufen.
//
// Benötigte Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY  – API-Schlüssel von resend.com
//   NOTIFY_TO       – Empfänger, z. B. ehfy@web.de
// Optional:
//   MAIL_FROM       – Absender (Standard: onboarding@resend.dev, solange keine eigene Domain bestätigt ist)
//   SITE_URL        – Adresse der Webseite (Standard: https://www.ehfy.de)

// BEGIN buildMail
const PACKAGES = {
  kurs: "Erste-Hilfe-Kurs (50 €)",
  komplett: "Erste-Hilfe-Kurs + Sehtest (55 €)"
};
const TZ = "Europe/Berlin";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildMail(reg, course, opts = {}) {
  const siteUrl = opts.siteUrl || "https://www.ehfy.de";
  const start = new Date(course.starts_at);
  const dateShort = start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const dateLong = start.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const time = t => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const times = course.ends_at ? `${time(course.starts_at)} – ${time(course.ends_at)} Uhr` : `ab ${time(course.starts_at)} Uhr`;
  const birth = reg.birth_date ? new Date(reg.birth_date + "T12:00:00Z").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "–";
  const created = new Date(reg.created_at || Date.now()).toLocaleString("de-DE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
  const pkg = PACKAGES[reg.package] || reg.package;

  const subject = `Ersthilfeanmeldung – ${dateShort} (${course.location})`;

  const rows = [
    ["Kurs", `${dateLong}<br>${times}<br>${esc(course.location)} · ${esc(course.address)}`],
    ["Buchung", esc(pkg)],
    ["Name (laut Ausweis)", `<strong>${esc(reg.first_name)} ${esc(reg.last_name)}</strong>`],
    ["Geburtsdatum", birth],
    ["Anschrift", reg.street ? `${esc(reg.street)}<br>${esc(reg.zip)} ${esc(reg.city)}` : "–"],
    ["E-Mail", reg.email ? `<a href="mailto:${esc(reg.email)}">${esc(reg.email)}</a>` : "–"],
    ["Telefon", reg.phone ? `<a href="tel:${esc(reg.phone)}">${esc(reg.phone)}</a>` : "–"],
    ["Angemeldet am", created]
  ];

  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f3f7f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f1f2b">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0a2540;color:#fff;border-radius:16px 16px 0 0;padding:20px 24px">
      <div style="font-size:24px;font-weight:800;letter-spacing:-.5px">EHf<span style="color:#46d3d1">y</span></div>
      <div style="font-size:15px;color:#b7cad8;margin-top:4px">Neue Anmeldung zum Erste-Hilfe-Kurs</div>
    </div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:8px 24px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${rows.map(([k, v]) => `<tr><td style="padding:12px 12px 12px 0;border-bottom:1px solid #e2e9ee;color:#5a6b78;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:12px 0;border-bottom:1px solid #e2e9ee">${v}</td></tr>`).join("")}
      </table>
      <p style="margin:24px 0 0"><a href="${siteUrl}/admin.html" style="display:inline-block;background:#0a2540;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Teilnehmerliste öffnen</a></p>
    </div>
    <p style="font-size:12px;color:#8797a3;text-align:center;margin-top:16px">Automatische Nachricht von ${siteUrl.replace(/^https?:\/\//, "")}</p>
  </div></body></html>`;

  const text = [
    "Neue Anmeldung zum Erste-Hilfe-Kurs", "",
    `Kurs:          ${dateLong}, ${times}`,
    `Ort:           ${course.location} – ${course.address}`,
    `Buchung:       ${pkg}`,
    `Name:          ${reg.first_name} ${reg.last_name}`,
    `Geburtsdatum:  ${birth}`,
    `Anschrift:     ${reg.street ? `${reg.street}, ${reg.zip} ${reg.city}` : "–"}`,
    `E-Mail:        ${reg.email || "–"}`,
    `Telefon:       ${reg.phone || "–"}`,
    `Angemeldet am: ${created}`, "",
    `Teilnehmerliste: ${siteUrl}/admin.html`
  ].join("\n");

  return { subject, html, text };
}
// END buildMail

Deno.serve(async req => {
  const payload = await req.json().catch(() => null);
  const reg = payload?.record;
  if (!reg || payload.type !== "INSERT") return new Response("ignoriert");
  // Selbst in der Verwaltung eingetragene Teilnehmer lösen keine Mail aus
  if (reg.message === "manuell eingetragen") return new Response("übersprungen");

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/rest/v1/courses?id=eq.${reg.course_id}&select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const [course] = await res.json();
  if (!course) return new Response("Kurs nicht gefunden", { status: 404 });

  const mail = buildMail(reg, course, { siteUrl: Deno.env.get("SITE_URL") ?? "https://www.ehfy.de" });
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM") ?? "EHfy Anmeldung <onboarding@resend.dev>",
      to: [Deno.env.get("NOTIFY_TO") ?? "ehfy@web.de"],
      reply_to: reg.email || undefined,
      subject: mail.subject,
      html: mail.html,
      text: mail.text
    })
  });
  if (!sent.ok) {
    console.error("Mailversand fehlgeschlagen:", await sent.text());
    return new Response("Mailversand fehlgeschlagen", { status: 500 });
  }
  return new Response("ok");
});
