// Supabase Edge Function "anmeldung-push"
// Schickt bei jeder neuen Online-Anmeldung eine Push-Mitteilung auf deine Geräte.
// Wird von einem Database Webhook (Tabelle "registrations", Ereignis INSERT) aufgerufen.
//
// Benötigte Secrets (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   – derselbe Wert wie vapidPublicKey in assets/config.js
//   VAPID_PRIVATE_KEY  – der geheime Gegenschlüssel (nur hier eintragen, nie in die Webseite)
//   VAPID_SUBJECT      – mailto:ehfy@web.de

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

Deno.serve(async req => {
  const payload = await req.json().catch(() => null);
  const reg = payload?.record;
  if (!reg || payload.type !== "INSERT") return new Response("ignoriert");
  // Selbst eingetragene Teilnehmer lösen keine Mitteilung aus
  if (reg.message === "manuell eingetragen") return new Response("übersprungen");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: course } = await db.from("courses").select("starts_at, location").eq("id", reg.course_id).maybeSingle();
  const { data: subs } = await db.from("push_subscriptions").select("endpoint, subscription");
  if (!subs?.length) return new Response("keine Geräte");

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:ehfy@web.de",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!
  );
  const when = course
    ? new Date(course.starts_at).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" }) + ` · ${course.location}`
    : "";
  const message = JSON.stringify({
    title: "Neue Anmeldung",
    body: `${reg.first_name} ${reg.last_name}${when ? "\n" + when : ""}`,
    courseId: reg.course_id
  });

  const results = await Promise.allSettled(subs.map(s => webpush.sendNotification(s.subscription, message)));
  // Abgemeldete Geräte aufräumen
  await Promise.all(results.map((r, i) => {
    const code = r.status === "rejected" ? (r.reason as { statusCode?: number }).statusCode : 0;
    if (code === 404 || code === 410) return db.from("push_subscriptions").delete().eq("endpoint", subs[i].endpoint);
    if (r.status === "rejected") console.error("Push fehlgeschlagen:", r.reason);
    return null;
  }));
  return new Response("ok");
});
