-- Prüft, welche Update-Dateien in deiner Datenbank schon ausgeführt sind. Ändert nichts.
with checks(datei, art, name) as (values
  ('update-vor-ort.sql', 'f', 'checkin_register_general'),
  ('update-datenblatt-abgleich.sql', 'f', 'ehfy_name_key'),
  ('update-datenblatt-heute.sql', 'f', 'checkin_register_day'),
  ('update-datenblatt-heute.sql', 'c', 'courses.intern'),
  ('update-zahlung-teilnehmerliste.sql', 'c', 'registrations.on_list'),
  ('update-paypal-privat.sql', 'k', 'paypal_privat'),
  ('update-beleg-zuordnen.sql', 'f', 'link_invoice'),
  ('update-rechnung-betrieb.sql', 'f', 'set_invoice_recipient'),
  ('update-schreiben.sql', 't', 'mail_log'),
  ('update-ausweisnummer.sql', 'c', 'registrations.sehtest_id_no'),
  ('update-nur-sehtest.sql', 'c', 'registrations.sehtest_only'),
  ('update-sehtest-protokoll.sql', 'c', 'registrations.sehtest_nr'),
  ('update-sehtest-pruefer.sql', 'c', 'registrations.sehtest_examiner'),
  ('update-sehtest-ausgestellt.sql', 'c', 'registrations.sehtest_issued_at'),
  ('update-sehtest-ausschuss.sql', 'f', 'void_sehtest'),
  ('update-sehtest-startnummer.sql', 'f', 'get_next_sehtest_nr'),
  ('update-sehtest-zaehler.sql', 'f', 'sehtest_next_back'),
  ('update-ohne-adresse.sql', 'f', 'register_for_course'),
  ('aufraeumen-anmeldungen.sql', 'f', 'cleanup_old_registrations')
)
select case when
  (art = 'f' and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = name))
  or (art = 't' and to_regclass('public.' || name) is not null)
  or (art = 'c' and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = split_part(name, '.', 1) and column_name = split_part(name, '.', 2)))
  or (art = 'k' and exists (select 1 from pg_constraint where conname = 'registrations_payment_method_check' and pg_get_constraintdef(oid) like '%' || name || '%'))
  then '✓ erledigt' else '✗ FEHLT' end as stand, datei
from checks order by stand desc, datei;
