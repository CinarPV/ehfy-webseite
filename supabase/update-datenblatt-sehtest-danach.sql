-- QR-Datenblatt: Die Sehtest-Frage kommt erst NACH dem Unterschreiben (nicht mehr im Datenblatt).
-- Diese Funktion speichert die Antwort beim gerade eingetragenen Schüler. Einmal im Supabase SQL Editor ausführen. Löscht nichts.

create or replace function public.checkin_set_package(
  p_token uuid, p_first_name text, p_last_name text, p_birth_date date, p_package text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_general boolean;
begin
  v_general := p_token is not null and exists (select 1 from public.checkin_settings where id = 1 and token = p_token);
  if p_token is null or (not v_general and not exists (select 1 from public.courses where checkin_token = p_token)) then
    raise exception 'Dieser QR-Code ist nicht mehr gültig. Bitte wende dich an deinen Kursleiter.';
  end if;
  -- Nur der Eintrag, der gerade (letzte 30 Minuten) über das Datenblatt kam
  select r.id into v_id from public.registrations r
   where r.checkin_at > now() - interval '30 minutes'
     and r.birth_date = p_birth_date
     and public.ehfy_name_key(r.last_name) = public.ehfy_name_key(p_last_name)
     and public.ehfy_name_key(r.first_name) = public.ehfy_name_key(p_first_name)
     and (v_general or r.course_id in (select id from public.courses where checkin_token = p_token))
   order by r.checkin_at desc limit 1;
  if v_id is null then return false; end if;
  update public.registrations set package = case when p_package = 'komplett' then 'komplett' else 'kurs' end where id = v_id;
  return true;
end $$;
revoke execute on function public.checkin_set_package(uuid, text, text, date, text) from public;
grant execute on function public.checkin_set_package(uuid, text, text, date, text) to anon, authenticated;
