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

const remplacer = (chemin, motif, remplacement) => {
  const avant = readFileSync(chemin, "utf8");
  const apres = avant.replace(motif, remplacement);
  if (avant === apres) throw new Error(`estampille introuvable dans ${chemin}`);
  writeFileSync(chemin, apres);
};

remplacer("worker/src/version.js", /export const VERSION = "[^"]*";/, `export const VERSION = "${version}";`);
remplacer("public/index.html", /const VERSION_PAGE = "[^"]*";/, `const VERSION_PAGE = "${version}";`);
remplacer("public/sw.js", /const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
console.log("version", version);
