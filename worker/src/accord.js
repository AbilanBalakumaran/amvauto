/* Accorder les plans aux paroles.

   Le montage automatique choisissait sur l'énergie : un drop appelait un plan de
   combat, un pont un plan calme. C'est juste, et c'est sourd — les paroles
   disent quelque chose, et rien ne l'écoutait.

   Depuis que les plans sont lus, on sait ce qu'ils montrent : « une jeune femme
   blessée observe des mains spectrales ramper ». Rapprocher ce texte d'un vers
   n'est plus un problème de vision, c'est un problème de langue — et le modèle
   de Workers AI le traite pour rien.

   Un seul appel par montage, quel que soit le nombre de plans. Le résultat est
   un ordre de préférence par section, pas un choix ferme : le montage garde la
   main, parce qu'il connaît des contraintes que le modèle ignore — la durée des
   sources, la fraîcheur, ce qui vient d'être montré. */

import { codeValide } from "./coffre.js";
import { compter } from "./quota.js";

const PAR_JOUR = 60;
const MODELES = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-3.2-3b-instruct",
];

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

const SYSTEME = [
  "You match animation shots to the parts of a song. Output JSON only.",
  "",
  "You get a song's lyrics, its sections in order, and a list of shots.",
  "Each shot has an id and a plain description of what is on screen.",
  "",
  "For every section, pick the shots whose CONTENT echoes what that part of the",
  "song is about — an image of rain for a line about rain, a turned back for a",
  "line about leaving. Prefer meaning over intensity: the montage already",
  "handles energy on its own.",
  "",
  'Answer exactly: {"sections":[{"i":0,"ids":["a","b","c"]}]}',
  "Six ids per section at most, best first. Use only ids from the list.",
].join("\n");

function consigne(demande) {
  const sections = demande.sections
    .map((s, i) => `  ${i}. ${s.nom || "section"} — ${Math.round(s.debut)}s to ${Math.round(s.fin)}s`)
    .join("\n");
  const plans = demande.plans
    .map((p) => `  ${p.id}: ${p.resume || "?"}${p.motscles?.length ? ` [${p.motscles.join(", ")}]` : ""}`)
    .join("\n");
  return [
    "LYRICS:",
    demande.paroles || "(instrumental — match the mood of each section instead)",
    "",
    "SECTIONS, in order:",
    sections,
    "",
    "SHOTS:",
    plans,
  ].join("\n");
}

/* Le modèle rend parfois son objet dans un bloc de code, ou précédé d'une
   phrase. On récupère la première accolade équilibrée plutôt que d'espérer. */
function extraire(brut) {
  const texte = String(brut || "");
  const debut = texte.indexOf("{");
  if (debut < 0) return null;
  let profondeur = 0;
  for (let i = debut; i < texte.length; i += 1) {
    if (texte[i] === "{") profondeur += 1;
    else if (texte[i] === "}") {
      profondeur -= 1;
      if (!profondeur) {
        try { return JSON.parse(texte.slice(debut, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export async function accorderParoles(request, url, env) {
  if (request.method !== "POST") return new Response("méthode non permise", { status: 405 });

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) {
    return new Response(JSON.stringify({ erreur: "Cette route demande un code de sauvegarde." }),
      { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
  }
  if (!env.AI) {
    return new Response(JSON.stringify({ erreur: "Workers AI n'est pas branché sur ce Worker." }),
      { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  let demande;
  try { demande = await request.json(); } catch { return new Response("demande illisible", { status: 400 }); }
  if (!Array.isArray(demande?.sections) || !demande.sections.length
    || !Array.isArray(demande?.plans) || !demande.plans.length) {
    return new Response("sections ou plans manquants", { status: 400 });
  }
  // Une centaine de plans suffit largement, et borne la consigne.
  demande.plans = demande.plans.slice(0, 100);
  demande.sections = demande.sections.slice(0, 24);

  const rang = await compter(env, "accord", code.slice(0, 8), PAR_JOUR);
  if (rang < 0) {
    return new Response(JSON.stringify({ erreur: `Plafond atteint : ${PAR_JOUR} accords pour aujourd'hui.` }),
      { status: 429, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  const connus = new Set(demande.plans.map((p) => String(p.id)));
  let dernierEchec = "aucun modèle disponible";
  for (const modele of MODELES) {
    try {
      const reponse = await env.AI.run(modele, {
        messages: [
          { role: "system", content: SYSTEME },
          { role: "user", content: consigne(demande) },
        ],
        max_tokens: 1200,
        temperature: 0.3,
      });
      const brut = reponse?.response;
      const rendu = brut && typeof brut === "object" ? brut : extraire(brut);
      if (!Array.isArray(rendu?.sections)) {
        throw new Error(`réponse inexploitable : ${JSON.stringify(brut ?? "(vide)").slice(0, 300)}`);
      }

      /* On ne fait pas confiance aux identifiants : un modèle en invente, ou
         recopie de travers. Ce qui ne correspond à rien est écarté ici plutôt
         que de faire échouer le montage plus loin. */
      const accords = {};
      rendu.sections.forEach((entree) => {
        const i = Number(entree?.i);
        if (!Number.isInteger(i) || i < 0 || i >= demande.sections.length) return;
        const ids = (Array.isArray(entree.ids) ? entree.ids : [])
          .map(String).filter((id) => connus.has(id)).slice(0, 6);
        if (ids.length) accords[i] = ids;
      });
      if (!Object.keys(accords).length) throw new Error("aucun plan reconnu dans la réponse");

      return new Response(JSON.stringify({ accords, modele }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-accords-du-jour": String(rang),
        },
      });
    } catch (erreur) {
      dernierEchec = erreur.message;
      if (!/deprecat|not found|no such model|5028/i.test(dernierEchec)) break;
    }
  }
  return new Response(JSON.stringify({ erreur: dernierEchec }), {
    status: 502,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
