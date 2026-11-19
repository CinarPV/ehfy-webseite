-- Rechnung an einen Betrieb (Firma zahlt für den Schüler): gleiche Rechnungsnummer, nur der Empfänger wird umgestellt.
-- Gespeichert wird im Feld recipient: company = Firmendaten, bill_to = 'firma' oder 'person'. Die Schülerdaten bleiben erhalten.
-- Sonst bleibt jede Rechnung unveränderlich (Positionen, Betrag, Nummer, Datum).
-- Einmal im Supabase SQL Editor ausführen (auch erneut möglich). Löscht nichts.
create or replace function public.set_invoice_recipient(p_id uuid, p_company jsonb, p_bill_to text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Keine Berechtigung.'; end if;
  if p_bill_to not in ('person', 'firma') then raise exception 'Empfänger bitte wählen: Schüler oder Betrieb.'; end if;
  if p_bill_to = 'firma' and coalesce(trim(p_company->>'name'), '') = '' then raise exception 'Bitte den Namen des Betriebs eintragen.'; end if;
  update public.invoices
     set recipient = recipient || jsonb_build_object('bill_to', p_bill_to)
                   || case when p_company is null then '{}'::jsonb else jsonb_build_object('company', p_company) end
   where id = p_id and type = 'rechnung'
   returning recipient into v;
  if v is null then raise exception 'Rechnung nicht gefunden.'; end if;
  return v;
end $$;
revoke execute on function public.set_invoice_recipient(uuid, jsonb, text) from public, anon;
grant execute on function public.set_invoice_recipient(uuid, jsonb, text) to authenticated;
