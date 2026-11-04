-- Anmeldung ohne Adresse: einmal im Supabase SQL Editor ausführen.
create or replace function public.register_for_course(
  p_course_id uuid, p_first_name text, p_last_name text, p_birth_date date,
  p_email text, p_phone text, p_street text, p_zip text, p_city text,
  p_package text, p_message text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  c public.courses;
  n int;
  tok uuid;
begin
  select * into c from public.courses where id = p_course_id for update;
  if not found or c.status <> 'offen' or c.starts_at <= now() then
    raise exception 'Dieser Termin ist nicht mehr buchbar.';
  end if;
  if not c.online_booking then
    raise exception 'Für diesen Termin ist nur eine telefonische Anmeldung möglich.';
  end if;
  select count(*) into n from public.registrations
   where course_id = c.id and status <> 'storniert';
  if n >= c.capacity then
    raise exception 'Dieser Termin ist leider ausgebucht.';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = ''
     or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Bitte gib deinen Namen und eine gültige E-Mail-Adresse an.';
  end if;
  if p_package not in ('kurs', 'komplett') then
    raise exception 'Bitte wähle ein gültiges Paket.';
  end if;
  -- einfacher Schutz vor Doppelanmeldungen
  if exists (select 1 from public.registrations
              where course_id = c.id and status <> 'storniert'
                and lower(email) = lower(trim(p_email))
                and lower(last_name) = lower(trim(p_last_name))
                and lower(first_name) = lower(trim(p_first_name))) then
    raise exception 'Du bist für diesen Termin bereits angemeldet.';
  end if;

  insert into public.registrations
    (course_id, first_name, last_name, birth_date, email, phone, street, zip, city, package, message)
  values
    (c.id, left(trim(p_first_name), 80), left(trim(p_last_name), 80), p_birth_date,
     left(trim(p_email), 120), nullif(left(trim(coalesce(p_phone, '')), 40), ''),
     left(trim(p_street), 120), p_zip, left(trim(p_city), 80),
     p_package, nullif(left(trim(coalesce(p_message, '')), 1000), ''))
  returning cancel_token into tok;

  return json_build_object('cancel_token', tok, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
                           'location', c.location, 'address', c.address);
end $$;
