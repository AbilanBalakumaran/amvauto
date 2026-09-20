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
import { annoncerDepot } from "./pousser.js";

const POIDS_MAX = 100_000_000;   // la limite d'un corps de requête chez Cloudflare

/* Combien de rendus on garde, et jusqu'où.

   Trois, c'était le compte d'un dépannage : de quoi ne pas perdre le dernier
   export. Ce n'est pas un historique. Depuis que le rendu se fait sur un runner
   et se dépose ici tout seul, le grenier EST l'historique — c'est là qu'on
   revient chercher un montage d'il y a trois semaines, sans avoir à le refaire.

   On borne donc par les deux bouts, et par le plus petit des deux : un nombre,
   pour que la liste reste lisible, et un poids, pour que la place occupée ne
   dépende pas de la durée des montages. Trois gigaoctets par code sur les dix
   offerts : trois personnes peuvent s'en servir sans jamais se gêner, et un
   rendu de quatre-vingt-dix mégaoctets en laisse passer une trentaine. */
const GARDES = 24;
const POIDS_PAR_CODE = 3 * 1024 ** 3;

/* Les limites qu'il ne faut pas dépasser, et qui ne sont écrites nulle part
   ailleurs que dans la grille tarifaire de Cloudflare.

   Dix gigaoctets de stockage R2 par mois sont gratuits ; au-delà, c'est payant.
   C'est la seule limite qui coûte de l'argent si on la franchit, donc la seule
   qui mérite d'être montrée en clair dans l'application plutôt que devinée. */
const PLAFOND_R2 = 10 * 1024 ** 3;
// R2 ne rend pas la taille d'un compartiment : il faut la compter. Mille objets
// par page, et l'on s'arrête à dix pages — au-delà, le total est annoncé comme
// partiel plutôt que faux.
const PAGES_MAX = 10;

async function place(env, code) {
  let octets = 0;
  let objets = 0;
  let curseur;
  let complet = true;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const liste = await env.GRENIER.list({ limit: 1000, cursor: curseur });
    for (const o of liste.objects) { octets += o.size || 0; objets += 1; }
    if (!liste.truncated) { curseur = undefined; break; }
    curseur = liste.cursor;
    if (page === PAGES_MAX - 1) complet = false;
  }
  const miens = await inventaire(env, code);
  return {
    plafond: PLAFOND_R2,
    utilise: octets,
    objets,
    complet,
    gardesParCode: GARDES,
    poidsMax: POIDS_MAX,
    mien: {
      octets: miens.reduce((somme, x) => somme + (x.taille || 0), 0),
      rendus: miens.length,
    },
  };
}
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
  // « include » est nécessaire : sans lui, R2 ne rend ni les métadonnées ni le
  // type, et la liste ne saurait dire que « rendu.mp4, 93 Mo ».
  const liste = await env.GRENIER.list({ prefix: `${code}/`, include: ["customMetadata", "httpMetadata"] });
  return liste.objects
    .map((o) => {
      const meta = o.customMetadata || {};
      return {
        nom: o.key.slice(code.length + 1),
        taille: o.size,
        quand: o.uploaded ? new Date(o.uploaded).getTime() : 0,
        type: o.httpMetadata?.contentType || "",
        // Ce que le rendu raconte de lui-même. Tout est facultatif : un dépôt
        // fait par une version plus ancienne n'en a aucun, et la liste doit
        // rester lisible quand même.
        projet: meta.projet || "",
        duree: Number(meta.duree) || 0,
        plans: Number(meta.plans) || 0,
        source: meta.source || "",
        musique: meta.musique || "",
      };
    })
    .sort((a, b) => b.quand - a.quand);
}

/* Ce qui doit partir pour que le grenier tienne ses deux bornes.

   Les plus récents d'abord : on garde tant qu'on est sous le compte ET sous le
   poids, et tout ce qui vient après s'en va. */
function aJeter(rendus) {
  const partants = [];
  let poids = 0;
  let gardes = 0;
  for (const rendu of rendus) {
    poids += rendu.taille || 0;
    gardes += 1;
    if (gardes > GARDES || poids > POIDS_PAR_CODE) partants.push(rendu);
  }
  return partants;
}

export async function grenier(request, url, env, ctx) {
  if (!env.GRENIER) return texte("grenier indisponible", 503);

  const code = nettoyer(url.searchParams.get("code"));
  // Vérifié avant toute lecture : un code mal recopié, ou tiré au hasard par
  // quelqu'un qui essaierait d'en trouver un, n'atteint jamais le stockage.
  if (!codeValide(code)) return texte("code invalide", 403);

  if (request.method === "GET") {
    // « place » : ce que le compartiment occupe, et ce qu'il a le droit
    // d'occuper. C'est ce que l'application montre dans ses réglages.
    if (url.searchParams.has("place")) return donnees(await place(env, code));
    const nom = url.searchParams.get("nom");
    if (!nom) return donnees({ rendus: await inventaire(env, code) });
    /* Le fichier, en entier ou par tranches.

       Une balise vidéo ne lit pas un fichier de quatre-vingt-dix mégaoctets d'un
       bloc : elle demande le début, puis se déplace. Sans les plages, tout
       arrivait avant la première image et l'on ne pouvait pas sauter dans la
       vidéo. C'est ce qui sépare « un fichier qu'on télécharge » d'« un rendu
       qu'on regarde ». */
    const plage = (request.headers.get("range") || "").match(/^bytes=(\d*)-(\d*)$/);
    const cle = `${code}/${nomPropre(nom)}`;
    const entetes = (objet, extra = {}) => ({
      "content-type": objet.httpMetadata?.contentType || "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      /* Sur un téléphone, un lien sans ce nom enregistre « grenier » sans
         suffixe, et le fichier n'est plus reconnu comme une vidéo. Il n'est posé
         que si l'on demande le téléchargement : sans cela, l'aperçu d'une balise
         vidéo se transformerait lui aussi en téléchargement. */
      ...(url.searchParams.has("telecharger")
        ? { "content-disposition": `attachment; filename="${nomPropre(nom)}"` }
        : {}),
      ...extra,
    });

    if (plage) {
      const tete = await env.GRENIER.head(cle);
      if (!tete) return texte("rendu introuvable", 404);
      /* Deux formes, et elles ne se lisent pas pareil : « bytes=100-499 » donne
         un début et une fin ; « bytes=-500 » demande les cinq cents DERNIERS
         octets. Les confondre renvoie le début du fichier à qui demandait la
         fin — un lecteur vidéo qui cherche l'index d'un MP4 ne trouve alors
         rien. */
      const suffixe = !plage[1];
      const debut = suffixe
        ? Math.max(0, tete.size - Number(plage[2] || 0))
        : Number(plage[1]);
      const fin = suffixe || !plage[2]
        ? tete.size - 1
        : Math.min(Number(plage[2]), tete.size - 1);
      if (!Number.isFinite(debut) || !(debut >= 0) || debut > fin || fin >= tete.size) {
        return new Response("plage hors du fichier", {
          status: 416, headers: { "content-range": `bytes */${tete.size}` },
        });
      }
      const morceau = await env.GRENIER.get(cle, { range: { offset: debut, length: fin - debut + 1 } });
      if (!morceau) return texte("rendu introuvable", 404);
      return new Response(morceau.body, {
        status: 206,
        headers: entetes(morceau, {
          "content-length": String(fin - debut + 1),
          "content-range": `bytes ${debut}-${fin}/${tete.size}`,
        }),
      });
    }

    const objet = await env.GRENIER.get(cle);
    if (!objet) return texte("rendu introuvable", 404);
    return new Response(objet.body, {
      headers: entetes(objet, { "content-length": String(objet.size) }),
    });
  }

  if (request.method === "PUT") {
    const type = (request.headers.get("content-type") || "").split(";")[0].trim();
    if (!TYPES.has(type)) return texte("ce grenier ne prend que des rendus", 415);
    const annonce = Number(request.headers.get("content-length") || 0);
    if (annonce > POIDS_MAX) return texte("rendu trop lourd", 413);

    const nom = nomPropre(url.searchParams.get("nom") || "rendu.mp4");

    /* Ce que le rendu raconte de lui-même, tel que le déposant le donne.

       Rien n'est obligatoire et rien n'est cru : ce sont des libellés, affichés
       tels quels dans une liste, jamais interprétés. On borne simplement leur
       longueur — R2 plafonne l'ensemble des métadonnées, et une liste se lit
       mieux avec des noms courts. */
    const mot = (nomChamp, combien = 80) =>
      String(url.searchParams.get(nomChamp) || "").slice(0, combien);
    const meta = {
      // Cent vingt : un titre de montage porte le nom du morceau en entier.
      projet: mot("projet", 120),
      duree: mot("duree", 12),
      plans: mot("plans", 6),
      source: mot("source", 20),
      musique: mot("musique", 80),
    };
    for (const [clef, valeur] of Object.entries(meta)) if (!valeur) delete meta[clef];

    /* Le fichier passe directement du réseau à R2, sans s'arrêter en mémoire.

       Il s'y arrêtait : « await request.arrayBuffer() » chargeait tout le rendu
       dans le tas du Worker avant de l'écrire. Un Worker dispose de cent
       vingt-huit mébioctets en tout ; un rendu de deux minutes vingt en pèse
       quatre-vingt-treize, et l'écriture en demande une seconde copie. C'était
       le dépôt le plus lourd qui échouait — c'est-à-dire précisément celui pour
       lequel tout ce chemin existe.

       Le corps de la requête est un flux : R2 sait le prendre tel quel, et rien
       n'est jamais tenu en entier. La longueur est déjà vérifiée plus haut,
       d'après ce que l'expéditeur annonce ; ce qui a réellement été écrit est
       vérifié en dessous, sur l'objet rendu. */
    if (!request.body) return texte("rendu vide", 400);
    const ecrit = await env.GRENIER.put(`${code}/${nom}`, request.body, {
      httpMetadata: { contentType: type },
      customMetadata: meta,
    }).catch(() => null);
    if (!ecrit) return texte("le dépôt a échoué", 502);
    if (!ecrit.size) {
      await env.GRENIER.delete(`${code}/${nom}`).catch(() => null);
      return texte("rendu vide", 400);
    }

    /* Le grenier tient ses deux bornes : un nombre de rendus, et un poids.
       Ce qui dépasse l'une ou l'autre s'en va, en commençant par le plus
       ancien. Sans cela, la place occupée ne dépendrait de rien. */
    const restants = await inventaire(env, code);
    for (const vieux of aJeter(restants)) {
      // eslint-disable-next-line no-await-in-loop
      await env.GRENIER.delete(`${code}/${vieux.nom}`).catch(() => null);
    }
    const inventaireFinal = await inventaire(env, code);

    /* Un dépôt, c'est un rendu prêt : c'est le seul moment où l'on a quelque
       chose à annoncer, et le seul endroit qui le sait à coup sûr. Le runner qui
       dépose n'attend pas la poussée — elle part après la réponse. */
    const prevenir = annoncerDepot(env, code, inventaireFinal.find((x) => x.nom === nom))
      .catch(() => null);
    if (ctx?.waitUntil) ctx.waitUntil(prevenir); else await prevenir;

    return donnees({ rendus: inventaireFinal });
  }

  if (request.method === "DELETE") {
    const nom = url.searchParams.get("nom");
    if (!nom) return texte("nom manquant", 400);
    await env.GRENIER.delete(`${code}/${nomPropre(nom)}`);
    return donnees({ rendus: await inventaire(env, code) });
  }

  return texte("méthode non permise", 405);
}
