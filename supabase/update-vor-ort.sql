-- Selbsteintragung vor Ort per QR-Code: Schüler tippen ihre Daten am eigenen Handy ein und unterschreiben mit dem Finger.
-- Kein Foto, keine Kamera. Gespeichert werden nur die Angaben und die Unterschrift (als Bild der Linie).
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts.

alter table public.courses add column if not exists checkin_token uuid;
alter table public.registrations add column if not exists signature_png text;
alter table public.registrations add column if not exists checkin_at timestamptz;

-- Geheimer Schlüssel je Kurs für den QR-Code (nur Verwaltung). p_new = true macht einen neuen, der alte QR-Code gilt dann nicht mehr.
create or replace function public.checkin_token(p_course uuid, p_new boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not public.is_admin() then raise exception 'Nicht erlaubt'; end if;
  select checkin_token into t from public.courses where id = p_course;
  if not found then raise exception 'Termin nicht gefunden.'; end if;
  if t is null or p_new then
    t := gen_random_uuid();
    update public.courses set checkin_token = t where id = p_course;
  end if;
  return t;
end $$;
revoke execute on function public.checkin_token(uuid, boolean) from public, anon;
grant execute on function public.checkin_token(uuid, boolean) to authenticated;

-- Gültig nur für Kurse von vor 2 Tagen bis in 14 Tagen, nicht abgesagt
create or replace function public.checkin_find(p_token uuid)
returns public.courses language sql stable security definer set search_path = public as $$
  select c.* from public.courses c
   where p_token is not null and c.checkin_token = p_token and c.status <> 'abgesagt'
     and (c.starts_at at time zone 'Europe/Berlin')::date
         between (now() at time zone 'Europe/Berlin')::date - 2 and (now() at time zone 'Europe/Berlin')::date + 14
   limit 1
$$;
revoke execute on function public.checkin_find(uuid) from public, anon, authenticated;

-- Für die Seite der Schüler: nur Datum und Uhrzeit (Ort steht immer als Siegen)
create or replace function public.checkin_course(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.courses;
begin
  c := public.checkin_find(p_token);
  if c.id is null then return null; end if;
  return jsonb_build_object('starts_at', c.starts_at, 'ends_at', c.ends_at);
end $$;
grant execute on function public.checkin_course(uuid) to anon, authenticated;

create or replace function public.checkin_register(
  p_token uuid, p_first_name text, p_last_name text, p_birth_date date,
  p_street text, p_zip text, p_city text, p_phone text, p_email text, p_package text, p_signature text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.courses; v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  c := public.checkin_find(p_token);
  if c.id is null then raise exception 'Dieser QR-Code ist nicht mehr gültig. Bitte wende dich an deinen Kursleiter.'; end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then raise exception 'Bitte Vor- und Nachname eintragen.'; end if;
  if p_birth_date is null or p_birth_date > v_today or p_birth_date < date '1900-01-01' then raise exception 'Bitte das Geburtsdatum prüfen.'; end if;
  if coalesce(trim(p_street), '') = '' or coalesce(trim(p_zip), '') = '' or coalesce(trim(p_city), '') = '' then raise exception 'Bitte die vollständige Adresse eintragen.'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 400000 then raise exception 'Bitte unterschreiben.'; end if;
  if exists (select 1 from public.registrations r
              where r.course_id = c.id and r.status <> 'storniert'
                and lower(r.first_name) = lower(trim(p_first_name)) and lower(r.last_name) = lower(trim(p_last_name))
                and r.birth_date = p_birth_date) then
    raise exception 'Du bist für diesen Kurs schon eingetragen.';
  end if;
  insert into public.registrations
    (course_id, first_name, last_name, birth_date, street, zip, city, phone, email, package, status, message, signature_png, checkin_at)
  values
    (c.id, left(trim(p_first_name), 80), left(trim(p_last_name), 80), p_birth_date,
     left(trim(p_street), 120), left(trim(p_zip), 10), left(trim(p_city), 80),
     nullif(left(trim(coalesce(p_phone, '')), 40), ''), nullif(left(trim(coalesce(p_email, '')), 120), ''),
     case when p_package = 'komplett' then 'komplett' else 'kurs' end,
     case when (c.starts_at at time zone 'Europe/Berlin')::date <= v_today then 'teilgenommen' else 'angemeldet' end,
     'manuell eingetragen', -- keine Anmelde-Mail
     p_signature, now());
  return trim(p_first_name);
end $$;
grant execute on function public.checkin_register(uuid, text, text, date, text, text, text, text, text, text, text) to anon, authenticated;
