-- QR-Datenblatt hat Vorrang: Steht der Schüler im gewählten Kurs schon drin (Online-Anmeldung oder von Hand eingetragen),
-- wird KEIN zweiter Eintrag angelegt. Stattdessen werden Name, Geburtsdatum und Adresse durch die Angaben vom Datenblatt ersetzt,
-- Telefon/E-Mail ergänzt (wenn angegeben), Unterschrift gespeichert.
-- Alles andere bleibt: Paket, Sehtest, Sehtest-Protokoll und -Nummer, Gebühren, Rabatt, Notizen.
-- Bescheinigungen, Protokoll und neue Quittungen nehmen danach automatisch die neuen Daten.
-- Außerdem: E-Mail ist beim Datenblatt Pflicht (für Quittung oder Rechnung).
-- Einmal im Supabase SQL Editor ausführen (auch erneut möglich). Löscht nichts.

-- Name vergleichbar machen: klein, ohne Akzente, ü = ue = u (Görgülü = Goerguelue = Gorgulu), ohne Leerzeichen, Bindestriche usw.
create or replace function public.ehfy_name_key(p text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(regexp_replace(
    replace(
      translate(lower(coalesce(p, '')),
        'äöüáàâãåāăąçćčďéèêëēėęěğíìîïīıłñńňóòôõøōőŕřśšşșťţțúùûūůűųýÿźżž',
        'aouaaaaaaaacccdeeeeeeeegiiiiiilnnnooooooorrsssstttuuuuuuuyyzzz'),
      'ß', 'ss'),
    '[^a-z]', '', 'g'), 'ae', 'a'), 'oe', 'o'), 'ue', 'u')
$$;

-- Passt ein Vorname zum anderen? Gleich, oder einer steckt im anderen (z. B. „Carla“ und „Carla Maria“).
create or replace function public.ehfy_first_fits(a text, b text)
returns boolean language sql immutable set search_path = public as $$
  select public.ehfy_name_key(a) <> '' and public.ehfy_name_key(b) <> ''
     and (public.ehfy_name_key(a) = public.ehfy_name_key(b)
          or (length(public.ehfy_name_key(a)) >= 3 and position(public.ehfy_name_key(a) in public.ehfy_name_key(b)) > 0)
          or (length(public.ehfy_name_key(b)) >= 3 and position(public.ehfy_name_key(b) in public.ehfy_name_key(a)) > 0))
$$;

create or replace function public.checkin_insert(
  c public.courses, p_first_name text, p_last_name text, p_birth_date date,
  p_street text, p_zip text, p_city text, p_phone text, p_email text, p_package text, p_signature text)
returns text language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Europe/Berlin')::date; v_day date; v_id uuid;
begin
  if c.id is null then raise exception 'Dieser QR-Code ist nicht mehr gültig. Bitte wende dich an deinen Kursleiter.'; end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then raise exception 'Bitte Vor- und Nachname eintragen.'; end if;
  if p_birth_date is null or p_birth_date > v_today or p_birth_date < date '1900-01-01' then raise exception 'Bitte das Geburtsdatum prüfen.'; end if;
  if coalesce(trim(p_street), '') = '' or coalesce(trim(p_zip), '') = '' or coalesce(trim(p_city), '') = '' then raise exception 'Bitte die vollständige Adresse eintragen.'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 400000 then raise exception 'Bitte unterschreiben.'; end if;
  -- E-Mail ist Pflicht (für Quittung oder Rechnung)
  if coalesce(trim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Bitte deine E-Mail-Adresse eintragen (für Quittung oder Rechnung).'; end if;
  v_day := (c.starts_at at time zone 'Europe/Berlin')::date;

  -- Schon im Kurs? Nachname gleich und Vorname passt, oder Vor-/Nachname vertauscht, oder Nachname + Geburtsdatum gleich.
  select r.id into v_id from public.registrations r
   where r.course_id = c.id and r.status <> 'storniert'
     and (
       (public.ehfy_name_key(r.last_name) = public.ehfy_name_key(p_last_name) and public.ehfy_first_fits(r.first_name, p_first_name))
       or (public.ehfy_name_key(r.last_name) = public.ehfy_name_key(p_first_name) and public.ehfy_name_key(r.first_name) = public.ehfy_name_key(p_last_name))
       or (public.ehfy_name_key(r.last_name) = public.ehfy_name_key(p_last_name) and r.birth_date = p_birth_date)
     )
   order by (r.birth_date = p_birth_date) desc nulls last, (r.checkin_at is null) desc, r.created_at
   limit 1;

  if v_id is not null then
    update public.registrations set
      first_name = left(trim(p_first_name), 80),
      last_name = left(trim(p_last_name), 80),
      birth_date = p_birth_date,
      street = left(trim(p_street), 120),
      zip = left(trim(p_zip), 10),
      city = left(trim(p_city), 80),
      phone = coalesce(nullif(left(trim(coalesce(p_phone, '')), 40), ''), phone),
      email = coalesce(nullif(left(trim(coalesce(p_email, '')), 120), ''), email),
      status = case when v_day <= v_today and status in ('angemeldet', 'nicht_erschienen') then 'teilgenommen' else status end,
      signature_png = p_signature,
      checkin_at = now()
    where id = v_id;
    return trim(p_first_name);
  end if;

  insert into public.registrations
    (course_id, first_name, last_name, birth_date, street, zip, city, phone, email, package, status, message, signature_png, checkin_at)
  values
    (c.id, left(trim(p_first_name), 80), left(trim(p_last_name), 80), p_birth_date,
     left(trim(p_street), 120), left(trim(p_zip), 10), left(trim(p_city), 80),
     nullif(left(trim(coalesce(p_phone, '')), 40), ''), nullif(left(trim(coalesce(p_email, '')), 120), ''),
     case when p_package = 'komplett' then 'komplett' else 'kurs' end,
     case when v_day <= v_today then 'teilgenommen' else 'angemeldet' end,
     'manuell eingetragen', -- keine Anmelde-Mail
     p_signature, now());
  return trim(p_first_name);
end $$;
revoke execute on function public.checkin_insert(public.courses, text, text, date, text, text, text, text, text, text, text) from public, anon, authenticated;
