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

import { lireMp4 } from "./demux.js";
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
      return { echec: "segments de formats différents" };
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
      return { echec: "segments aux paramètres de flux différents" };
    }
    dernier = { carte, donnees };
    for (const e of carte.echantillons) {
      piste.echantillons.push({
        octets: donnees.subarray(e.ou, e.ou + e.taille),
        taille: e.taille,
        duree: Math.max(1, Math.round((e.duree / carte.echelle) * ECHELLE)),
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
  const { id, blob, cle, entree, sortie, large, debit, haut, cadence: cadenceVoulue } = evt.data || {};
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
    let depuis = 0;
    for (let i = 0; i < ech.length; i += 1) {
      if (ech[i].cle && instant(ech[i]) <= entree) depuis = i;
    }

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
    const bouges = [];
    let precedent = null;

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
        // Les cases jusqu'à cette image reviennent à la précédente.
        if (derniere) { produire(derniere.image, t - entree - 1e-6); derniere.image.close(); }
        derniere = { image, t };
      },
      error: () => { casse = true; },
    });
    decodeur.configure(config);

    for (let i = depuis; i < ech.length; i += 1) {
      const e = ech[i];
      if (instant(e) > sortie + 0.05) break;
      decodeur.decode(new EncodedVideoChunk({
        type: e.cle ? "key" : "delta",
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
      debutNoir: Math.round(debutNoir * 100) / 100,
      luminance: Math.round(moyenne(lumas)),
      mouvement: Math.round(bouge * 10) / 10,
      vues: lumas.length,
      noir: immobile && lumas.length >= 3 && sombres >= lumas.length * 0.8,
      blanc: immobile && lumas.length >= 3 && clairs >= lumas.length * 0.8,
      fige: immobile,
    };

    const mp4 = ecrireMp4([piste]);
    repondre({ mp4, images: piste.echantillons.length, largeur: l, hauteur: h,
      duree: piste.echantillons.length / cadence, octets: mp4.size, verdict });
  } catch (erreur) {
    repondre({ echec: String((erreur && erreur.name) || erreur || "erreur") });
  } finally {
    try { decodeur?.close(); } catch { /* déjà fermé */ }
    try { encodeur?.close(); } catch { /* déjà fermé */ }
  }
};
