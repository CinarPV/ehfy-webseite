-- Öffentlich nur noch eine Einstufung statt Platzzahlen. Einmal im Supabase SQL Editor ausführen.
drop function if exists public.get_open_courses();
create or replace function public.get_open_courses()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, location text,
               seats text, online_booking boolean, note text)
language sql stable security definer set search_path = public as $$
  select c.id, c.starts_at, c.ends_at, c.location,
         case when f.free <= 0 then 'voll' when f.free <= 4 then 'letzte' when f.free <= 8 then 'wenige' else 'frei' end,
         c.online_booking, c.note
    from public.courses c
    cross join lateral (
      select c.capacity - (select count(*)::int from public.registrations r
                            where r.course_id = c.id and r.status <> 'storniert') as free
    ) f
   where c.status = 'offen' and c.starts_at > now()
   order by c.starts_at;
$$;
grant execute on function public.get_open_courses() to anon, authenticated;
