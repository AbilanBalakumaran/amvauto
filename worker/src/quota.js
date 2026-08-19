/* Le compteur quotidien.

   Deux routes tirent sur des ressources comptées — le GPU d'un Space pour la
   musique, les neurones de Workers AI pour les paroles. Ni l'une ni l'autre ne
   doit pouvoir être vidée par un inconnu qui aurait mis la main sur un code.

   La clé porte le jour dans son nom et expire d'elle-même au bout de deux
   jours : il n'y a rien à nettoyer, et la remise à zéro de minuit est gratuite.
   Renvoie le rang de l'appel, ou -1 si le plafond est atteint. */
export async function compter(env, sujet, cle, plafond) {
  if (!env.COFFRE) return 0;
  const jour = new Date().toISOString().slice(0, 10);
  const compteur = `${sujet}:${jour}:${cle}`;
  const vu = Number(await env.COFFRE.get(compteur)) || 0;
  if (vu >= plafond) return -1;
  await env.COFFRE.put(compteur, String(vu + 1), { expirationTtl: 172800 });
  return vu + 1;
}
