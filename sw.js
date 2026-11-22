// Service Worker: Die Verwaltung lässt sich als App installieren und startet auch bei schwachem Netz.
// Immer zuerst das Netz (damit Änderungen sofort ankommen), sonst die gespeicherte Kopie.
const CACHE = "ehfy-app-v157";
const SHELL = [
  "admin.html", "admin.webmanifest",
  "assets/style.css", "assets/admin-hell.css", "assets/config.js", "assets/layout.js", "assets/brand.js", "assets/db.js",
  "assets/sync.js", "assets/calendar.js", "assets/import-alt.js", "assets/finanzen.js", "assets/admin.js", "assets/docs.js", "assets/sehtest.js", "assets/ausweis.js", "assets/sign.js", "assets/vendor/qrcode.js",
  "assets/vendor/supabase.js", "assets/vendor/pdf-lib.min.js", "assets/vendor/fontkit.umd.min.js", "assets/vendor/pdfjs.min.js", "assets/vendor/pdfjs.worker.min.js",
  "assets/fonts/jakarta-400.woff2", "assets/fonts/jakarta-600.woff2", "assets/fonts/jakarta-800.woff2",
  "assets/fonts/jakarta-400.ttf", "assets/fonts/jakarta-700.ttf", "assets/fonts/jakarta-800.ttf",
  "assets/icon-192.png", "assets/favicon.svg", "assets/symbole.svg"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Gespeicherte oder geholte Antwort ohne Umleitungs-Kennzeichen (sonst lehnt Safari sie ab)
function clean(res) {
  if (!res || !res.redirected) return res;
  return res.blob().then(body => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  // Nur eigene Dateien – Datenbank-Anfragen (Supabase) laufen immer direkt übers Netz
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const nav = req.mode === "navigate";
  e.respondWith(
    // no-cache: den 10-Minuten-Zwischenspeicher des Browsers umgehen, damit nie eine alte Version startet
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then(res => {
        // Umgeleitete Antwort (z. B. ehfy.de → www.ehfy.de): Safari verweigert sie beim Öffnen der Seite
        // („Response served by service worker has redirections“). Seiten: Browser selbst weiterleiten lassen,
        // Dateien: als saubere Antwort ohne Umleitung zurückgeben. Umgeleitetes wird nie gespeichert.
        if (res.redirected) return nav ? Response.redirect(res.url, 302) : clean(res);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(clean))
  );
});

// Push-Mitteilung bei neuer Anmeldung
self.addEventListener("push", e => {
  let data = {};
  try { data = e.data.json(); } catch (err) { /* ohne Inhalt */ }
  e.waitUntil(Promise.all([
    self.registration.showNotification(data.title || "Neue Anmeldung", {
      body: data.body || "Es gibt eine neue Anmeldung.",
      icon: "assets/icon-192.png", badge: "assets/icon-192.png", tag: "anmeldung-" + Date.now()
    }),
    self.clients.matchAll({ type: "window" }).then(list => list.forEach(c => c.postMessage("neue-anmeldung")))
  ]));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.includes("admin.html"));
    return open ? open.focus() : self.clients.openWindow("admin.html");
  }));
});
