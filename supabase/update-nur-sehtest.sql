-- Personen, die nur zum Sehtest kommen (ohne Erste-Hilfe-Kurs).
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts.
alter table public.registrations add column if not exists sehtest_only boolean not null default false;
