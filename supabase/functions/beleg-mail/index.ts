// Supabase Edge Function "beleg-mail"
// Verschickt eine Quittung oder Rechnung (PDF im Anhang) direkt über dein IONOS-Postfach info@ehfy.de.
// Aufruf nur aus der Verwaltung – nur angemeldete Verwaltungs-Konten dürfen senden.
//
// Benötigte Secrets (Supabase → Edge Functions → Secrets):
//   IONOS_USER      – info@ehfy.de
//   IONOS_PASSWORD  – das Passwort dieses Postfachs (nur hier eintragen, nie in die Webseite)
// Optional:
//   MAIL_NAME       – Absendername (Standard: Erste Hilfe for you)
//   COPY_TO_SELF    – "false", wenn du keine Kopie an dich selbst möchtest

import nodemailer from "npm:nodemailer@6.9.14";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const oneLine = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, max);

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }
  });
  const { data: isAdmin } = await asUser.rpc("is_admin");
  if (!isAdmin) return json({ error: "Keine Berechtigung." }, 403);

  const b = await req.json().catch(() => null);
  if (!b || !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(b.to ?? "")) return json({ error: "Bitte eine gültige Empfänger-Adresse angeben." }, 400);
  if (typeof b.pdfBase64 !== "string" || !b.pdfBase64 || b.pdfBase64.length > 8_000_000) return json({ error: "Die PDF fehlt oder ist zu groß." }, 400);

  const from = Deno.env.get("IONOS_USER");
  const pass = Deno.env.get("IONOS_PASSWORD");
  if (!from || !pass) return json({ error: "Das Postfach ist noch nicht eingerichtet (Secrets IONOS_USER / IONOS_PASSWORD)." }, 500);

  // IONOS über SSL (Port 465) – Port 587 ist bei Supabase gesperrt
  const transport = nodemailer.createTransport({ host: "smtp.ionos.de", port: 465, secure: true, auth: { user: from, pass } });
  try {
    await transport.sendMail({
      from: `"${oneLine(Deno.env.get("MAIL_NAME") ?? "Erste Hilfe for you", 80)}" <${from}>`,
      to: b.to,
      bcc: Deno.env.get("COPY_TO_SELF") === "false" ? undefined : from,
      subject: oneLine(b.subject, 200),
      text: String(b.text ?? "").slice(0, 5000),
      attachments: [{
        filename: oneLine(b.filename || "Beleg.pdf", 120).replace(/[\/\\:*?"<>|]/g, "_"),
        content: b.pdfBase64, encoding: "base64", contentType: "application/pdf"
      }]
    });
  } catch (e) {
    console.error("Versand fehlgeschlagen:", e);
    return json({ error: "Versand über info@ehfy.de fehlgeschlagen: " + ((e as Error)?.message ?? String(e)) }, 502);
  }

  // Versand am Beleg vermerken
  if (b.invoice_id) {
    await createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
      .from("invoices").update({ sent_at: new Date().toISOString(), sent_to: b.to }).eq("id", b.invoice_id);
  }
  return json({ ok: true });
});
