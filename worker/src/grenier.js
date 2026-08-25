/* Le grenier : l'endroit où un rendu survit à son téléphone.

   Le coffre garde les décisions — l'ordre des plans, les coupes, les noms —
   parce qu'elles sont irremplaçables et qu'elles tiennent dans quelques dizaines
   de kilo-octets. Un rendu, lui, pèse dix mégaoctets et se refabrique ; mais le
   refabriquer prend des minutes sur un téléphone, et il n'a pas sa place dans le
   coffre : une valeur y est plafonnée à vingt-cinq mégaoctets.

   D'où ce second rangement, sur R2, pour ce qui est lourd. Même clé que le
   coffre : le code de vingt caractères que l'appareil a tiré au sort. Qui a le
   code a le contenu — et le code est vérifié ici, somme de contrôle comprise,
   avant que R2 ne soit touché. Un point d'entrée qui accepterait n'importe quoi
   sur un compte à sortie gratuite serait un hébergeur de fichiers offert au
   premier venu ; celui-ci refuse tout ce qui n'est pas un rendu déposé par
   quelqu'un qui connaît déjà son code.

   Trois rendus par code, pas davantage : le plus ancien s'efface quand un
   quatrième arrive. C'est ce qui borne la place occupée sans avoir à surveiller
   quoi que ce soit. */

import { codeValide } from "./coffre.js";

const POIDS_MAX = 100_000_000;   // la limite d'un corps de requête chez Cloudflare
const GARDES = 3;                // rendus conservés par code
const TYPES = new Set(["video/mp4", "video/webm", "application/zip"]);

const texte = (message, statut) =>
  new Response(JSON.stringify({ error: message }), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const donnees = (charge, statut = 200) =>
  new Response(JSON.stringify(charge), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

// Un nom de fichier, pas un chemin : ni barre oblique, ni remontée de dossier.
const nomPropre = (brut) => {
  const net = String(brut || "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  return net && net !== "." && net !== ".." ? net : "rendu.mp4";
};

async function inventaire(env, code) {
  const liste = await env.GRENIER.list({ prefix: `${code}/` });
  return liste.objects
    .map((o) => ({
      nom: o.key.slice(code.length + 1),
      taille: o.size,
      quand: o.uploaded ? new Date(o.uploaded).getTime() : 0,
    }))
    .sort((a, b) => b.quand - a.quand);
}

export async function grenier(request, url, env) {
  if (!env.GRENIER) return texte("grenier indisponible", 503);

  const code = nettoyer(url.searchParams.get("code"));
  // Vérifié avant toute lecture : un code mal recopié, ou tiré au hasard par
  // quelqu'un qui essaierait d'en trouver un, n'atteint jamais le stockage.
  if (!codeValide(code)) return texte("code invalide", 403);

  if (request.method === "GET") {
    const nom = url.searchParams.get("nom");
    if (!nom) return donnees({ rendus: await inventaire(env, code) });
    const objet = await env.GRENIER.get(`${code}/${nomPropre(nom)}`);
    if (!objet) return texte("rendu introuvable", 404);
    return new Response(objet.body, {
      headers: {
        "content-type": objet.httpMetadata?.contentType || "application/octet-stream",
        "content-length": String(objet.size),
        "cache-control": "private, no-store",
      },
    });
  }

  if (request.method === "PUT") {
    const type = (request.headers.get("content-type") || "").split(";")[0].trim();
    if (!TYPES.has(type)) return texte("ce grenier ne prend que des rendus", 415);
    const annonce = Number(request.headers.get("content-length") || 0);
    if (annonce > POIDS_MAX) return texte("rendu trop lourd", 413);

    const nom = nomPropre(url.searchParams.get("nom") || "rendu.mp4");
    const corps = await request.arrayBuffer();
    if (!corps.byteLength) return texte("rendu vide", 400);
    if (corps.byteLength > POIDS_MAX) return texte("rendu trop lourd", 413);

    await env.GRENIER.put(`${code}/${nom}`, corps, { httpMetadata: { contentType: type } });

    /* Trois rendus gardés, pas plus : au quatrième, le plus ancien s'en va.
       Sans cette borne, la place occupée ne dépendrait de rien. */
    const restants = await inventaire(env, code);
    for (const vieux of restants.slice(GARDES)) {
      await env.GRENIER.delete(`${code}/${vieux.nom}`).catch(() => null);
    }
    return donnees({ rendus: await inventaire(env, code) });
  }

  if (request.method === "DELETE") {
    const nom = url.searchParams.get("nom");
    if (!nom) return texte("nom manquant", 400);
    await env.GRENIER.delete(`${code}/${nomPropre(nom)}`);
    return donnees({ rendus: await inventaire(env, code) });
  }

  return texte("méthode non permise", 405);
}
