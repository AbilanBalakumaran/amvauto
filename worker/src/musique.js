/* Génération de musique.

   La clé d'un fournisseur ne peut pas vivre dans la page : n'importe qui
   pourrait la lire et dépenser à la place du propriétaire. Elle reste donc ici,
   en secret du Worker, et la page ne connaît que cette route.

   Deux protections, parce que cette route coûte de l'argent à chaque appel :
   le code du coffre sert de laissez-passer — sans lui, personne ne peut faire
   payer le compte — et un plafond quotidien borne la casse même si le code
   fuite un jour.

   Le fournisseur est choisi par ce qui est configuré. Aucun n'est gratuit : il
   n'existe aujourd'hui aucune génération de musique à la fois libre d'usage et
   appelable par programme. */

import { codeValide } from "./coffre.js";

const PAR_JOUR = 20;              // plafond de générations quotidiennes
const ATTENTE_MAX = 180000;       // trois minutes : au-delà, on rend la main

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

async function compter(env, cle) {
  if (!env.COFFRE) return 0;
  const jour = new Date().toISOString().slice(0, 10);
  const compteur = `musique:${jour}:${cle}`;
  const vu = Number(await env.COFFRE.get(compteur)) || 0;
  if (vu >= PAR_JOUR) return -1;
  // Expire tout seul au bout de deux jours : rien à nettoyer.
  await env.COFFRE.put(compteur, String(vu + 1), { expirationTtl: 172800 });
  return vu + 1;
}

/* Lyria, par l'API Gemini. Une seule requête : la réponse porte l'audio en
   base64, sans file d'attente à interroger. Modèles et tarifs relevés dans la
   documentation officielle : « lyria-3-clip-preview » pour trente secondes à
   0,04 $, « lyria-3-pro-preview » pour un morceau complet à 0,08 $. Aucun des
   deux n'est offert sur le palier gratuit. */
async function parLyria(env, brief) {
  const modele = brief.court ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
  const reponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modele,
      input: brief.consigne,
      response_format: { type: "audio" },
    }),
  });
  if (!reponse.ok) {
    const detail = (await reponse.text()).slice(0, 300);
    throw new Error(`Lyria a répondu ${reponse.status} : ${detail}`);
  }
  const contenu = await reponse.json();
  // On cherche le premier bloc audio dans les étapes rendues.
  const blocs = [];
  const parcourir = (noeud) => {
    if (!noeud || typeof noeud !== "object") return;
    if (Array.isArray(noeud)) return noeud.forEach(parcourir);
    if (noeud.type === "audio" && typeof noeud.data === "string") blocs.push(noeud);
    for (const valeur of Object.values(noeud)) parcourir(valeur);
  };
  parcourir(contenu.steps || contenu);
  if (!blocs.length) throw new Error("Lyria n'a rendu aucun bloc audio");
  const brut = atob(blocs[0].data);
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i);
  return { octets, type: blocs[0].mime_type || "audio/mpeg", nom: "lyria.mp3" };
}

/* Un fournisseur de démonstration : il renvoie un fichier connu, ce qui permet
   d'éprouver toute la chaîne — laissez-passer, plafond, transport, dépôt dans la
   piste son, lecture du tempo — sans compte ni dépense. Il n'existe qu'en
   développement, quand l'adresse de démonstration est configurée. */
async function parDemonstration(env) {
  const reponse = await fetch(env.MUSIQUE_DEMO);
  if (!reponse.ok) throw new Error(`démonstration indisponible (${reponse.status})`);
  const octets = new Uint8Array(await reponse.arrayBuffer());
  return { octets, type: reponse.headers.get("content-type") || "audio/wav", nom: "demonstration.wav" };
}

export async function genererMusique(request, url, env) {
  if (request.method !== "POST") return new Response("méthode non permise", { status: 405 });

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) {
    return new Response(JSON.stringify({
      erreur: "Cette route demande un code de sauvegarde : c'est lui qui empêche un inconnu de faire payer le compte. Active la sauvegarde en ligne dans Réglages.",
    }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  let brief;
  try {
    brief = await request.json();
  } catch {
    return new Response("consigne illisible", { status: 400 });
  }
  if (!brief?.consigne || typeof brief.consigne !== "string" || brief.consigne.length > 4000) {
    return new Response("consigne inattendue", { status: 400 });
  }

  const fournisseur = env.MUSIQUE_DEMO ? parDemonstration
    : env.GEMINI_API_KEY ? parLyria
    : null;
  if (!fournisseur) {
    return new Response(JSON.stringify({
      erreur: "Aucun fournisseur de musique n'est configuré. Il faut une clé — aucun service ne génère de musique gratuitement et par programme.",
    }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  const rang = await compter(env, code.slice(0, 8));
  if (rang < 0) {
    return new Response(JSON.stringify({
      erreur: `Plafond atteint : ${PAR_JOUR} générations pour aujourd'hui. Il protège la facture, il se remet à zéro demain.`,
    }), { status: 429, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  try {
    const attente = new Promise((_, rejeter) =>
      setTimeout(() => rejeter(new Error("le fournisseur n'a pas répondu à temps")), ATTENTE_MAX));
    const { octets, type, nom } = await Promise.race([fournisseur(env, brief), attente]);
    return new Response(octets, {
      headers: {
        "content-type": type,
        "content-disposition": `inline; filename="${nom}"`,
        "cache-control": "no-store",
        "x-generations-du-jour": String(rang),
      },
    });
  } catch (erreur) {
    return new Response(JSON.stringify({ erreur: erreur.message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
