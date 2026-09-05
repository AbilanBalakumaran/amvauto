/* Découper un plan sans le réencoder.

   C'est le changement d'angle. Jusqu'ici, préparer un plan voulait dire :
   décoder les images du rush, les redessiner dans un cadre, puis les réencoder
   à un débit tenable pour un téléphone. Trois opérations, dont deux coûteuses,
   et surtout : un réencodage est toujours une perte. On peut le régler mieux ou
   moins bien, on ne peut pas le rendre nul. Les carrés visibles à l'aperçu
   venaient de là, et aucun réglage de débit ne les aurait fait disparaître.

   Or il n'y a rien à encoder. Le rush est déjà du H.264, à la bonne définition,
   encodé une fois pour toutes par ceux qui l'ont mis en ligne. Le morceau qu'on
   veut est une suite d'images déjà compressées, à la file dans le fichier. Le
   préparer, c'est recopier ces octets-là dans un petit conteneur, avec les
   mêmes paramètres de décodage. Le résultat est identique à la source au bit
   près — il ne peut pas être « mieux encodé », il est le même.

   Ce que cela demande en échange :

     — commencer sur une image-clé. Une image quelconque dépend de celles qui la
       précèdent ; on remonte donc à l'image-clé qui précède le point d'entrée,
       et l'on prévient l'appelant du temps d'avance ainsi inclus. C'est lui qui
       positionnera la lecture ;
     — garder les décalages d'affichage. Un flux courant réordonne ses images :
       recopier les octets sans recopier « ctts » les afficherait dans le
       désordre ;
     — ne rien promettre sur les codecs qu'on ne sait pas emballer. Un rush WebM
       repart par l'ancien chemin. */

import { lireMp4, departCle } from "./demux.js";
import { ecrireMp4 } from "./mp4.js";

/* Les codecs qu'on sait recopier tels quels : ceux que le multiplexeur sait
   décrire, et que tous les téléphones savent lire. */
export function copiable(carte) {
  return !!carte && !carte.echec && typeof carte.codec === "string"
    && carte.codec.startsWith("avc1") && !!carte.description && carte.description.length >= 7;
}

/* Le morceau demandé, recopié.

   Rend un blob MP4, la durée réellement couverte, et « decalage » : le temps
   d'avance inclus, c'est-à-dire de combien il faut avancer dans ce fichier pour
   tomber sur l'image que le montage voulait. */
export function copierMorceau(donnees, carte, entree, sortie, caler = true) {
  if (!copiable(carte)) return { echec: "codec non recopiable" };
  const ech = carte.echantillons;
  if (ech.length < 4) return { echec: "rush trop court" };

  /* Caler la fenêtre sur une image-clé, à durée constante.

     Sans cela, un plan qui commence entre deux images-clés traîne derrière lui
     tout le groupe d'images qui précède : mesuré sur un vrai rush, jusqu'à 2,7
     secondes d'avance pour un plan de 0,8 — des octets qu'il faut ranger sur le
     téléphone et redécoder à chaque lecture, pour ne rien montrer.

     On déplace donc la fenêtre jusqu'à l'image-clé la plus proche, en gardant
     exactement sa durée. Le plan montre un instant légèrement différent du même
     rush ; il tombe toujours au même endroit sur la musique, et il démarre
     désormais sur une image-clé — c'est-à-dire immédiatement, sans rien avoir à
     redécoder avant. */
  const longueur = Math.max(0.05, sortie - entree);
  let debutVise = entree;
  if (caler) {
    const finRush = ech[ech.length - 1].instant / carte.echelle;
    let meilleure = -1;
    let ecart = Infinity;
    for (let i = 0; i < ech.length; i += 1) {
      if (!ech[i].cle) continue;
      const t = ech[i].instant / carte.echelle;
      if (t + longueur > finRush + 0.05) continue;      // la fenêtre sortirait du rush
      const d = Math.abs(t - entree);
      if (d < ecart) { ecart = d; meilleure = i; }
    }
    if (meilleure >= 0) debutVise = ech[meilleure].instant / carte.echelle;
  }
  const finVise = debutVise + longueur;

  const depuis = departCle(carte, debutVise + 0.001);
  if (depuis < 0) return { echec: "aucune image-clé dans le fichier" };

  /* Jusqu'où aller : la dernière image dont l'affichage tombe avant la sortie.
     Les images qui suivent dans l'ordre du fichier s'affichent forcément après,
     puisqu'on prend le plus grand indice. */
  let jusqua = depuis;
  for (let i = depuis; i < ech.length; i += 1) {
    if (ech[i].instant / carte.echelle <= finVise) jusqua = i;
  }
  // Une image de plus : la dernière doit avoir une durée à couvrir.
  if (jusqua + 1 < ech.length) jusqua += 1;
  if (jusqua <= depuis) return { echec: "morceau trop court dans le rush" };

  const debut = ech[depuis].decodage;
  const echantillons = [];
  for (let i = depuis; i <= jusqua; i += 1) {
    const e = ech[i];
    if (e.ou < 0 || e.ou + e.taille > donnees.length) break;
    echantillons.push({
      octets: donnees.subarray(e.ou, e.ou + e.taille),
      taille: e.taille,
      duree: e.duree,
      // L'écart entre décodage et affichage, tel qu'il était dans le rush.
      composition: e.instant - e.decodage,
      cle: e.cle,
    });
  }
  if (echantillons.length < 2) return { echec: "trop peu d'images entières" };

  /* Le segment doit commencer à zéro, et non à quatre-vingts millisecondes.

     Les instants recopiés sont ceux du rush, et le premier d'entre eux n'est pas
     nul : une image-clé s'affiche un peu après avoir été décodée, c'est
     justement ce que dit « ctts ». Le fichier produit commençait donc par un
     petit trou, et l'application devait déplacer le lecteur pour entrer dedans —
     à chaque coupe.

     Ce déplacement est ce qu'on voyait. Pendant qu'il a lieu, le lecteur n'a
     aucune image à donner : le moniteur passe au noir entre les plans, et comme
     rien n'a jamais été retenu pour ce plan-là, il se rabat sur la vignette de
     couverture — trois cents points agrandis sur tout l'écran. « Un plan noir
     entre chaque plan », « une frame pixelisée avant que ça se lance », « on
     voit l'image de couverture » : trois façons de décrire le même trou.

     On décale donc tous les instants d'affichage pour que le premier tombe à
     zéro. Le lecteur n'a plus rien à chercher : il joue. */
  let premierInstant = debut;
  {
    let minimum = Infinity;
    let horloge = 0;
    for (const e of echantillons) {
      minimum = Math.min(minimum, horloge + e.composition);
      horloge += e.duree;
    }
    if (Number.isFinite(minimum)) {
      // L'instant du rush qui se retrouve à zéro dans le fichier produit.
      premierInstant = debut + minimum;
      if (minimum !== 0) for (const e of echantillons) e.composition -= minimum;
    }
  }

  const piste = {
    id: 1,
    type: "video",
    codec: carte.codec,
    description: carte.description,
    largeur: carte.largeur,
    hauteur: carte.hauteur,
    echelle: carte.echelle,
    echantillons,
  };
  const mp4 = ecrireMp4([piste]);

  const couverte = echantillons.reduce((somme, e) => somme + e.duree, 0) / carte.echelle;
  return {
    mp4,
    images: echantillons.length,
    largeur: carte.largeur,
    hauteur: carte.hauteur,
    /* De combien il faut avancer dans ce fichier pour voir l'image demandée.

       Calé sur une image-clé, c'est zéro : le fichier commence exactement là où
       le plan commence. Non calé, le fichier commence à l'image-clé qui précède
       — il le faut, un décodeur ne sait pas partir d'ailleurs — et le plan
       commence plus loin dedans. C'est ce qui permet de garder l'instant que
       l'utilisateur a choisi : sur ces rushs-là, l'image-clé la plus proche est
       parfois à trois secondes, et se caler dessus montre une autre scène. */
    decalage: caler ? 0 : Math.max(0, entree - premierInstant / carte.echelle),
    // Où, dans le rush, ce morceau commence réellement — l'app en a besoin
    // pour rester d'accord avec elle-même sur ce que montre ce plan.
    entree: debutVise,
    couverte,
    octets: mp4.size,
  };
}
