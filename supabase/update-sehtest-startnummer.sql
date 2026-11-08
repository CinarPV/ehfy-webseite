-- Sehtest-Protokoll, Teil 3: Startnummer frei wählbar (z. B. 1250 oder S26-045), danach fortlaufend.
-- Die Nummer wird erst vergeben, wenn ein Ergebnis bestätigt ist. Jede Nummer gibt es nur einmal.
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts.

create table if not exists public.sehtest_settings (
  id int primary key default 1 check (id = 1),
  next_nr text
);
alter table public.sehtest_settings enable row level security;
drop policy if exists admin_sehtest_settings on public.sehtest_settings;
create policy admin_sehtest_settings on public.sehtest_settings
  for select to authenticated using (public.is_admin());

-- Nummer um k weiterzählen: die Ziffern am Ende hochzählen, Vorsatz und führende Nullen bleiben (S26-009 → S26-010, 1250 → 1251)
create or replace function public.sehtest_nr_plus(nr text, k int)
returns text language sql immutable set search_path = public as $$
  select case when nr ~ '[0-9]+$' then
    regexp_replace(nr, '[0-9]+$', '')
      || lpad(((substring(nr from '([0-9]+)$'))::bigint + k)::text, length(substring(nr from '([0-9]+)$')), '0')
  else nr || k::text end
$$;

-- Nächste Nummer festlegen (nur Verwaltung)
create or replace function public.set_next_sehtest_nr(p_next text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nicht erlaubt'; end if;
  p_next := trim(coalesce(p_next, ''));
  if p_next !~ '[0-9]$' then raise exception 'Die Nummer muss mit einer Zahl enden, z. B. 1250 oder S26-045.'; end if;
  if exists (select 1 from public.registrations where sehtest_nr = p_next) then
    raise exception 'Die Nummer % ist schon vergeben.', p_next;
  end if;
  insert into public.sehtest_settings (id, next_nr) values (1, p_next)
    on conflict (id) do update set next_nr = excluded.next_nr;
  return p_next;
end $$;
revoke execute on function public.set_next_sehtest_nr(text) from public, anon;
grant execute on function public.set_next_sehtest_nr(text) to authenticated;

-- Nächste Nummer abfragen (nur Verwaltung); belegte Nummern werden übersprungen
create or replace function public.get_next_sehtest_nr()
returns text language plpgsql stable security definer set search_path = public as $$
declare nx text;
begin
  if not public.is_admin() then raise exception 'Nicht erlaubt'; end if;
  select next_nr into nx from public.sehtest_settings where id = 1;
  if nx is null then return null; end if;
  while exists (select 1 from public.registrations where sehtest_nr = nx) loop
    nx := public.sehtest_nr_plus(nx, 1);
  end loop;
  return nx;
end $$;
revoke execute on function public.get_next_sehtest_nr() from public, anon;
grant execute on function public.get_next_sehtest_nr() to authenticated;

create or replace function public.assign_sehtest_nr()
returns trigger language plpgsql security definer set search_path = public as $$
declare y int; yy text; n int; used int; nx text;
begin
  -- Eine vergebene Nummer kann geändert, aber nicht gelöscht werden
  if tg_op = 'UPDATE' and old.sehtest_nr is not null and coalesce(trim(new.sehtest_nr), '') = '' then
    new.sehtest_nr := old.sehtest_nr;
    new.sehtest_nr_at := old.sehtest_nr_at;
  end if;
  -- Von Hand geänderte Nummer: Liegt sie hinter der nächsten Nummer, wird ab ihr weitergezählt
  if tg_op = 'UPDATE' and new.sehtest_nr is distinct from old.sehtest_nr then
    new.sehtest_nr := trim(new.sehtest_nr);
    new.sehtest_nr_at := now();
    select next_nr into nx from public.sehtest_settings where id = 1 for update;
    if nx is not null and new.sehtest_nr ~ '[0-9]+$'
       and regexp_replace(new.sehtest_nr, '[0-9]+$', '') = regexp_replace(nx, '[0-9]+$', '')
       and (substring(new.sehtest_nr from '([0-9]+)$'))::bigint >= (substring(nx from '([0-9]+)$'))::bigint then
      update public.sehtest_settings set next_nr = public.sehtest_nr_plus(new.sehtest_nr, 1) where id = 1;
    end if;
  end if;
  -- Neue Nummer beim ersten bestätigten Ergebnis
  if new.sehtest_passed is not null and new.sehtest_nr is null
     and (tg_op = 'INSERT' or old.sehtest_passed is distinct from new.sehtest_passed) then
    select next_nr into nx from public.sehtest_settings where id = 1 for update;
    if nx is not null then
      -- Ab der eingestellten Startnummer fortlaufend; schon belegte Nummern überspringen
      while exists (select 1 from public.registrations where sehtest_nr = nx) loop
        nx := public.sehtest_nr_plus(nx, 1);
      end loop;
      new.sehtest_nr := nx;
      update public.sehtest_settings set next_nr = public.sehtest_nr_plus(nx, 1) where id = 1;
    else
      -- Ohne Startnummer wie bisher: S26-001, S26-002 …
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
    end if;
    new.sehtest_nr_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.assign_sehtest_nr() from public, anon, authenticated;
