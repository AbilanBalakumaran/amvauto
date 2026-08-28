/* La fabrique de segments.

   Un bloc de montage est un fichier et deux bornes. Le lire, c'est ouvrir le
   fichier, se déplacer sur la borne d'entrée, jouer une seconde, puis
   recommencer ailleurs — et chaque coupe est une discontinuité que le décodeur
   doit encaisser. Mesuré dans ce dépôt : quarante à quatre-vingt-onze
   interruptions par lecture, contre zéro quand le montage est un seul fichier.

   Cette fabrique prépare, pour chaque bloc, un petit MP4 qui contient exactement
   ce bloc et qui commence à zéro. Le lire ne demande alors plus aucun
   déplacement : le lecteur ouvre un fichier de cent cinquante kilo-octets et le
   joue du début à la fin. C'est le cache de rendu de n'importe quel banc de
   montage, à ceci près qu'il travaille par bloc et non par montage : rogner un
   plan refait un segment d'une seconde et demie, pas le film entier.

   Elle tourne sur son propre fil. Rien de ce qu'elle fait ne doit jamais tomber
   dans la boucle qui produit l'image suivante. */

import { lireMp4, departCle, reculerCle } from "./demux.js";
import { mesurer, apercuLuma, bandeFigee, abimee } from "./juge.js";
import { copiable, copierMorceau } from "./copier.js";
import { ecrireMp4, estAnnexB, unitesAnnexB, versAvcc, avcCDepuis } from "./mp4.js";

/* Les cartes et les octets des fichiers, gardés d'un segment à l'autre : un
   montage tire cent blocs de vingt-quatre rushs, et relire le même fichier à
   chaque bloc serait le gros du travail. */
const cartes = new Map();
const octets = new Map();
const GARDEES = 2;

function ranger(table, cle, valeur) {
  table.set(cle, valeur);
  while (table.size > GARDEES) table.delete(table.keys().next().value);
  return valeur;
}

async function fichierDe(cle, blob) {
  if (cle && octets.has(cle)) return octets.get(cle);
  const donnees = new Uint8Array(await blob.arrayBuffer());
  return cle ? ranger(octets, cle, donnees) : donnees;
}

function carteDe(cle, donnees) {
  if (cle && cartes.has(cle)) return cartes.get(cle);
  const carte = lireMp4(donnees);
  return cle && !carte.echec ? ranger(cartes, cle, carte) : carte;
}

/* Les codecs essayés, dans l'ordre — la même liste que l'export, et pour la
   même raison : H.264 est celui que lisent les téléphones, VP8 est le secours
   des navigateurs sans codec propriétaire. */
const CODECS = ["avc1.42E01E", "avc1.4D401E", "avc1.640028", "vp8"];

async function choisirCodec(config) {
  for (const codec of CODECS) {
    try {
      const essai = await VideoEncoder.isConfigSupported({ ...config, codec });
      if (essai.supported) return codec;
    } catch { /* codec inconnu de ce navigateur */ }
  }
  return null;
}

/* Recoller les segments en un seul fichier.

   C'est le geste qui manquait, et il ne coûte presque rien : les segments ont
   tous le même codec, le même cadre et la même cadence — recoller revient à
   copier leurs octets bout à bout et à écrire un seul plan de fichier. Aucun
   décodage, aucun encodage.

   Ce que cela donne à la lecture est ce qu'une application native obtient d'une
   « composition » : un seul flux, un seul décodeur, aucune coupe à encaisser.
   Chaque bloc commence par une image-clé, donc se déplacer dans le montage
   reste immédiat.

   La contrainte est stricte et vérifiée : un segment qui n'a pas exactement le
   même codec, la même taille ni la même description que le premier fait échouer
   l'assemblage plutôt que de produire un fichier illisible. */
function memeDescription(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
}

/* Décoder une image avec des paramètres donnés, et la rendre en trente-deux
   points de large. Sert à prouver qu'un segment se décode correctement avec les
   paramètres du fichier recollé — pas à le supposer. */
async function imageAvec(config, octets) {
  if (typeof VideoDecoder !== "function") return null;
  try {
    if (!(await VideoDecoder.isConfigSupported(config)).supported) return null;
  } catch { return null; }
  return new Promise((rendre) => {
    let fini = false;
    const finir = (v) => { if (!fini) { fini = true; rendre(v); } };
    let decodeur;
    try {
      decodeur = new VideoDecoder({
        output: (image) => {
          try {
            const t = new OffscreenCanvas(32, 18);
            const c = t.getContext("2d", { willReadFrequently: true });
            c.drawImage(image, 0, 0, 32, 18);
            const d = c.getImageData(0, 0, 32, 18).data;
            const gris = new Uint8Array(32 * 18);
            for (let i = 0, k = 0; i < d.length; i += 4, k += 1) {
              gris[k] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
            }
            finir(gris);
          } catch { finir(null); } finally { image.close(); }
        },
        error: () => finir(null),
      });
      decodeur.configure(config);
      decodeur.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: octets }));
      decodeur.flush().then(() => finir(null)).catch(() => finir(null));
    } catch { finir(null); }
    setTimeout(() => finir(null), 4000);
  });
}

/* La preuve, pas le raisonnement.

   On a d'abord comparé les octets de la description : nécessaire, mais pas
   suffisant — rien ne dit qu'un décodeur réel se comportera comme prévu. Ce qui
   décide, c'est l'image. On décode donc la première image-clé du dernier
   segment deux fois : une fois avec les paramètres du fichier recollé, une fois
   avec les siens. Si les deux images diffèrent, le fichier recollé ment, et on
   ne le livre pas.

   C'est bon marché : deux images, une seule fois par recollage. */
async function verifierFlux(piste, dernier) {
  if (!dernier || typeof VideoDecoder !== "function") return "";
  const ech = dernier.carte.echantillons || [];
  const i = ech.findIndex((e) => e.cle);
  if (i < 0) return "";
  const octets = dernier.donnees.slice(ech[i].ou, ech[i].ou + ech[i].taille);
  const base = { codedWidth: dernier.carte.largeur, codedHeight: dernier.carte.hauteur };
  const avecMontage = await imageAvec(
    { ...base, codec: piste.codec, ...(piste.description ? { description: piste.description } : {}) },
    octets,
  );
  const avecSien = await imageAvec(
    { ...base, codec: dernier.carte.codec,
      ...(dernier.carte.description ? { description: dernier.carte.description } : {}) },
    octets,
  );
  // Le segment seul ne se décode pas : ce n'est pas le recollage qui est en
  // cause, et on ne peut rien conclure.
  if (!avecSien) return "";
  if (!avecMontage) return "un segment ne se décode pas avec les paramètres du montage";
  let ecart = 0;
  for (let k = 0; k < avecSien.length; k += 1) ecart += Math.abs(avecSien[k] - avecMontage[k]);
  ecart /= avecSien.length;
  return ecart > 12 ? `le montage décode faux (écart ${Math.round(ecart)})` : "";
}

/* Relire un segment fraîchement écrit et le comparer à ce qu'il devrait
   montrer. Rend une raison si le fichier est faux, une chaîne vide sinon. */
async function relireSegment(mp4, attendu) {
  if (!attendu || typeof VideoDecoder !== "function") return "";
  let carte;
  try {
    carte = lireMp4(await mp4.arrayBuffer());
  } catch { return "le segment produit ne se relit pas"; }
  if (carte.echec) return `le segment produit est illisible (${carte.echec})`;
  const ech = carte.echantillons || [];
  const i = ech.findIndex((x) => x.cle);
  if (i < 0) return "le segment produit n'a pas d'image-clé";
  const donnees = new Uint8Array(await mp4.arrayBuffer());
  const octets = donnees.slice(ech[i].ou, ech[i].ou + ech[i].taille);
  const vu = await imageAvec({
    codec: carte.codec, codedWidth: carte.largeur, codedHeight: carte.hauteur,
    ...(carte.description ? { description: carte.description } : {}),
  }, octets);
  if (!vu) return "le segment produit ne se décode pas";
  let ecart = 0;
  for (let k = 0; k < attendu.length; k += 1) ecart += Math.abs(attendu[k] - vu[k]);
  ecart /= attendu.length;
  return ecart > 18 ? `le segment produit ne montre pas la bonne image (écart ${Math.round(ecart)})` : "";
}

async function assembler(morceaux) {
  const ECHELLE = 90000;
  let piste = null;
  let dernier = null;
  for (const morceau of morceaux) {
    const donnees = new Uint8Array(await morceau.arrayBuffer());
    const carte = lireMp4(donnees);
    if (carte.echec) return { echec: `segment illisible : ${carte.echec}` };
    if (!piste) {
      piste = { id: 1, type: "video", codec: carte.codec, echelle: ECHELLE,
        largeur: carte.largeur, hauteur: carte.hauteur,
        description: carte.description ? new Uint8Array(carte.description) : null,
        echantillons: [] };
    } else if (carte.codec !== piste.codec || carte.largeur !== piste.largeur
               || carte.hauteur !== piste.hauteur) {
      return { echec: "segments de définitions différentes" };
    } else if (!memeDescription(piste.description, carte.description)) {
      /* La description du flux — les paramètres SPS et PPS — décrit comment
         décoder les images. Le fichier recollé n'en porte qu'une, celle du
         premier segment. Si un segment suivant a été encodé avec des paramètres
         différents, ses images sont décodées avec les mauvaises consignes : les
         macroblocs se déplacent, les couleurs bavent, et l'on voit une bouillie
         colorée à la place de l'image. C'est ce qui a été photographié.

         Deux segments de même codec et de même taille peuvent parfaitement
         avoir des descriptions différentes — il suffit que l'encodeur ait choisi
         un autre niveau, ce qu'il fait selon le débit. On compare donc les
         octets, et l'on refuse plutôt que de fabriquer un fichier qui ne se
         décode pas. */
      /* Et depuis que les segments sont recopiés de leurs rushs sans être
         réencodés, c'est devenu le cas ordinaire : deux rushs différents n'ont
         aucune raison de partager leurs paramètres. Ce n'est plus une panne,
         c'est la contrepartie de l'image exacte — et le nom du refus le dit,
         pour que l'application n'en fasse pas une alerte. */
      return { echec: "segments de définitions différentes" };
    }
    dernier = { carte, donnees };
    for (const e of carte.echantillons) {
      piste.echantillons.push({
        octets: donnees.subarray(e.ou, e.ou + e.taille),
        taille: e.taille,
        duree: Math.max(1, Math.round((e.duree / carte.echelle) * ECHELLE)),
        // L'écart entre décodage et affichage suit l'image : sans lui, un flux
        // recopié s'afficherait dans l'ordre où il a été décodé.
        composition: Math.round(((e.instant - e.decodage) / carte.echelle) * ECHELLE),
        cle: e.cle,
      });
    }
  }
  if (!piste || !piste.echantillons.length) return { echec: "rien à assembler" };
  const faux = await verifierFlux(piste, dernier);
  if (faux) return { echec: faux };
  const mp4 = ecrireMp4([piste]);
  return { mp4, images: piste.echantillons.length, octets: mp4.size,
    largeur: piste.largeur, hauteur: piste.hauteur };
}

self.onmessage = async (evt) => {
  const { id, blob, cle, entree, sortie, large, debit, haut, cadence: cadenceVoulue, recule } = evt.data || {};
  const repondre = (quoi) => self.postMessage({ id, ...quoi });

  if (Array.isArray(evt.data?.morceaux)) {
    try {
      repondre({ assemble: true, ...(await assembler(evt.data.morceaux)) });
    } catch (erreur) {
      repondre({ assemble: true, echec: String((erreur && erreur.name) || erreur || "erreur") });
    }
    return;
  }
  if (typeof VideoDecoder !== "function" || typeof VideoEncoder !== "function") {
    return repondre({ echec: "codecs indisponibles" });
  }

  let decodeur = null;
  let encodeur = null;
  try {
    const donnees = await fichierDe(cle, blob);
    const carte = carteDe(cle, donnees);
    if (carte.echec) return repondre({ echec: carte.echec });

    /* D'abord : ne rien encoder du tout.

       Le rush est déjà du H.264, à la bonne définition, encodé une fois pour
       toutes. Le morceau demandé est une suite d'images déjà compressées, à la
       file dans le fichier : le préparer, c'est recopier ces octets-là dans un
       petit conteneur. Le résultat est identique à la source au bit près — il
       ne peut pas être « mieux encodé », il est le même. Ni décodage, ni
       encodage, ni débit à régler : les carrés visibles à l'aperçu venaient tous
       de là, et il n'y a plus rien qui puisse les produire.

       Deux réserves. Un rush qu'on ne sait pas emballer — du WebM, et c'est le
       cas des génériques d'AnimeThemes — repart par l'ancien chemin. Et un rush
       nettement plus grand que l'écran garde un intérêt à être réduit : le
       recopier obligerait le téléphone à décoder du 1080p pour l'afficher en
       400 points.

       Ce chemin passe avant le test de compatibilité du décodeur, et c'est
       voulu : il ne décode rien. Un appareil dont le décodeur logiciel refuse
       l'H.264 sait tout de même lire un MP4 dans sa balise vidéo. */
    if (!recule && copiable(carte) && carte.largeur <= 1280) {
      const copie = copierMorceau(donnees, carte, entree, sortie);
      if (!copie.echec) {
        return repondre({
          mp4: copie.mp4,
          images: copie.images,
          largeur: copie.largeur,
          hauteur: copie.hauteur,
          duree: copie.couverte,
          octets: copie.octets,
          copie: true,
          decalage: copie.decalage,
          entreeReelle: copie.entree,
          verdict: null,
        });
      }
    }
    const config = { codec: carte.codec, codedWidth: carte.largeur, codedHeight: carte.hauteur };
    if (carte.description) config.description = carte.description;
    if (carte.accepte === undefined) {
      try { carte.accepte = (await VideoDecoder.isConfigSupported(config)).supported; }
      catch { carte.accepte = false; }
    }
    if (!carte.accepte) return repondre({ echec: `codec refusé (${carte.codec})` });


    /* La taille du segment : celle du moniteur, pas celle du rush.

       Un rush fait 854 à 960 points de large et pèse un débit fait pour analyser
       l'animation image par image. L'aperçu, lui, tient dans quatre cents points
       sur un téléphone. Réduire, c'est moins d'octets à lire et moins de pixels
       à décoder — donc précisément ce qui manque à un appareil qui peine. */
    /* Tous les segments dans le même cadre.

       Ils suivaient chacun la définition de leur rush. C'était plus simple et
       cela interdisait la suite : deux fichiers de tailles différentes ne se
       recollent pas sans tout réencoder. Un cadre unique, et le montage entier
       devient un assemblage d'octets — la seule façon, dans un navigateur,
       d'obtenir ce qu'une application native obtient d'une « composition » :
       un seul flux, un seul décodeur, aucune coupe à encaisser.

       L'image du rush y est posée entière, à son format, centrée. Les bords
       noirs sont ceux que le moniteur dessinait de toute façon. */
    const l = Math.max(2, Math.round((large || 640) / 2) * 2);
    const h = Math.max(2, Math.round((haut || Math.round((l * 9) / 16)) / 2) * 2);
    const cadre = new OffscreenCanvas(l, h);
    const ctxCadre = cadre.getContext("2d", { alpha: false });
    const poser = (image) => {
      const li = image.displayWidth || image.codedWidth || l;
      const hi = image.displayHeight || image.codedHeight || h;
      const f = Math.min(l / li, h / hi);
      const dl = Math.max(1, Math.round(li * f));
      const dh = Math.max(1, Math.round(hi * f));
      ctxCadre.fillStyle = "#000";
      ctxCadre.fillRect(0, 0, l, h);
      ctxCadre.drawImage(image, Math.round((l - dl) / 2), Math.round((h - dh) / 2), dl, dh);
    };

    const ech = carte.echantillons;
    const instant = (e) => e.instant / carte.echelle;
    // On repart de l'image-clé qui précède l'entrée : c'est la seule par où un
    // décodeur peut commencer. Ces images-là sont décodées puis jetées.
    let depuis = departCle(carte, entree);
    if (depuis < 0) return repondre({ echec: "aucune image-clé dans le fichier" });
    // Un bloc refait après un décodage raté repart d'une image-clé plus tôt.
    if (recule > 0) depuis = reculerCle(carte, depuis, recule);

    /* Et tous à la même cadence. Un montage assemblé de morceaux à vingt-trois
       et vingt-cinq images par seconde n'a pas de cadence du tout : on rééchan-
       tillonne sur celle du montage, en répétant ou en sautant une image quand
       il le faut. C'est ce que fait n'importe quel banc de montage. */
    const cadence = Math.max(1, Math.round(cadenceVoulue || 24));
    const sortieCodec = await choisirCodec({ width: l, height: h, framerate: cadence });
    if (!sortieCodec) return repondre({ echec: "aucun codec d'encodage" });

    const echelle = 90000;
    const piste = { id: 1, type: "video", codec: sortieCodec, echelle, largeur: l, hauteur: h,
      description: null, echantillons: [] };

    encodeur = new VideoEncoder({
      output: (bloc, meta) => {
        if (meta?.decoderConfig?.description && !piste.description) {
          piste.description = new Uint8Array(meta.decoderConfig.description);
        }
        const buf = new Uint8Array(bloc.byteLength);
        bloc.copyTo(buf);
        /* On regarde les octets plutôt que de croire la demande.

           « avc: { format: "avc" } » réclame des longueurs, pas des codes de
           départ. Le navigateur qui ne l'honore pas rend de l'Annex B, et l'on
           écrivait ces octets tels quels dans un MP4 qui annonce des longueurs :
           le décodeur lit alors une longueur là où il y a un code de départ, et
           saute au hasard dans le fichier. C'est la bouillie de macroblocs.

           On convertit donc, et l'on récupère au passage les jeux de paramètres
           que l'Annex B transporte dans le flux — ceux que la description
           n'apporte pas dans ce cas-là. */
        let octets = buf;
        if (estAnnexB(buf)) {
          const unites = unitesAnnexB(buf);
          if (!piste.description) {
            const sps = unites.find((u) => (u[0] & 0x1f) === 7);
            const pps = unites.find((u) => (u[0] & 0x1f) === 8);
            const avcc = avcCDepuis(sps, pps);
            if (avcc) piste.description = avcc;
          }
          octets = versAvcc(unites);
        }
        if (!octets.length) return;
        piste.echantillons.push({ octets, taille: octets.length,
          duree: Math.round(echelle / cadence), cle: bloc.type === "key" });
      },
      error: () => { /* relevé plus bas par l'absence d'échantillons */ },
    });
    encodeur.configure({ codec: sortieCodec, width: l, height: h, framerate: cadence,
      bitrate: debit || 900000,
      ...(sortieCodec.startsWith("avc1") ? { avc: { format: "avc" } } : {}) });

    /* Regarder ce qu'on décode, puisqu'on le décode.

       Un bloc peut être juste sur le papier — bonnes bornes, bon fichier — et
       ne rien montrer : un fondu au noir, un carton blanc, un plan fixe où rien
       ne bouge. Rien dans les données d'un rush ne le dit ; il faut voir les
       images. La fabrique les a toutes sous la main.

       On échantillonne une image sur trois, réduite à trente-deux points de
       large : de quoi mesurer une luminance moyenne et un mouvement d'une image
       à l'autre, pour un coût qui ne se mesure pas. */
    const controle = new OffscreenCanvas(32, 18);
    const ctxControle = controle.getContext("2d", { willReadFrequently: true });
    const lumas = [];
    // La toute première image du bloc, gardée pour la relire après encodage.
    let premierGris = null;
    const bouges = [];
    let precedent = null;

    /* Et le contrôle du décodage lui-même, qui ne se fait pas au même endroit.

       Ce qui précède juge le contenu — noir, blanc, figé — et se contente de
       trente-deux points. Reconnaître une image que le décodeur a ratée demande
       autre chose : la grille de seize pixels sur laquelle il travaille, et
       celle-ci n'existe qu'à la taille d'origine du rush. Réduite, elle a
       disparu ; c'est pourquoi le contrôle d'avant ne voyait jamais rien.

       On regarde donc deux images source entières par bloc, pas une de plus :
       chacune coûte une lecture de pixels et une passe de mesure, et le banc a
       montré qu'à quatre le contrôle mangeait la lecture — vingt-trois images
       par seconde tombées à deux. Deux suffisent : une panne de décodage ne
       touche jamais une image isolée, elle dure jusqu'à l'image-clé suivante. */
    /* Quand regarder : par paires, et à deux endroits du bloc.

       Par paires, parce que la tranche perdue — une bande de l'image restée sur
       l'image d'avant — ne se voit qu'en comparant deux images qui se suivent
       vraiment. À deux endroits, parce qu'une panne née à l'entrée du bloc et
       une panne née au milieu ne se ressemblent pas : la première vient du point
       où l'on a posé le décodeur, la seconde d'une image abîmée dans le rush. */
    const QUAND_JUGER = new Set([0, 1]);
    let toile = null;
    let ctxToile = null;
    let avant = null;
    const juges = [];
    let jugees = 0;

    let rang = -1;
    const juger = (image) => {
      rang += 1;
      if (!QUAND_JUGER.has(rang)) return;
      const li = image.codedWidth || image.displayWidth;
      const hi = image.codedHeight || image.displayHeight;
      if (!li || !hi || li < 48 || hi < 48) return;
      try {
        if (!toile || toile.width !== li || toile.height !== hi) {
          toile = new OffscreenCanvas(li, hi);
          ctxToile = toile.getContext("2d", { alpha: false, willReadFrequently: true });
        }
        ctxToile.drawImage(image, 0, 0, li, hi);
        const donnees = ctxToile.getImageData(0, 0, li, hi).data;
        const m = mesurer(donnees, li, hi);
        const apercu = apercuLuma(donnees, li, hi);
        // Deux images qui se suivent : la comparaison n'a de sens que là.
        const mouvement = QUAND_JUGER.has(rang - 1) && avant ? bandeFigee(avant, apercu) : null;
        avant = apercu;
        jugees += 1;
        const mal = abimee(m, mouvement);
        if (mal) juges.push(mal);
      } catch { /* une image qu'on ne sait pas lire ne prouve rien */ }
    };

    const inspecter = (image) => {
      if (!ctxControle) return;
      try {
        ctxControle.drawImage(image, 0, 0, 32, 18);
        const donnees = ctxControle.getImageData(0, 0, 32, 18).data;
        let somme = 0;
        let bouge = 0;
        const gris = new Uint8Array(32 * 18);
        for (let i = 0, k = 0; i < donnees.length; i += 4, k += 1) {
          // Luminance perçue, en entiers : le vert pèse le plus, le bleu le moins.
          const y = (donnees[i] * 77 + donnees[i + 1] * 150 + donnees[i + 2] * 29) >> 8;
          gris[k] = y;
          somme += y;
          if (precedent) bouge += Math.abs(y - precedent[k]);
        }
        lumas.push(somme / gris.length);
        if (precedent) bouges.push(bouge / gris.length);
        if (!premierGris) premierGris = gris;
        precedent = gris;
      } catch { /* image illisible : on ne saura rien de celle-là */ }
    };

    let gardees = 0;
    let casse = false;
    const combien = Math.max(1, Math.round((sortie - entree) * cadence));
    let prochaine = 0;          // index de la prochaine image à produire

    /* Produire les images du segment à cadence fixe.

       On ne recopie plus les images du rush une par une : on avance sur une
       grille régulière, et pour chaque case on prend la dernière image décodée
       qui lui appartient. Un rush plus lent voit ses images répétées, un rush
       plus rapide en perd — et le segment fait exactement le nombre d'images
       que le montage attend. */
    const produire = (image, jusqua) => {
      while (prochaine < combien && prochaine / cadence <= jusqua + 1e-6) {
        poser(image);
        const sortie2 = new VideoFrame(cadre, {
          timestamp: Math.round((prochaine / cadence) * 1e6),
          duration: Math.round(1e6 / cadence),
        });
        if (prochaine % 3 === 0) inspecter(sortie2);
        try {
          encodeur.encode(sortie2, { keyFrame: prochaine === 0 });
          gardees += 1;
        } catch { casse = true; }
        sortie2.close();
        prochaine += 1;
      }
    };

    let derniere = null;
    decodeur = new VideoDecoder({
      output: (image) => {
        const t = image.timestamp / 1e6;
        if (t < entree - 0.001) { image.close(); return; }
        if (t > sortie + 0.001) { image.close(); return; }
        // Juger l'image du rush, entière et à sa taille : c'est la seule où la
        // grille du décodeur existe encore.
        juger(image);
        // Les cases jusqu'à cette image reviennent à la précédente.
        if (derniere) { produire(derniere.image, t - entree - 1e-6); derniere.image.close(); }
        derniere = { image, t };
      },
      error: () => { casse = true; },
    });
    decodeur.configure(config);

    /* On s'arrête sur l'instant de décodage, pas sur celui d'affichage.

       Les deux ne vont pas dans le même sens : une image B s'affiche après des
       images décodées plus tard qu'elle. Couper la boucle au premier instant
       d'affichage dépassé, c'est priver le décodeur d'images dont il a encore
       besoin — et retomber, autrement, sur la même bouillie. Une demi-seconde
       de marge couvre largement le réordonnancement de n'importe quel encodeur.
     */
    const MARGE_REORDRE = 0.5;
    for (let i = depuis; i < ech.length; i += 1) {
      const e = ech[i];
      if (e.decodage / carte.echelle > sortie + MARGE_REORDRE) break;
      decodeur.decode(new EncodedVideoChunk({
        // La toute première image donnée à un décodeur doit être une clé :
        // « departCle » n'en rend pas d'autre, et on ne le suppose pas.
        type: e.cle || i === depuis ? "key" : "delta",
        timestamp: Math.round(instant(e) * 1e6),
        duration: Math.round((e.duree / carte.echelle) * 1e6),
        data: donnees.subarray(e.ou, e.ou + e.taille),
      }));
      // On ne noie pas le décodeur : il rendrait la main bien après la fin.
      if (decodeur.decodeQueueSize > 24) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((suite) => { decodeur.addEventListener?.("dequeue", suite, { once: true }); setTimeout(suite, 40); });
      }
    }
    await decodeur.flush().catch(() => { casse = true; });
    // La dernière image remplit les cases qui restent jusqu'au bout du bloc.
    if (derniere) { produire(derniere.image, (sortie - entree) + 1); derniere.image.close(); derniere = null; }
    await encodeur.flush().catch(() => { casse = true; });

    if (casse || !piste.echantillons.length) return repondre({ echec: "fabrication interrompue" });

    /* Le verdict sur ce bloc.

       Noir ou blanc : la plupart des images échantillonnées sont dans un
       extrême, c'est-à-dire un fondu ou un carton. Figé : d'une image à l'autre,
       presque rien ne change — un plan d'attente, une image tenue par le rush
       lui-même. Les seuils sont larges à dessein : on ne corrige que ce qui ne
       fait aucun doute, parce qu'une correction déplace le montage. */
    const moyenne = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const sombres = lumas.filter((x) => x < 14).length;
    const clairs = lumas.filter((x) => x > 242).length;
    const bouge = moyenne(bouges);

    /* Le mouvement décide, la luminance ne fait que nommer.

       Premier essai : « sombre = noir ». La règle était fausse et dangereuse.
       Une scène de nuit, du sakuga sur fond noir, une silhouette sur ciel
       étoilé — tout cela est sombre et parfaitement valable. Vérifié sur un
       rush fabriqué exprès : deux blocs sains sur quatre étaient condamnés,
       donc deux blocs du montage auraient été déplacés sans raison.

       Ce qui fait qu'un bloc ne montre rien, ce n'est pas qu'il soit sombre :
       c'est qu'il ne se passe rien. Un bloc n'est donc suspect que si le
       mouvement moyen d'une image à l'autre est quasi nul — et la luminance ne
       sert plus qu'à dire de quoi il s'agit : fondu au noir, carton blanc, ou
       plan d'attente. */
    const immobile = bouges.length >= 3 && bouge < 1.2;

    /* Le noir du début, qui n'est pas le noir du bloc.

       Un bloc qui commence par un fondu au noir et s'anime ensuite n'était
       jamais condamné — et il ne doit pas l'être, il contient quelque chose.
       Mais ce qu'on voit à l'écran, c'est un plan qui commence par du noir : sur
       un bloc d'une seconde, un tiers de noir se remarque autant qu'un bloc
       entièrement noir.

       On compte donc les images sombres du début, et on les rend en secondes.
       L'application décalera le bloc d'autant, sans changer sa durée. */
    let tete = 0;
    while (tete < lumas.length && lumas[tete] < 14) tete += 1;
    // Une image échantillonnée sur trois : chaque échantillon vaut trois images.
    const debutNoir = tete >= lumas.length ? 0 : (tete * 3) / cadence;

    const verdict = {
      /* La première image du bloc, en trente-deux points sur dix-huit.

         Elle voyage jusqu'à l'application pour que celle-ci puisse vérifier ce
         que le vrai lecteur vidéo, lui, affiche de ce fichier. Cinq cent
         soixante-seize octets : c'est le prix d'une preuve. */
      apercu: premierGris ? Array.from(premierGris) : null,
      debutNoir: Math.round(debutNoir * 100) / 100,
      luminance: Math.round(moyenne(lumas)),
      mouvement: Math.round(bouge * 10) / 10,
      vues: lumas.length,
      noir: immobile && lumas.length >= 3 && sombres >= lumas.length * 0.8,
      blanc: immobile && lumas.length >= 3 && clairs >= lumas.length * 0.8,
      fige: immobile,
      /* Le décodage lui-même a-t-il raté ?

         Il faut deux images d'accord, pas une. Le détecteur n'accuse aucune
         image propre sur les deux cent soixante-dix du corpus, mais il travaille
         ici sur des rushs qu'aucun corpus ne contient : une seule image
         douteuse ne doit pas faire refaire un bloc qui allait bien. Une panne
         de décodage, elle, ne touche jamais une image isolée — elle dure
         jusqu'à l'image-clé suivante, donc bien au-delà de deux prises. */
      abime: juges.length >= 2 ? { quoi: juges[0].quoi, valeur: juges[0].valeur, combien: juges.length } : null,
    };

    const mp4 = ecrireMp4([piste]);

    /* Relire ce qu'on vient d'écrire.

       Trois défauts successifs ont produit la même bouillie de macroblocs, et
       aucun n'était visible depuis le banc d'essai : ils tenaient à ce que le
       navigateur de l'appareil fait de sa sortie d'encodage, et à ce que notre
       propre emballage en fait ensuite. Raisonner sur les octets ne suffit
       manifestement pas.

       On décode donc la première image du fichier qu'on vient de fabriquer, et
       on la compare à l'image qu'on avait sous les yeux avant de l'encoder. Si
       elles ne se ressemblent pas, le fichier est faux — quelle qu'en soit la
       raison, connue ou non — et on ne le livre pas. Le plan se lira depuis son
       rush : moins fluide, mais juste.

       Une image décodée par segment. C'est le prix d'une garantie. */
    const relu = await relireSegment(mp4, premierGris);
    if (relu) return repondre({ echec: relu });

    /* Un bloc dont les images source sont abîmées ne se livre pas.

       Ce n'est pas l'encodage qui est en cause — la relecture ci-dessus l'a
       vérifié — c'est ce que le décodeur a rendu du rush. Le refaire depuis
       l'image-clé d'avant lui donne les références qui lui manquaient ; c'est
       l'application qui le redemande, une fois, avec « recule ». */
    if (verdict.abime) {
      return repondre({ echec: `images mal décodées (${verdict.abime.quoi})`, abime: verdict.abime, verdict });
    }

    repondre({ mp4, images: piste.echantillons.length, largeur: l, hauteur: h,
      duree: piste.echantillons.length / cadence, octets: mp4.size, verdict });
  } catch (erreur) {
    repondre({ echec: String((erreur && erreur.name) || erreur || "erreur") });
  } finally {
    try { decodeur?.close(); } catch { /* déjà fermé */ }
    try { encodeur?.close(); } catch { /* déjà fermé */ }
  }
};
