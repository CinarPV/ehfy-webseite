// Service Worker: Die Verwaltung lässt sich als App installieren und startet auch bei schwachem Netz.
// Immer zuerst das Netz (damit Änderungen sofort ankommen), sonst die gespeicherte Kopie.
const CACHE = "ehfy-app-v2";
const SHELL = [
  "admin.html", "admin.webmanifest",
  "assets/style.css", "assets/config.js", "assets/layout.js", "assets/brand.js", "assets/db.js",
  "assets/calendar.js", "assets/admin.js", "assets/docs.js",
  "assets/vendor/supabase.js", "assets/vendor/pdf-lib.min.js", "assets/vendor/fontkit.umd.min.js",
  "assets/fonts/jakarta-400.woff2", "assets/fonts/jakarta-600.woff2", "assets/fonts/jakarta-800.woff2",
  "assets/fonts/jakarta-400.ttf", "assets/fonts/jakarta-700.ttf", "assets/fonts/jakarta-800.ttf",
  "assets/icon-192.png", "assets/favicon.svg"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  // Nur eigene Dateien – Datenbank-Anfragen (Supabase) laufen immer direkt übers Netz
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
