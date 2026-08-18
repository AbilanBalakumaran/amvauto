/* Le coffre : l'endroit où un montage survit à son téléphone.

   Ce qui vaut d'être sauvegardé tient dans presque rien — un plan pèse environ
   600 octets, un montage de soixante plans 37 Ko. Les vidéos, elles, ne montent
   pas ici : elles pèsent des gigaoctets et l'application sait les retrouver
   toute seule depuis leur source. On ne conserve que ce qui est irremplaçable,
   c'est-à-dire les décisions : l'ordre des plans, les coupes, les noms.

   Pas de compte, pas d'adresse e-mail, pas de mot de passe : un code tiré au
   hasard sur l'appareil sert à la fois d'adresse et de clé. Qui a le code a le
   contenu — c'est le prix de l'absence de compte, et la raison pour laquelle le
   code fait cent bits.

   Les deux derniers caractères du code sont une clé de contrôle. Un code mal
   recopié, ou tiré au hasard par quelqu'un qui essaierait d'en trouver un, est
   rejeté ici sans jamais toucher au stockage : le quota de lectures ne s'épuise
   pas sur des tentatives. */

// Alphabet de Crockford : ni I, ni L, ni O, ni U — rien qui se confonde avec 1,
// 0, ou qui forme un mot par accident. Un code se recopie à la main.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LONGUEUR = 20;      // 18 caractères tirés au sort + 2 de contrôle
const POIDS_MAX = 1_000_000;   // un montage n'atteint pas 1 Mo, de loin

// Somme de contrôle : deux caractères déduits des dix-huit premiers. La même
// fonction, mot pour mot, existe dans la page — les deux doivent s'accorder.
export function controle(base) {
  let a = 0x811c9dc5;
  for (const caractere of base) {
    a ^= caractere.charCodeAt(0);
    a = Math.imul(a, 0x01000193) >>> 0;
  }
  return ALPHABET[a % 32] + ALPHABET[(a >>> 5) % 32];
}

export function codeValide(code) {
  if (typeof code !== "string" || code.length !== LONGUEUR) return false;
  if (![...code].every((c) => ALPHABET.includes(c))) return false;
  return controle(code.slice(0, LONGUEUR - 2)) === code.slice(LONGUEUR - 2);
}

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export async function coffre(request, url, env) {
  if (!env.COFFRE) return new Response("coffre indisponible", { status: 503 });

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) return new Response("code invalide", { status: 400 });
  const cle = `coffre:${code}`;
  const entetes = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (request.method === "GET") {
    const garde = await env.COFFRE.get(cle);
    // Un coffre vide n'est pas une erreur : c'est un premier usage.
    return new Response(garde || JSON.stringify({ vide: true }), { headers: entetes });
  }

  if (request.method === "PUT") {
    const texte = await request.text();
    if (texte.length > POIDS_MAX) return new Response("contenu trop lourd", { status: 413 });
    let contenu;
    try {
      contenu = JSON.parse(texte);
    } catch {
      return new Response("contenu illisible", { status: 400 });
    }
    if (!contenu || !Array.isArray(contenu.projets)) {
      return new Response("contenu inattendu", { status: 400 });
    }
    const range = JSON.stringify({ projets: contenu.projets, depose: Date.now() });
    await env.COFFRE.put(cle, range);
    return new Response(JSON.stringify({ depose: true, octets: range.length }), { headers: entetes });
  }

  if (request.method === "DELETE") {
    await env.COFFRE.delete(cle);
    return new Response(JSON.stringify({ efface: true }), { headers: entetes });
  }

  return new Response("méthode non permise", { status: 405 });
}
