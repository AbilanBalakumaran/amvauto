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

const HOTES = new Set([
  "www.sakugabooru.com",
  "sakugabooru.com",
  "v.animethemes.moe",
  "animethemes.moe",
]);

export async function relayerMedia(request, url) {
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

  const amont = await fetch(source.toString(), {
    headers: entetes,
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (!amont.ok && amont.status !== 206) {
    return new Response(`source indisponible (${amont.status})`, { status: 502 });
  }

  const reponse = new Headers();
  for (const nom of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const valeur = amont.headers.get(nom);
    if (valeur) reponse.set(nom, valeur);
  }
  reponse.set("cache-control", "public, max-age=86400");
  // La page lit ces octets : sans cet en-tête, le navigateur les lui refuse.
  reponse.set("access-control-allow-origin", "*");
  reponse.set("timing-allow-origin", "*");

  return new Response(amont.body, { status: amont.status, headers: reponse });
}
