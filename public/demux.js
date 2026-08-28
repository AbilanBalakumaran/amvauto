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

/* Par où un décodeur peut commencer.

   Un décodeur ne se pose que sur une image-clé : elle seule ne dépend de rien.
   Les deux fils cherchaient la dernière image-clé qui précède le point
   d'entrée, et gardaient zéro quand ils n'en trouvaient aucune — c'est-à-dire
   qu'ils commençaient sur une image quelconque, qui fait référence à des images
   jamais décodées. Le décodeur rend alors les premières images en morceaux :
   des blocs pris sur du gris, des couleurs qui bavent. C'est exactement la
   bouillie du début de plan.

   Le cas arrive pour de vrai : un rush recoupé dont la première image-clé est à
   la deuxième seconde, un fichier dont « stss » commence à l'image 12. On
   remonte donc à la première image-clé du fichier plutôt que de se poser
   n'importe où — le début du bloc manquera, mais ce qui s'affiche sera juste.
   Et si le fichier n'a aucune image-clé, on le dit au lieu de décoder du vide. */
/* Et l'image-clé d'avant celle-là.

   Quand un bloc sort abîmé, c'est le plus souvent que le point de départ ne
   valait rien : une image-clé qui n'était pas une IDR, un groupe ouvert dont
   les premières images renvoient encore à celles d'avant. Repartir de l'image-
   clé précédente donne au décodeur les références qui lui manquaient. Cela
   coûte un groupe d'images de plus à décoder — rien, à côté d'un plan refait au
   lecteur vidéo. */
export function reculerCle(carte, depuis, combien = 1) {
  const ech = (carte && carte.echantillons) || [];
  let i = Math.min(depuis, ech.length - 1);
  for (let n = 0; n < combien && i > 0; n += 1) {
    let precedente = -1;
    for (let k = i - 1; k >= 0; k -= 1) if (ech[k].cle) { precedente = k; break; }
    if (precedente < 0) break;
    i = precedente;
  }
  return i;
}

export function departCle(carte, entree) {
  const ech = (carte && carte.echantillons) || [];
  const echelle = (carte && carte.echelle) || 1;
  /* Quatre choix, du meilleur au moins bon :
       — la dernière image sûre avant l'entrée : rien à supposer, rien à jeter ;
       — la dernière image annoncée clé avant l'entrée : le début du plan peut
         être un peu abîmé, mais le plan est au bon endroit ;
       — la première image sûre du fichier, puis la première annoncée clé : le
         début manque, mais ce qui s'affiche est juste. */
  let sure = -1;
  let annoncee = -1;
  for (let i = 0; i < ech.length; i += 1) {
    if (ech[i].instant / echelle > entree) continue;
    if (ech[i].sure) sure = i;
    if (ech[i].cle) annoncee = i;
  }
  if (sure >= 0) return sure;
  if (annoncee >= 0) return annoncee;
  for (let i = 0; i < ech.length; i += 1) if (ech[i].sure) return i;
  for (let i = 0; i < ech.length; i += 1) if (ech[i].cle) return i;
  return -1;
}

export function lireMp4(donnees) {
  /* Aucune exception ne sort d'ici.

     Un fichier abîmé — tronqué par une coupure, à moitié écrit faute de place —
     faisait lever une exception à la lecture des tables : « Invalid array
     length », « Offset is outside the bounds ». L'appelant ne recevait alors pas
     un échec nommé mais une panne, et la fabrique s'arrêtait sans rien dire.

     Vérifié sur vingt-deux façons d'abîmer un vrai rush : neuf levaient une
     exception, et l'une d'elles rendait des positions d'images situées hors du
     fichier — c'est-à-dire des octets pris n'importe où, donnés tels quels au
     décodeur. */
  try {
    return lireVraiment(donnees);
  } catch (erreur) {
    return { echec: `fichier illisible (${erreur?.name || "erreur"})` };
  }
}

function lireVraiment(donnees) {
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

  /* La liste d'édition, qu'on ignorait.

     Une piste peut dire « ne commence pas au début du média » : c'est « elst »,
     et beaucoup d'encodeurs en écrivent une — un iPhone, notamment, en met
     presque toujours. Deux formes se rencontrent : une entrée vide au début,
     qui retarde l'affichage, et une entrée qui commence à un instant donné du
     média, ce qui revient à couper le début.

     Sans en tenir compte, tous les instants sont décalés d'autant : on découpe
     à côté, on juge des images qui ne sont pas celles du bloc, et sur un fichier
     dont l'édition commence tard, le début du plan est du noir ou du vide. */
  let coupeDebut = 0;
  {
    const edts = trouver(piste.trak.corps, piste.trak.bout, "edts");
    const elst = edts && trouver(edts.corps, edts.bout, "elst");
    if (elst && elst.corps + 8 <= octets.length) {
      const version = octets[elst.corps];
      const combien = vue.getUint32(elst.corps + 4);
      const taille = version === 1 ? 20 : 12;
      for (let k = 0; k < combien; k += 1) {
        const o = elst.corps + 8 + k * taille;
        if (o + taille > elst.bout) break;
        const depart = version === 1
          ? Number(vue.getBigInt64(o + 8))
          : vue.getInt32(o + 4 + 4);
        // Une entrée vide vaut -1 : elle ne coupe rien, elle décale l'affichage.
        if (depart > 0) { coupeDebut = depart; break; }
      }
    }
  }

  const mdhd = trouver(piste.mdia.corps, piste.mdia.bout, "mdhd");
  if (!mdhd) return { echec: "pas de mdhd" };
  const versionMdhd = octets[mdhd.corps];
  const echelle = versionMdhd === 1 ? vue.getUint32(mdhd.corps + 20) : vue.getUint32(mdhd.corps + 12);
  if (!echelle) return { echec: "échelle de temps nulle" };

  const minf = trouver(piste.mdia.corps, piste.mdia.bout, "minf");
  const stbl = minf && trouver(minf.corps, minf.bout, "stbl");
  if (!stbl) return { echec: "pas de stbl" };

  /* --- de quoi configurer le décodeur ---

     Une piste peut porter plusieurs descriptions : « stsd » en compte le nombre,
     et « stsc » dit laquelle sert pour chaque morceau. C'est ainsi qu'un fichier
     change de résolution ou de jeu de paramètres en cours de route — un rush
     recollé de deux sources en est le cas courant.

     On prenait toujours la première. Les images de la seconde partie étaient
     alors décodées avec le mauvais jeu de paramètres : mêmes octets, autre
     grille — l'image sort en blocs déplacés. On lit donc toutes les entrées, et
     c'est la table des morceaux qui désignera celle qui vaut. */
  const stsd = trouver(stbl.corps, stbl.bout, "stsd");
  if (!stsd) return { echec: "pas de stsd" };
  const entrees = [...boites(stsd.corps + 8, stsd.bout)];
  if (!entrees.length) return { echec: "stsd vide" };

  const decrire = (entree) => {
    const largeur = vue.getUint16(entree.corps + 24);
    const hauteur = vue.getUint16(entree.corps + 26);
    let codec = null;
    let description = null;
    const dans = (nom) => trouver(entree.corps + 78, entree.bout, nom);
    if (entree.nom === "avc1" || entree.nom === "avc3") {
      const avcC = dans("avcC");
      if (!avcC) return { echec: "pas d'avcC" };
      description = octets.slice(avcC.corps, avcC.bout);
      if (description.length < 7) return { echec: "avcC trop court" };
      const p2 = description[1].toString(16).padStart(2, "0");
      const p3 = description[2].toString(16).padStart(2, "0");
      const p4 = description[3].toString(16).padStart(2, "0");
      codec = `avc1.${p2}${p3}${p4}`;
    } else if (entree.nom === "hvc1" || entree.nom === "hev1") {
      const hvcC = dans("hvcC");
      if (!hvcC) return { echec: "pas de hvcC" };
      description = octets.slice(hvcC.corps, hvcC.bout);
      if (description.length < 23) return { echec: "hvcC trop court" };
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
    if (!largeur || !hauteur) return { echec: "taille d'image nulle" };
    return { codec, description, largeur, hauteur };
  };

  // --- la carte des images ---
  const table = (nom) => {
    const b = trouver(stbl.corps, stbl.bout, nom);
    return b ? { debut: b.corps + 4, bout: b.bout } : null;   // on saute version+drapeaux
  };

  /* Le nombre d'entrées annoncé par une table n'engage qu'elle.

     Une table abîmée annonce volontiers deux milliards d'entrées : on lisait
     alors bien au-delà de sa fin, et souvent au-delà du fichier. On borne donc
     ce nombre à ce que la boîte peut réellement contenir. */
  const combienTient = (t, octetsParEntree) => {
    if (!t) return 0;
    const annonce = t.debut + 4 <= octets.length ? vue.getUint32(t.debut) : 0;
    const place = Math.max(0, Math.floor((t.bout - t.debut - 4) / octetsParEntree));
    return Math.min(annonce, place);
  };

  const stts = table("stts");
  if (!stts) return { echec: "pas de stts" };
  const durees = [];
  {
    const n = combienTient(stts, 8);
    for (let k = 0; k < n; k += 1) {
      const combien = vue.getUint32(stts.debut + 4 + k * 8);
      const pas = vue.getUint32(stts.debut + 8 + k * 8);
      for (let j = 0; j < combien; j += 1) durees.push(pas);
    }
  }

  const ctts = table("ctts");
  const decalages = [];
  if (ctts) {
    const n = combienTient(ctts, 8);
    // Version 0 : décalages non signés. Version 1 : signés. Les lire tous comme
    // signés donnerait des instants négatifs sur un fichier de version 0 dont
    // les décalages dépassent deux milliards.
    const cttsVersion = octets[ctts.debut - 4];
    for (let k = 0; k < n; k += 1) {
      const combien = vue.getUint32(ctts.debut + 4 + k * 8);
      const ecart = cttsVersion === 1
        ? vue.getInt32(ctts.debut + 8 + k * 8)
        : vue.getUint32(ctts.debut + 8 + k * 8);
      for (let j = 0; j < combien; j += 1) decalages.push(ecart);
    }
  }

  const stsz = table("stsz");
  if (!stsz) return { echec: "pas de stsz" };
  const tailleFixe = vue.getUint32(stsz.debut);
  const annonce = vue.getUint32(stsz.debut + 4);
  // Sans taille fixe, chaque image occupe quatre octets de table : le nombre
  // d'images ne peut pas dépasser ce que la boîte contient.
  const place = tailleFixe ? annonce : Math.max(0, Math.floor((stsz.bout - stsz.debut - 8) / 4));
  const combienImages = Math.min(annonce, place);
  if (!combienImages) return { echec: "aucune image dans la table" };
  const tailles = [];
  for (let k = 0; k < combienImages; k += 1) {
    tailles.push(tailleFixe || vue.getUint32(stsz.debut + 8 + k * 4));
  }

  const stco = table("stco");
  const co64 = table("co64");
  const morceaux = [];
  if (stco) {
    const n = combienTient(stco, 4);
    for (let k = 0; k < n; k += 1) morceaux.push(vue.getUint32(stco.debut + 4 + k * 4));
  } else if (co64) {
    const n = combienTient(co64, 8);
    for (let k = 0; k < n; k += 1) morceaux.push(Number(vue.getBigUint64(co64.debut + 4 + k * 8)));
  } else return { echec: "pas de stco" };

  const stsc = table("stsc");
  if (!stsc) return { echec: "pas de stsc" };
  const regles = [];
  {
    const n = combienTient(stsc, 12);
    for (let k = 0; k < n; k += 1) {
      regles.push({
        premier: vue.getUint32(stsc.debut + 4 + k * 12),
        parMorceau: vue.getUint32(stsc.debut + 8 + k * 12),
        quelleDescription: vue.getUint32(stsc.debut + 12 + k * 12) || 1,
      });
    }
  }

  const stss = table("stss");
  const cles = new Set();
  if (stss) {
    const n = combienTient(stss, 4);
    for (let k = 0; k < n; k += 1) cles.add(vue.getUint32(stss.debut + 4 + k * 4) - 1);
  }

  /* Où commence chaque image dans le fichier : les images sont groupées en
     morceaux, et « stsc » dit combien d'images par morceau — par tranches, pour
     ne pas répéter la même valeur des milliers de fois. */
  const positions = [];
  const quelleDescription = [];
  let image = 0;
  for (let m = 0; m < morceaux.length && image < combienImages; m += 1) {
    let parMorceau = regles[0]?.parMorceau || 1;
    let description = regles[0]?.quelleDescription || 1;
    for (let r = 0; r < regles.length; r += 1) {
      if (regles[r].premier - 1 <= m) {
        parMorceau = regles[r].parMorceau;
        description = regles[r].quelleDescription;
      }
    }
    let ou = morceaux[m];
    for (let j = 0; j < parMorceau && image < combienImages; j += 1) {
      positions.push(ou);
      quelleDescription.push(description);
      ou += tailles[image];
      image += 1;
    }
  }
  /* Une carte plus courte que la table des tailles n'est pas un fichier perdu.

     Cela arrive quand « stco » a été tronquée : les premières images sont
     parfaitement localisées, les dernières n'ont plus d'adresse. On refusait
     tout le fichier ; on garde maintenant ce qui est localisé — comme pour un
     fichier tronqué, dont le début reste bon. */
  if (!positions.length) return { echec: "carte des images incomplète" };
  const combienPlacees = Math.min(combienImages, positions.length);

  /* Les images qu'on peut vraiment donner à un décodeur.

     Aucune ne peut se trouver hors du fichier : une table cohérente avec
     elle-même désigne parfaitement des octets qui n'existent pas — c'est le cas
     d'un fichier tronqué, dont la carte est intacte et les données coupées.
     Donner ces octets-là au décodeur, c'est lui donner n'importe quoi. On
     s'arrête à la dernière image entièrement présente : le début du fichier
     reste utilisable, ce qui manque est simplement absent.

     Et toutes celles qu'on garde partagent la même description, puisque le
     décodeur n'en reçoit qu'une. À la première image qui en demande une autre,
     on s'arrête : ce qui précède reste juste, ce qui suit aurait été décodé de
     travers. */
  const descriptionVoulue = quelleDescription[0] || 1;
  const utilisables = [];
  for (let k = 0; k < combienPlacees; k += 1) {
    // Hors du fichier : tout ce qui suit l'est aussi, on s'arrête là.
    if (positions[k] < 0 || positions[k] + tailles[k] > octets.length) break;
    if (quelleDescription[k] !== descriptionVoulue) break;
    // Une image de taille nulle n'est pas une image : on la saute sans perdre
    // la suite, plutôt que de couper le fichier à cet endroit.
    if (!tailles[k]) continue;
    utilisables.push(k);
  }
  if (!utilisables.length) return { echec: "aucune image entière dans le fichier" };

  const quoi = entrees[descriptionVoulue - 1] ? decrire(entrees[descriptionVoulue - 1]) : decrire(entrees[0]);
  if (quoi.echec) return { echec: quoi.echec };
  const { codec, description, largeur, hauteur } = quoi;

  /* Une image-clé annoncée est-elle vraiment une image-clé ?

     Deux façons de se tromper, et les deux se voient à l'écran :

     — « stss » absente. La règle dit alors que toutes les images sont des
       images-clés. C'est vrai d'un fichier tout en images I ; c'est faux d'un
       fichier dont le muxeur a simplement oublié la table — et on se pose alors
       sur une image qui dépend d'une autre. Le décodeur bâtit son image sur une
       référence grise : des blocs déplacés, des couleurs qui bavent.

     — « stss » présente mais généreuse. Certains muxeurs y inscrivent des
       images I qui ne sont pas des IDR : les images qui suivent peuvent encore
       renvoyer à celles d'avant. Le début du plan sort abîmé, la suite est
       juste.

     La vérité est dans les octets de l'image : une IDR H.264 porte une unité de
     type 5, une IRAP HEVC un type entre 16 et 23. On les lit — c'est quelques
     entiers par image, rien du tout à côté d'un décodage — et on s'en sert pour
     choisir où poser le décodeur. */
  const longueurNal = description && (codec.startsWith("avc") || codec.startsWith("hvc") || codec.startsWith("hev"))
    ? (description[codec.startsWith("avc") ? 4 : 21] & 3) + 1
    : 0;
  const hevc = codec.startsWith("hvc") || codec.startsWith("hev");
  const estIdr = (ou, taille) => {
    if (!longueurNal) return false;
    let p = ou;
    const fin = ou + taille;
    while (p + longueurNal < fin) {
      let n = 0;
      for (let b = 0; b < longueurNal; b += 1) n = n * 256 + octets[p + b];
      p += longueurNal;
      if (!n || p + n > fin) break;
      const type = hevc ? (octets[p] >> 1) & 0x3f : octets[p] & 0x1f;
      if (hevc ? type >= 16 && type <= 23 : type === 5) return true;
      p += n;
    }
    return false;
  };
  const idr = new Set();
  if (longueurNal) {
    for (const k of utilisables) if (estIdr(positions[k], tailles[k])) idr.add(k);
  }
  /* Sans aucune IDR, on ne sait rien de plus qu'avant : le flux est peut-être
     tout en images I, ou fait de points de reprise progressifs. On s'en remet
     alors à ce que le fichier annonce, comme avant. */
  const surIdr = idr.size > 0;

  const echantillons = [];
  // L'horloge court sur toutes les images du fichier, y compris celles qu'on
  // saute : c'est elle qui donne les instants justes.
  /* Quand « stts » s'arrête avant la fin, les images qui suivent n'ont pas de
     durée. Leur en donner zéro, c'est leur donner à toutes le même instant :
     le décodeur reçoit une pile d'images datées pareil et le montage n'a plus
     de cadence. On continue avec la dernière durée connue. */
  const dureeDe = (k) => durees[k] ?? durees[durees.length - 1] ?? 0;
  const horloges = [];
  {
    let t = 0;
    for (let k = 0; k < combienPlacees; k += 1) { horloges.push(t); t += dureeDe(k); }
  }
  for (const k of utilisables) {
    echantillons.push({
      decodage: horloges[k] - coupeDebut,
      instant: horloges[k] + (decalages[k] || 0) - coupeDebut,
      duree: dureeDe(k),
      taille: tailles[k],
      ou: positions[k],
      /* Une IDR est un point d'entrée valable même si la table l'ignore : on
         l'ajoute à ce que le fichier annonce, jamais on n'en retire. */
      cle: idr.has(k) || (stss ? cles.has(k) : !surIdr),
      // Une image sur laquelle un décodeur peut se poser sans rien supposer.
      sure: surIdr ? idr.has(k) : (stss ? cles.has(k) : true),
    });
  }
  /* L'ordre est celui du décodage, et il ne doit pas changer.

     Ce tableau était trié par instant d'affichage — ce qui paraît naturel et
     qui est faux. Un fichier H.264 courant réordonne ses images : une image B
     s'affiche entre deux images qui ont été décodées avant elle. L'ordre du
     fichier est l'ordre de décodage ; l'instant d'affichage, lui, est écrit à
     part, dans « ctts ».

     Trié par instant, le décodeur recevait donc des images qui font référence à
     d'autres qu'il n'avait pas encore vues. Il rendait alors des macroblocs pris
     sur la mauvaise référence — l'image se déforme par blocs, les couleurs
     bavent en traînées. C'est la bouillie signalée pendant des heures, et le
     banc d'essai ne pouvait pas la reproduire : les fichiers qu'il fabrique
     n'ont pas d'images B, si bien que les deux ordres y sont identiques.

     Mesuré sur un vrai rush Sakugabooru — 705 images, profil High : deux cent
     soixante-dix-neuf images changeaient de place au tri.

     On rend donc les images dans l'ordre du fichier. « instant » reste là pour
     savoir quand chacune s'affiche ; il ne sert plus à les ranger. */
  return { codec, description, largeur, hauteur, echelle, echantillons };
}
