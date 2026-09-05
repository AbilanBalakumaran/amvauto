/* Les extraits, calculés une fois pour tout le monde.

   Un extrait ne dépend que de trois choses : le fichier d'origine et les deux
   bornes du plan. Le même rush coupé au même endroit donne toujours exactement
   les mêmes octets — quel que soit l'appareil, quel que soit l'utilisateur.
   Le faire calculer par chaque téléphone, à chaque ouverture, c'est refaire
   cent soixante-quinze fois un travail dont le résultat était déjà connu.

   On le calcule donc ici, une fois, et on le range. Le téléphone ne télécharge
   plus le rush de dix mégaoctets ni ne le démultiplexe : il demande l'extrait,
   reçoit trois cents kilo-octets déjà découpés, et n'a plus rien à faire.

   Rien n'est réencodé — ni ici ni ailleurs. Les octets de l'extrait sont ceux
   du rush, à l'identique ; seules les tables du conteneur sont réécrites. C'est
   pourquoi ce travail tient dans un Worker, qui n'a ni décodeur ni encodeur.

   Et l'on ne télécharge pas le rush entier pour cela : les tables du fichier
   disent où sont les octets utiles, et l'on ne demande que ceux-là. Un extrait
   d'une seconde coûte donc, à la source, un ou deux mégaoctets — une seule
   fois dans la vie du fichier. */
import { lireMp4 } from "../../public/demux.js";
import { copiable, copierMorceau } from "../../public/copier.js";
import { trouverMoov, depuisPourFenetre, tranchePourFenetre, fondreTranches } from "../../public/plage.js";
import { HOTES } from "./media.js";

/* La version des extraits.

   Elle entre dans la clé de rangement : la changer met tout le monde d'accord
   sur des octets neufs sans avoir à vider quoi que ce soit. À monter dès que le
   découpage change de résultat. */
export const VERSION_EXTRAIT = 3;

/* Jusqu'où on accepte de déplacer un plan pour tomber sur une image-clé.

   Se caler dessus rend l'extrait deux à cinq fois plus léger : il ne porte plus
   le groupe d'images qui précède. Mais sur ces rushs-là — trois à six images-clés
   pour une demi-minute — l'image-clé la plus proche est parfois à trois secondes,
   et le plan montre alors une autre scène.

   Quatre dixièmes de seconde ne se voient pas sur un plan d'une seconde ; trois
   secondes changent tout. On se cale donc quand c'est gratuit, et pas autrement. */
const CALAGE_TOLERE = 0.4;

const TETE = 32768;
// Au-delà, l'extrait n'a plus d'intérêt : autant que l'appareil prenne le rush.
const PLAFOND_EXTRAIT = 12 * 1024 * 1024;
// Un extrait de plus de trente secondes n'est pas un plan, c'est une erreur.
const DUREE_MAX = 30;

const encodeur = new TextEncoder();

async function empreinte(texte) {
  const brut = await crypto.subtle.digest("SHA-256", encodeur.encode(texte));
  return [...new Uint8Array(brut)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/* Une requête vers la source, avec les mêmes règles que le relais : liste
   blanche à chaque saut, et jamais de redirection suivie à l'aveugle. */
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

/* Découper, à partir des seuls octets nécessaires.

   Rend les octets de l'extrait, ou une raison. Aucune exception ne sort d'ici :
   un extrait qu'on ne sait pas faire n'est pas une panne, c'est un plan que
   l'appareil préparera lui-même comme avant. */
async function decouper(adresse, entree, sortie) {
  const tete = await plageDe(adresse, 0, TETE);
  if (!tete || !tete.total) return { echec: "la source ne sert pas de plages" };
  if (tete.total > 512 * 1024 * 1024) return { echec: "rush trop gros" };

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
  if (!copiable(carte)) return { echec: `codec non recopiable (${carte.codec})` };

  const tranches = fondreTranches([
    tranchePourFenetre(carte, depuisPourFenetre(carte, entree), entree, sortie),
  ]);
  if (!tranches.length) return { echec: "aucune tranche" };

  for (const t of tranches) {
    // eslint-disable-next-line no-await-in-loop
    const morceau = await plageDe(adresse, t.debut, t.fin);
    if (!morceau) return { echec: "tranche illisible" };
    troue.set(morceau.octets.subarray(0, tete.total - t.debut), t.debut);
  }

  // Relire une fois les octets posés : les images-clés se vérifient dans le
  // flux, et ce flux vient seulement d'arriver.
  const remplie = lireMp4(troue);
  if (remplie.echec) return { echec: remplie.echec };

  /* Sans caler sur l'image-clé : l'instant choisi par l'utilisateur est gardé.

     Caler donnait des extraits deux à cinq fois plus légers, mais déplaçait le
     plan jusqu'à l'image-clé la plus proche — mesuré sur de vrais rushs de
     Sakugabooru, qui n'en comptent que trois à six pour une demi-minute : des
     écarts de 0,3 à 3,3 secondes, c'est-à-dire une autre scène. On garde donc
     le bon instant, l'extrait porte le groupe d'images qui le précède, et
     « decalage » dit où entrer dedans. */
  let proche = Infinity;
  for (const e of remplie.echantillons) {
    if (!e.cle) continue;
    proche = Math.min(proche, Math.abs(e.instant / remplie.echelle - entree));
  }
  const copie = copierMorceau(troue, remplie, entree, sortie, proche <= CALAGE_TOLERE);
  if (copie.echec) return { echec: copie.echec };
  const octets = new Uint8Array(await copie.mp4.arrayBuffer());
  if (!octets.length || octets.length > PLAFOND_EXTRAIT) return { echec: "extrait hors mesure" };
  return { octets, images: copie.images, duree: copie.couverte, decalage: copie.decalage,
    entree: copie.entree, largeur: copie.largeur, hauteur: copie.hauteur };
}

const entetes = (extra = {}) => ({
  "content-type": "video/mp4",
  // Un extrait ne change jamais : sa clé contient déjà tout ce qui le définit.
  "cache-control": "public, max-age=31536000, immutable",
  "timing-allow-origin": "*",
  ...extra,
});

export async function extrait(request, url, env, ctx) {
  const cible = url.searchParams.get("u");
  const entree = Number(url.searchParams.get("a"));
  const sortie = Number(url.searchParams.get("b"));
  if (!cible || !Number.isFinite(entree) || !Number.isFinite(sortie)) {
    return new Response("paramètres manquants", { status: 400 });
  }
  if (sortie <= entree || sortie - entree > DUREE_MAX || entree < 0) {
    return new Response("bornes invalides", { status: 400 });
  }

  let source;
  try { source = new URL(cible); } catch { return new Response("adresse invalide", { status: 400 }); }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const permis = HOTES.has(source.hostname)
    || (local && (source.hostname === "127.0.0.1" || source.hostname === "localhost"));
  if (!permis) return new Response("source non autorisée", { status: 403 });
  if (source.protocol !== "https:" && !local) return new Response("https requis", { status: 400 });

  const a = entree.toFixed(3);
  const b = sortie.toFixed(3);
  const cle = `extraits/v${VERSION_EXTRAIT}/${await empreinte(`${source.toString()}|${a}|${b}`)}.mp4`;

  if (env.GRENIER) {
    const range = await env.GRENIER.get(cle).catch(() => null);
    if (range) {
      /* Le décalage voyage avec l'extrait : sans lui, l'appareil ne sait pas où
         entrer dedans et montre le groupe d'images qui précède le plan. Il était
         rendu au calcul et perdu à la relecture — c'est-à-dire dans tous les cas
         qui comptent, puisqu'un extrait n'est calculé qu'une fois. */
      const meta = range.customMetadata || {};
      return new Response(range.body, { headers: entetes({
        "x-amvauto-extrait": "rangé",
        "x-amvauto-decalage": meta.decalage || "0",
        "x-amvauto-images": meta.images || "0",
      }) });
    }
  }

  const fait = await decouper(source, entree, sortie).catch((erreur) => ({ echec: String(erreur?.message || erreur) }));
  if (fait.echec) {
    // Pas une panne : l'appareil sait encore le faire lui-même.
    return new Response(fait.echec, { status: 422, headers: { "cache-control": "public, max-age=3600" } });
  }

  if (env.GRENIER) {
    const ranger = env.GRENIER.put(cle, fait.octets, {
      httpMetadata: { contentType: "video/mp4", cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: {
        decalage: String(Math.round((fait.decalage || 0) * 1000) / 1000),
        images: String(fait.images || 0),
      },
    }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(ranger); else await ranger;
  }

  return new Response(fait.octets, { headers: entetes({
    "x-amvauto-extrait": "calculé",
    /* Ce que l'appareil doit savoir pour poser l'extrait au bon endroit du
       montage : de combien il commence avant l'image demandée. La recopie cale
       la fenêtre sur une image-clé, et cette image-clé n'est pas toujours celle
       du plan. */
    "x-amvauto-decalage": String(Math.round((fait.decalage || 0) * 1000) / 1000),
    "x-amvauto-images": String(fait.images || 0),
  }) });
}
