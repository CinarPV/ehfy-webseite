-- Schülerdatenbank: Sehtest und Protokoll je Anmeldung. Einmal im Supabase SQL Editor ausführen.
alter table public.registrations add column if not exists sehtest_on date;
alter table public.registrations add column if not exists sehtest_none boolean not null default false;
alter table public.registrations add column if not exists protocol_added_on date;
