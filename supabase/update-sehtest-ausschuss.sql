-- Sehtest-Protokoll, Teil 5: Nummer ändern ohne Nachrücken bestätigter Nummern, „Ausschuss“.
-- Bestätigte Nummern bleiben, wie sie sind. Ist die gewünschte Nummer belegt, kann der andere Eintrag
-- als Ausschuss markiert werden (Schüler wollte doch keins / Bescheinigung verschrieben). Seine Nummer wird dann frei.
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts.

alter table public.registrations add column if not exists sehtest_void_at timestamptz;
alter table public.registrations add column if not exists sehtest_void_nr text;
alter table public.registrations add column if not exists sehtest_void_reason text;

-- Nummernvergabe wie bisher; eine vergebene Nummer darf jetzt nur beim Ausschuss leer werden
create or replace function public.assign_sehtest_nr()
returns trigger language plpgsql security definer set search_path = public as $$
declare y int; yy text; n int; used int; nx text;
begin
  if tg_op = 'UPDATE' and old.sehtest_nr is not null and coalesce(trim(new.sehtest_nr), '') = '' and new.sehtest_void_at is null then
    new.sehtest_nr := old.sehtest_nr;
    new.sehtest_nr_at := old.sehtest_nr_at;
  end if;
  if tg_op = 'UPDATE' and new.sehtest_nr is distinct from old.sehtest_nr and new.sehtest_nr is not null then
    new.sehtest_nr := trim(new.sehtest_nr);
    new.sehtest_nr_at := now();
    select next_nr into nx from public.sehtest_settings where id = 1 for update;
    if nx is not null and new.sehtest_nr ~ '[0-9]+$'
       and regexp_replace(new.sehtest_nr, '[0-9]+$', '') = regexp_replace(nx, '[0-9]+$', '')
       and (substring(new.sehtest_nr from '([0-9]+)$'))::bigint >= (substring(nx from '([0-9]+)$'))::bigint then
      update public.sehtest_settings set next_nr = public.sehtest_nr_plus(new.sehtest_nr, 1) where id = 1;
    end if;
  end if;
  -- Neue Nummer beim ersten bestätigten Ergebnis (nicht für Ausschuss)
  if new.sehtest_passed is not null and new.sehtest_nr is null and new.sehtest_void_at is null
     and (tg_op = 'INSERT' or old.sehtest_passed is distinct from new.sehtest_passed) then
    select next_nr into nx from public.sehtest_settings where id = 1 for update;
    if nx is not null then
      while exists (select 1 from public.registrations where sehtest_nr = nx) loop
        nx := public.sehtest_nr_plus(nx, 1);
      end loop;
      new.sehtest_nr := nx;
      update public.sehtest_settings set next_nr = public.sehtest_nr_plus(nx, 1) where id = 1;
    else
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

-- Als Ausschuss markieren: Nummer wird frei, bleibt aber zur Nachvollziehbarkeit gespeichert
create or replace function public.void_sehtest(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_nr text;
begin
  if not public.is_admin() then raise exception 'Nicht erlaubt'; end if;
  select sehtest_nr into v_nr from public.registrations where id = p_id;
  update public.registrations
     set sehtest_void_at = now(), sehtest_void_nr = coalesce(v_nr, sehtest_void_nr),
         sehtest_void_reason = nullif(left(trim(coalesce(p_reason, '')), 200), ''),
         sehtest_nr = null, sehtest_issued_at = null, sehtest_reissue = false
   where id = p_id;
  return v_nr;
end $$;
revoke execute on function public.void_sehtest(uuid, text) from public, anon;
grant execute on function public.void_sehtest(uuid, text) to authenticated;

-- Nummer eines Sehtests ändern. Andere Nummern bleiben unverändert.
-- Ist die Nummer belegt: Fehler „BELEGT|Name|bestätigt am“, außer p_void_other = true (dann wird der andere Ausschuss).
create or replace function public.set_sehtest_nr(p_id uuid, p_new text, p_void_other boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if not public.is_admin() then raise exception 'Nicht erlaubt'; end if;
  p_new := trim(coalesce(p_new, ''));
  if p_new !~ '[0-9]+$' then raise exception 'Die Nummer muss mit einer Zahl enden, z. B. 3869.'; end if;
  select id, first_name, last_name, sehtest_issued_at into o from public.registrations where sehtest_nr = p_new and id <> p_id;
  if o.id is not null then
    if not p_void_other then
      raise exception 'BELEGT|%|%', o.first_name || ' ' || o.last_name, case when o.sehtest_issued_at is null then 'nein' else 'ja' end;
    end if;
    perform public.void_sehtest(o.id, 'Nummer an anderen Sehtest vergeben');
  end if;
  update public.registrations set sehtest_nr = p_new, sehtest_void_at = null where id = p_id;
  return p_new;
end $$;
revoke execute on function public.set_sehtest_nr(uuid, text, boolean) from public, anon;
grant execute on function public.set_sehtest_nr(uuid, text, boolean) to authenticated;
