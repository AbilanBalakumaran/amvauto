/* Lire un plan.

   Jusqu'ici l'outil ne regardait pas l'image : il savait qu'un rush portait
   l'étiquette « acting », pas qu'il montrait une main qui tremble. Le montage
   automatique s'accordait donc sur des mots-clés, jamais sur ce qui se passe.

   Gemini sait lire une vidéo. On lui donne le plan, il rend ce qu'on ne pouvait
   pas déduire : ce qu'on y voit, l'intensité réelle, et surtout **le moment qui
   compte** — l'instant de l'impact, celui du regard. C'est cette seconde-là
   qu'un monteur cherche, et c'est celle qu'on ne trouvait qu'à l'œil.

   Trois précautions, parce que cette route dépend d'un quota gratuit :

   — Le résultat est mis en cache pour toujours, par identifiant de rush. Un plan
     ne se lit qu'une fois, jamais deux, quel que soit le montage qui l'emploie.
   — Le Worker va chercher la vidéo lui-même. Le téléphone n'envoie pas les
     mégaoctets : sur un lien mobile, ce serait la partie la plus lente de loin.
   — L'adresse est vérifiée contre la même liste d'hôtes que le relais média.
     Sans elle, n'importe qui ferait lire n'importe quoi par le compte. */

import { codeValide } from "./coffre.js";
import { HOTES } from "./media.js";
import { compter } from "./quota.js";

const PAR_JOUR = 300;              // le palier gratuit tient autour de 1 500 appels
const POIDS_ENLIGNE = 18_000_000;  // au-delà, l'envoi dans la requête ne passe plus
const POIDS_MAX = 120_000_000;     // au-delà, on renonce : ce n'est plus un plan
const ATTENTE_MAX = 120000;
const RACINE = "https://generativelanguage.googleapis.com";

/* Plusieurs modèles, essayés dans l'ordre : les identifiants changent, et une
   dépréciation a déjà fait tomber une fonctionnalité entière dans ce projet. */
const MODELES = [
  "gemini-flash-latest",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
];

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

const CONSIGNE = `You are helping an AMV editor pick shots. Watch this short animation clip and answer about what is actually on screen.

- resume: one sentence, in French, describing what happens. Concrete and visual: who or what, doing what. Never mention the art style or the animation quality.
- motscles: 4 to 8 English keywords for what is visible (objects, actions, weather, body language). Lowercase, no punctuation.
- energie: 0 to 3. 0 is stillness or quiet acting, 1 is gentle movement, 2 is fast action, 3 is an explosive peak.
- pic: the second, as a number, where the strongest moment happens — the impact, the turn, the look. 0 if the clip is even throughout.
- emotion: one English word for the feeling it carries.
- mouvement: the direction the ACTION travels across the frame — one of
  "right", "left", "up", "down", "toward", "away", "still". Judge the subject,
  never the camera: a character lunging right while the camera follows is
  "right"; a still character filmed by a panning camera is "still".
- force: 0 to 3, how strongly that motion reads.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    resume: { type: "STRING" },
    motscles: { type: "ARRAY", items: { type: "STRING" } },
    energie: { type: "INTEGER" },
    pic: { type: "NUMBER" },
    emotion: { type: "STRING" },
    mouvement: { type: "STRING" },
    force: { type: "INTEGER" },
  },
  required: ["resume", "motscles", "energie", "pic", "emotion", "mouvement", "force"],
};

/* btoa ne prend qu'une chaîne, et fromCharCode appliqué à plusieurs mégaoctets
   d'un coup fait déborder la pile. On avance par tranches. */
function enBase64(octets) {
  let binaire = "";
  const pas = 0x8000;
  for (let i = 0; i < octets.length; i += pas) {
    binaire += String.fromCharCode.apply(null, octets.subarray(i, i + pas));
  }
  return btoa(binaire);
}

function adresseValable(brut) {
  let cible;
  try { cible = new URL(brut); } catch { return null; }
  if (cible.protocol !== "https:" || !HOTES.has(cible.hostname)) return null;
  return cible;
}

/* Au-delà de dix-huit mégaoctets, la vidéo ne tient plus dans la requête. On la
   dépose alors par l'API Files, qui accepte de très gros fichiers — et qui
   demande d'attendre : un envoi n'est pas lisible tant qu'il est en cours de
   traitement. Beaucoup de rushs sakuga font trente ou quarante mégaoctets, donc
   ce chemin n'est pas un cas rare. */
async function deposerFichier(env, octets, type) {
  const depot = await fetch(`${RACINE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "X-Goog-Upload-Protocol": "raw",
      "X-Goog-Upload-Command": "start, upload, finalize",
      "X-Goog-Upload-Header-Content-Length": String(octets.length),
      "X-Goog-Upload-Header-Content-Type": type,
      "content-type": type,
    },
    body: octets,
  });
  if (!depot.ok) throw new Error(`dépôt refusé (${depot.status}) : ${(await depot.text()).slice(0, 200)}`);
  const { file } = await depot.json();
  if (!file?.uri) throw new Error("le dépôt n'a rendu aucune adresse");

  let etat = file.state;
  let nom = file.name;
  for (let essai = 0; etat === "PROCESSING" && essai < 30; essai += 1) {
    await new Promise((suite) => setTimeout(suite, 2000));
    const vu = await fetch(`${RACINE}/v1beta/${nom}`, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    });
    if (!vu.ok) break;
    const suite = await vu.json();
    etat = suite.state;
    nom = suite.name || nom;
  }
  if (etat !== "ACTIVE") throw new Error(`le fichier déposé n'est pas exploitable (${etat})`);
  return file.uri;
}

async function lireParGemini(env, media) {
  let dernierEchec = "aucun modèle disponible";
  for (const modele of MODELES) {
    const reponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: CONSIGNE },
              media,
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
            temperature: 0.2,
          },
        }),
      },
    );
    if (reponse.ok) {
      const contenu = await reponse.json();
      const texte = contenu?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!texte) throw new Error("Gemini n'a rien rendu");
      return { ...JSON.parse(texte), modele };
    }
    dernierEchec = `HTTP ${reponse.status} — ${(await reponse.text()).slice(0, 250)}`;
    // Modèle inconnu ou retiré : on passe au suivant. Tout le reste est
    // définitif, et insister ne ferait que brûler du quota.
    if (!/not found|not supported|NOT_FOUND|UNAVAILABLE|high demand|overloaded|HTTP 503/i.test(dernierEchec)) break;
  }
  throw new Error(dernierEchec);
}

export async function lireScene(request, url, env) {
  if (request.method !== "POST") return new Response("méthode non permise", { status: 405 });

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) {
    return new Response(JSON.stringify({
      erreur: "Cette route demande un code de sauvegarde : c'est lui qui empêche un inconnu de tirer sur le quota.",
    }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
  }
  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({
      erreur: "Aucune clé Gemini configurée sur ce Worker (secret « GEMINI_API_KEY »).",
    }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  let demande;
  try { demande = await request.json(); } catch { return new Response("demande illisible", { status: 400 }); }
  const identifiant = String(demande?.id || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40);
  const cible = adresseValable(demande?.video);
  if (!identifiant || !cible) return new Response("plan inattendu", { status: 400 });

  // Un plan ne se lit qu'une fois. Le cache passe avant le plafond : relire une
  // fiche déjà écrite ne doit rien coûter à personne.
  const cle = `scene:${identifiant}`;
  if (env.COFFRE) {
    const garde = await env.COFFRE.get(cle);
    if (garde) {
      return new Response(garde, {
        headers: { "content-type": "application/json; charset=utf-8", "x-lecture": "cache" },
      });
    }
  }

  const rang = await compter(env, "scene", code.slice(0, 8), PAR_JOUR);
  if (rang < 0) {
    return new Response(JSON.stringify({
      erreur: `Plafond atteint : ${PAR_JOUR} plans lus aujourd'hui. Il se remet à zéro demain.\n\n`
        + "Le montage continue sans la lecture des plans restants : il s'accorde alors sur les "
        + "étiquettes de Sakugabooru.",
      definitif: true,
    }), { status: 429, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  try {
    const attente = new Promise((_, rejeter) =>
      setTimeout(() => rejeter(new Error("Gemini n'a pas répondu à temps")), ATTENTE_MAX));

    const travail = (async () => {
      const media = await fetch(cible.toString(), { headers: { referer: "https://www.sakugabooru.com/" } });
      if (!media.ok) throw new Error(`la vidéo est inaccessible (${media.status})`);
      const octets = new Uint8Array(await media.arrayBuffer());
      if (octets.length > POIDS_MAX) {
        throw new Error(`plan trop lourd (${Math.round(octets.length / 1e6)} Mo, maximum ${POIDS_MAX / 1e6})`);
      }
      const type = media.headers.get("content-type")?.split(";")[0] || "video/mp4";
      const part = octets.length > POIDS_ENLIGNE
        ? { file_data: { mime_type: type, file_uri: await deposerFichier(env, octets, type) } }
        : { inline_data: { mime_type: type, data: enBase64(octets) } };
      return lireParGemini(env, part);
    })();

    const fiche = await Promise.race([travail, attente]);
    const corps = JSON.stringify({ ...fiche, id: identifiant, lu: Date.now() });
    // Sans expiration : ce qu'un plan montre ne changera pas.
    if (env.COFFRE) await env.COFFRE.put(cle, corps);
    return new Response(corps, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-lecture": "gemini",
        "x-lectures-du-jour": String(rang),
      },
    });
  } catch (erreur) {
    const clair = traduireEchec(erreur.message);
    return new Response(JSON.stringify({ erreur: clair.texte, definitif: clair.definitif }), {
      status: clair.statut,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

/* Dire ce qui s'est passé, pas ce que le serveur a répondu.

   Le message brut de Google — « HTTP 429 — {"error":{"code":429,"message":"You
   exceeded your current quota, please check your plan and billing details…" } »
   — était affiché tel quel, dans une alerte bloquante, au milieu d'une
   automatisation qui continuait ensuite comme si de rien n'était. Deux défauts
   en un : illisible, et contredit par la suite.

   Chaque cas rend trois choses : un texte en français, le code HTTP qui lui
   correspond, et surtout « definitif » — insister a-t-il un sens ? Un quota
   épuisé ne se débloque pas en réessayant, et la page doit le savoir pour
   arrêter la lecture au lieu de brûler quinze appels de plus. */
export function traduireEchec(motif = "") {
  const quota = /quota|RESOURCE_EXHAUSTED|rate.?limit|HTTP 429/i.test(motif);
  if (quota) {
    return {
      statut: 429,
      definitif: true,
      texte:
        "Le quota gratuit de Gemini est épuisé pour aujourd'hui. Il se remet à zéro " +
        "au début de la journée, heure du Pacifique — vers 9 h en France.\n\n" +
        "Le montage continue sans la lecture des plans : il s'accorde alors sur les " +
        "étiquettes de Sakugabooru et coupe au début des plans. Plus grossier, mais " +
        "il se fait.",
    };
  }
  if (/API key|API_KEY_INVALID|PERMISSION_DENIED|HTTP 40[13]/i.test(motif)) {
    return {
      statut: 403,
      definitif: true,
      texte: "La clé Gemini de ce serveur est refusée. Il faut la renouveler dans la console Google AI Studio.",
    };
  }
  if (/n'a pas répondu à temps|HTTP 50[0-9]|overloaded|UNAVAILABLE/i.test(motif)) {
    return {
      statut: 503,
      definitif: false,
      texte: "Gemini n'a pas répondu à temps. Les plans suivants sont tentés quand même.",
    };
  }
  if (/trop lourd|inaccessible/i.test(motif)) {
    return { statut: 422, definitif: false, texte: `Ce plan n'a pas pu être lu : ${motif}.` };
  }
  return { statut: 502, definitif: false, texte: motif.slice(0, 200) };
}
