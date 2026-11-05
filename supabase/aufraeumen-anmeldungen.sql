-- Löscht einmal täglich alte Anmeldungen, deren Kurs mehr als 4 Wochen zurückliegt.
-- Es bleiben immer: ✓ Da, noch nicht abgehakt, offene Rechnung, offene zweite Chance, hinterlegtes Protokoll.
-- Kurse, Rechnungen und Quittungen werden nicht gelöscht.
create extension if not exists pg_cron;

create or replace function public.cleanup_old_registrations()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  removed integer;
begin
  delete from public.registrations r
   using public.courses c
   where c.id = r.course_id
     and c.starts_at < now() - interval '28 days'
     and r.status in ('storniert', 'nicht_erschienen')
     and r.protocol_added_on is null
     and (
       r.fee_state is null
       or r.fee_state = 'erlassen'
       or (r.fee_state = 'rechnung' and not exists (
             select 1 from public.invoices i
              where i.registration_id = r.id and i.status = 'offen'))
     );
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function public.cleanup_old_registrations() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ehfy-anmeldungen-aufraeumen';
select cron.schedule('ehfy-anmeldungen-aufraeumen', '30 3 * * *', 'select public.cleanup_old_registrations()');
select jobname, schedule, active from cron.job where jobname = 'ehfy-anmeldungen-aufraeumen';
