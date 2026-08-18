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

async function lire(env, cle) {
  try {
    const garde = await env.COFFRE.get(cle);
    const contenu = garde ? JSON.parse(garde) : null;
    return contenu && Array.isArray(contenu.projets) ? contenu : { projets: [], supprimes: {} };
  } catch {
    return { projets: [], supprimes: {} };
  }
}

const valable = (projet) =>
  Boolean(projet) && typeof projet === "object" && typeof projet.id === "string" && projet.id
  && Array.isArray(projet.plans);

const quand = (projet) => (typeof projet.maj === "number" ? projet.maj : 0);

/* Réconciliation : les suppressions se réunissent, chaque montage garde sa
   version la plus récente, et un montage supprimé après sa dernière
   modification s'en va. Trois mois plus tard, la trace d'une suppression ne sert
   plus qu'à encombrer et disparaît. */
const OUBLI = 90 * 24 * 3600 * 1000;

function fusionner(ancien, neuf) {
  const supprimes = { ...(ancien.supprimes || {}) };
  for (const [id, date] of Object.entries(neuf.supprimes || {})) {
    if (typeof date === "number") supprimes[id] = Math.max(supprimes[id] || 0, date);
  }

  const parId = new Map();
  for (const projet of [...(ancien.projets || []), ...neuf.projets]) {
    if (!valable(projet)) continue;
    const present = parId.get(projet.id);
    if (!present || quand(projet) > quand(present)) parId.set(projet.id, projet);
  }

  const projets = [...parId.values()].filter((projet) => !(supprimes[projet.id] > quand(projet)));

  const limite = Date.now() - OUBLI;
  for (const [id, date] of Object.entries(supprimes)) if (!(date > limite)) delete supprimes[id];

  return { projets, supprimes };
}

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

  /* POST vaut PUT : c'est la seule méthode qu'un « sendBeacon » sait employer,
     et c'est par lui que passe le dernier envoi quand l'application part en
     arrière-plan — le moment où l'on risque justement de tout perdre. */
  if (request.method === "PUT" || request.method === "POST") {
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

    /* Le dépôt fusionne au lieu d'écraser.

       Deux appareils ouverts en même temps déposent chacun leur état. Le dernier
       à parler effaçait le travail de l'autre : un montage supprimé sur le
       téléphone revenait dès que l'ordinateur redéposait sa copie, encore
       ignorante de la suppression — vérifié, il revenait des deux côtés. Aucun
       appareil ne peut connaître l'état de l'autre au moment où il parle ; le
       coffre, lui, les voit tous les deux. C'est donc ici que les deux versions
       se réconcilient, et nulle part ailleurs. */
    const ancien = await lire(env, cle);
    const fusion = fusionner(ancien, contenu);
    const range = JSON.stringify({ ...fusion, depose: Date.now() });
    await env.COFFRE.put(cle, range);
    return new Response(JSON.stringify({
      depose: true, octets: range.length, projets: fusion.projets.length,
    }), { headers: entetes });
  }

  if (request.method === "DELETE") {
    await env.COFFRE.delete(cle);
    return new Response(JSON.stringify({ efface: true }), { headers: entetes });
  }

  return new Response("méthode non permise", { status: 405 });
}
