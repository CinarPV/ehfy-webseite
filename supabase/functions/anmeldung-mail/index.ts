// Supabase Edge Function "anmeldung-mail"
// Bei jeder neuen Online-Anmeldung gehen zwei E-Mails über dein IONOS-Postfach raus:
//   1. die Bestätigung an den Teilnehmer (Absender info@ehfy.de)
//   2. die Benachrichtigung mit allen Daten an dich
// Wird von einem Database Webhook (Tabelle "registrations", Ereignis INSERT) aufgerufen.
//
// Benötigte Secrets (Supabase → Edge Functions → Secrets):
//   IONOS_USER      – info@ehfy.de
//   IONOS_PASSWORD  – das Passwort dieses Postfachs (nur hier eintragen, nie in die Webseite)
//   NOTIFY_TO       – wohin die Benachrichtigung an dich geht, z. B. ehfy@web.de
//   SITE_URL        – Adresse der Webseite, ohne / am Ende (wichtig für den Absage-Link)
// Optional:
//   MAIL_NAME       – Absendername (Standard: Erste Hilfe for you)

import nodemailer from "npm:nodemailer@6.9.14";

// BEGIN buildMail
const PACKAGES = {
  kurs: "Erste-Hilfe-Kurs (50 €)",
  komplett: "Erste-Hilfe-Kurs + Sehtest (55 €)"
};
const TZ = "Europe/Berlin";
const DEFAULT_SITE = "https://cinarpv.github.io/ehfy-webseite";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildMail(reg, course, opts = {}) {
  const siteUrl = opts.siteUrl || DEFAULT_SITE;
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
    `E-Mail:        ${reg.email || "–"}`,
    `Telefon:       ${reg.phone || "–"}`,
    `Angemeldet am: ${created}`, "",
    `Teilnehmerliste: ${siteUrl}/admin.html`
  ].join("\n");

  return { subject, html, text };
}

// Bestätigung an den Teilnehmer
function buildConfirmation(reg, course, opts = {}) {
  const siteUrl = opts.siteUrl || DEFAULT_SITE;
  const contact = opts.contact || "info@ehfy.de";
  const start = new Date(course.starts_at);
  const dateShort = start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const dateLong = start.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const time = t => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const times = course.ends_at ? `${time(course.starts_at)} – ${time(course.ends_at)} Uhr` : `ab ${time(course.starts_at)} Uhr`;
  const pkg = PACKAGES[reg.package] || reg.package;
  const fullName = `${reg.first_name} ${reg.last_name}`;
  const place = course.address && course.address !== course.location ? `${course.location}, ${course.address}` : course.location;
  const cancel = `${siteUrl}/absage.html?code=${reg.cancel_token}`;
  const bring = ["Personalausweis oder Reisepass"];
  if (reg.package === "komplett") bring.push("Brille bzw. Kontaktlinsen (für den Sehtest)");

  const subject = `Deine Anmeldung: Erste-Hilfe-Kurs am ${dateShort}`;
  const rows = [
    ["Termin", `${dateLong}<br>${times}`],
    ["Ort", esc(place)],
    ["Buchung", esc(pkg)],
    ["Name auf der Bescheinigung", `<strong>${esc(fullName)}</strong>`]
  ];

  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f3f7f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f1f2b">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0a2540;color:#fff;border-radius:16px 16px 0 0;padding:20px 24px">
      <div style="font-size:24px;font-weight:800;letter-spacing:-.5px">EHf<span style="color:#46d3d1">y</span></div>
      <div style="font-size:15px;color:#b7cad8;margin-top:4px">Deine Anmeldung ist bestätigt</div>
    </div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:20px 24px 24px">
      <p style="margin:0 0 12px;font-size:16px">Hallo ${esc(reg.first_name)},</p>
      <p style="margin:0 0 12px;font-size:15px">danke für deine Anmeldung. Das sind deine Kursdaten:</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${rows.map(([k, v]) => `<tr><td style="padding:12px 12px 12px 0;border-bottom:1px solid #e2e9ee;color:#5a6b78;vertical-align:top">${k}</td><td style="padding:12px 0;border-bottom:1px solid #e2e9ee">${v}</td></tr>`).join("")}
      </table>
      <p style="margin:20px 0 6px;font-size:15px"><strong>Stimmt dein Name nicht genau mit deinem Ausweis überein?</strong> Dann melde dich bitte vor dem Kurs bei uns, denn deine Bescheinigung wird vorab ausgestellt.</p>
      <p style="margin:20px 0 6px;font-size:15px"><strong>Bitte mitbringen:</strong></p>
      <ul style="margin:0;padding-left:20px;font-size:15px">${bring.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
      <p style="margin:20px 0 10px;font-size:15px"><strong>Du kannst nicht kommen?</strong> Bitte melde dich mindestens 48 Stunden vor Kursbeginn ab:</p>
      <p style="margin:0"><a href="${esc(cancel)}" style="display:inline-block;background:#0a2540;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Anmeldung absagen</a></p>
      <p style="margin:20px 0 0;font-size:15px">Fragen? Antworte einfach auf diese E-Mail.</p>
      <p style="margin:12px 0 0;font-size:15px">Bis bald<br>Erste Hilfe for you</p>
    </div>
    <p style="font-size:12px;color:#8797a3;text-align:center;margin-top:16px">Automatische Bestätigung von ${esc(contact)}</p>
  </div></body></html>`;

  const text = [
    `Hallo ${reg.first_name},`, "",
    "danke für deine Anmeldung. Das sind deine Kursdaten:", "",
    `Termin:  ${dateLong}, ${times}`,
    `Ort:     ${place}`,
    `Buchung: ${pkg}`,
    `Name auf der Bescheinigung: ${fullName}`, "",
    "Stimmt dein Name nicht genau mit deinem Ausweis überein? Dann melde dich bitte vor dem Kurs bei uns, denn deine Bescheinigung wird vorab ausgestellt.", "",
    "Bitte mitbringen:", ...bring.map(b => `- ${b}`), "",
    "Du kannst nicht kommen? Bitte melde dich mindestens 48 Stunden vor Kursbeginn ab:", cancel, "",
    "Fragen? Antworte einfach auf diese E-Mail.", "",
    "Bis bald", "Erste Hilfe for you"
  ].join("\n");

  return { subject, html, text };
}
// END buildMail

Deno.serve(async req => {
  const payload = await req.json().catch(() => null);
  const id = payload?.record?.id;
  if (!id || payload.type !== "INSERT") return new Response("ignoriert");

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const read = (path: string) => fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key!, Authorization: `Bearer ${key}` } }).then(r => r.json());

  // Nur echte, frische Anmeldungen aus der Datenbank: Empfänger kommen nie aus der Anfrage selbst.
  const [reg] = await read(`registrations?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!reg) return new Response("Anmeldung nicht gefunden", { status: 404 });
  if (Date.now() - new Date(reg.created_at).getTime() > 10 * 60 * 1000) return new Response("zu alt");
  // Selbst in der Verwaltung eingetragene Teilnehmer lösen keine Mail aus
  if (reg.message === "manuell eingetragen") return new Response("übersprungen");

  const [course] = await read(`courses?id=eq.${reg.course_id}&select=*`);
  if (!course) return new Response("Kurs nicht gefunden", { status: 404 });

  const user = Deno.env.get("IONOS_USER");
  const pass = Deno.env.get("IONOS_PASSWORD");
  if (!user || !pass) {
    console.error("IONOS_USER oder IONOS_PASSWORD fehlt.");
    return new Response("Postfach nicht eingerichtet", { status: 500 });
  }
  // Port 465: Supabase sperrt die Ports 25 und 587
  const transport = nodemailer.createTransport({ host: "smtp.ionos.de", port: 465, secure: true, auth: { user, pass } });
  const name = (Deno.env.get("MAIL_NAME") ?? "Erste Hilfe for you").replace(/[\r\n"]+/g, " ");
  const from = `"${name}" <${user}>`;
  const opts = { siteUrl: Deno.env.get("SITE_URL") ?? DEFAULT_SITE, contact: user };

  const jobs = [];
  if (reg.email) jobs.push(transport.sendMail({ from, to: reg.email, replyTo: user, ...buildConfirmation(reg, course, opts) }));
  jobs.push(transport.sendMail({ from, to: Deno.env.get("NOTIFY_TO") ?? user, replyTo: reg.email || undefined, ...buildMail(reg, course, opts) }));

  const failed = (await Promise.allSettled(jobs)).filter(r => r.status === "rejected");
  if (failed.length) {
    failed.forEach(r => console.error("Mailversand fehlgeschlagen:", (r as PromiseRejectedResult).reason));
    return new Response("Mailversand fehlgeschlagen", { status: 500 });
  }
  return new Response("ok");
});
