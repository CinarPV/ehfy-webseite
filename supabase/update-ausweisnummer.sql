-- Ausweisnummer zum Sehtest (nur für das Verwaltungs-Konto lesbar). Löscht nichts.
alter table public.registrations add column if not exists sehtest_id_no text;
