// Service worker d'amvauto.
//
// Le nom du cache porte l'horodatage du déploiement, posé par tools/stamp.mjs :
// un sw.js différent d'un octet suffit à faire installer le nouveau worker, qui
// prend la main aussitôt (skipWaiting + clients.claim) et fait recharger la page
// ouverte. Sans cette estampille automatique, il faudrait penser à incrémenter
// un numéro à chaque déploiement — et l'oublier une fois suffit à figer
// l'application chez l'utilisateur.
const VERSION = "2026-08-17 11:23";
const CACHE = `amvauto-${VERSION}`;

const COQUILLE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./apple-touch-icon.png",
  "./fonts/ObelixProB-cyr.ttf",
];

self.addEventListener("install", (event) => {
  // cache: "reload" court-circuite le cache HTTP : le nouveau worker s'installe
  // avec des copies réellement fraîches.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(COQUILLE.map((url) => new Request(url, { cache: "reload" }))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((cle) => cle !== CACHE).map((cle) => caches.delete(cle)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  // Les rushs et les vignettes viennent d'autres domaines, et l'API doit rendre
  // des données vivantes : ni les uns ni l'autre ne passent par le cache.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // La page d'abord au réseau : c'est ce qui garantit qu'une correction
  // déployée arrive, le cache ne servant que hors ligne.
  const estPage = requete.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html");
  if (estPage) {
    event.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copie));
          return reponse;
        })
        .catch(() => caches.match("./index.html").then((cache) => cache || Response.error())),
    );
    return;
  }

  // Le reste — police, icônes — sort du cache et se rafraîchit en arrière-plan.
  event.respondWith(
    caches.match(requete).then((cache) => {
      const reseau = fetch(requete)
        .then((reponse) => {
          if (reponse.ok) {
            const copie = reponse.clone();
            caches.open(CACHE).then((c) => c.put(requete, copie));
          }
          return reponse;
        })
        .catch(() => cache);
      return cache || reseau;
    }),
  );
});
