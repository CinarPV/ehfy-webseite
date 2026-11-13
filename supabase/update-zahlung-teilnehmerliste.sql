-- Teilnehmer: Zahlart (bar / PayPal / Überweisung) und Häkchen „auf die Teilnehmerliste“ (z. B. fürs Finanzamt).
-- Einmal im Supabase SQL Editor ausführen (auch erneut möglich). Löscht nichts.
alter table public.registrations add column if not exists payment_method text;
alter table public.registrations add column if not exists on_list boolean not null default false;
alter table public.registrations drop constraint if exists registrations_payment_method_check;
alter table public.registrations add constraint registrations_payment_method_check
  check (payment_method is null or payment_method in ('bar', 'paypal', 'ueberweisung'));
