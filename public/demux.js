/* Le fil de décodage.

   Décoder d'avance le début des plans à venir est ce qui supprime le temps mort
   d'une coupe : le lecteur, lui, doit analyser un conteneur, allouer un
   décodeur, retrouver une image-clé et redécoder jusqu'au point d'entrée — cent
   à trois cents millisecondes qu'on paie quatre-vingt-huit fois par montage.

   Mais ce travail ne peut pas se faire sur le fil qui affiche. Mesuré : décodé
   sur le fil principal, sur un processeur bridé huit fois, l'aperçu tombe de
   onze à trois images par seconde et se troue de deux secondes — le décodage
   d'avance vole le processeur à l'affichage qu'il devait servir. C'est
   précisément pour cela qu'un banc de montage décode sur un fil séparé.

   Ce fil-ci ne fait que cela : on lui donne un fichier et un intervalle, il
   rend des images déjà réduites à la taille du moniteur. Il ne touche à rien
   d'autre, et s'il échoue il le dit sans bruit — la lecture reprend alors son
   cours d'avant. */

/* Démuxeur MP4 : il lit la carte du fichier sans rien décoder.

   Un MP4 est fait de « boîtes » emboîtées. Celles qui nous intéressent disent
   où sont les images dans le fichier, laquelle est une image-clé, et à quel
   instant chacune doit s'afficher. C'est tout ce qu'il faut pour alimenter un
   décodeur soi-même, au lieu de confier un fichier entier à un lecteur vidéo. */

export function lireMp4(donnees) {
  const vue = new DataView(donnees.buffer || donnees, donnees.byteOffset || 0, donnees.byteLength);
  const octets = new Uint8Array(donnees.buffer || donnees, donnees.byteOffset || 0, donnees.byteLength);

  /* Parcourir les boîtes d'un intervalle : chacune annonce sa taille puis son
     nom sur quatre lettres. Une taille de 1 veut dire « la vraie taille est sur
     huit octets juste après », une taille de 0 « jusqu'à la fin ». */
  function* boites(debut, fin) {
    let i = debut;
    while (i + 8 <= fin) {
      let taille = vue.getUint32(i);
      const nom = String.fromCharCode(octets[i + 4], octets[i + 5], octets[i + 6], octets[i + 7]);
      let corps = i + 8;
      if (taille === 1) { taille = Number(vue.getBigUint64(i + 8)); corps = i + 16; }
      else if (taille === 0) taille = fin - i;
      if (taille < 8 || i + taille > fin) return;
      yield { nom, corps, bout: i + taille };
      i += taille;
    }
  }
  const trouver = (debut, fin, nom) => {
    for (const b of boites(debut, fin)) if (b.nom === nom) return b;
    return null;
  };

  const moov = trouver(0, octets.length, "moov");
  if (!moov) return { echec: "pas de moov (fichier fragmenté ou tronqué ?)" };

  // Parmi les pistes, celle qui porte de l'image.
  let piste = null;
  for (const trak of boites(moov.corps, moov.bout)) {
    if (trak.nom !== "trak") continue;
    const mdia = trouver(trak.corps, trak.bout, "mdia");
    if (!mdia) continue;
    const hdlr = trouver(mdia.corps, mdia.bout, "hdlr");
    if (!hdlr) continue;
    const genre = String.fromCharCode(...octets.subarray(hdlr.corps + 8, hdlr.corps + 12));
    if (genre === "vide") { piste = { trak, mdia }; break; }
  }
  if (!piste) return { echec: "aucune piste vidéo" };

  const mdhd = trouver(piste.mdia.corps, piste.mdia.bout, "mdhd");
  if (!mdhd) return { echec: "pas de mdhd" };
  const versionMdhd = octets[mdhd.corps];
  const echelle = versionMdhd === 1 ? vue.getUint32(mdhd.corps + 20) : vue.getUint32(mdhd.corps + 12);
  if (!echelle) return { echec: "échelle de temps nulle" };

  const minf = trouver(piste.mdia.corps, piste.mdia.bout, "minf");
  const stbl = minf && trouver(minf.corps, minf.bout, "stbl");
  if (!stbl) return { echec: "pas de stbl" };

  // --- de quoi configurer le décodeur ---
  const stsd = trouver(stbl.corps, stbl.bout, "stsd");
  if (!stsd) return { echec: "pas de stsd" };
  const entree = [...boites(stsd.corps + 8, stsd.bout)][0];
  if (!entree) return { echec: "stsd vide" };
  const largeur = vue.getUint16(entree.corps + 24);
  const hauteur = vue.getUint16(entree.corps + 26);

  let codec = null;
  let description = null;
  const dans = (nom) => trouver(entree.corps + 78, entree.bout, nom);
  if (entree.nom === "avc1" || entree.nom === "avc3") {
    const avcC = dans("avcC");
    if (!avcC) return { echec: "pas d'avcC" };
    description = octets.slice(avcC.corps, avcC.bout);
    const p2 = description[1].toString(16).padStart(2, "0");
    const p3 = description[2].toString(16).padStart(2, "0");
    const p4 = description[3].toString(16).padStart(2, "0");
    codec = `avc1.${p2}${p3}${p4}`;
  } else if (entree.nom === "hvc1" || entree.nom === "hev1") {
    const hvcC = dans("hvcC");
    if (!hvcC) return { echec: "pas de hvcC" };
    description = octets.slice(hvcC.corps, hvcC.bout);
    const profil = description[1] & 0x1f;
    const niveau = description[12];
    codec = `${entree.nom}.1.6.L${niveau}.B0`.replace(".1.", `.${profil}.`);
  } else if (entree.nom === "vp09" || entree.nom === "vp08") {
    const vpcC = dans("vpcC");
    if (entree.nom === "vp08") codec = "vp8";
    else if (vpcC) {
      const d = octets.subarray(vpcC.corps + 4, vpcC.bout);
      codec = `vp09.${String(d[0]).padStart(2, "0")}.${String(d[1]).padStart(2, "0")}.${String(d[2] >> 4).padStart(2, "0")}`;
    } else codec = "vp09.00.10.08";
  } else if (entree.nom === "av01") {
    const av1C = dans("av1C");
    if (av1C) description = octets.slice(av1C.corps, av1C.bout);
    codec = "av01.0.04M.08";
  } else {
    return { echec: `codec inconnu (${entree.nom})` };
  }

  // --- la carte des images ---
  const table = (nom) => {
    const b = trouver(stbl.corps, stbl.bout, nom);
    return b ? { debut: b.corps + 4, bout: b.bout } : null;   // on saute version+drapeaux
  };

  const stts = table("stts");
  if (!stts) return { echec: "pas de stts" };
  const durees = [];
  {
    const n = vue.getUint32(stts.debut);
    for (let k = 0; k < n; k += 1) {
      const combien = vue.getUint32(stts.debut + 4 + k * 8);
      const pas = vue.getUint32(stts.debut + 8 + k * 8);
      for (let j = 0; j < combien; j += 1) durees.push(pas);
    }
  }

  const ctts = table("ctts");
  const decalages = [];
  if (ctts) {
    const n = vue.getUint32(ctts.debut);
    for (let k = 0; k < n; k += 1) {
      const combien = vue.getUint32(ctts.debut + 4 + k * 8);
      const ecart = vue.getInt32(ctts.debut + 8 + k * 8);
      for (let j = 0; j < combien; j += 1) decalages.push(ecart);
    }
  }

  const stsz = table("stsz");
  if (!stsz) return { echec: "pas de stsz" };
  const tailleFixe = vue.getUint32(stsz.debut);
  const combienImages = vue.getUint32(stsz.debut + 4);
  const tailles = [];
  for (let k = 0; k < combienImages; k += 1) {
    tailles.push(tailleFixe || vue.getUint32(stsz.debut + 8 + k * 4));
  }

  const stco = table("stco");
  const co64 = table("co64");
  const morceaux = [];
  if (stco) {
    const n = vue.getUint32(stco.debut);
    for (let k = 0; k < n; k += 1) morceaux.push(vue.getUint32(stco.debut + 4 + k * 4));
  } else if (co64) {
    const n = vue.getUint32(co64.debut);
    for (let k = 0; k < n; k += 1) morceaux.push(Number(vue.getBigUint64(co64.debut + 4 + k * 8)));
  } else return { echec: "pas de stco" };

  const stsc = table("stsc");
  if (!stsc) return { echec: "pas de stsc" };
  const regles = [];
  {
    const n = vue.getUint32(stsc.debut);
    for (let k = 0; k < n; k += 1) {
      regles.push({
        premier: vue.getUint32(stsc.debut + 4 + k * 12),
        parMorceau: vue.getUint32(stsc.debut + 8 + k * 12),
      });
    }
  }

  const stss = table("stss");
  const cles = new Set();
  if (stss) {
    const n = vue.getUint32(stss.debut);
    for (let k = 0; k < n; k += 1) cles.add(vue.getUint32(stss.debut + 4 + k * 4) - 1);
  }

  /* Où commence chaque image dans le fichier : les images sont groupées en
     morceaux, et « stsc » dit combien d'images par morceau — par tranches, pour
     ne pas répéter la même valeur des milliers de fois. */
  const positions = [];
  let image = 0;
  for (let m = 0; m < morceaux.length && image < combienImages; m += 1) {
    let parMorceau = regles[0]?.parMorceau || 1;
    for (let r = 0; r < regles.length; r += 1) {
      if (regles[r].premier - 1 <= m) parMorceau = regles[r].parMorceau;
    }
    let ou = morceaux[m];
    for (let j = 0; j < parMorceau && image < combienImages; j += 1) {
      positions.push(ou);
      ou += tailles[image];
      image += 1;
    }
  }
  if (positions.length < combienImages) return { echec: "carte des images incomplète" };

  const echantillons = [];
  let horloge = 0;
  for (let k = 0; k < combienImages; k += 1) {
    echantillons.push({
      decodage: horloge,
      instant: horloge + (decalages[k] || 0),
      duree: durees[k] ?? durees[durees.length - 1] ?? 0,
      taille: tailles[k],
      ou: positions[k],
      cle: stss ? cles.has(k) : true,
    });
    horloge += durees[k] ?? 0;
  }
  echantillons.sort((a, b) => a.instant - b.instant);

  return { codec, description, largeur, hauteur, echelle, echantillons };
}
