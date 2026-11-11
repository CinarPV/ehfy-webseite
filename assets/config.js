// Zentrale Einstellungen der Webseite.
// Solange supabaseUrl / supabaseAnonKey leer sind, läuft die Seite im DEMO-MODUS:
// Termine und Anmeldungen werden dann nur im eigenen Browser gespeichert.
// Wie du die beiden Werte bekommst, steht in der ANLEITUNG.md.
window.EHFY_CONFIG = {
  supabaseUrl: "https://oujxqtrqmopgfyskgwpt.supabase.co",
  supabaseAnonKey: "sb_publishable_NA_Q9dpLRXAtcy5QrpmzgQ_ZYg9dQ8s",

  name: "Erste Hilfe for you",
  phone: "0175 1567473",
  phoneIntl: "+491751567473",
  whatsapp: "491751567473",
  email: "ehfy@web.de",
  // Google-Bewertung: öffnet direkt das Fenster „Rezension schreiben“ (für den kleinen QR-Code auf dem Ausdruck)
  googleReviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ8_rloDQdvEcRZ74ohUwTzKk",
  defaultLocation: "Siegen",
  defaultAddress: "Selims Fahrschule, Hagener Straße 20, 57072 Siegen",
  defaultCapacity: 12,

  // Kursorte für die Schnell-Eingabe in der Verwaltung.
  // weekday: üblicher Kurstag (0 = Sonntag, 6 = Samstag) – wird im Kalender hervorgehoben.
  // Die Adresse sehen Teilnehmer erst nach der Anmeldung.
  locations: [
    { name: "Siegen",    weekday: 0, start: "10:00", end: "17:30", address: "Selims Fahrschule, Hagener Straße 20, 57072 Siegen" },
    { name: "Burbach",   weekday: 6, start: "10:00", end: "17:30", address: "Fahrschule Kleeb & Murat, Marktplatz 3, 57299 Burbach" },
    { name: "Netphen",   weekday: 6, start: "10:00", end: "17:30", address: "Fahrschule Jens Schiller, Albert-Irle-Straße 8, 57250 Netphen-Deuz" },
    { name: "Wilnsdorf", weekday: 6, start: "10:00", end: "17:30", address: "Fahrschule Die Zwei, Rathausstraße 2, 57234 Wilnsdorf" }
  ],
  cancelHours: 48,
  prices: { kurs: 50, komplett: 55 },

  // Öffentlicher Schlüssel für Push-Mitteilungen (wird bei der Einrichtung eingetragen, siehe ANLEITUNG.md)
  vapidPublicKey: "",

  // Absender für Quittungen und Rechnungen
  issuer: {
    name: "Erste Hilfe for you",
    owner: "Kürşat Cinar",
    street: "Hagener Straße 20",
    zip: "57072",
    city: "Siegen",
    phone: "0175 1567473",
    email: "ehfy@web.de",
    web: "www.ehfy.de",
    paypal: "ehfy@web.de"
    // Bankverbindung und Steuernummer stehen bewusst NICHT hier, denn diese Datei ist öffentlich.
    // Du trägst sie in der Verwaltung unter „Vorlagen & Bank“ ein.
  },

  // Ausfüllen der Vorlagen in der Verwaltung
  documents: {
    issueCity: "Siegen",        // „Ort, Datum“ auf der Bescheinigung
    infoLeafletHanded: true,    // Kreuz bei „Informationsschrift wurde ausgehändigt: Ja“
    noShowFee: 50, // Ausfallgebühr in Euro
    paymentDays: 14,            // Zahlungsziel für Rechnungen
    // Letzte Nummer, die vor der Webseite schon vergeben war – neue Belege machen danach weiter (26-04 …).
    // Für die echte Datenbank steht derselbe Startwert in supabase/setup.sql.
    lastNumberBefore: { 2026: 3 }
  },

  // Buchbare Leistungen – der Schlüssel wird mit der Anmeldung gespeichert (z. B. für die Quittung).
  packages: [
    { key: "kurs",     label: "Erste-Hilfe-Kurs",         detail: "inkl. Bescheinigung",                 price: 50 },
    { key: "komplett", label: "Erste-Hilfe-Kurs + Sehtest", detail: "Komplett-Paket, auf Wunsch 2 Passbilder gratis", price: 55 }
  ]
};
