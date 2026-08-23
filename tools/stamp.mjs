// Estampille le Worker et la page avec le même horodatage, juste avant un
// déploiement : c'est ce qui permet à l'interface de repérer qu'un navigateur
// lui sert une copie périmée.
import { readFileSync, writeFileSync } from "node:fs";

const maintenant = new Date();
const deuxChiffres = (n) => String(n).padStart(2, "0");
const version =
  `${maintenant.getUTCFullYear()}-${deuxChiffres(maintenant.getUTCMonth() + 1)}-` +
  `${deuxChiffres(maintenant.getUTCDate())} ${deuxChiffres(maintenant.getUTCHours())}:` +
  `${deuxChiffres(maintenant.getUTCMinutes())}`;

/* On vérifie que le motif existe, pas que le contenu a changé.

   La garde d'avant confondait deux choses très différentes : « la marque est
   introuvable, ce fichier n'est pas estampillable » et « la marque porte déjà
   cette valeur ». Or deux déploiements dans la même minute produisent le même
   horodatage : le second échouait donc en annonçant une estampille introuvable,
   alors que tout allait bien. */
const remplacer = (chemin, motif, remplacement) => {
  const avant = readFileSync(chemin, "utf8");
  if (!motif.test(avant)) throw new Error(`estampille introuvable dans ${chemin}`);
  writeFileSync(chemin, avant.replace(motif, remplacement));
};

remplacer("worker/src/version.js", /export const VERSION = "[^"]*";/, `export const VERSION = "${version}";`);
remplacer("public/index.html", /const VERSION_PAGE = "[^"]*";/, `const VERSION_PAGE = "${version}";`);
remplacer("public/sw.js", /const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
console.log("version", version);
