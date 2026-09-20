/* Entendre les paroles d'un morceau qu'on n'a pas écrit.

   « Il faut que ça illustre les paroles en choisissant les bonnes scènes. »
   Jusqu'ici les paroles n'étaient connues que lorsque l'outil les avait lui-même
   écrites. Une musique apportée par l'utilisateur, elle, ne dit rien : il faut
   l'écouter.

   Whisper tourne sur Workers AI, donc sur le même compte que le reste, sans
   nouvelle clé. Il rend le texte ET l'instant de chaque mot, ce qui est tout ce
   qu'il faut : un vers sur un passage, et le passage choisit ses scènes.

   Le fichier ne transite pas par le stockage : il arrive, il est écouté, il est
   oublié. Seul le texte revient. */

import { codeValide } from "./coffre.js";
import { compter } from "./quota.js";

const PAR_JOUR = 30;
const MODELES = ["@cf/openai/whisper-large-v3-turbo", "@cf/openai/whisper"];
const POIDS_MAX = 24_000_000;

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

const json = (charge, statut = 200) => new Response(JSON.stringify(charge), {
  status: statut,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

/* Les mots, regroupés en vers.

   Un mot seul ne dit rien : c'est la phrase qui parle de pluie ou de départ. On
   coupe donc là où la voix s'arrête — plus d'une demi-seconde de silence — ou au
   bout de douze mots, ce qui fait un vers de chanson. */
function enVers(mots) {
  const lignes = [];
  let courant = null;
  for (const m of mots) {
    const mot = String(m.word || m.text || "").trim();
    if (!mot) continue;
    const debut = Number(m.start ?? m.begin ?? 0);
    const fin = Number(m.end ?? debut);
    if (courant && (debut - courant.fin > 0.55 || courant.mots.length >= 12)) {
      lignes.push(courant);
      courant = null;
    }
    if (!courant) courant = { debut, fin, mots: [] };
    courant.mots.push(mot);
    courant.fin = Math.max(courant.fin, fin);
  }
  if (courant) lignes.push(courant);
  return lignes.map((l) => ({
    debut: Math.round(l.debut * 100) / 100,
    fin: Math.round(l.fin * 100) / 100,
    texte: l.mots.join(" ").replace(/\s+([,.!?])/g, "$1"),
  }));
}

export async function ecoute(request, url, env) {
  if (!env.AI) return json({ erreur: "l'écoute n'est pas configurée sur ce compte" }, 503);
  if (request.method !== "POST") return json({ erreur: "méthode non permise" }, 405);

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) return json({ erreur: "code invalide" }, 400);

  const octets = new Uint8Array(await request.arrayBuffer());
  if (!octets.length) return json({ erreur: "aucun son reçu" }, 400);
  if (octets.length > POIDS_MAX) {
    return json({ erreur: `le morceau dépasse ${Math.round(POIDS_MAX / 1e6)} Mo`, octets: octets.length }, 413);
  }

  const reste = await compter(env, "ecoute", code, PAR_JOUR);
  if (reste < 0) return json({ erreur: `${PAR_JOUR} écoutes par jour, c'est tout pour aujourd'hui` }, 429);

  let derniere = "";
  for (const modele of MODELES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const dit = await env.AI.run(modele, { audio: [...octets] });
      const mots = dit?.words || dit?.word_segments || [];
      const lignes = mots.length ? enVers(mots) : [];
      const texte = String(dit?.text || "").trim();
      if (!texte && !lignes.length) { derniere = "le modèle n'a rien entendu"; continue; }
      return json({ modele, texte, lignes, reste });
    } catch (erreur) {
      derniere = String(erreur?.message || erreur).slice(0, 200);
    }
  }
  return json({ erreur: `l'écoute a échoué : ${derniere}` }, 502);
}
