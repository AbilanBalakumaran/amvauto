// Service worker d'amvauto.
//
// Le nom du cache porte l'horodatage du déploiement, posé par tools/stamp.mjs :
// un sw.js différent d'un octet suffit à faire installer le nouveau worker, qui
// prend la main aussitôt (skipWaiting + clients.claim) et fait recharger la page
// ouverte. Sans cette estampille automatique, il faudrait penser à incrémenter
// un numéro à chaque déploiement — et l'oublier une fois suffit à figer
// l'application chez l'utilisateur.
const VERSION = "2026-08-25 01:48";
const CACHE = `amvauto-${VERSION}`;

const COQUILLE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-masque.png",
  "./apple-touch-icon.png",
  "./fonts/ObelixProB-cyr.ttf",
];

self.addEventListener("install", (event) => {
  /* Chaque fichier est mis en cache pour lui-même. « addAll » échoue en bloc :
     un seul fichier absent — une icône renommée, une police oubliée dans un
     déploiement — faisait échouer l'installation entière. Le nouveau worker ne
     prenait alors jamais la main et l'application restait figée sur son ancienne
     version chez l'utilisateur, sans le moindre message. Mieux vaut une coquille
     incomplète, qui se complètera au premier passage en ligne, qu'une mise à
     jour qui n'arrive jamais.

     cache: "reload" court-circuite le cache HTTP : les copies sont fraîches. */
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(COQUILLE.map((url) =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => null),
      )),
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

/* Une notification tapée ramène dans l'application plutôt que d'ouvrir un
   second onglet. Si une fenêtre est déjà là, on la remet devant. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const fenetre of fenetres) {
      if ("focus" in fenetre) return fenetre.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow("./");
    return undefined;
  })());
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
          // Seule une page valable est gardée : une panne passagère du serveur
          // devenait sinon la page servie hors ligne, définitivement.
          if (reponse.ok) {
            const copie = reponse.clone();
            caches.open(CACHE).then((cache) => cache.put("./index.html", copie));
          }
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
