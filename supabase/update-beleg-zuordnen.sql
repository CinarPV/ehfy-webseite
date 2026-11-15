-- Beleg nachträglich einem Schüler zuordnen. Rechnungen selbst bleiben unveränderlich:
-- Diese Funktion setzt NUR die fehlende Zuordnung (registration_id), sonst nichts.
create or replace function public.link_invoice(p_id uuid, p_registration uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Keine Berechtigung.'; end if;
  if not exists (select 1 from public.registrations where id = p_registration) then raise exception 'Schüler nicht gefunden.'; end if;
  update public.invoices set registration_id = p_registration where id = p_id and registration_id is null;
  if not found then raise exception 'Dieser Beleg ist schon einem Schüler zugeordnet.'; end if;
end $$;
revoke execute on function public.link_invoice(uuid, uuid) from public, anon;
grant execute on function public.link_invoice(uuid, uuid) to authenticated;
