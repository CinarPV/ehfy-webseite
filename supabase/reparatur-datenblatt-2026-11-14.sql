-- Einmalige Reparatur für den 14.11.2026:
-- Wer sich HEUTE über das Teilnehmerdatenblatt eingetragen und dabei einen falschen Tag gewählt hat,
-- kommt in einen internen Kurs von heute (wird angelegt, nicht online sichtbar) und gilt als „teilgenommen“.
-- VORHER update-datenblatt-heute.sql ausführen.
-- Nur am 14.11.2026 ausführen (das Skript nimmt immer „heute“).

-- 1) Vorschau: Wer würde verschoben? (nur diesen Block markieren und ausführen)
select r.first_name, r.last_name, r.birth_date,
       to_char(c.starts_at at time zone 'Europe/Berlin', 'DD.MM.YYYY') as gewaehlter_tag,
       to_char(r.checkin_at at time zone 'Europe/Berlin', 'HH24:MI') as eingetragen_um
  from public.registrations r join public.courses c on c.id = r.course_id
 where (r.checkin_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
   and (c.starts_at at time zone 'Europe/Berlin')::date <> (now() at time zone 'Europe/Berlin')::date
   and r.status <> 'storniert'
 order by r.checkin_at;

-- 2) Verschieben
with heute as (select public.ehfy_today_course() as id)
update public.registrations r
   set course_id = (select id from heute),
       status = case when r.status in ('angemeldet', 'nicht_erschienen') then 'teilgenommen' else r.status end
  from public.courses c
 where c.id = r.course_id
   and (r.checkin_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
   and (c.starts_at at time zone 'Europe/Berlin')::date <> (now() at time zone 'Europe/Berlin')::date
   and r.status <> 'storniert'
returning r.first_name, r.last_name;
