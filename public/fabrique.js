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

self.onmessage = async (evt) => {
  const { id, blob, cle, entree, sortie, large, debit } = evt.data || {};
  const repondre = (quoi) => self.postMessage({ id, ...quoi });
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
    const facteur = Math.min(1, large / (carte.largeur || large));
    const l = Math.max(2, Math.round((carte.largeur * facteur) / 2) * 2);
    const h = Math.max(2, Math.round((carte.hauteur * facteur) / 2) * 2);

    const ech = carte.echantillons;
    const instant = (e) => e.instant / carte.echelle;
    // On repart de l'image-clé qui précède l'entrée : c'est la seule par où un
    // décodeur peut commencer. Ces images-là sont décodées puis jetées.
    let depuis = 0;
    for (let i = 0; i < ech.length; i += 1) {
      if (ech[i].cle && instant(ech[i]) <= entree) depuis = i;
    }

    const cadence = Math.max(1, Math.round(1 / ((ech[1] ? instant(ech[1]) - instant(ech[0]) : 1 / 24) || 1 / 24)));
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

    let gardees = 0;
    let casse = false;
    decodeur = new VideoDecoder({
      output: (image) => {
        const t = image.timestamp / 1e6;
        // Hors des bornes : décodée parce qu'il le fallait, jetée parce qu'elle
        // n'appartient pas au bloc.
        if (t < entree - 0.001 || t > sortie + 0.001) { image.close(); return; }
        /* Le segment commence à zéro. C'est tout l'intérêt : le lecteur n'aura
           aucun déplacement à faire pour entrer dedans. */
        const recadree = new VideoFrame(image, {
          timestamp: Math.max(0, Math.round((t - entree) * 1e6)),
          duration: Math.round(1e6 / cadence),
        });
        image.close();
        try {
          encodeur.encode(recadree, { keyFrame: gardees === 0 });
          gardees += 1;
        } catch { casse = true; }
        recadree.close();
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
    await encodeur.flush().catch(() => { casse = true; });

    if (casse || !piste.echantillons.length) return repondre({ echec: "fabrication interrompue" });
    const mp4 = ecrireMp4([piste]);
    repondre({ mp4, images: piste.echantillons.length, largeur: l, hauteur: h,
      duree: piste.echantillons.length / cadence, octets: mp4.size });
  } catch (erreur) {
    repondre({ echec: String((erreur && erreur.name) || erreur || "erreur") });
  } finally {
    try { decodeur?.close(); } catch { /* déjà fermé */ }
    try { encodeur?.close(); } catch { /* déjà fermé */ }
  }
};
