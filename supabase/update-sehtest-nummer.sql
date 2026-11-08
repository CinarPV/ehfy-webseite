-- Sehtest-Protokoll, Teil 2: Kreuze speichern, Nummer von Hand änderbar, aber nie doppelt.
-- Einmal im Supabase SQL Editor ausführen (nach update-sehtest-protokoll.sql). Löscht nichts.

alter table public.registrations add column if not exists sehtest_marks jsonb;

-- Jede Protokoll-Nummer darf es nur einmal geben
create unique index if not exists registrations_sehtest_nr_key
  on public.registrations (sehtest_nr) where sehtest_nr is not null;

create or replace function public.assign_sehtest_nr()
returns trigger language plpgsql security definer set search_path = public as $$
declare y int; yy text; n int; used int;
begin
  -- Eine vergebene Nummer kann geändert, aber nicht gelöscht werden
  if tg_op = 'UPDATE' and old.sehtest_nr is not null and coalesce(trim(new.sehtest_nr), '') = '' then
    new.sehtest_nr := old.sehtest_nr;
    new.sehtest_nr_at := old.sehtest_nr_at;
  end if;
  if tg_op = 'UPDATE' and new.sehtest_nr is distinct from old.sehtest_nr then
    new.sehtest_nr := trim(new.sehtest_nr);
    new.sehtest_nr_at := now();
  end if;
  -- Neue Nummer beim ersten Ergebnis: weiter nach der höchsten schon vergebenen Nummer des Jahres
  if new.sehtest_passed is not null and new.sehtest_nr is null
     and (tg_op = 'INSERT' or old.sehtest_passed is distinct from new.sehtest_passed) then
    y := extract(year from coalesce(new.sehtest_on, (now() at time zone 'Europe/Berlin')::date));
    yy := right(y::text, 2);
    insert into public.sehtest_counters (year, last) values (y, 0) on conflict (year) do nothing;
    select last into n from public.sehtest_counters where year = y for update;
    select coalesce(max(substring(sehtest_nr from '^S' || yy || '-([0-9]+)$')::int), 0) into used
      from public.registrations where sehtest_nr like 'S' || yy || '-%';
    n := greatest(n, used) + 1;
    while exists (select 1 from public.registrations where sehtest_nr = 'S' || yy || '-' || lpad(n::text, 3, '0')) loop
      n := n + 1;
    end loop;
    update public.sehtest_counters set last = n where year = y;
    new.sehtest_nr := 'S' || yy || '-' || lpad(n::text, 3, '0');
    new.sehtest_nr_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.assign_sehtest_nr() from public, anon, authenticated;
