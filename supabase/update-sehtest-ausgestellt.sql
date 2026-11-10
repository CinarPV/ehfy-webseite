-- Sehtest-Protokoll, Teil 4: „Bescheinigung ausgestellt“ macht die Nummer fest.
-- Nummer ändern zählt alle späteren Nummern mit; schon ausgestellte werden zum Neu-Ausstellen markiert.
-- Startnummer 3868. Einmal im Supabase SQL Editor ausführen. Löscht nichts.

alter table public.registrations add column if not exists sehtest_issued_at timestamptz;
alter table public.registrations add column if not exists sehtest_reissue boolean not null default false;

-- Nummer eines Sehtests ändern; alle späteren Nummern (gleicher Vorsatz, höhere Zahl) rücken fortlaufend nach.
-- Rückgabe: Liste der schon ausgestellten Bescheinigungen, deren Nummer sich geändert hat.
create or replace function public.renumber_sehtest(p_id uuid, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old text; v_pre text; v_oldn bigint; v_ids uuid[]; v_olds text[]; v_nf int; v_clash text; v_nr text;
  v_out jsonb := '[]'::jsonb; v_row record; i int;
begin
  if not public.is_admin() then raise exception 'Nicht erlaubt'; end if;
  p_new := trim(coalesce(p_new, ''));
  if p_new !~ '[0-9]+$' then raise exception 'Die Nummer muss mit einer Zahl enden, z. B. 3868.'; end if;
  select sehtest_nr into v_old from public.registrations where id = p_id;
  if v_old is null then raise exception 'Dieser Sehtest hat noch keine Nummer.'; end if;
  if v_old = p_new then return v_out; end if;
  v_pre := regexp_replace(v_old, '[0-9]+$', '');
  v_oldn := coalesce(substring(v_old from '([0-9]+)$')::bigint, -1);

  -- Spätere Nummern in ihrer Reihenfolge
  select coalesce(array_agg(x.id order by substring(x.sehtest_nr from '([0-9]+)$')::bigint), '{}'),
         coalesce(array_agg(x.sehtest_nr order by substring(x.sehtest_nr from '([0-9]+)$')::bigint), '{}')
    into v_ids, v_olds
    from public.registrations x
   where x.id <> p_id and x.sehtest_nr ~ '[0-9]+$'
     and regexp_replace(x.sehtest_nr, '[0-9]+$', '') = v_pre
     and substring(x.sehtest_nr from '([0-9]+)$')::bigint > v_oldn;
  v_nf := coalesce(array_length(v_ids, 1), 0);

  -- Neue Nummern dürfen nicht bei anderen Sehtests vorkommen
  select x.sehtest_nr into v_clash from public.registrations x
   where x.id <> p_id and not (x.id = any(v_ids))
     and x.sehtest_nr in (select public.sehtest_nr_plus(p_new, g) from generate_series(0, v_nf) g)
   limit 1;
  if v_clash is not null then raise exception 'Die Nummer % ist schon vergeben.', v_clash; end if;

  -- Erst kurz parken (damit sich keine Nummern in die Quere kommen), dann fortlaufend neu setzen
  update public.registrations set sehtest_nr = '~' || id::text || '~' where id = p_id or id = any(v_ids);
  update public.registrations
     set sehtest_nr = p_new, sehtest_reissue = sehtest_reissue or sehtest_issued_at is not null
   where id = p_id;
  for i in 1 .. v_nf loop
    v_nr := public.sehtest_nr_plus(p_new, i);
    update public.registrations
       set sehtest_nr = v_nr, sehtest_reissue = sehtest_reissue or (sehtest_issued_at is not null and v_nr <> v_olds[i])
     where id = v_ids[i];
  end loop;

  -- Fortlaufend weiter nach der letzten Nummer
  insert into public.sehtest_settings (id, next_nr) values (1, public.sehtest_nr_plus(p_new, v_nf + 1))
    on conflict (id) do update set next_nr = excluded.next_nr;

  for v_row in
    select x.first_name, x.last_name, x.sehtest_nr from public.registrations x
     where (x.id = p_id or x.id = any(v_ids)) and x.sehtest_issued_at is not null and x.sehtest_reissue
     order by substring(x.sehtest_nr from '([0-9]+)$')::bigint
  loop
    v_out := v_out || jsonb_build_object('name', v_row.first_name || ' ' || v_row.last_name, 'nr', v_row.sehtest_nr);
  end loop;
  return v_out;
end $$;
revoke execute on function public.renumber_sehtest(uuid, text) from public, anon;
grant execute on function public.renumber_sehtest(uuid, text) to authenticated;

-- Startnummer 3868 (nur wenn sie noch frei ist)
insert into public.sehtest_settings (id, next_nr)
  select 1, '3868' where not exists (select 1 from public.registrations where sehtest_nr = '3868')
  on conflict (id) do update set next_nr = excluded.next_nr;

-- Zur Kontrolle: nächste Nummer und schon vergebene Nummern
select (select next_nr from public.sehtest_settings where id = 1) as naechste_nummer,
       (select count(*) from public.registrations where sehtest_nr is not null) as schon_vergeben;
