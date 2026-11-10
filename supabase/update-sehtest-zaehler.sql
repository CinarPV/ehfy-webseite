-- Sehtest-Protokoll, Teil 6: Wird ein Teilnehmer mit der zuletzt vergebenen Sehtest-Nummer gelöscht,
-- zählt die nächste Nummer wieder zurück (die Nummer wird wieder frei). Lücken mitten in der Reihe bleiben,
-- denn bestätigte Nummern anderer Sehtests werden nie verändert.
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts.

-- Zahl am Ende einer Nummer (3871 → 3871, S26-009 → 9)
create or replace function public.sehtest_nr_num(nr text)
returns bigint language sql immutable set search_path = public as $$
  select case when nr ~ '[0-9]+$' then substring(nr from '([0-9]+)$')::bigint end
$$;

-- Nächste Nummer = höchste noch vergebene Nummer + 1 (ohne vergebene: p_empty), nie unter p_floor, nie höher als bisher
create or replace function public.sehtest_next_back(p_floor text, p_empty text)
returns void language plpgsql security definer set search_path = public as $$
declare nx text; pre text; top text; cand text;
begin
  select next_nr into nx from public.sehtest_settings where id = 1 for update;
  if nx is null then return; end if;
  pre := regexp_replace(nx, '[0-9]+$', '');
  select sehtest_nr into top from public.registrations
   where sehtest_nr ~ '[0-9]+$' and regexp_replace(sehtest_nr, '[0-9]+$', '') = pre
   order by public.sehtest_nr_num(sehtest_nr) desc limit 1;
  cand := case when top is null then p_empty else public.sehtest_nr_plus(top, 1) end;
  if cand is not null and regexp_replace(cand, '[0-9]+$', '') = pre
     and public.sehtest_nr_num(cand) < public.sehtest_nr_num(nx) then
    if p_floor is not null and public.sehtest_nr_num(cand) < public.sehtest_nr_num(p_floor) then cand := p_floor; end if;
    update public.sehtest_settings set next_nr = cand where id = 1;
  end if;
end $$;
revoke execute on function public.sehtest_next_back(text, text) from public, anon, authenticated;

create or replace function public.sehtest_nr_freed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Gelöscht: Zähler zurück, falls dahinter keine Nummer mehr vergeben ist
  if old.sehtest_nr is not null then perform public.sehtest_next_back(null, old.sehtest_nr); end if;
  return null;
end $$;
revoke execute on function public.sehtest_nr_freed() from public, anon, authenticated;

drop trigger if exists sehtest_nr_freed_del on public.registrations;
create trigger sehtest_nr_freed_del after delete on public.registrations
  for each row execute function public.sehtest_nr_freed();

-- Einmalig: Zähler jetzt schon zurücksetzen (nicht unter 3869, deiner ersten Nummer)
select public.sehtest_next_back('3869', '3869');

select next_nr as naechste_nummer from public.sehtest_settings where id = 1;
