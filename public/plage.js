/* Ne télécharger que les octets que le montage utilise.

   Un rush de Sakugabooru pèse dix mégaoctets et dure huit secondes ; un plan en
   prend une seconde. Rapatrier le fichier entier pour en garder un huitième
   coûte, sur un lien de métro, une minute par montage — et c'est ce qui rend
   l'outil inutilisable dans les transports.

   Un MP4 dit où sont ses octets : la table « stco » donne la position de chaque
   échantillon, « stsz » sa taille. Ces tables sont dans la boîte « moov », qui
   pèse huit à dix-huit kilo-octets et que ces fichiers rangent À LA FIN. Deux
   petites requêtes suffisent donc pour savoir exactement quoi demander :
   quelques kilo-octets d'en-tête, puis les seules tranches utiles.

   Ce module ne fait que le calcul. Il ne connaît ni le réseau ni le stockage :
   on lui donne un début de fichier, il dit où est « moov » ; on lui donne une
   carte et des fenêtres, il dit quels octets réclamer. */

/* Les boîtes de premier niveau, lues sur un début de fichier.

   On ne lit que les en-têtes — huit octets, seize pour une taille longue — et
   l'on saute d'une boîte à l'autre. Une boîte dont le corps dépasse ce qu'on a
   sous la main ne pose aucun problème : sa taille est dans son en-tête, et
   c'est tout ce dont on a besoin pour trouver la suivante. */
export function boitesDeTete(octets) {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const boites = [];
  let ou = 0;
  while (ou + 8 <= octets.length) {
    let taille = vue.getUint32(ou);
    const nom = String.fromCharCode(octets[ou + 4], octets[ou + 5], octets[ou + 6], octets[ou + 7]);
    let entete = 8;
    if (taille === 1) {
      if (ou + 16 > octets.length) break;
      // Une taille sur soixante-quatre bits : le nombre haut d'abord.
      taille = vue.getUint32(ou + 8) * 4294967296 + vue.getUint32(ou + 12);
      entete = 16;
    }
    // « jusqu'au bout du fichier » : on ne sait pas où il finit, on s'arrête là.
    if (taille === 0) { boites.push({ nom, ou, taille: 0, entete }); break; }
    if (taille < entete) break;
    boites.push({ nom, ou, taille, entete });
    ou += taille;
  }
  return boites;
}

/* Où est « moov », et l'avons-nous déjà ?

   Rendu : « { ou, taille, present } ». « present » dit si la boîte tient
   entièrement dans ce qu'on a lu — auquel cas il n'y a pas de seconde requête à
   faire. « ou » vaut -1 quand le début du fichier ne permet pas de conclure :
   ce n'est pas un MP4, ou la chaîne des boîtes est cassée. */
export function trouverMoov(tete) {
  for (const boite of boitesDeTete(tete)) {
    if (boite.nom !== "moov") continue;
    return { ou: boite.ou, taille: boite.taille,
      present: boite.taille > 0 && boite.ou + boite.taille <= tete.length };
  }
  // Pas trouvée : la dernière boîte connue dit où commence la suivante.
  const boites = boitesDeTete(tete);
  const derniere = boites[boites.length - 1];
  if (!derniere || !derniere.taille) return { ou: -1, taille: 0, present: false };
  return { ou: derniere.ou + derniere.taille, taille: 0, present: false };
}

/* Les octets qu'il faut pour couvrir une fenêtre du rush.

   On part de l'image-clé qui précède l'entrée — un décodeur ne sait pas
   commencer ailleurs — et l'on va jusqu'au dernier échantillon dont l'instant
   de décodage tombe dans la fenêtre, marge de réordonnancement comprise. Le
   résultat est l'intervalle d'octets qui contient tous ces échantillons.

   Les échantillons d'une piste vidéo se suivent dans le fichier : l'intervalle
   est donc dense, et demander « du premier au dernier » ne réclame presque rien
   de plus que la somme de leurs tailles. On ne cherche pas mieux : une requête
   par fenêtre vaut mieux que trente requêtes exactes sur un lien à trois cents
   millisecondes de latence. */
const MARGE_REORDRE = 0.5;

/* Par où commencer, quand on n'a pas encore les octets.

   « departCle » choisit de préférence une image-clé vérifiée dans le flux —
   c'est-à-dire en lisant ses octets. Ici, justement, on ne les a pas : c'est ce
   qu'on cherche à télécharger. Toutes les images passeraient donc pour
   douteuses, et le choix retomberait sur la première du fichier, c'est-à-dire
   sur le fichier entier.

   On s'en tient donc à ce que les tables déclarent, et l'on recule d'une
   image-clé de plus. Ce recul est l'assurance du dispositif : si la fabrique
   décide plus tard de repartir plus tôt — ce qu'elle fait quand un bloc sort
   abîmé — les octets sont déjà là. Il coûte quelques dizaines de kilo-octets. */
export function depuisPourFenetre(carte, entree, recul = 1) {
  const ech = carte.echantillons;
  if (!ech?.length) return -1;
  const cles = [];
  for (let i = 0; i < ech.length; i += 1) if (ech[i].cle) cles.push(i);
  if (!cles.length) return 0;
  let rang = -1;
  for (let k = 0; k < cles.length; k += 1) {
    if (ech[cles[k]].instant / carte.echelle <= entree + 1e-6) rang = k;
    else break;
  }
  if (rang < 0) rang = 0;
  return cles[Math.max(0, rang - recul)];
}

export function tranchePourFenetre(carte, depuis, entree, sortie) {
  const ech = carte.echantillons;
  if (!ech?.length || depuis < 0 || depuis >= ech.length) return null;
  let debut = Infinity;
  let fin = 0;
  for (let i = depuis; i < ech.length; i += 1) {
    const e = ech[i];
    if (e.decodage / carte.echelle > sortie + MARGE_REORDRE) break;
    debut = Math.min(debut, e.ou);
    fin = Math.max(fin, e.ou + e.taille);
  }
  if (!Number.isFinite(debut) || fin <= debut) return null;
  return { debut, fin };
}

/* Fondre les tranches qui se touchent presque.

   Deux fenêtres voisines dans le même rush laissent entre elles un trou de
   quelques dizaines de kilo-octets. Ouvrir une seconde requête pour l'éviter
   coûte plus cher que de le télécharger : à trois cents millisecondes de
   latence, un aller-retour vaut cinquante kilo-octets de contenu. On fond donc
   tout ce qui est séparé de moins que cela. */
export const TROU_TOLERE = 64 * 1024;

export function fondreTranches(tranches, tolere = TROU_TOLERE) {
  const propres = tranches.filter(Boolean).sort((a, b) => a.debut - b.debut);
  const sortie = [];
  for (const t of propres) {
    const derniere = sortie[sortie.length - 1];
    if (derniere && t.debut - derniere.fin <= tolere) {
      derniere.fin = Math.max(derniere.fin, t.fin);
    } else {
      sortie.push({ debut: t.debut, fin: t.fin });
    }
  }
  return sortie;
}

// Ce que pèsent des tranches, pour dire ce qu'on a économisé.
export const poidsTranches = (tranches) =>
  tranches.reduce((somme, t) => somme + (t.fin - t.debut), 0);
