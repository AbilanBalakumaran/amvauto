/* La musique du montage, déposée le temps d'un rendu déporté.

   Le rendu qui se fait ailleurs — sur un runner GitHub — ne connaît du montage
   que sa feuille de route : des adresses et des bornes. Les rushs, il sait où
   les prendre, ce sont des adresses publiques. La musique, non : elle est un
   fichier choisi sur le téléphone, et sans elle la vidéo sortirait muette.

   Elle passe donc par ici, une fois, et le runner vient la chercher à une
   adresse. Rien d'autre ne transite : ni le montage, ni les rushs, ni le moindre
   identifiant.

   La clé est l'empreinte du contenu : deux dépôts du même fichier donnent la
   même adresse, personne ne peut deviner celle d'un autre, et rien ne s'écrase.
   Le dépôt n'est possible que depuis notre propre page. */
const PLAFOND = 20 * 1024 * 1024;

const TYPES = new Map([
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/aac", "m4a"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/ogg", "ogg"],
  ["audio/webm", "webm"],
]);

const texte = (quoi, status = 200) =>
  new Response(quoi, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/* Le dépôt ne sert que notre page : c'est du stockage, et il se paie. */
function memeOrigine(request, url) {
  const origine = request.headers.get("origin");
  if (!origine) return true;                 // navigation directe, pas une requête d'un autre site
  try { return new URL(origine).host === url.host; } catch { return false; }
}

async function empreinte(octets) {
  const brut = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(brut)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

export async function piste(request, url, env) {
  if (!env.GRENIER) return texte("dépôt indisponible", 503);

  if (request.method === "GET") {
    const cle = url.searchParams.get("c") || "";
    if (!/^pistes\/v1\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/.test(cle)) return texte("clé invalide", 400);
    const objet = await env.GRENIER.get(cle).catch(() => null);
    if (!objet) return texte("introuvable", 404);
    return new Response(objet.body, {
      headers: {
        "content-type": objet.httpMetadata?.contentType || "application/octet-stream",
        // Le contenu est nommé par son empreinte : il ne changera jamais.
        "cache-control": "public, max-age=604800, immutable",
      },
    });
  }

  if (request.method !== "PUT") return texte("méthode non gérée", 405);
  if (!memeOrigine(request, url)) return texte("origine non autorisée", 403);

  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const suffixe = TYPES.get(type);
  if (!suffixe) return texte(`ce dépôt ne prend que de l'audio (${type || "type absent"})`, 415);

  const annonce = Number(request.headers.get("content-length") || 0);
  if (annonce > PLAFOND) return texte("piste trop lourde", 413);

  const octets = new Uint8Array(await request.arrayBuffer());
  if (!octets.length) return texte("piste vide", 400);
  if (octets.length > PLAFOND) return texte("piste trop lourde", 413);

  const cle = `pistes/v1/${await empreinte(octets)}.${suffixe}`;
  const deja = await env.GRENIER.head(cle).catch(() => null);
  if (!deja) {
    await env.GRENIER.put(cle, octets, {
      httpMetadata: { contentType: type, cacheControl: "public, max-age=604800, immutable" },
      customMetadata: { pose: new Date().toISOString() },
    });
  }

  return new Response(JSON.stringify({
    cle,
    url: `${url.origin}/api/piste?c=${encodeURIComponent(cle)}`,
    octets: octets.length,
    deja: Boolean(deja),
  }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
