-- Erste Hilfe for you – Datenbank einrichten
-- Komplett in Supabase unter "SQL Editor" einfügen und auf "Run" klicken.

create extension if not exists pgcrypto;

-- ---------- Tabellen ----------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default 'Siegen',
  address text not null default 'Selims Fahrschule, Hagener Straße 20, 57072 Siegen',
  capacity int not null default 12 check (capacity between 0 and 999),
  online_booking boolean not null default true,
  status text not null default 'offen' check (status in ('offen', 'abgesagt')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date,
  email text,
  phone text,
  street text,
  zip text,
  city text,
  package text not null default 'kurs' check (package in ('kurs', 'komplett')),
  message text,
  status text not null default 'angemeldet'
    check (status in ('angemeldet', 'teilgenommen', 'nicht_erschienen', 'storniert')),
  cancel_token uuid not null unique default gen_random_uuid(),
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists registrations_course_idx on public.registrations(course_id);
-- Falls die Tabelle schon ohne Anschrift angelegt wurde:
alter table public.registrations add column if not exists street text;
alter table public.registrations add column if not exists zip text;
alter table public.registrations add column if not exists city text;

-- Wer hier eingetragen ist, darf die Verwaltung benutzen.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ---------- Rechte ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.courses enable row level security;
alter table public.registrations enable row level security;
alter table public.admins enable row level security;

drop policy if exists "admin_courses" on public.courses;
create policy "admin_courses" on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_registrations" on public.registrations;
create policy "admin_registrations" on public.registrations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_self" on public.admins;
create policy "admin_self" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Besucher (anon) haben KEINEN direkten Tabellenzugriff, nur über die Funktionen unten.

-- ---------- Öffentliche Funktionen ----------

-- Kommende, offene Termine inkl. Belegung (ohne genaue Adresse)
create or replace function public.get_open_courses()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, location text,
               capacity int, booked int, online_booking boolean, note text)
language sql stable security definer set search_path = public as $$
  select c.id, c.starts_at, c.ends_at, c.location, c.capacity,
         (select count(*)::int from public.registrations r
           where r.course_id = c.id and r.status <> 'storniert'),
         c.online_booking, c.note
    from public.courses c
   where c.status = 'offen' and c.starts_at > now()
   order by c.starts_at;
$$;

-- Online-Anmeldung
drop function if exists public.register_for_course(uuid, text, text, date, text, text, text, text);
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
  if coalesce(trim(p_street), '') = '' or coalesce(p_zip, '') !~ '^[0-9]{5}$' or coalesce(trim(p_city), '') = '' then
    raise exception 'Bitte gib deine vollständige Anschrift an.';
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

-- Anmeldung über Abmelde-Code anzeigen
create or replace function public.get_registration(p_token uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare res json;
begin
  select json_build_object('first_name', r.first_name, 'last_name', r.last_name, 'status', r.status,
                           'package', r.package, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
                           'location', c.location, 'course_status', c.status)
    into res
    from public.registrations r join public.courses c on c.id = r.course_id
   where r.cancel_token = p_token;
  if res is null then
    raise exception 'Anmeldung nicht gefunden. Bitte prüfe deinen Link.';
  end if;
  return res;
end $$;

-- Selbst abmelden
create or replace function public.cancel_registration(p_token uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  r public.registrations;
  c public.courses;
begin
  select * into r from public.registrations where cancel_token = p_token for update;
  if not found then
    raise exception 'Anmeldung nicht gefunden. Bitte prüfe deinen Link.';
  end if;
  if r.status <> 'angemeldet' then
    raise exception 'Diese Anmeldung wurde bereits storniert.';
  end if;
  select * into c from public.courses where id = r.course_id;
  if c.starts_at <= now() then
    raise exception 'Der Kurs hat bereits begonnen. Bitte melde dich telefonisch.';
  end if;
  update public.registrations set status = 'storniert', cancelled_at = now() where id = r.id;
  return json_build_object('late', c.starts_at - now() < interval '48 hours', 'starts_at', c.starts_at);
end $$;

grant execute on function public.get_open_courses() to anon, authenticated;
grant execute on function public.register_for_course(uuid, text, text, date, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_registration(uuid) to anon, authenticated;
grant execute on function public.cancel_registration(uuid) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- Rechnungen und Quittungen ----------
-- Fortlaufende Nummern je Jahr (26-04, 26-05 …). Rechnungen werden nie gelöscht,
-- sondern bei Bedarf storniert – so bleiben die Nummern lückenlos.
create table if not exists public.invoice_counters (
  year int primary key,
  last int not null default 0
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  year int not null,
  seq int not null,
  type text not null check (type in ('quittung', 'rechnung')),
  registration_id uuid references public.registrations(id) on delete set null,
  recipient jsonb not null,
  items jsonb not null,
  total numeric(10, 2) not null,
  issued_on date not null default current_date,
  service_date date,
  payment text not null default 'bar' check (payment in ('bar', 'ueberweisung')),
  status text not null default 'offen' check (status in ('offen', 'bezahlt', 'storniert')),
  paid_on date,
  created_at timestamptz not null default now()
);
create index if not exists invoices_reg_idx on public.invoices(registration_id);
-- Versand per E-Mail (wird von der Funktion "beleg-mail" eingetragen)
alter table public.invoices add column if not exists sent_at timestamptz;
alter table public.invoices add column if not exists sent_to text;
-- Pro Anmeldung höchstens eine gültige Quittung und eine gültige Rechnung
create unique index if not exists invoices_one_receipt on public.invoices(registration_id)
  where type = 'quittung' and status <> 'storniert';
create unique index if not exists invoices_one_bill on public.invoices(registration_id)
  where type = 'rechnung' and status <> 'storniert' and registration_id is not null;

-- Deine bisherigen Rechnungen gehen bis 26-03 – die neuen Nummern machen mit 26-04 weiter
insert into public.invoice_counters (year, last) values (2026, 3) on conflict (year) do nothing;

alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;

drop policy if exists "admin_read_invoices" on public.invoices;
create policy "admin_read_invoices" on public.invoices
  for select to authenticated using (public.is_admin());
drop policy if exists "admin_update_invoices" on public.invoices;
create policy "admin_update_invoices" on public.invoices
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- Nachträglich ändern lassen sich nur Status und Zahlungsdatum
revoke update on public.invoices from authenticated;
grant update (status, paid_on) on public.invoices to authenticated;

create or replace function public.create_invoice(
  p_type text, p_registration_id uuid, p_recipient jsonb, p_items jsonb,
  p_issued_on date, p_service_date date, p_payment text, p_status text)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from coalesce(p_issued_on, current_date));
  n int;
  t numeric(10, 2);
  r public.invoices;
begin
  if not public.is_admin() then
    raise exception 'Keine Berechtigung.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception 'Die Rechnung braucht mindestens eine Position.';
  end if;
  select coalesce(sum((i->>'qty')::numeric * (i->>'price')::numeric), 0) into t from jsonb_array_elements(p_items) i;

  insert into public.invoice_counters (year, last) values (y, 1)
    on conflict (year) do update set last = public.invoice_counters.last + 1
    returning last into n;

  insert into public.invoices (number, year, seq, type, registration_id, recipient, items, total,
                               issued_on, service_date, payment, status, paid_on)
  values (right(y::text, 2) || '-' || lpad(n::text, 2, '0'), y, n, p_type, p_registration_id, p_recipient, p_items, t,
          coalesce(p_issued_on, current_date), p_service_date, coalesce(p_payment, 'bar'),
          coalesce(p_status, 'offen'), case when p_status = 'bezahlt' then coalesce(p_issued_on, current_date) end)
  returning * into r;
  return r;
end $$;
grant execute on function public.create_invoice(text, uuid, jsonb, jsonb, date, date, text, text) to authenticated;

-- ---------- Geräte für Push-Mitteilungen ----------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  device text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "admin_push" on public.push_subscriptions;
create policy "admin_push" on public.push_subscriptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Bankverbindung und Steuernummer ----------
-- Stehen nicht in den öffentlichen Webseiten-Dateien, sondern nur hier (nur für das Verwaltungs-Konto).
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null
);
alter table public.app_settings enable row level security;
drop policy if exists "admin_settings" on public.app_settings;
create policy "admin_settings" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Vorlagen (Bescheinigung, Teilnehmerdatenblatt) ----------
-- Privater Speicher: nur das Verwaltungs-Konto kann die Vorlagen hochladen und lesen.
insert into storage.buckets (id, name, public) values ('vorlagen', 'vorlagen', false)
  on conflict (id) do nothing;
drop policy if exists "admin_vorlagen" on storage.objects;
create policy "admin_vorlagen" on storage.objects
  for all to authenticated
  using (bucket_id = 'vorlagen' and public.is_admin())
  with check (bucket_id = 'vorlagen' and public.is_admin());
