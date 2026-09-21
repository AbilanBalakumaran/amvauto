// Service worker d'amvauto.
//
// Le nom du cache porte l'horodatage du déploiement, posé par tools/stamp.mjs :
// un sw.js différent d'un octet suffit à faire installer le nouveau worker, qui
// prend la main aussitôt (skipWaiting + clients.claim) et fait recharger la page
// ouverte. Sans cette estampille automatique, il faudrait penser à incrémenter
// un numéro à chaque déploiement — et l'oublier une fois suffit à figer
// l'application chez l'utilisateur.
const VERSION = "2026-09-21 11:19";
const CACHE = `amvauto-${VERSION}`;

const COQUILLE = [
  "./",
  "./index.html",
  "./decodeur.js",
  "./demux.js",
  "./fabrique.js",
  "./copier.js",
  "./plage.js",
  "./juge.js",
  "./mp4.js",
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

/* La notification poussée par le serveur : la seule qui arrive quand
   l'application est fermée.

   Tout le reste des bannières est posé par la page, qui suit la course du rendu
   et prévient à la fin — ce qui suppose qu'elle tourne encore. Un onglet fermé
   n'exécute rien, et c'est précisément le moment où l'on veut être prévenu.

   Le message arrive chiffré pour cet appareil et déchiffré par le navigateur : il
   dit déjà quoi afficher, et rien n'a besoin d'être demandé au serveur. Il faut
   TOUJOURS montrer quelque chose — une poussée qui n'affiche rien finit par faire
   retirer la permission au site —, d'où la bannière générique quand le message
   manque. */
self.addEventListener("push", (event) => {
  let dit = null;
  try { dit = event.data?.json() || null; } catch { dit = null; }
  event.waitUntil((async () => {
    await self.registration.showNotification(dit?.titre || "Ton AMV est prêt", {
      body: dit?.corps || "Ouvre AMVAuto pour le télécharger.",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "amvauto-rendu",
      data: dit?.rendu ? { rendu: dit.rendu } : {},
    });
    try { await self.navigator.setAppBadge?.(1); } catch { /* pas de pastille ici */ }
  })());
});

/* Une notification tapée ramène dans l'application plutôt que d'ouvrir un
   second onglet. Si une fenêtre est déjà là, on la remet devant. */
self.addEventListener("notificationclick", (event) => {
  /* Un bouton de la notification n'ouvre pas l'application : il agit.

     « Suspendre », « Reprendre », « Arrêter » sont des gestes qu'on fait
     justement parce qu'on n'a pas envie de rouvrir l'application — dans le
     métro, quand la batterie tombe. Le worker les relaie donc à la page si elle
     est là, et la notification reste ouverte pour montrer le nouvel état.

     Sans page ouverte, il n'y a rien à relayer : les téléchargements sont
     portés par elle. On l'ouvre alors, et l'état s'y appliquera. */
  const action = event.action;
  if (action) {
    event.waitUntil((async () => {
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (fenetres.length) {
        for (const fenetre of fenetres) fenetre.postMessage({ transfert: action });
        return undefined;
      }
      event.notification.close();
      if (self.clients.openWindow) return self.clients.openWindow("./");
      return undefined;
    })());
    return;
  }
  event.notification.close();
  /* Le rendu que la bannière annonçait : on ne ramène pas seulement dans
     l'application, on ramène sur sa page — c'est là qu'est le bouton qui le
     télécharge. Une fenêtre déjà ouverte l'apprend par message ; une fenêtre
     neuve le lit dans son adresse. */
  const nom = event.notification.data?.rendu;
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const fenetre of fenetres) {
      if ("focus" in fenetre) {
        if (nom) fenetre.postMessage({ rendu: nom });
        return fenetre.focus();
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(nom ? `./?rendu=${encodeURIComponent(nom)}` : "./");
    }
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
