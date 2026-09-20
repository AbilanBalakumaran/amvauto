/* Où sont les images-clés d'un rush.

   Un extrait ne peut commencer que sur une image-clé : un décodeur ne sait pas
   partir d'ailleurs. Quand le plan commence entre deux images-clés, l'extrait
   doit porter tout le groupe qui précède — et sur ces rushs-là, qui ne comptent
   que trois à six images-clés pour une demi-minute, ce groupe pèse plus lourd
   que le plan lui-même. Relevé sur l'appareil : 131 Mo d'extraits pour cent
   douze plans, soit 1,17 Mo chacun pour une seconde d'image.

   La solution n'est pas de déplacer les plans après coup — cela montrerait une
   autre scène — mais de CHOISIR leurs points d'entrée sur les images-clés dès
   la sélection. Pour cela il faut les connaître avant de couper, et c'est tout
   ce que fait cette route : deux petites requêtes par rush, une liste
   d'instants, rangée une fois pour tout le monde.

   Le calcul est celui de « extrait.js » — en-tête, « moov », tables — sans le
   moindre octet d'image. */
import { lireMp4 } from "../../public/demux.js";
import { trouverMoov } from "../../public/plage.js";
import { estWebm, lireWebm } from "../../public/webm.js";
import { HOTES } from "./media.js";

export const VERSION_CLES = 3;

/* Le mouvement d'un plan, lu dans le poids de ses images.

   Une image compressée pèse ce qu'elle a de nouveau à montrer. Un plan fixe sur
   un visage tient en un ou deux kilo-octets par image ; un panoramique, où
   chaque pixel se déplace, en pèse dix à trente fois plus. Et ce poids est déjà
   dans le « moov » que l'on télécharge pour les images-clés : la courbe de
   mouvement d'un rush ne coûte donc pas un octet de plus, et se garde au même
   endroit, pour toujours.

   Les images-clés sont exclues du calcul : une image-clé se décrit seule et pèse
   toujours beaucoup, ce qui ferait passer un plan fixe pour un mouvement à
   chaque début de groupe.

   L'unité est le milli-octet par pixel — le poids de l'image divisé par sa
   surface, en millièmes —, ce qui rend les valeurs comparables d'un rush à
   l'autre quelle que soit sa définition. Mesuré sur des rushs de Sakugabooru :
   0,002 pour un plan quasi immobile, 0,02 à 0,05 en régime ordinaire, 0,08 à
   0,31 dans un combat. Une valeur par demi-seconde, plafonnée à 255 pour tenir
   sur un octet. */
const PAS_MOUVEMENT = 0.5;
const ECHELLE_MOUVEMENT = 1000;

function courbeDeMouvement(ech, echelle, duree, largeur, hauteur) {
  const surface = (largeur || 0) * (hauteur || 0);
  if (!surface || !(duree > 0)) return null;
  const cases = Math.max(1, Math.ceil(duree / PAS_MOUVEMENT));
  const sommes = new Float64Array(cases);
  const nombres = new Float64Array(cases);
  for (const e of ech) {
    if (e.cle) continue;
    const i = Math.min(cases - 1, Math.max(0, Math.floor((e.instant / echelle) / PAS_MOUVEMENT)));
    sommes[i] += (e.taille || 0) / surface;
    nombres[i] += 1;
  }
  const valeurs = [];
  for (let i = 0; i < cases; i += 1) {
    const moyenne = nombres[i] ? sommes[i] / nombres[i] : 0;
    valeurs.push(Math.min(255, Math.round(moyenne * ECHELLE_MOUVEMENT)));
  }
  // Un rush dont aucune demi-seconde ne bouge n'a rien à dire de son mouvement.
  return valeurs.some((v) => v > 0) ? { pas: PAS_MOUVEMENT, valeurs } : null;
}

const TETE = 65536;
// Les Cues d'un WebM sont à la fin du fichier : c'est là que se lisent ses
// images-clés, donc ses changements de plan.
const QUEUE_WEBM = 65536;
const encodeur = new TextEncoder();

async function empreinte(texte) {
  const brut = await crypto.subtle.digest("SHA-256", encodeur.encode(texte));
  return [...new Uint8Array(brut)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

async function amont(adresse, plage) {
  const entetes = { "User-Agent": "amvauto/0.1 (+https://github.com/AbilanBalakumaran/amvauto)" };
  if (plage) entetes.Range = plage;
  let ou = adresse;
  for (let saut = 0; ; saut += 1) {
    // eslint-disable-next-line no-await-in-loop
    const reponse = await fetch(ou.toString(), { headers: entetes, redirect: "manual",
      cf: { cacheEverything: true, cacheTtl: 2592000 } });
    if (![301, 302, 303, 307, 308].includes(reponse.status)) return reponse;
    if (saut >= 3) return null;
    let suite;
    try { suite = new URL(reponse.headers.get("location") || "", ou); } catch { return null; }
    if (suite.protocol !== "https:" || !HOTES.has(suite.hostname)) return null;
    ou = suite;
  }
}

async function plageDe(adresse, debut, fin) {
  const reponse = await amont(adresse, fin === undefined ? `bytes=${debut}-` : `bytes=${debut}-${fin - 1}`);
  if (!reponse || reponse.status !== 206) return null;
  const total = Number((reponse.headers.get("content-range") || "").split("/")[1]) || 0;
  return { octets: new Uint8Array(await reponse.arrayBuffer()), total };
}

/* Les derniers octets d'un fichier, sans savoir sa taille : c'est une plage
   suffixe, que tout serveur qui sert des plages comprend. */
async function plageSuffixe(adresse, combien) {
  const reponse = await amont(adresse, `bytes=-${combien}`);
  if (!reponse || reponse.status !== 206) return null;
  return { octets: new Uint8Array(await reponse.arrayBuffer()) };
}

async function lireCles(adresse) {
  const tete = await plageDe(adresse, 0, TETE);
  if (!tete || !tete.total) return { echec: "la source ne sert pas de plages" };

  /* Un WebM ne se lit pas comme un MP4, et c'est ce qui tenait AnimeThemes hors
     du montage : sans durée ni images-clés, ses génériques étaient écartés. La
     tête porte l'échelle de temps, la durée et la définition ; la queue porte les
     Cues, c'est-à-dire la carte des plans. */
  if (estWebm(tete.octets)) {
    const queue = await plageSuffixe(adresse, QUEUE_WEBM);
    const lu = lireWebm(tete.octets, queue?.octets || null);
    if (lu.echec) return lu;
    if (!lu.cles?.length) return { echec: "aucune image-clé dans les Cues" };
    return lu;
  }

  const ou = trouverMoov(tete.octets);
  if (ou.ou < 0 || ou.ou >= tete.total) return { echec: "pas de moov" };

  const troue = new Uint8Array(tete.total);
  troue.set(tete.octets, 0);
  if (!ou.present) {
    const moov = await plageDe(adresse, ou.ou, ou.taille ? ou.ou + ou.taille : undefined);
    if (!moov) return { echec: "moov illisible" };
    troue.set(moov.octets.subarray(0, tete.total - ou.ou), ou.ou);
  }

  const carte = lireMp4(troue);
  if (carte.echec) return { echec: carte.echec };
  const ech = carte.echantillons || [];
  if (!ech.length) return { echec: "aucun échantillon" };

  let duree = 0;
  const cles = [];
  for (const e of ech) {
    duree = Math.max(duree, (e.instant + e.duree) / carte.echelle);
    if (e.cle) cles.push(Math.round((e.instant / carte.echelle) * 1000) / 1000);
  }
  cles.sort((a, b) => a - b);
  return { duree: Math.round(duree * 1000) / 1000, cles, codec: carte.codec,
    largeur: carte.largeur, hauteur: carte.hauteur,
    mouvement: courbeDeMouvement(ech, carte.echelle, duree, carte.largeur, carte.hauteur) };
}

const entetes = {
  "content-type": "application/json; charset=utf-8",
  // Les images-clés d'un fichier ne changent jamais : son adresse est une
  // empreinte de son contenu.
  "cache-control": "public, max-age=31536000, immutable",
};

export async function cles(request, url, env, ctx) {
  const cible = url.searchParams.get("u");
  if (!cible) return new Response("adresse manquante", { status: 400 });
  let source;
  try { source = new URL(cible); } catch { return new Response("adresse invalide", { status: 400 }); }

  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const permis = HOTES.has(source.hostname)
    || (local && (source.hostname === "127.0.0.1" || source.hostname === "localhost"));
  if (!permis) return new Response("source non autorisée", { status: 403 });
  if (source.protocol !== "https:" && !local) return new Response("https requis", { status: 400 });

  const cle = `cles/v${VERSION_CLES}/${await empreinte(source.toString())}.json`;
  if (env.GRENIER) {
    const range = await env.GRENIER.get(cle).catch(() => null);
    if (range) return new Response(range.body, { headers: entetes });
  }

  const fait = await lireCles(source).catch((erreur) => ({ echec: String(erreur?.message || erreur) }));
  if (fait.echec) {
    // Pas une panne : sans images-clés, le montage coupe comme avant.
    return new Response(JSON.stringify({ echec: fait.echec }),
      { status: 422, headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
  }

  const corps = JSON.stringify(fait);
  if (env.GRENIER) {
    const ranger = env.GRENIER.put(cle, corps, {
      httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=31536000, immutable" },
    }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(ranger); else await ranger;
  }
  return new Response(corps, { headers: entetes });
}
