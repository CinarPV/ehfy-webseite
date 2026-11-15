-- Gesendete Schreiben (Rechnung, zweite Chance, Absage, Belege …) in der Verwaltung nachvollziehen.
-- Einmal im Supabase SQL Editor ausführen. Löscht nichts.
create table if not exists public.mail_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  registration_id uuid references public.registrations(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  invoice_number text,
  kind text,
  to_addr text,
  subject text,
  body text,
  attachment text,
  person text
);
alter table public.mail_log enable row level security;
drop policy if exists "admin_mail_log" on public.mail_log;
create policy "admin_mail_log" on public.mail_log
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create index if not exists mail_log_reg on public.mail_log(registration_id);
