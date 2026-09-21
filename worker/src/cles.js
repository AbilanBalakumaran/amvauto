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
import { codeValide } from "./coffre.js";

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
  /* Les images-clés d'un fichier ne changent jamais — son adresse est une
     empreinte de son contenu —, et la fiche était donc servie « immutable » pour
     un an. Elle ne l'est plus : le runner y écrit le sens du plan après coup, et
     une fiche gardée un an chez le visiteur ne verrait jamais cet ajout. Un jour
     de cache, avec une semaine de sursis pendant laquelle la version périmée est
     servie tout de suite pendant qu'une fraîche se prépare : le contenu stable
     ne coûte rien de plus, et l'enrichissement finit par arriver. */
  "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
};

/* ---- Le sens d'un plan, écrit par le runner -----------------------------

   Le raccord de mouvement est la règle la plus utile du montage — enchaîner un
   geste qui part à droite sur un geste qui part à droite se voit à peine, et
   l'inverse est ce qu'on garde pour les impacts. Elle dormait faute de savoir
   dans quel sens un plan bouge.

   Le mesurer demande de DÉCODER des images. Ce Worker ne le peut pas : il n'a ni
   ffmpeg, ni décodeur vidéo, et les vecteurs de mouvement d'un H.264 sont
   derrière un décodage entropique qu'on ne fait pas en trente secondes de
   processeur. Il lit des en-têtes, c'est tout ce qu'il sait faire.

   Le runner GitHub, lui, a ffmpeg — et il a déjà les fichiers sous la main quand
   il rend un AMV. Il mesure donc le sens de chaque plan qu'il vient d'employer,
   presque gratuitement, et l'écrit ici. La fiche du plan s'enrichit dans R2, et
   toutes les générations suivantes le trouvent posé.

   Conséquence assumée : la toute première génération sur une série n'a aucun
   sens à lire, et le montage y est celui d'avant. Le premier rendu réchauffe le
   catalogue, et c'est de plus en plus vrai à chaque AMV. On le dit dans le
   journal plutôt que de le cacher.

   Le code du coffre sert de laissez-passer — et il ne suffit pas d'en avoir la
   FORME. « codeValide » ne vérifie qu'une somme de contrôle : n'importe qui peut
   en calculer un, la fonction est dans la page. Pour le grenier ce n'est pas
   grave, le code y désigne l'espace de rangement du déposant et l'on n'écrit que
   chez soi. Ici, la fiche d'un rush est partagée par tout le monde : un code
   fabriqué permettrait d'écrire dans le cache de tous. On exige donc que le
   coffre EXISTE dans KV, c'est-à-dire que quelqu'un ait vraiment sauvegardé un
   montage sous ce code.

   Et l'on n'écrit QUE le sens : jamais les images-clés, jamais la durée —
   celles-là se lisent dans le fichier, elles ne se déclarent pas. Le pire qu'un
   déposant malveillant puisse faire est de se tromper de direction, ce qui coûte
   un raccord moins joli. */
const SENS_PERMIS = new Set(["left", "right", "up", "down", "still"]);

async function ecrireLeSens(request, url, env) {
  const code = url.searchParams.get("code") || "";
  if (!codeValide(code)) return new Response("code invalide", { status: 401 });
  // La forme est bonne ; reste à savoir si ce coffre a jamais existé.
  if (!env.COFFRE) return new Response("pas de coffre", { status: 503 });
  const connu = await env.COFFRE.get(`coffre:${code}`).catch(() => null);
  if (!connu) return new Response("coffre inconnu", { status: 401 });
  const cible = url.searchParams.get("u");
  if (!cible) return new Response("adresse manquante", { status: 400 });
  let source;
  try { source = new URL(cible); } catch { return new Response("adresse invalide", { status: 400 }); }
  if (!HOTES.has(source.hostname)) return new Response("source non autorisée", { status: 403 });
  if (!env.GRENIER) return new Response("pas de grenier", { status: 503 });

  let dit;
  try { dit = await request.json(); } catch { return new Response("corps illisible", { status: 400 }); }
  const sens = String(dit?.sens || "");
  if (!SENS_PERMIS.has(sens)) return new Response("sens inconnu", { status: 400 });
  const force = Math.max(0, Math.min(3, Number(dit?.force) || 0));

  const cle = `cles/v${VERSION_CLES}/${await empreinte(source.toString())}.json`;
  const range = await env.GRENIER.get(cle).catch(() => null);
  // On n'invente pas de fiche : sans lecture préalable, il n'y a rien à enrichir.
  if (!range) return new Response("fiche inconnue", { status: 404 });
  let fiche;
  try { fiche = await range.json(); } catch { return new Response("fiche illisible", { status: 500 }); }
  if (!fiche || fiche.echec) return new Response("fiche illisible", { status: 500 });

  fiche.sens = sens;
  fiche.sensForce = force;
  await env.GRENIER.put(cle, JSON.stringify(fiche), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=86400" },
  });
  return new Response(JSON.stringify({ ecrit: true, sens, force }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function cles(request, url, env, ctx) {
  if (request.method === "PUT") return ecrireLeSens(request, url, env);
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
      httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=86400" },
    }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(ranger); else await ranger;
  }
  return new Response(corps, { headers: entetes });
}
