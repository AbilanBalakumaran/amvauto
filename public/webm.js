/* Lire un WebM comme on lit un MP4 : sa durée, ses images-clés, son mouvement.

   AnimeThemes sert des génériques en WebM 1080p sans crédits — le meilleur
   matériau brut en accès libre. Mais tout ce que le montage sait faire reposait
   sur les boîtes d'un MP4 : sans durée, une scène est écartée ; sans images-clés,
   on coupe au milieu d'un plan ; sans courbe de mouvement, le choix redevient
   aveugle. D'où ce lecteur.

   Matroska range ses données en EBML : un identifiant, une taille, un contenu,
   récursivement. Trois éléments suffisent ici :

     Info   porte l'échelle de temps et la durée — dans les premiers kilo-octets ;
     Tracks porte la définition de l'image et la durée d'une image ;
     Cues   porte, pour chaque image-clé, son instant et la position en octets du
            groupe qui la contient — et se trouve à la FIN du fichier.

   Deux lectures par plage, donc, exactement comme pour un MP4. Et les positions
   des Cues donnent mieux qu'une liste d'instants : l'écart d'octets entre deux
   images-clés, divisé par leur écart de temps, est un débit — c'est-à-dire la
   même mesure de mouvement que le poids des images d'un MP4. */

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_ECHELLE = 0x2ad7b1;
const ID_DUREE = 0x4489;
const ID_TRACKS = 0x1654ae6b;
const ID_PISTE = 0xae;
const ID_VIDEO = 0xe0;
const ID_LARGEUR = 0xb0;
const ID_HAUTEUR = 0xba;
const ID_PAR_IMAGE = 0x23e383;
const ID_CUES = 0x1c53bb6b;
const ID_CUE = 0xbb;
const ID_CUE_TEMPS = 0xb3;
const ID_CUE_PISTE = 0xb7;
const ID_CUE_POSITION = 0xf1;

export const estWebm = (octets) => octets.length > 4
  && octets[0] === 0x1a && octets[1] === 0x45 && octets[2] === 0xdf && octets[3] === 0xa3;

/* Un entier à longueur variable. Le premier bit à 1 dit sur combien d'octets il
   s'écrit ; pour un identifiant on garde les bits de marque, pour une taille on
   les retire — c'est la seule différence entre les deux. */
function vint(octets, ou, garderMarque) {
  if (ou >= octets.length) return null;
  const premier = octets[ou];
  if (!premier) return null;
  let longueur = 1;
  while (longueur <= 8 && !(premier & (0x80 >> (longueur - 1)))) longueur += 1;
  if (longueur > 8 || ou + longueur > octets.length) return null;
  let valeur = garderMarque ? premier : premier & (0xff >> longueur);
  let inconnue = !garderMarque && (premier & (0xff >> longueur)) === (0xff >> longueur);
  for (let i = 1; i < longueur; i += 1) {
    valeur = valeur * 256 + octets[ou + i];
    if (!garderMarque && octets[ou + i] !== 0xff) inconnue = false;
  }
  return { valeur, longueur, inconnue };
}

// Parcourir les enfants d'un élément : identifiant, taille, contenu.
function* enfants(octets, debut, fin) {
  let ou = debut;
  while (ou < fin) {
    const id = vint(octets, ou, true);
    if (!id) return;
    const taille = vint(octets, ou + id.longueur, false);
    if (!taille) return;
    const corps = ou + id.longueur + taille.longueur;
    // Une taille inconnue (Segment en flux) : on va jusqu'au bout de ce qu'on a.
    const bout = taille.inconnue ? fin : Math.min(fin, corps + taille.valeur);
    if (bout < corps) return;
    yield { id: id.valeur, corps, bout };
    ou = bout;
    if (taille.inconnue) return;
  }
}

const entier = (octets, a, b) => {
  let v = 0;
  for (let i = a; i < b; i += 1) v = v * 256 + octets[i];
  return v;
};

const flottant = (octets, a, b) => {
  const vue = new DataView(octets.buffer, octets.byteOffset + a, b - a);
  if (b - a === 4) return vue.getFloat32(0);
  if (b - a === 8) return vue.getFloat64(0);
  return entier(octets, a, b);
};

/* Les Cues, où qu'elles soient dans ce qu'on a lu. On ne suit pas le SeekHead :
   il donne des positions relatives au Segment, qu'il faudrait recalculer, alors
   qu'un élément Cues se reconnaît à son identifiant. On le cherche donc, et l'on
   vérifie que ce qu'on trouve se lit vraiment comme des Cues. */
function lireCues(octets, echelle) {
  const points = [];
  for (let ou = 0; ou + 4 < octets.length; ou += 1) {
    if (octets[ou] !== 0x1c || octets[ou + 1] !== 0x53
      || octets[ou + 2] !== 0xbb || octets[ou + 3] !== 0x6b) continue;
    const taille = vint(octets, ou + 4, false);
    if (!taille) continue;
    const corps = ou + 4 + taille.longueur;
    const bout = Math.min(octets.length, corps + taille.valeur);
    for (const point of enfants(octets, corps, bout)) {
      if (point.id !== ID_CUE) continue;
      let temps = null;
      let position = null;
      for (const champ of enfants(octets, point.corps, point.bout)) {
        if (champ.id === ID_CUE_TEMPS) temps = entier(octets, champ.corps, champ.bout);
        else if (champ.id === ID_CUE_PISTE) {
          for (const sous of enfants(octets, champ.corps, champ.bout)) {
            if (sous.id === ID_CUE_POSITION) position = entier(octets, sous.corps, sous.bout);
          }
        }
      }
      if (temps !== null) points.push({ temps: (temps * echelle) / 1e9, position });
    }
    if (points.length) break;
  }
  points.sort((a, b) => a.temps - b.temps);
  return points;
}

/* La courbe de mouvement, au même pas et dans la même unité que celle d'un MP4 :
   le milli-octet par pixel et par image. Entre deux images-clés, on n'a qu'un
   débit moyen — c'est plus grossier qu'une valeur par image, et cela suffit : ce
   qu'on cherche est la différence entre un plan fixe et un panoramique, pas le
   détail d'une image. */
function courbe(points, duree, surface, parImage, pas = 0.5) {
  if (!surface || !(duree > 0) || points.length < 2) return null;
  const cases = Math.max(1, Math.ceil(duree / pas));
  const valeurs = new Array(cases).fill(0);
  const fps = parImage > 0 ? 1e9 / parImage : 24;
  let vu = false;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.position === null || b.position === null) continue;
    const secondes = b.temps - a.temps;
    const octets = b.position - a.position;
    if (!(secondes > 0) || !(octets > 0)) continue;
    // Débit par seconde → poids d'une image → millièmes d'octet par pixel.
    const valeur = Math.min(255, Math.round(((octets / secondes / fps) / surface) * 1000));
    const debut = Math.max(0, Math.floor(a.temps / pas));
    const fin = Math.min(cases, Math.max(debut + 1, Math.ceil(b.temps / pas)));
    for (let k = debut; k < fin; k += 1) valeurs[k] = valeur;
    vu = true;
  }
  return vu ? { pas, valeurs } : null;
}

export function lireWebm(octets, queue) {
  if (!estWebm(octets)) return { echec: "pas un WebM" };
  let echelle = 1000000;
  let duree = 0;
  let largeur = 0;
  let hauteur = 0;
  let parImage = 0;

  for (const haut of enfants(octets, 0, octets.length)) {
    if (haut.id !== ID_SEGMENT) continue;
    for (const element of enfants(octets, haut.corps, haut.bout)) {
      if (element.id === ID_INFO) {
        for (const champ of enfants(octets, element.corps, element.bout)) {
          if (champ.id === ID_ECHELLE) echelle = entier(octets, champ.corps, champ.bout) || echelle;
          else if (champ.id === ID_DUREE) duree = flottant(octets, champ.corps, champ.bout);
        }
      } else if (element.id === ID_TRACKS) {
        for (const piste of enfants(octets, element.corps, element.bout)) {
          if (piste.id !== ID_PISTE) continue;
          for (const champ of enfants(octets, piste.corps, piste.bout)) {
            if (champ.id === ID_PAR_IMAGE) parImage = entier(octets, champ.corps, champ.bout);
            else if (champ.id === ID_VIDEO) {
              for (const sous of enfants(octets, champ.corps, champ.bout)) {
                if (sous.id === ID_LARGEUR) largeur = entier(octets, sous.corps, sous.bout);
                else if (sous.id === ID_HAUTEUR) hauteur = entier(octets, sous.corps, sous.bout);
              }
            }
          }
        }
      }
    }
  }

  const secondes = (duree * echelle) / 1e9;
  if (!(secondes > 0)) return { echec: "durée illisible" };

  // Les Cues sont à la fin : on les cherche dans la queue, et à défaut dans la
  // tête — certains fichiers les rangent devant.
  let points = queue?.length ? lireCues(queue, echelle) : [];
  if (points.length < 2) points = lireCues(octets, echelle);

  return {
    duree: Math.round(secondes * 1000) / 1000,
    cles: points.map((p) => Math.round(p.temps * 1000) / 1000).filter((t) => t >= 0 && t <= secondes + 0.5),
    codec: "webm",
    largeur,
    hauteur,
    mouvement: courbe(points, secondes, largeur * hauteur, parImage),
  };
}
