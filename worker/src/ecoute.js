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

/* Quatre-vingt-dix écoutes par jour : une analyse en demande jusqu'à quatre —
   une par tranche de quatre-vingt-dix secondes —, ce qui laisse une vingtaine de
   morceaux analysés par jour. Whisper coûte peu de neurones ; c'est le nombre
   d'appels qu'il faut borner, pas le budget. */
const PAR_JOUR = 90;
/* Deux modèles, et ils ne prennent PAS la même entrée.

   « whisper-large-v3-turbo » veut le son en base64 ; l'ancien « whisper » veut un
   tableau d'octets. Envoyer un tableau au turbo le fait échouer, et l'on retombait
   toujours sur l'ancien — mesuré : vingt-neuf secondes pour quarante-cinq secondes
   de musique, et un texte qui boucle sur la même phrase vingt fois. Le turbo est
   plus rapide et ne part pas en boucle ; encore faut-il lui parler sa langue. */
const MODELES = [
  { nom: "@cf/openai/whisper-large-v3-turbo", entree: "base64" },
  { nom: "@cf/openai/whisper", entree: "octets" },
];

/* Le base64 par tranches : « String.fromCharCode(...octets) » épuise la pile
   au-delà de quelques dizaines de milliers d'octets, et l'on en envoie des
   millions. */
function enBase64(octets) {
  let texte = "";
  const pas = 8192;
  for (let i = 0; i < octets.length; i += pas) {
    texte += String.fromCharCode(...octets.subarray(i, Math.min(octets.length, i + pas)));
  }
  return btoa(texte);
}
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
      const charge = modele.entree === "base64"
        ? { audio: enBase64(octets), task: "transcribe" }
        : { audio: [...octets] };
      // eslint-disable-next-line no-await-in-loop
      const dit = await env.AI.run(modele.nom, charge);
      /* Le turbo rend des segments, l'ancien des mots. Les deux disent la même
         chose : un texte et des instants. */
      const mots = dit?.words || dit?.word_segments || [];
      const lignes = mots.length
        ? enVers(mots)
        : (dit?.segments || []).map((s) => ({
          debut: Math.round(Number(s.start || 0) * 100) / 100,
          fin: Math.round(Number(s.end || s.start || 0) * 100) / 100,
          texte: String(s.text || "").trim(),
        })).filter((l) => l.texte);
      const texte = String(dit?.text || dit?.transcription_info?.text || "").trim();
      if (!texte && !lignes.length) { derniere = "le modèle n'a rien entendu"; continue; }
      return json({ modele: modele.nom, texte, lignes, reste });
    } catch (erreur) {
      derniere = String(erreur?.message || erreur).slice(0, 200);
    }
  }
  return json({ erreur: `l'écoute a échoué : ${derniere}` }, 502);
}
