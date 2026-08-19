// Relais de médias.
//
// Un logiciel de montage travaille sur des fichiers locaux : c'est ce qui rend
// le déplacement dans un plan instantané et fiable. Pour importer un rush dans
// le navigateur, il faut pouvoir en lire les octets — donc une requête que le
// navigateur autorise, donc une requête sur notre propre domaine. Les sources
// n'envoient pas d'en-tête CORS : elles passent par ici.
//
// Une fois le fichier importé, il est servi depuis l'appareil : plus de réseau,
// plus de règle de lecture mobile, plus de toile teintée — on peut même en
// relire les images.

export const HOTES = new Set([
  "www.sakugabooru.com",
  "sakugabooru.com",
  "v.animethemes.moe",
  "animethemes.moe",
]);

/* Le relais ne sert que notre propre page.

   Il annonçait « access-control-allow-origin: * » : n'importe quel site pouvait
   donc afficher des vidéos de Sakugabooru en passant par ici, aux frais du
   compte — et le plan gratuit compte cent mille requêtes par jour. Notre page
   étant servie par le même Worker, elle est de même origine et n'a besoin
   d'aucune permission de ce genre. On refuse donc les requêtes venues d'ailleurs
   plutôt que de les inviter. */
function memeOrigine(request, url) {
  /* « Sec-Fetch-Site » d'abord : c'est le seul en-tête que le navigateur envoie
     sur toutes les requêtes, y compris celles d'une balise <video> — et une
     balise <video> posée sur un autre site est justement la façon la plus simple
     de puiser dans ce relais. L'en-tête « Origin », lui, est absent de ces
     requêtes-là : s'y fier seul laissait le trou grand ouvert. */
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") return false;

  const origine = request.headers.get("Origin");
  if (!origine) return true;          // requête sans origine : rien à comparer
  try {
    return new URL(origine).host === url.host;
  } catch {
    return false;
  }
}

export async function relayerMedia(request, url) {
  if (!memeOrigine(request, url)) return new Response("origine non autorisée", { status: 403 });

  const cible = url.searchParams.get("u");
  if (!cible) return new Response("adresse manquante", { status: 400 });

  let source;
  try {
    source = new URL(cible);
  } catch {
    return new Response("adresse invalide", { status: 400 });
  }

  // Liste blanche stricte : un relais ouvert servirait à n'importe qui pour
  // n'importe quoi.
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (source.protocol !== "https:" && !local) return new Response("https requis", { status: 400 });
  if (!HOTES.has(source.hostname) && !(local && (source.hostname === "127.0.0.1" || source.hostname === "localhost"))) {
    return new Response("source non autorisée", { status: 403 });
  }

  const entetes = { "User-Agent": "amvauto/0.1 (+https://github.com/AbilanBalakumaran/amvauto)" };
  // La requête par plage est transmise telle quelle : c'est ce qui permet de
  // reprendre un téléchargement et de ne pas tout retélécharger pour une image.
  const plage = request.headers.get("Range");
  if (plage) entetes.Range = plage;

  /* Les redirections ne sont pas suivies aveuglément : une source de la liste
     blanche qui renverrait ailleurs ferait de ce relais un passe-plat vers
     n'importe quel hôte. Chaque saut est donc revérifié contre la même liste. */
  let amont;
  let adresse = source;
  for (let saut = 0; ; saut += 1) {
    amont = await fetch(adresse.toString(), {
      headers: entetes,
      redirect: "manual",
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    if (![301, 302, 303, 307, 308].includes(amont.status)) break;
    if (saut >= 3) return new Response("trop de redirections", { status: 502 });
    let suite;
    try {
      suite = new URL(amont.headers.get("location") || "", adresse);
    } catch {
      return new Response("redirection illisible", { status: 502 });
    }
    if (suite.protocol !== "https:" || !HOTES.has(suite.hostname)) {
      return new Response("redirection hors liste", { status: 403 });
    }
    adresse = suite;
  }
  if (!amont.ok && amont.status !== 206) {
    return new Response(`source indisponible (${amont.status})`, { status: 502 });
  }

  const reponse = new Headers();
  for (const nom of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const valeur = amont.headers.get(nom);
    if (valeur) reponse.set(nom, valeur);
  }
  reponse.set("cache-control", "public, max-age=86400");
  // Notre page est de même origine que ce Worker : elle lit ces octets de plein
  // droit. L'autorisation n'est renvoyée qu'à elle, jamais en grand ouvert.
  const origine = request.headers.get("Origin");
  if (origine) {
    reponse.set("access-control-allow-origin", origine);
    reponse.set("vary", "Origin");
  }
  reponse.set("timing-allow-origin", "*");

  return new Response(amont.body, { status: amont.status, headers: reponse });
}
