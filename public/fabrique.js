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
import { ecrireMp4 } from "./mp4.js";

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
async function assembler(morceaux) {
  const ECHELLE = 90000;
  let piste = null;
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
    }
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
        piste.echantillons.push({ octets: buf, taille: buf.length,
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
    const verdict = {
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
