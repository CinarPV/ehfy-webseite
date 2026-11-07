-- Reparatur nach versehentlich ausgeführtem Fahrstundenplaner-Code (November 2026)
-- Entfernt die Fahrschul-Tabellen und -Funktionen aus dem EHfy-Projekt
-- und stellt die EHfy-Tabelle für Push-Mitteilungen wieder her.
-- EHfy-Daten (Kurse, Anmeldungen, Rechnungen, Einstellungen) werden NICHT angefasst.

begin;

-- Sicherheitsprüfung: bricht ab, falls doch echte Fahrschul-Daten vorhanden sind
do $$
declare n int;
begin
  select (select count(*) from public.bookings) + (select count(*) from public.exams)
       + (select count(*) from public.own_entries) + (select count(*) from public.profiles)
       + (select count(*) from public.settings) + (select count(*) from public.slots)
       + (select count(*) from public.teacher_pay) + (select count(*) from public.theory_lessons)
       + (select count(*) from public.time_off) + (select count(*) from public.training_progress)
       + (select count(*) from public.push_subscriptions)
    into n;
  if n > 0 then
    raise exception 'Abbruch: In den Fahrschul-Tabellen stehen % Einträge. Nichts wurde geändert.', n;
  end if;
end $$;

-- Automatik bei neuen Benutzerkonten (gehört zum Fahrstundenplaner)
drop trigger if exists on_auth_user_created on auth.users;

-- Fahrschul-Tabellen
drop table if exists public.training_progress, public.training_topics, public.exams,
  public.bookings, public.slots, public.time_off, public.theory_lessons, public.teacher_pay,
  public.own_entries, public.settings, public.profiles cascade;

-- Fahrschul-Funktionen
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'book_slot','can_manage_teacher','cancel_booking','cancel_deadline','cancel_request',
      'cleanup_old_data','create_teacher','delete_student','delete_teacher','exam_passed_access',
      'get_calendar','handle_new_user','has_own_booking','is_active','is_owner','is_school_admin',
      'is_teacher','is_time_off','make_owner','my_teacher_id','owner_set_teacher_password',
      'password_changed','profiles_valid_guard','public_teachers','respond_change','respond_offer',
      'restore_backup','restore_slot_time','set_teacher_status','set_teacher_valid','slot_teacher',
      'slots_keep_orig','student_passed','student_teacher','teacher_valid','update_my_profile')
  loop
    execute 'drop function ' || f || ' cascade';
  end loop;
end $$;

-- EHfy-Tabelle für Push-Mitteilungen wiederherstellen (war leer)
drop table if exists public.push_subscriptions cascade;
create table public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  device text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "admin_push" on public.push_subscriptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Umlaut in zwei Fehlermeldungen korrigieren ("prüfe" statt "pr√ºfe")
create or replace function public.cancel_registration(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.registrations; c public.courses;
begin
  select * into r from public.registrations where cancel_token = p_token for update;
  if not found then raise exception 'Anmeldung nicht gefunden. Bitte prüfe deinen Link.'; end if;
  if r.status <> 'angemeldet' then raise exception 'Diese Anmeldung wurde bereits storniert.'; end if;
  select * into c from public.courses where id = r.course_id;
  if c.starts_at <= now() then raise exception 'Der Kurs hat bereits begonnen. Bitte melde dich telefonisch.'; end if;
  update public.registrations set status = 'storniert', cancelled_at = now() where id = r.id;
  return json_build_object('late', c.starts_at - now() < interval '48 hours', 'starts_at', c.starts_at);
end $$;

create or replace function public.get_registration(p_token uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare res json;
begin
  select json_build_object('first_name', r.first_name, 'last_name', r.last_name, 'status', r.status,
    'package', r.package, 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'location', c.location,
    'course_status', c.status) into res
  from public.registrations r join public.courses c on c.id = r.course_id
  where r.cancel_token = p_token;
  if res is null then raise exception 'Anmeldung nicht gefunden. Bitte prüfe deinen Link.'; end if;
  return res;
end $$;

commit;

-- Kontrolle: sollte nur noch die 7 EHfy-Tabellen zeigen, alle mit Schutz = true
select c.relname as tabelle, c.relrowsecurity as schutz_an
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
