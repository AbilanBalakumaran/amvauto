/* Reconnaître une image que le décodeur a ratée.

   Une image mal encodée se contrôle par comparaison : on sait à quoi elle
   devait ressembler. Une image mal décodée, non — il n'existe aucune référence,
   seulement l'image telle qu'elle sort. Il faut donc la juger sur elle-même.

   Ce qui la trahit, c'est la grille. Un décodeur H.264 travaille par carrés de
   seize pixels ; quand il se trompe de référence, ce sont des carrés entiers
   qui viennent d'ailleurs, et leurs bords tombent exactement sur les multiples
   de seize. Une image dessinée, elle, n'a aucune raison d'aligner ses contours
   là : un trait, un cheveu, une bouche passent où ils veulent.

   Reste le piège, et c'est lui qui rendait la mesure inutilisable : un encodeur
   fabrique une grille lui aussi. À bas débit — celui, précisément, auquel l'app
   fabrique ses blocs pour tenir sur un téléphone — une image parfaitement
   décodée montre déjà ses carrés. Mesuré sur quatre-vingt-dix vraies images
   d'anime à trois qualités : la grille d'une image propre très comprimée monte
   à 5,4 quand une image légèrement abîmée descend à 1,0. Les deux tas se
   recouvrent : impossible de trancher.

   La sortie est là : les deux pannes ne cassent pas sur la même grille. Un
   encodeur découpe par huit et lisse les bords qu'il crée ; un décodeur qui se
   trompe de référence déplace des carrés de seize. On ne compare donc pas les
   coutures de seize au reste de l'image — on les compare à celles de huit. Le
   grain de compression s'annule de lui-même : sur les mêmes images propres, la
   mesure vaut 1,03, qu'elles soient à peine comprimées ou écrasées.

   Calibré sur sept cent vingt images dont on connaît la vérité : quatre-vingt-
   neuf pour cent des images abîmées attrapées, aucune image propre accusée à
   tort. Les quatre pannes de macrobloc — références déplacées, même de peu,
   blocs sans référence, traînées — le sont à 98 ou 100 pour cent. Ce qui
   échappe est la tranche perdue, qu'une seule image ne peut pas trahir : c'est
   « bandeFigee », plus bas, qui s'en charge, sur deux images qui se suivent. */

export const MACROBLOC = 16;

/* La luminance perçue, en entiers : le vert pèse le plus, le bleu le moins.

   Elle n'est jamais calculée sur l'image entière. Déplier huit cent mille
   pixels en mémoire puis les reparcourir deux fois coûtait, sur un processeur
   de téléphone, plus que tout le reste de la fabrication réunie : mesuré au
   banc, la lecture tombait de vingt-trois à deux images par seconde. On calcule
   donc chaque valeur là où elle sert, et une seule fois. */
const luma = (rgba, i) => (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;

/* Un échantillon de l'image, pour la comparaison d'une image à la suivante :
   un pixel sur trois dans chaque sens, ce qui suffit largement à voir si une
   bande a bougé, et coûte neuf fois moins. */
export const PAS_APERCU = 3;
export function apercuLuma(rgba, l, h) {
  const cl = Math.ceil(l / PAS_APERCU);
  const ch = Math.ceil(h / PAS_APERCU);
  const y = new Uint8Array(cl * ch);
  for (let j = 0, b = 0; j < ch; j += 1, b += PAS_APERCU) {
    for (let x = 0, a = 0; x < cl; x += 1, a += PAS_APERCU) {
      y[j * cl + x] = luma(rgba, (b * l + a) * 4);
    }
  }
  return { y, l: cl, h: ch };
}

const median = (t) => {
  if (!t.length) return 0;
  const c = Array.from(t).sort((a, b) => a - b);
  const m = c.length >> 1;
  return c.length % 2 ? c[m] : (c[m - 1] + c[m]) / 2;
};

/* Les mesures d'une image, à sa taille d'origine.

   À sa taille d'origine, parce que c'est la seule où la grille de seize existe
   encore : réduite, elle disparaît. Et l'image entière, pas un morceau : une
   tranche perdue tombe le plus souvent en haut ou en bas, là où un cadrage
   central ne regarde pas. */
export function mesurer(rgba, l, h) {
  if (!rgba || l < MACROBLOC * 3 || h < MACROBLOC * 3) return null;

  /* On échantillonne, et pas n'importe comment.

     L'énergie d'une colonne se mesure sur une ligne sur trois, celle d'une ligne
     sur une colonne sur trois : ce qu'on cherche est un contour qui traverse
     toute l'image, il n'a aucun besoin d'être compté pixel par pixel. Ce qui
     doit rester intact, en revanche, c'est la phase — les colonnes gardées sont
     toutes les colonnes, les lignes gardées toutes les lignes. Sauter une
     colonne sur deux détruirait la grille de seize ; sauter une ligne sur trois
     dans le calcul d'une colonne ne lui fait rien. */
  const PAS = 3;

  const colonnes = new Float64Array(l);
  for (let x = 1; x < l; x += 1) {
    let somme = 0;
    let combien = 0;
    for (let j = 0; j < h; j += PAS) {
      const i = (j * l + x) * 4;
      somme += Math.abs(luma(rgba, i) - luma(rgba, i - 4));
      combien += 1;
    }
    colonnes[x] = combien ? somme / combien : 0;
  }
  const lignes = new Float64Array(h);
  const ligneOctets = l * 4;
  for (let j = 1; j < h; j += 1) {
    let somme = 0;
    let combien = 0;
    for (let x = 0; x < l; x += PAS) {
      const i = (j * l + x) * 4;
      somme += Math.abs(luma(rgba, i) - luma(rgba, i - ligneOctets));
      combien += 1;
    }
    lignes[j] = combien ? somme / combien : 0;
  }

  // Trois familles : les coutures de seize, celles de huit, et tout le reste.
  const seize = [];
  const huit = [];
  const hors = [];
  for (let x = 1; x < l; x += 1) (x % 16 === 0 ? seize : x % 8 === 0 ? huit : hors).push(colonnes[x]);
  for (let j = 1; j < h; j += 1) (j % 16 === 0 ? seize : j % 8 === 0 ? huit : hors).push(lignes[j]);

  /* La médiane, pas la moyenne : un seul contour franc — le bord d'un
     personnage, une bande noire — suffirait à tirer une moyenne, et l'on
     jugerait le dessin au lieu de juger le décodage. */
  const m16 = median(seize);
  const m8 = median(huit);
  const mh = median(hors);

  /* La couture la plus violente, cherchée seulement là où les deux côtés ont du
     dessin. Le bord d'une bande noire est une vraie couture de l'image, pas une
     panne : on ne le compte pas.

     Ce qui compte pour « avoir du dessin » se mesure sur l'image elle-même. Un
     seuil fixe ne marche pas : le dessin animé est fait d'aplats, et le gradient
     médian d'une vraie image d'anime propre tombe entre 0,03 et 0,4 — cent fois
     moins qu'une photographie. Un garde-fou posé en dur écartait ainsi les
     images les plus abîmées du corpus, celles dont la mesure valait cinquante. */
  const fond = Math.max(mh, 0.15);
  const dessin = Math.max(0.1, mh * 0.6);
  const moyenneSur = (table, debut, fin, borne) => {
    let somme = 0;
    let combien = 0;
    for (let i = Math.max(1, debut); i < Math.min(borne, fin); i += 1) { somme += table[i]; combien += 1; }
    return combien ? somme / combien : 0;
  };
  let pire = 0;
  for (let j = MACROBLOC; j < h - MACROBLOC; j += MACROBLOC) {
    if (moyenneSur(lignes, j - 12, j - 2, h) < dessin || moyenneSur(lignes, j + 2, j + 12, h) < dessin) continue;
    pire = Math.max(pire, lignes[j] / fond);
  }
  for (let x = MACROBLOC; x < l - MACROBLOC; x += MACROBLOC) {
    if (moyenneSur(colonnes, x - 12, x - 2, l) < dessin || moyenneSur(colonnes, x + 2, x + 12, l) < dessin) continue;
    pire = Math.max(pire, colonnes[x] / fond);
  }

  return {
    seize: Math.round((m8 > 0.2 ? m16 / m8 : 1) * 1000) / 1000,
    pire: Math.round(pire * 10) / 10,
    contraste: Math.round(mh * 100) / 100,
  };
}

/* Le mouvement bande par bande, entre deux images qui se suivent.

   C'est la seule façon de voir une tranche perdue : une bande de l'image est
   restée sur l'image d'avant pendant que le reste bougeait. Sur une seule
   image, cette bande est un dessin parfaitement plausible ; sur deux, elle est
   la seule à ne pas avoir bougé — ou la seule à avoir sauté. */
export function bandeFigee(avant, apres) {
  if (!avant || !apres || avant.y.length !== apres.y.length) return null;
  const l = avant.l;
  const h = avant.h;
  const bande = Math.max(2, Math.round(MACROBLOC / PAS_APERCU));
  const nb = Math.floor(h / bande);
  if (nb < 6) return null;
  const bouges = new Float64Array(nb);
  for (let b = 0; b < nb; b += 1) {
    let somme = 0;
    for (let j = b * bande; j < (b + 1) * bande; j += 1) {
      for (let x = 0; x < l; x += 1) somme += Math.abs(apres.y[j * l + x] - avant.y[j * l + x]);
    }
    bouges[b] = somme / (l * bande);
  }
  const central = median(bouges);
  // Sur une image immobile, il n'y a rien à comparer : tout est « figé ».
  if (central < 1.2) return { ecart: 0, central: Math.round(central * 100) / 100 };
  let ecart = 0;
  for (let b = 1; b < nb - 1; b += 1) {
    // Une bande seule à ne pas bouger, ou seule à bouger beaucoup trop.
    const voisines = (bouges[b - 1] + bouges[b + 1]) / 2;
    if (voisines < 1.2) continue;
    ecart = Math.max(ecart, bouges[b] < central * 0.12 ? 3 : bouges[b] / Math.max(voisines, 0.5));
  }
  return { ecart: Math.round(ecart * 100) / 100, central: Math.round(central * 100) / 100 };
}

/* Les seuils.

   Ils ne sont pas devinés. Ils viennent de sept cent vingt images : quatre-
   vingt-dix vraies images d'anime, chacune à trois qualités de compression pour
   les propres, et cassée de quatre façons pour les abîmées — macroblocs
   déplacés, blocs sans référence, tranche perdue, traînée. Le couple retenu est
   le plus serré qui n'accuse aucune image propre. */
export const SEUILS = { seize: 1.35, pire: 60, ecart: 2.6 };

export function abimee(m, mouvement, seuils = SEUILS) {
  if (!m) return null;
  if (m.seize > seuils.seize) return { quoi: "macroblocs déplacés", valeur: m.seize };
  if (m.pire > seuils.pire) return { quoi: "couture", valeur: m.pire };
  if (mouvement && mouvement.ecart > seuils.ecart) return { quoi: "bande figée", valeur: mouvement.ecart };
  return null;
}
