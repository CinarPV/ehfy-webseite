-- Sehtest-Protokoll: Verlauf, Sehhilfe, Ausweisdokument und fortlaufende Protokollnummer.
-- Die Nummer vergibt die Datenbank erst, wenn „bestanden“ oder „nicht bestanden“ gesetzt wird.
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts.

alter table public.registrations add column if not exists sehtest_flow text;      -- 'fluessig' oder 'zoegerlich'
alter table public.registrations add column if not exists sehtest_aid_kind text;  -- 'ohne', 'brille' oder 'linse'
alter table public.registrations add column if not exists sehtest_id_doc text;    -- 'personalausweis', 'reisepass', 'fuehrerschein', 'aufenthaltstitel'
alter table public.registrations add column if not exists sehtest_nr text;
alter table public.registrations add column if not exists sehtest_nr_at timestamptz;

-- Zähler je Jahr (nur die Datenbank selbst schreibt hinein)
create table if not exists public.sehtest_counters (
  year int primary key,
  last int not null default 0
);
alter table public.sehtest_counters enable row level security;

create or replace function public.assign_sehtest_nr()
returns trigger language plpgsql security definer set search_path = public as $$
declare y int; n int;
begin
  -- Eine einmal vergebene Nummer bleibt; neu vergeben wird nur, wenn zum ersten Mal ein Ergebnis gesetzt wird
  if new.sehtest_passed is not null and new.sehtest_nr is null
     and (tg_op = 'INSERT' or old.sehtest_passed is distinct from new.sehtest_passed) then
    y := extract(year from coalesce(new.sehtest_on, (now() at time zone 'Europe/Berlin')::date));
    insert into public.sehtest_counters (year, last) values (y, 1)
      on conflict (year) do update set last = public.sehtest_counters.last + 1
      returning last into n;
    new.sehtest_nr := 'S' || right(y::text, 2) || '-' || lpad(n::text, 3, '0');
    new.sehtest_nr_at := now();
  end if;
  -- Die Nummer kann von außen nicht verändert werden
  if tg_op = 'UPDATE' and old.sehtest_nr is not null then
    new.sehtest_nr := old.sehtest_nr;
    new.sehtest_nr_at := old.sehtest_nr_at;
  end if;
  return new;
end $$;
revoke execute on function public.assign_sehtest_nr() from public, anon, authenticated;

drop trigger if exists sehtest_nr on public.registrations;
create trigger sehtest_nr before insert or update on public.registrations
  for each row execute function public.assign_sehtest_nr();
