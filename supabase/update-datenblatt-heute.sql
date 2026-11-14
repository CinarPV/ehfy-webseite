-- Teilnehmerdatenblatt (fester QR-Code): „Heute“ steht IMMER ganz oben und ist vorausgewählt, darunter die Termine.
-- Über „Anderer Tag …“ kann auch ein Tag ohne Termin gewählt werden.
-- Gibt es an dem gewählten Tag noch keinen Kurs, wird beim ersten Absenden automatisch ein INTERNER Kurs angelegt
-- (10:00–17:30, Siegen, nur telefonisch). Interne Kurse erscheinen nie im öffentlichen Kalender.
-- Ort und Uhrzeit kannst du danach in der Verwaltung anpassen.
-- Einmal im Supabase SQL Editor ausführen (auch erneut möglich). Löscht nichts.

alter table public.courses add column if not exists intern boolean not null default false;

-- Öffentlicher Kalender: interne Kurse ausblenden (sonst wie bisher)
drop function if exists public.get_open_courses();
create or replace function public.get_open_courses()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, location text,
               seats text, online_booking boolean, note text)
language sql stable security definer set search_path = public as $$
  select c.id, c.starts_at, c.ends_at, c.location,
         case when f.free <= 0 then 'voll' when f.free <= 4 then 'letzte' when f.free <= 8 then 'wenige' else 'frei' end,
         c.online_booking, c.note
    from public.courses c
    cross join lateral (
      select c.capacity - (select count(*)::int from public.registrations r
                            where r.course_id = c.id and r.status <> 'storniert') as free
    ) f
   where c.status = 'offen' and c.starts_at > now() and not c.intern
   order by c.starts_at;
$$;
grant execute on function public.get_open_courses() to anon, authenticated;

-- Kurs an einem Tag finden – oder einen internen Kurs für diesen Tag anlegen (10:00–17:30, Siegen)
create or replace function public.ehfy_day_course(p_day date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.courses
   where status <> 'abgesagt' and (starts_at at time zone 'Europe/Berlin')::date = p_day
   order by intern, starts_at limit 1;
  if v_id is null then
    insert into public.courses (starts_at, ends_at, location, address, capacity, online_booking, status, intern, note)
    values ((p_day + time '10:00') at time zone 'Europe/Berlin', (p_day + time '17:30') at time zone 'Europe/Berlin',
            'Siegen', 'Selims Fahrschule, Hagener Straße 20, 57072 Siegen', 30, false, 'offen', true,
            'Intern – automatisch über das Teilnehmerdatenblatt angelegt. Ort und Uhrzeit bitte prüfen.')
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.ehfy_day_course(date) from public, anon, authenticated;

create or replace function public.ehfy_today_course()
returns uuid language sql security definer set search_path = public as $$
  select public.ehfy_day_course((now() at time zone 'Europe/Berlin')::date)
$$;
revoke execute on function public.ehfy_today_course() from public, anon, authenticated;

-- Eintragen über den festen QR-Code mit einem TAG (heute oder ein anderer Tag ohne Kurs):
-- Kurs an diesem Tag wird genommen, sonst wird intern einer angelegt. Erlaubt: 7 Tage zurück bis 30 Tage voraus.
create or replace function public.checkin_register_day(
  p_token uuid, p_day date, p_first_name text, p_last_name text, p_birth_date date,
  p_street text, p_zip text, p_city text, p_phone text, p_email text, p_package text, p_signature text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.courses; v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if p_token is null or not exists (select 1 from public.checkin_settings where id = 1 and token = p_token) then
    raise exception 'Dieser QR-Code ist nicht mehr gültig. Bitte wende dich an deinen Kursleiter.';
  end if;
  if p_day is null or p_day < v_today - 7 or p_day > v_today + 30 then raise exception 'Bitte das Kursdatum auswählen.'; end if;
  -- Erst prüfen, damit nicht für eine fehlerhafte Eingabe ein leerer Kurs entsteht
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then raise exception 'Bitte Vor- und Nachname eintragen.'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' then raise exception 'Bitte unterschreiben.'; end if;
  if coalesce(trim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Bitte deine E-Mail-Adresse eintragen (für Quittung oder Rechnung).'; end if;
  select * into c from public.courses where id = public.ehfy_day_course(p_day);
  return public.checkin_insert(c, p_first_name, p_last_name, p_birth_date, p_street, p_zip, p_city, p_phone, p_email, p_package, p_signature);
end $$;
grant execute on function public.checkin_register_day(uuid, date, text, text, date, text, text, text, text, text, text, text) to anon, authenticated;

-- Kursliste fürs Datenblatt: wie bisher, interne Kurse von heute sind auch dabei
-- (die Seite ergänzt „heute“ selbst, wenn es noch keinen Kurs gibt)

-- Eintragen über den festen QR-Code: p_course = null bedeutet „heute“
create or replace function public.checkin_register_general(
  p_token uuid, p_course uuid, p_first_name text, p_last_name text, p_birth_date date,
  p_street text, p_zip text, p_city text, p_phone text, p_email text, p_package text, p_signature text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.courses; v_today date := (now() at time zone 'Europe/Berlin')::date; v_course uuid := p_course;
begin
  if p_token is null or not exists (select 1 from public.checkin_settings where id = 1 and token = p_token) then
    raise exception 'Dieser QR-Code ist nicht mehr gültig. Bitte wende dich an deinen Kursleiter.';
  end if;
  if v_course is null then
    -- Erst alles prüfen, damit nicht für eine fehlerhafte Eingabe ein leerer Kurs entsteht
    if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then raise exception 'Bitte Vor- und Nachname eintragen.'; end if;
    if p_signature is null or p_signature not like 'data:image/png;base64,%' then raise exception 'Bitte unterschreiben.'; end if;
    v_course := public.ehfy_today_course();
  end if;
  select * into c from public.courses
   where id = v_course and status <> 'abgesagt'
     and (starts_at at time zone 'Europe/Berlin')::date between v_today - 7 and v_today + 30;
  if c.id is null then raise exception 'Bitte das Kursdatum auswählen.'; end if;
  return public.checkin_insert(c, p_first_name, p_last_name, p_birth_date, p_street, p_zip, p_city, p_phone, p_email, p_package, p_signature);
end $$;
grant execute on function public.checkin_register_general(uuid, uuid, text, text, date, text, text, text, text, text, text, text) to anon, authenticated;
