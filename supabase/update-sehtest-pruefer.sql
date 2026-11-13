-- Sehtest-Protokoll: Name des Prüfers je Protokoll (Auswahl aus den Einstellungen).
-- Einmal im Supabase SQL Editor ausführen (auch erneut möglich). Löscht nichts.
alter table public.registrations add column if not exists sehtest_examiner text;
