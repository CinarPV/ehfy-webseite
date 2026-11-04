# Erste Hilfe for you – Webseite: Anleitung

## Was ist drin?

| Seite | Datei |
|---|---|
| Startseite | `index.html` |
| Informationen zum Kurs | `kurs.html` |
| Preise | `preise.html` |
| Termine & Anmeldung | `anmelden.html` |
| Absage & Online-Abmeldung | `absage.html` |
| Ersatzbescheinigung | `ersatzbescheinigung.html` |
| Impressum / Datenschutz | `impressum.html`, `datenschutz.html` |
| **Verwaltung (nur für dich)** | `admin.html` (Link ganz unten im Footer: „Verwaltung“) |

Telefon, E-Mail, Preise und Standard-Kursort stehen zentral in `assets/config.js`.

**Demo-Modus:** Solange in `assets/config.js` keine Supabase-Daten eingetragen sind, läuft alles nur im eigenen Browser (Admin-Passwort `demo`). Das ist zum Ausprobieren gedacht – echte Anmeldungen brauchen Schritt 1.

---

## Schritt 1: Datenbank (Supabase) einrichten – ca. 10 Minuten

1. Auf **https://supabase.com** ein kostenloses Konto anlegen.
2. **New project** → Name z. B. `ehfy`, ein sicheres Datenbank-Passwort vergeben,
   **Region: „Central EU (Frankfurt)“** wählen (wichtig für den Datenschutz).
3. Links auf **SQL Editor** → den kompletten Inhalt von `supabase/setup.sql` einfügen → **Run**.
4. Links auf **Authentication → Users → Add user → Create new user**:
   deine E-Mail (z. B. ehfy@web.de) + ein sicheres Passwort, „Auto Confirm User“ anhaken.
5. Wieder im **SQL Editor** diese Zeile ausführen (E-Mail ggf. anpassen):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'ehfy@web.de';
   ```
6. **Authentication → Sign In / Providers**: „Allow new users to sign up“ **ausschalten**.
7. **Project Settings → API** (bzw. „Data API“ / „API Keys“): die **Project URL** und den
   **anon / publishable key** kopieren und in `assets/config.js` eintragen:
   ```js
   supabaseUrl: "https://xxxx.supabase.co",
   supabaseAnonKey: "eyJ...",
   ```
   (Der anon-Key ist öffentlich und darf in der Webseite stehen. Den **service_role**-Key niemals eintragen!)
8. Unter **Settings → Legal / DPA** den Auftragsverarbeitungsvertrag (DPA) abschließen.

Hinweis: Kostenlose Supabase-Projekte werden nach ca. 1 Woche ohne Aktivität pausiert. Bei regelmäßigen Anmeldungen passiert das nicht; sonst im Dashboard einfach wieder „Restore“ klicken.

## Schritt 1b: E-Mail bei jeder neuen Anmeldung – ca. 10 Minuten

Bei jeder Online-Anmeldung bekommst du eine E-Mail mit allen Daten.
Betreff: **„Ersthilfeanmeldung – 07.11.2026 (Burbach)“**. Wie die Mail aussieht: `supabase/mail-vorschau.html`.
Antwortest du auf die Mail, geht deine Antwort direkt an den Teilnehmer.

1. Auf **https://resend.com** ein kostenloses Konto **mit ehfy@web.de** anlegen
   (bis 3.000 Mails/Monat kostenlos). **API Keys → Create API Key** → Schlüssel kopieren.
2. In Supabase: **Edge Functions → Deploy a new function → Via Editor**, Name: `anmeldung-mail`.
   Den kompletten Inhalt von `supabase/functions/anmeldung-mail/index.ts` einfügen → **Deploy**.
3. **Edge Functions → Secrets** → zwei Einträge anlegen:
   - `RESEND_API_KEY` = der kopierte Schlüssel von Resend
   - `NOTIFY_TO` = `ehfy@web.de`
4. **Database → Webhooks → Create a new hook**:
   Name `anmeldung-mail`, Tabelle **registrations**, Ereignis **Insert** anhaken,
   Typ **Supabase Edge Functions**, Funktion **anmeldung-mail** → **Create webhook**.
5. Testen: eine Probe-Anmeldung auf der Webseite machen → die Mail sollte nach wenigen Sekunden da sein
   (auch im Spam-Ordner nachsehen und als „kein Spam“ markieren).

Teilnehmer, die du selbst in der Verwaltung einträgst, lösen keine Mail aus.
Solange keine eigene Domain bei Resend bestätigt ist, kommt die Mail von `onboarding@resend.dev` – das ist in Ordnung,
da sie nur an dich geht. Später kannst du unter **Resend → Domains** `ehfy.de` bestätigen und das Secret
`MAIL_FROM` = `EHfy Anmeldung <anmeldung@ehfy.de>` setzen.

## Schritt 1c: Vorlagen hochladen

In der Verwaltung unter **Vorlagen** die leere **Bescheinigung** und das leere **Teilnehmerdatenblatt** als PDF hochladen.
Sie liegen dann geschützt in Supabase (nur dein Konto kann sie lesen) – **nicht** in den Webseiten-Dateien.
Lege die Vorlagen deshalb nie in den Projektordner, der zu GitHub hochgeladen wird.
Mit „Testdruck mit Beispieldaten“ prüfst du, ob alles an der richtigen Stelle sitzt.

Auf derselben Seite trägst du **Bankverbindung** und **Steuernummer** ein – sie erscheinen auf den Rechnungen und stehen bewusst nicht in den öffentlichen Dateien.
Ab 250 € ist die Steuernummer auf einer Rechnung Pflicht.

## Schritt 2: Auf GitHub veröffentlichen (GitHub Pages)

1. Auf **https://github.com** ein Konto anlegen (falls noch nicht vorhanden).
2. Oben rechts **+ → New repository** → Name z. B. `ehfy-website`, **Public** → Create.
3. **„uploading an existing file“** klicken und **alle Dateien und Ordner** dieses Projekts hineinziehen → **Commit changes**.
4. Im Repository: **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main** / **(root)** → Save.
5. Nach 1–2 Minuten ist die Seite erreichbar unter `https://DEIN-NAME.github.io/ehfy-website/`.

## Schritt 3: Eigene Domain www.ehfy.de verbinden

Erst machen, wenn die neue Seite fertig geprüft ist – danach ist die alte WordPress-Seite nicht mehr unter ehfy.de erreichbar.

1. GitHub: **Settings → Pages → Custom domain**: `www.ehfy.de` eintragen → Save.
2. Beim Domain-Anbieter (dort, wo ehfy.de registriert ist) die DNS-Einträge ändern:
   - `www` → **CNAME** auf `DEIN-NAME.github.io`
   - `@` (ehfy.de ohne www) → **A-Records** auf `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. Nach der Umstellung bei GitHub **„Enforce HTTPS“** anhaken.
4. In Supabase unter **Authentication → URL Configuration** die Site URL auf `https://www.ehfy.de` setzen.

## Bescheinigungen, Datenblätter, Quittungen und Rechnungen

- **Kursmappe mit einem Klick**: In der Terminliste „Kursmappe drucken“ (oder in der Teilnehmeransicht „Alles mit einem Klick“)
  ergibt eine PDF mit Datenblatt, Bescheinigung und Quittung für jeden Teilnehmer, alphabetisch nach Nachnamen.
- **Einzeln**: In der Teilnehmeransicht gibt es Knöpfe für alle Datenblätter, Bescheinigungen, Quittungen oder Rechnungen
  des Kurses – und „Drucken …“ in jeder Zeile für eine einzelne Person.
- Quittungen bekommen beim ersten Druck automatisch eine **fortlaufende Nummer** (2026-0001, 2026-0002 …).
  Wird eine Quittung noch einmal gedruckt, bleibt die Nummer gleich.
- **Rechnungen**: Übersicht aller Belege des Jahres mit Umsatz und offenen Beträgen.
  „+ Neue Rechnung“ für freie Rechnungen (z. B. Firmenschulungen) mit beliebig vielen Positionen.
  Rechnungen lassen sich nicht löschen, nur **stornieren** – so bleiben die Nummern lückenlos.
- Auf der Bescheinigung steht immer die Anschrift der Ausbildungsstelle in Siegen (aus deiner Vorlage) – auch bei Kursen in anderen Orten.

## Verwaltung als App auf iPhone und MacBook

Funktioniert, sobald die Seite unter https://www.ehfy.de online ist.

- **iPhone**: In Safari `www.ehfy.de/admin.html` öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“** → „Hinzufügen“.
  Danach startet „EHfy Admin“ wie eine eigene App, ohne Adressleiste.
- **MacBook (Safari)**: `www.ehfy.de/admin.html` öffnen → Menü **Ablage → „Zum Dock hinzufügen“**.
- **MacBook (Chrome)**: In der Adressleiste rechts auf das Installieren-Symbol klicken → „Installieren“.

Einmal angemeldet, bleibst du angemeldet. Termine, Teilnehmer und Rechnungen sind auf allen Geräten gleich,
weil alles in der Datenbank liegt.

## Lokal arbeiten und „Online stellen“

Oben in der Verwaltung zeigt eine Leiste, ob du online bist und wie viele Änderungen noch nicht übertragen sind.

- **Termine und Teilnehmer** speicherst du zuerst nur auf dem Gerät – auch ohne Internet. Kunden sehen davon noch nichts.
- **„Online stellen“** überträgt alles in die Datenbank. Erst dann sehen Kunden die neuen Termine und dein anderes Gerät bekommt den Stand.
- **Neue Anmeldungen** holt die App beim Öffnen und über „Aktualisieren“.
- **Rechnungen und Quittungen ohne Internet** sind Entwürfe mit „ENTWURF“ statt Nummer. Die fortlaufende Nummer kommt beim Online-Stellen.
  Danach das PDF neu erzeugen. Mit Internet bekommt ein Beleg sofort seine Nummer.
- **E-Mail-Versand und das Hochladen von Vorlagen** brauchen Internet.
- Ändern Mac und iPhone denselben Eintrag, gilt der Stand, der zuletzt online gestellt wurde. Deshalb am besten nach dem Bearbeiten direkt online stellen.
- **Abmelden** löscht die lokalen Daten vom Gerät. Teilnehmerdaten liegen sonst auf dem Gerät: Bitte Geräte-Code bzw. Passwort am Mac und iPhone aktiv lassen.

## Plätze jederzeit ändern

In der Terminliste und in der Teilnehmeransicht ändert **− / +** die maximale Teilnehmerzahl sofort.
Damit Kunden die neue Zahl sehen, danach **„Online stellen“** drücken. Bereits angemeldete Personen bleiben angemeldet, auch wenn du unter ihre Zahl gehst.

## Push-Mitteilungen bei neuen Anmeldungen

1. Schlüsselpaar erzeugen und mir melden: Der öffentliche Teil kommt in `assets/config.js` (`vapidPublicKey`),
   der private nur in die Supabase-Secrets.
2. In Supabase die Funktion **`anmeldung-push`** anlegen (Inhalt aus `supabase/functions/anmeldung-push/index.ts`).
3. **Edge Functions → Secrets**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` = `mailto:ehfy@web.de`.
4. **Database → Webhooks**: zweiten Hook für Tabelle **registrations**, Ereignis **Insert**, Funktion **anmeldung-push**.
5. In der App unter **Einstellungen → Mitteilungen** auf jedem Gerät einschalten.
   Auf dem **iPhone** geht das nur in der installierten App vom Home-Bildschirm (ab iOS 16.4).

Die Mitteilung zeigt Name, Kurstag und Ort – auch auf dem Sperrbildschirm.

## Quittungen und Rechnungen per E-Mail senden

- In **Rechnungen** bei einem Beleg auf **„E-Mail“** tippen – oder in der Teilnehmerliste „Drucken …“ →
  „Quittung/Rechnung per E-Mail senden“.
- Empfänger, Betreff und Text sind vorausgefüllt und lassen sich ändern. **„Jetzt senden“** verschickt die Mail
  mit der PDF im Anhang **direkt von deiner web.de-Adresse**. Du bekommst automatisch eine Kopie (BCC).
- In der Rechnungsliste steht danach ✉ mit dem Versanddatum.
- Alternativ: „Über Mail-App“ (Teilen-Menü) oder herunterladen und selbst anhängen.

### Einmalig einrichten: Direktversand über web.de

1. **web.de freischalten**: In web.de einloggen → **E-Mail → Einstellungen → POP3/IMAP Abruf** →
   **„POP3 und IMAP Zugriff erlauben“** anhaken → Speichern. (Ohne das lehnt web.de den Versand ab.)
   Hast du bei web.de die Zwei-Faktor-Anmeldung aktiv, erstelle dort ein **App-Passwort** und nimm dieses.
2. In Supabase: **Edge Functions → Deploy a new function → Via Editor**, Name **`beleg-mail`**,
   Inhalt von `supabase/functions/beleg-mail/index.ts` einfügen → **Deploy**.
3. **Edge Functions → Secrets**:
   - `WEBDE_USER` = `ehfy@web.de`
   - `WEBDE_PASSWORD` = dein web.de-Passwort bzw. App-Passwort
4. Testen: in der Verwaltung eine Rechnung an deine eigene Adresse senden.

Dein Passwort liegt nur verschlüsselt bei Supabase – nicht auf der Webseite und nicht im Browser.
Versendet wird über web.de mit SSL (Port 465). Sollte web.de diese Verbindung ablehnen, steht der Grund
in der Fehlermeldung beim Senden bzw. unter Edge Functions → beleg-mail → Logs.

## Verwaltung benutzen

- `https://www.ehfy.de/admin.html` → mit deiner Supabase-E-Mail und deinem Passwort anmelden.
- **Termin freigeben**: Ort antippen (Siegen, Burbach, Netphen, Wilnsdorf oder der freie Knopf), Tag(e) im Kalender antippen, „Termin freigeben“. Unter „Ort, Uhrzeit und Plätze anpassen“ änderst du die Angaben; „Für diesen Knopf speichern“ merkt sie dauerhaft.
- **+ Neuer Termin**: Datum, Uhrzeit, Ort (öffentlich), genaue Adresse (sehen Teilnehmer erst nach der Anmeldung), max. Teilnehmer.
  „Online-Anmeldung möglich“ ausschalten → Termin wird angezeigt, aber nur mit Hinweis „nur telefonisch“.
- **+1 Woche**: kopiert einen Termin auf den nächsten Sonntag – praktisch für regelmäßige Kurse.
- **Teilnehmer**: Liste ansehen, drucken, als Excel/CSV speichern, Status setzen (teilgenommen / nicht erschienen / storniert),
  telefonische Anmeldungen per **+ Teilnehmer eintragen** ergänzen, **E-Mail an alle** schreiben.
- **Termin absagen**: Bearbeiten → Status „abgesagt“ → du wirst gefragt, ob du alle Teilnehmer per E-Mail informieren willst.

## Bitte selbst prüfen

- Texte im **Impressum** und in der **Datenschutzerklärung** (keine Rechtsberatung – im Zweifel z. B. mit einem Generator wie e-recht24 abgleichen).
- Die **Postleitzahl**: Auf der alten Seite stand einmal 57072 und einmal 57078 – ich habe überall **57072** verwendet.
- „Bitte mitbringen“ auf der Kursinfo-Seite und die Standard-Uhrzeit **09:00–16:30** sind Vorschläge.
