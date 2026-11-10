-- Live-Aktualisierung der Verwaltung: neue Anmeldungen und QR-Eintragungen erscheinen sofort, ohne „Synchronisieren“.
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts. (Lesen dürfen weiterhin nur angemeldete Verwalter.)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'registrations') then
    alter publication supabase_realtime add table public.registrations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'courses') then
    alter publication supabase_realtime add table public.courses;
  end if;
end $$;
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
