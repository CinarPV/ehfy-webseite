-- Zahlart „PayPal privat“ erlauben (zählt nicht zum Gesamteinkommen, kommt nicht auf die Teilnehmerliste)
alter table public.registrations drop constraint if exists registrations_payment_method_check;
alter table public.registrations add constraint registrations_payment_method_check
  check (payment_method is null or payment_method in ('bar', 'paypal', 'ueberweisung', 'paypal_privat'));
