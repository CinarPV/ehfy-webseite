-- Schülerdatenbank: Sehtest und Protokoll je Anmeldung. Einmal im Supabase SQL Editor ausführen.
alter table public.registrations add column if not exists sehtest_on date;
alter table public.registrations add column if not exists sehtest_none boolean not null default false;
alter table public.registrations add column if not exists protocol_added_on date;
alter table public.registrations add column if not exists fee_state text;
alter table public.registrations add column if not exists fee_state_at timestamptz;
alter table public.registrations add column if not exists chance_until date;
alter table public.registrations add column if not exists sehtest_passed boolean;
alter table public.registrations add column if not exists sehtest_aid boolean;
alter table public.courses add column if not exists cancel_reason text;
alter table public.courses add column if not exists cancel_notified_at timestamptz;
