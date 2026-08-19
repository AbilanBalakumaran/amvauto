/* Écrire les paroles.

   ACE-Step chante ce qu'on lui donne : sans paroles, pas de voix. Les écrire à
   la main est un travail à part entière, et rarement celui qu'on a envie de
   faire quand on monte. On les fait donc écrire ici, par le modèle de langue de
   Workers AI — qui tourne sur le même compte Cloudflare que le reste, sans
   nouvelle clé, sans nouveau compte, et dont le plan gratuit donne dix mille
   neurones par jour. Une chanson en coûte une quarantaine : la limite ne se
   rencontre pas.

   Elles sortent en anglais. Ce n'est pas un jugement sur la langue, c'est ce
   que les modèles de musique chantent le mieux, et de très loin — ACE-Step
   comme les autres ont été entraînés sur un corpus massivement anglophone.

   Le texte revient dans le panneau avant d'être chanté. Rien n'est envoyé au
   générateur sans être passé sous les yeux : une parole ratée coûte un appel de
   quota, une parole relue n'en coûte aucun. */

import { codeValide } from "./coffre.js";
import { compter } from "./quota.js";

const PAR_JOUR = 40;                              // deux fois le plafond des musiques : on réécrit plus qu'on ne génère
/* Plusieurs modèles, essayés dans l'ordre. Le premier essai a buté sur un
   modèle retiré du catalogue en cours de route : une liste de secours évite que
   la fonctionnalité entière tombe le jour où le suivant sera déprécié. */
const MODELES = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-3.2-3b-instruct",
];
const MOTS_MAX = 2000;

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/* La consigne. Elle insiste sur trois choses, parce que ce sont les trois que
   le modèle rate spontanément : les balises de structure d'ACE-Step, l'absence
   de tout commentaire autour du texte, et la longueur — un modèle lâché sans
   borne écrit trois fois trop de vers pour la durée demandée. */
function consigne(brief) {
  const sections = Array.isArray(brief.sections) ? brief.sections : [];
  const plan = sections.length
    ? sections.map((s, i) => `  ${i + 1}. ${s.etiquette} — ${s.tenue}s, ${s.humeur}`).join("\n")
    : "  a single continuous section";
  return [
    `Anime: ${brief.anime || "unnamed"}`,
    `Mood: ${(brief.humeurs || []).join(", ") || "action"}`,
    `Tempo: ${brief.bpm || 140} BPM`,
    `Total length: ${brief.secondes || 120} seconds`,
    `Write exactly ${sections.length || 1} sections.`,
    brief.histoire ? `Story to tell: ${brief.histoire}` : "",
    "",
    "Section plan, in order:",
    plan,
  ].filter(Boolean).join("\n");
}

const SYSTEME = [
  "You write lyrics for anime music videos. Output ONLY the lyrics.",
  "",
  "Rules:",
  "- English only.",
  "- Use ONLY these tags, each on its own line: [verse], [chorus], [bridge].",
  "- Never write [inst]: it marks an instrumental passage, and everything you write is sung.",
  "- Exactly one tag per section of the given plan, in the given order, no extra sections.",
  "- Map the plan to tags: Intro, Ambient, Breakdown and Outro become [verse]; Build becomes [bridge]; Drop becomes [chorus].",
  "- About 4 lines per 20 seconds of that section. Never more.",
  "- Short, singable lines. No line longer than nine words.",
  "- Write the feeling of the scene, not a summary of the plot.",
  "- Never name the anime or its characters.",
  "- No title, no explanation, no markdown, no quotes around the lyrics.",
].join("\n");

/* Le modèle enrobe volontiers sa réponse — « Here are the lyrics: », un bloc de
   code, un titre en gras. On retire cet emballage, sans toucher au texte. */
function deballer(brut) {
  let texte = String(brut || "").trim();
  texte = texte.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  // Tout ce qui précède la première balise n'est que préambule.
  const premiere = texte.search(/^\s*\[[a-z]/im);
  if (premiere > 0) texte = texte.slice(premiere);
  return texte.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
}

export async function ecrireParoles(request, url, env) {
  if (request.method !== "POST") return new Response("méthode non permise", { status: 405 });

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) {
    return new Response(JSON.stringify({
      erreur: "Cette route demande un code de sauvegarde. Active la sauvegarde en ligne dans Réglages.",
    }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
  }
  if (!env.AI) {
    return new Response(JSON.stringify({
      erreur: "Workers AI n'est pas branché sur ce Worker : il manque la liaison « AI ».",
    }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  let brief;
  try {
    brief = await request.json();
  } catch {
    return new Response("brief illisible", { status: 400 });
  }
  if (typeof brief?.histoire === "string" && brief.histoire.length > 600) {
    return new Response("histoire trop longue", { status: 400 });
  }

  const rang = await compter(env, "paroles", code.slice(0, 8), PAR_JOUR);
  if (rang < 0) {
    return new Response(JSON.stringify({
      erreur: `Plafond atteint : ${PAR_JOUR} écritures pour aujourd'hui. Il se remet à zéro demain.`,
    }), { status: 429, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  const liste = env.MODELE_PAROLES ? [env.MODELE_PAROLES, ...MODELES] : MODELES;
  let dernierEchec = "aucun modèle disponible";
  for (const modele of liste) {
    try {
      const reponse = await env.AI.run(modele, {
        messages: [
          { role: "system", content: SYSTEME },
          { role: "user", content: consigne(brief) },
        ],
        max_tokens: 700,
        temperature: 0.9,
      });
      const paroles = deballer(reponse?.response).slice(0, MOTS_MAX);
      if (!paroles) throw new Error("le modèle n'a rien écrit");
      return new Response(JSON.stringify({ paroles, modele }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-ecritures-du-jour": String(rang),
        },
      });
    } catch (erreur) {
      dernierEchec = erreur.message;
      // Modèle retiré ou inconnu : on passe au suivant. Toute autre panne est
      // définitive — insister ne ferait que multiplier les appels.
      if (!/deprecat|not found|no such model|5028/i.test(dernierEchec)) break;
    }
  }
  return new Response(JSON.stringify({ erreur: dernierEchec }), {
    status: 502,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
