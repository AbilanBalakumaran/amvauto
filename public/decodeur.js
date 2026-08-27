/* Le fil de décodage.

   Il lit la carte d'un MP4 — « demux.js » — puis décode la tranche demandée et
   rend des images déjà réduites. Il tourne à part pour que ce travail ne tombe
   jamais dans la boucle qui doit produire l'image suivante. */

import { lireMp4, departCle } from "./demux.js";


/* Les cartes de fichiers déjà lues, gardées par adresse.

   Lire la carte d'un MP4, c'est parcourir ses tables : où est chaque image,
   laquelle est une image-clé, à quel instant. Sur un rush de six mégaoctets
   cela se compte en dizaines de millisecondes — et on la relisait à chaque
   demande, alors qu'un montage revient sans cesse au même fichier. Trois cartes
   suffisent à couvrir ce qui se joue à un instant donné, et une carte ne pèse
   que ses tables : quelques dizaines de milliers d'entrées, pas les images. */
const cartes = new Map();
const CARTES_GARDEES = 3;

/* Et les octets eux-mêmes, avec elles.

   Chaque demande faisait « blob.arrayBuffer() » : une copie entière du fichier
   dans le fil de décodage. Un rush pèse un à six mégaoctets, un montage en
   demande une par plan, et le même rush revient sans cesse — cent vingt blocs
   tirés de vingt-quatre fichiers, c'est cent vingt copies pour vingt-quatre
   fichiers distincts. Sur un téléphone, cette recopie n'est pas gratuite : elle
   se paie en mémoire et en temps, à chaque coupe.

   Les octets sont donc gardés à côté de la carte, et pour les mêmes trois
   fichiers. Ce qui est en mémoire est ce qui sert : le plan courant et les deux
   suivants viennent au plus de trois rushs différents. */
const octetsGardes = new Map();

async function fichierDe(cle, blob) {
  if (cle && octetsGardes.has(cle)) return octetsGardes.get(cle);
  const donnees = new Uint8Array(await blob.arrayBuffer());
  if (cle) {
    octetsGardes.set(cle, donnees);
    while (octetsGardes.size > CARTES_GARDEES) {
      octetsGardes.delete(octetsGardes.keys().next().value);
    }
  }
  return donnees;
}

function carteDe(cle, donnees) {
  if (cle && cartes.has(cle)) return cartes.get(cle);
  const carte = lireMp4(donnees);
  if (cle && !carte.echec) {
    cartes.set(cle, carte);
    while (cartes.size > CARTES_GARDEES) cartes.delete(cartes.keys().next().value);
  }
  return carte;
}

self.onmessage = async (evt) => {
  const { id, blob, entree, fin, large, combien, cle, pas } = evt.data || {};
  const repondre = (quoi, transferts) => self.postMessage({ id, ...quoi }, transferts || []);
  try {
    const donnees = await fichierDe(cle, blob);
    const carte = carteDe(cle, donnees);
    if (carte.echec) return repondre({ echec: carte.echec });

    const config = { codec: carte.codec, codedWidth: carte.largeur, codedHeight: carte.hauteur };
    if (carte.description) config.description = carte.description;
    /* La compatibilité ne se redemande pas à chaque image.

       « isConfigSupported » interroge le système, ce qui n'est pas gratuit et ne
       change jamais pour un fichier donné. La réponse est retenue avec la carte. */
    if (carte.accepte === undefined) {
      try { carte.accepte = (await VideoDecoder.isConfigSupported(config)).supported; }
      catch { carte.accepte = false; }
    }
    if (!carte.accepte) return repondre({ echec: `codec refusé (${carte.codec})` });

    // On repart de l'image-clé qui précède le point d'entrée : c'est la seule
    // par où un décodeur peut commencer.
    const ech = carte.echantillons;
    const depuis = departCle(carte, entree);
    if (depuis < 0) return repondre({ echec: "aucune image-clé dans le fichier" });

    /* Les images retenues sont étalées sur toute la plage demandée.

       On gardait les premières venues jusqu'à en avoir assez : sur une plage
       longue, cela donnait le début en entier et rien ensuite — une réserve qui
       s'épuise juste au moment où elle devrait servir. Un pas régulier couvre au
       contraire toute la plage : une image tous les deux ou trois vingt-quatrièmes
       de seconde tient largement le temps qu'un lecteur démarre, et coûte
       d'autant moins de mémoire. */
    const ecart = pas > 0 ? pas : 0;
    let prochaine = entree - 0.02;
    const prises = [];
    let cassee = false;
    const dec = new VideoDecoder({
      output: (img) => {
        const t = img.timestamp / 1e6;
        if (t < entree - 0.02 || t > fin + 0.02 || prises.length >= combien) { img.close(); return; }
        if (t < prochaine) { img.close(); return; }
        prochaine = t + ecart;
        prises.push({ t, img });
      },
      error: () => { cassee = true; },
    });
    dec.configure(config);
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
      if (e.decodage / carte.echelle > fin + MARGE_REORDRE) break;
      dec.decode(new EncodedVideoChunk({
        // La toute première image donnée à un décodeur doit être une clé :
        // « departCle » n'en rend pas d'autre, et on ne le suppose pas.
        type: e.cle || i === depuis ? "key" : "delta",
        timestamp: Math.round((e.instant / carte.echelle) * 1e6),
        duration: Math.round((e.duree / carte.echelle) * 1e6),
        data: donnees.subarray(e.ou, e.ou + e.taille),
      }));
      /* On ne noie pas le décodeur.

         Tout enfourner d'un coup, c'est demander à un téléphone de garder en
         mémoire une trentaine d'images compressées et autant d'images décodées.
         Le décodeur matériel d'un iPhone a une file courte : au-delà, il rend
         la main tard, et sous la pression mémoire le système peut le reprendre
         en pleine tranche — ce qui se voit à l'écran comme une image à moitié
         faite. La fabrique s'en garde déjà ; ce fil-ci, non. */
      if (dec.decodeQueueSize > 24) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((suite) => {
          dec.addEventListener?.("dequeue", suite, { once: true });
          setTimeout(suite, 40);
        });
      }
    }
    await dec.flush().catch(() => { cassee = true; });
    try { dec.close(); } catch { /* déjà fermé */ }
    if (cassee || !prises.length) {
      for (const x of prises) x.img.close();
      return repondre({ echec: "décodage interrompu" });
    }

    /* Réduites tout de suite à la taille du moniteur : une image de rush pèse
       un mégaoctet et demi en mémoire vive, la même en six cent quarante points
       en pèse moins du quart — et un téléphone n'en montre pas davantage. */
    const facteur = Math.min(1, large / (carte.largeur || large));
    const l = Math.max(2, Math.round(carte.largeur * facteur));
    const h = Math.max(2, Math.round(carte.hauteur * facteur));
    const images = [];
    const transferts = [];
    for (const x of prises) {
      try {
        const bitmap = await createImageBitmap(x.img, { resizeWidth: l, resizeHeight: h, resizeQuality: "low" });
        images.push({ t: x.t, image: bitmap });
        transferts.push(bitmap);
      } catch { /* cette image-là restera manquante */ }
      x.img.close();
    }
    if (!images.length) return repondre({ echec: "aucune image tirée" });
    images.sort((a, b) => a.t - b.t);
    repondre({ images }, transferts);
  } catch (erreur) {
    repondre({ echec: String(erreur && erreur.name) || "erreur" });
  }
};

