/* Écrire un MP4, boîte par boîte.

   Ce fichier était dans la page. Il en sort parce que trois endroits en ont
   besoin : l'export image par image, l'export en temps réel, et la fabrique de
   segments qui prépare l'aperçu dans un fil séparé. Un multiplexeur recopié
   trois fois se serait corrigé une fois sur trois.

   Rien n'y a changé : les mêmes fonctions, dans le même ordre. Seule la dernière
   est exportée, les autres lui servent. */

const CODEC_MP4 = new TextEncoder();

function nombreVersOctets(valeur, taille) {
  const octets = new Uint8Array(taille);
  for (let i = taille - 1; i >= 0; i -= 1) { octets[i] = valeur & 0xff; valeur = Math.floor(valeur / 256); }
  return octets;
}

const u8 = (...v) => new Uint8Array(v);
const u16 = (v) => nombreVersOctets(v, 2);
const u32 = (v) => nombreVersOctets(v, 4);
// Un entier signé sur quatre octets : les décalages d'affichage peuvent être
// négatifs, et le complément à deux se lit comme un entier non signé.
const i32 = (v) => nombreVersOctets(v < 0 ? v + 0x100000000 : v, 4);
const u64 = (v) => nombreVersOctets(v, 8);

/* Une boîte : sa taille, son nom, son contenu. Tout le format n'est que cela,
   emboîté. */
function boiteMp4(nom, ...morceaux) {
  const corps = [];
  let taille = 8;
  for (const m of morceaux) {
    const octets = m instanceof Uint8Array ? m : new Uint8Array(m);
    corps.push(octets);
    taille += octets.length;
  }
  const sortie = new Uint8Array(taille);
  sortie.set(u32(taille), 0);
  sortie.set(CODEC_MP4.encode(nom), 4);
  let position = 8;
  for (const m of corps) { sortie.set(m, position); position += m.length; }
  return sortie;
}

// Une boîte « pleine version » : un octet de version, trois de drapeaux.
const boiteMp4Pleine = (nom, version, drapeaux, ...morceaux) =>
  boiteMp4(nom, u8(version), nombreVersOctets(drapeaux, 3), ...morceaux);

const MATRICE = new Uint8Array([
  0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0,
]);

/* --- H.264 : deux emballages, et un seul convient au MP4 ----------------

   Un flux H.264 se présente sous deux formes. En « Annex B », chaque unité est
   précédée d'un code de départ — trois ou quatre octets — et les jeux de
   paramètres voyagent dans le flux lui-même. En « AVCC », celle du MP4, chaque
   unité est précédée de sa longueur sur quatre octets, et les jeux de paramètres
   vivent à part, dans la boîte « avcC ».

   WebCodecs permet de demander la seconde : « avc: { format: "avc" } ». Tous les
   navigateurs ne l'honorent pas. Celui qui rend de l'Annex B alors qu'on écrit
   un MP4 produit un fichier où le décodeur lit une longueur là où il y a un code
   de départ : il saute au hasard dans les octets, et rend des macroblocs
   déplacés et des couleurs qui bavent — la bouillie exacte qui a été
   photographiée, et que le banc d'essai ne pouvait pas reproduire puisque son
   navigateur, lui, honore la demande.

   On ne demande donc plus : on regarde les octets, et on convertit s'il le
   faut. */
const CODE_DEPART = (o, i) => (o[i] === 0 && o[i + 1] === 0
  && (o[i + 2] === 1 || (o[i + 2] === 0 && o[i + 3] === 1)));

export function estAnnexB(octets) {
  return octets.length > 4 && CODE_DEPART(octets, 0);
}

/* Découper un flux Annex B en unités, sans leur code de départ. */
export function unitesAnnexB(octets) {
  const unites = [];
  let i = 0;
  while (i < octets.length && !CODE_DEPART(octets, i)) i += 1;
  while (i < octets.length) {
    const saut = octets[i + 2] === 1 ? 3 : 4;
    let j = i + saut;
    while (j < octets.length && !CODE_DEPART(octets, j)) j += 1;
    if (j > i + saut) unites.push(octets.subarray(i + saut, j));
    i = j;
  }
  return unites;
}

/* Réemballer en longueurs de quatre octets, en laissant de côté les jeux de
   paramètres et les délimiteurs, qui n'ont rien à faire dans un échantillon. */
export function versAvcc(unites) {
  const gardees = unites.filter((u) => {
    const type = u[0] & 0x1f;
    return type !== 7 && type !== 8 && type !== 9;
  });
  let taille = 0;
  for (const u of gardees) taille += 4 + u.length;
  const sortie = new Uint8Array(taille);
  let o = 0;
  for (const u of gardees) {
    sortie[o] = (u.length >>> 24) & 0xff;
    sortie[o + 1] = (u.length >>> 16) & 0xff;
    sortie[o + 2] = (u.length >>> 8) & 0xff;
    sortie[o + 3] = u.length & 0xff;
    sortie.set(u, o + 4);
    o += 4 + u.length;
  }
  return sortie;
}

/* Construire la boîte « avcC » à partir des jeux de paramètres trouvés dans le
   flux. C'est elle qui dit au décodeur comment lire tout le reste. */
export function avcCDepuis(sps, pps) {
  if (!sps || !pps || sps.length < 4) return null;
  const sortie = new Uint8Array(11 + sps.length + pps.length);
  sortie[0] = 1;                    // version
  sortie[1] = sps[1];               // profil
  sortie[2] = sps[2];               // compatibilité
  sortie[3] = sps[3];               // niveau
  sortie[4] = 0xff;                 // longueurs sur quatre octets
  sortie[5] = 0xe1;                 // un seul jeu SPS
  sortie[6] = (sps.length >> 8) & 0xff;
  sortie[7] = sps.length & 0xff;
  sortie.set(sps, 8);
  let o = 8 + sps.length;
  sortie[o] = 1;                    // un seul jeu PPS
  sortie[o + 1] = (pps.length >> 8) & 0xff;
  sortie[o + 2] = pps.length & 0xff;
  sortie.set(pps, o + 3);
  return sortie;
}

/* La description du codec, telle que l'encodeur nous l'a donnée. Pour H.264
   c'est le « avcC » — profils, niveaux, jeux de paramètres — sans quoi aucun
   lecteur ne sait démarrer le décodage. */
function entreeVideo(piste) {
  const avc = piste.codec.startsWith("avc1");
  if (!avc && !piste.codec.startsWith("vp8")) {
    throw new Error(`codec non emballable : ${piste.codec}`);
  }
  /* Sans description, un « avc1 » est un fichier que rien ne peut décoder : le
     décodeur n'a ni profil, ni niveau, ni jeux de paramètres. On refusait
     silencieusement d'y penser — la boîte était écrite vide, et le résultat
     était une bouillie. Mieux vaut ne pas produire le fichier. */
  if (avc && (!piste.description || piste.description.length < 7)) {
    throw new Error("flux H.264 sans description : rien à emballer");
  }
  const specifique = avc
    ? boiteMp4("avcC", piste.description)
    /* Profil 0, niveau 1.0, huit bits par composante, sous-échantillonnage
       4:2:0 : la description minimale d'un flux VP8, telle que la réclame le
       conteneur. */
    : boiteMp4("vpcC", u8(1, 0, 0, 0), u8(0, 10, 0x08 << 4 | 0x01 << 1, 0), u16(0));
  const nom = avc ? "avc1" : "vp08";
  return boiteMp4(
    nom,
    u8(0, 0, 0, 0, 0, 0), u16(1),                    // réservé, index de donnée
    u16(0), u16(0), u32(0), u32(0), u32(0),          // version, révision, fabricant
    u16(piste.largeur), u16(piste.hauteur),
    u32(0x00480000), u32(0x00480000),                // 72 points par pouce
    u32(0), u16(1),
    new Uint8Array(32),                              // nom du compresseur
    u16(0x0018), u16(0xffff),                        // profondeur, table de couleurs
    specifique,
  );
}

/* Le son. « mp4a » réclame un « esds » qui enveloppe la configuration que rend
   l'encodeur ; Opus se contente d'un « dOps ». On écrit celui qui correspond. */
function entreeAudio(piste) {
  const commun = [
    u8(0, 0, 0, 0, 0, 0), u16(1),
    u32(0), u32(0),
    u16(piste.canaux), u16(16), u16(0), u16(0),
    u32(piste.echantillonnage * 65536),
  ];
  if (piste.codec.startsWith("mp4a")) {
    const config = piste.description || new Uint8Array([0x11, 0x90]);
    const descripteurDecodeur = boiteMp4Descripteur(0x04, [
      u8(0x40, 0x15),                                 // AAC, flux audio
      nombreVersOctets(0, 3), u32(0), u32(0),         // tampon, débits
      boiteMp4Descripteur(0x05, [config]),
    ]);
    const esds = boiteMp4Pleine("esds", 0, 0,
      boiteMp4Descripteur(0x03, [u16(1), u8(0), descripteurDecodeur, boiteMp4Descripteur(0x06, [u8(2)])]));
    return boiteMp4("mp4a", ...commun, esds);
  }
  return boiteMp4("Opus", ...commun,
    boiteMp4("dOps", u8(0), u8(piste.canaux), u16(312), u32(piste.echantillonnage), u16(0), u8(0)));
}

/* Les descripteurs MPEG-4 ont leur propre encodage de longueur, sur sept bits
   par octet. C'est le seul endroit du format où l'on compte ainsi. */
function boiteMp4Descripteur(marque, morceaux) {
  const contenu = [];
  let taille = 0;
  for (const m of morceaux) { contenu.push(m); taille += m.length; }
  const longueur = [];
  let reste = taille;
  do { longueur.unshift((reste & 0x7f) | (longueur.length ? 0x80 : 0)); reste >>= 7; } while (reste);
  const sortie = new Uint8Array(1 + longueur.length + taille);
  sortie[0] = marque;
  sortie.set(longueur, 1);
  let position = 1 + longueur.length;
  for (const m of contenu) { sortie.set(m, position); position += m.length; }
  return sortie;
}

/* La table des durées : autant de lignes que de changements de cadence. Une
   vidéo à cadence fixe tient en une seule ligne. */
function tableDurees(echantillons) {
  const lignes = [];
  for (const e of echantillons) {
    const derniere = lignes[lignes.length - 1];
    if (derniere && derniere.duree === e.duree) derniere.compte += 1;
    else lignes.push({ compte: 1, duree: e.duree });
  }
  const corps = [u32(lignes.length)];
  for (const l of lignes) corps.push(u32(l.compte), u32(l.duree));
  return boiteMp4Pleine("stts", 0, 0, ...corps);
}

/* La table des décalages d'affichage.

   Elle manquait, et son absence interdisait tout simplement de recopier un
   flux H.264 tel quel. Un fichier courant réordonne ses images : une image B
   s'affiche entre deux images décodées avant elle, et l'écart entre l'instant
   de décodage et l'instant d'affichage est écrit là, dans « ctts ». Sans cette
   table, les images recopiées s'affichent dans l'ordre où elles ont été
   décodées — c'est-à-dire dans le désordre.

   Elle ne coûte rien quand elle ne sert pas : un flux sans image B n'a que des
   décalages nuls, et l'on n'écrit alors pas la boîte. Version 1, la seule qui
   accepte des décalages négatifs. */
function tableComposition(echantillons) {
  if (!echantillons.some((e) => e.composition)) return new Uint8Array(0);
  const lignes = [];
  for (const e of echantillons) {
    const ecart = e.composition || 0;
    const derniere = lignes[lignes.length - 1];
    if (derniere && derniere.ecart === ecart) derniere.compte += 1;
    else lignes.push({ compte: 1, ecart });
  }
  const corps = [u32(lignes.length)];
  for (const l of lignes) corps.push(u32(l.compte), i32(l.ecart));
  return boiteMp4Pleine("ctts", 1, 0, ...corps);
}

function tableTailles(echantillons) {
  const corps = [u32(0), u32(echantillons.length)];
  for (const e of echantillons) corps.push(u32(e.taille));
  return boiteMp4Pleine("stsz", 0, 0, ...corps);
}

function tablePositions(echantillons) {
  const corps = [u32(echantillons.length)];
  for (const e of echantillons) corps.push(u32(e.decalage));
  return boiteMp4Pleine("stco", 0, 0, ...corps);
}

// Un échantillon par bloc : le plus simple, et le plus sûr.
const tableBlocs = () => boiteMp4Pleine("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1));

function tableCles(echantillons) {
  const cles = [];
  echantillons.forEach((e, i) => { if (e.cle) cles.push(i + 1); });
  if (cles.length === echantillons.length) return new Uint8Array(0);
  const corps = [u32(cles.length)];
  for (const c of cles) corps.push(u32(c));
  return boiteMp4Pleine("stss", 0, 0, ...corps);
}

function pisteMoov(piste, dureeFilm, echelleFilm) {
  const dureePiste = piste.echantillons.reduce((somme, e) => somme + e.duree, 0);
  const dureeEnFilm = Math.round((dureePiste / piste.echelle) * echelleFilm);
  const video = piste.type === "video";

  const tkhd = boiteMp4Pleine("tkhd", 0, 3,
    u32(0), u32(0), u32(piste.id), u32(0), u32(dureeEnFilm),
    u32(0), u32(0), u16(0), u16(video ? 0 : 0x0100), u16(0), u16(0),
    MATRICE,
    u32(video ? piste.largeur * 65536 : 0), u32(video ? piste.hauteur * 65536 : 0));

  const mdhd = boiteMp4Pleine("mdhd", 0, 0,
    u32(0), u32(0), u32(piste.echelle), u32(dureePiste), u16(0x55c4), u16(0));

  const hdlr = boiteMp4Pleine("hdlr", 0, 0,
    u32(0), CODEC_MP4.encode(video ? "vide" : "soun"), u32(0), u32(0), u32(0), u8(0));

  const entete = video
    ? boiteMp4Pleine("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0))
    : boiteMp4Pleine("smhd", 0, 0, u16(0), u16(0));

  const dinf = boiteMp4("dinf", boiteMp4Pleine("dref", 0, 0, u32(1), boiteMp4Pleine("url ", 0, 1)));

  const stbl = boiteMp4("stbl",
    boiteMp4Pleine("stsd", 0, 0, u32(1), video ? entreeVideo(piste) : entreeAudio(piste)),
    tableDurees(piste.echantillons),
    tableComposition(piste.echantillons),
    tableCles(piste.echantillons),
    tableBlocs(),
    tableTailles(piste.echantillons),
    tablePositions(piste.echantillons));

  return boiteMp4("trak", tkhd,
    boiteMp4("mdia", mdhd, hdlr, boiteMp4("minf", entete, dinf, stbl)));
}

/* Assemble le fichier. « pistes » porte, pour chacune, ses échantillons déjà
   encodés et la position qu'ils occuperont dans le « mdat ». */
export function ecrireMp4(pistes) {
  const echelleFilm = 1000;
  let duree = 0;
  for (const piste of pistes) {
    const t = piste.echantillons.reduce((somme, e) => somme + e.duree, 0) / piste.echelle;
    duree = Math.max(duree, t);
  }
  const dureeFilm = Math.round(duree * echelleFilm);

  const ftyp = boiteMp4("ftyp", CODEC_MP4.encode("isom"), u32(512),
    CODEC_MP4.encode("isomiso2avc1mp41"));

  // Les octets, dans l'ordre : d'abord toute la vidéo, puis tout le son.
  const corps = [];
  let decalage = ftyp.length + 8;
  for (const piste of pistes) {
    for (const e of piste.echantillons) {
      e.decalage = decalage;
      decalage += e.taille;
      corps.push(e.octets);
    }
  }
  const tailleMdat = decalage - ftyp.length - 8;
  const teteMdat = new Uint8Array(8);
  teteMdat.set(u32(tailleMdat + 8), 0);
  teteMdat.set(CODEC_MP4.encode("mdat"), 4);

  const mvhd = boiteMp4Pleine("mvhd", 0, 0,
    u32(0), u32(0), u32(echelleFilm), u32(dureeFilm), u32(0x00010000), u16(0x0100), u16(0),
    u32(0), u32(0), MATRICE, u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
    u32(pistes.length + 1));

  const moov = boiteMp4("moov", mvhd, ...pistes.map((p) => pisteMoov(p, dureeFilm, echelleFilm)));
  return new Blob([ftyp, teteMdat, ...corps, moov], { type: "video/mp4" });
}
