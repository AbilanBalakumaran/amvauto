/* Les comptes : une porte nommée devant un code.

   Jusqu'ici, retrouver ses montages sur un autre appareil demandait de recopier
   un code de vingt caractères. C'est sûr et c'est gratuit, mais cela ne se
   partage pas : donner l'application à quelqu'un, c'est lui demander de gérer un
   code qu'il perdra. Un identifiant et un mot de passe, en revanche, tout le
   monde sait.

   Le compte ne remplace donc pas le code : il le garde. Créer un compte tire un
   code neuf ; se connecter le rend. Tout ce qui existait derrière — le coffre,
   le grenier — continue de fonctionner sans rien savoir des comptes.

   Ce qui est stocké, et ce qui ne l'est pas :

     — le mot de passe n'est jamais écrit. On garde l'empreinte PBKDF2-SHA-256
       de deux cent mille tours, avec un sel tiré au sort par compte. Deux
       comptes au même mot de passe n'ont pas la même empreinte, et une empreinte
       volée ne se retourne pas en mot de passe sans un coût démesuré ;
     — le code de secours n'est pas écrit non plus, pour la même raison et de la
       même façon. Il est montré une fois, à la création, et c'est tout ;
     — la comparaison se fait en temps constant : un « === » sur des empreintes
       rend son verdict d'autant plus vite qu'il se trompe tôt, et cela se
       mesure.

   Il n'y a pas de courriel, donc pas de service tiers à brancher : un mot de
   passe oublié se retrouve avec le code de secours donné à l'inscription. C'est
   le choix qui garde l'application entière entre Cloudflare et le navigateur. */

import { controle } from "./coffre.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TOURS = 200_000;
const VIE_JETON = 60 * 60 * 24 * 30;      // trente jours
const ESSAIS_MAX = 8;                     // par quart d'heure et par identifiant
const VIE_ESSAIS = 60 * 15;

const donnees = (charge, statut = 200) =>
  new Response(JSON.stringify(charge), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const refus = (message, statut = 400) => donnees({ erreur: message }, statut);

const hexa = (octets) => [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, "0")).join("");

function tirer(combien) {
  const brut = crypto.getRandomValues(new Uint8Array(combien));
  return [...brut].map((o) => ALPHABET[o % 32]).join("");
}

/* Un code de coffre neuf : dix-huit caractères tirés au sort, deux de contrôle.
   Exactement la forme que « codeValide » attend, puisque c'est le même code. */
function codeNeuf() {
  const base = tirer(18);
  return base + controle(base);
}

/* Le code de secours : six groupes de quatre, lisible et recopiable. Trente
   caractères de l'alphabet sans ambiguïté, soit cent vingt bits — hors de
   portée d'une recherche exhaustive. */
function secoursNeuf() {
  const brut = tirer(24);
  return brut.match(/.{4}/g).join("-");
}

const nettoyerSecours = (brut) =>
  String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

async function empreinte(secret, sel) {
  const graine = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(sel), iterations: TOURS },
    graine, 256,
  );
  return hexa(bits);
}

/* Comparer sans laisser fuir où la différence se trouve. */
function memeEmpreinte(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let ecart = 0;
  for (let i = 0; i < x.length; i += 1) ecart |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return ecart === 0;
}

/* Un identifiant : trois à trente caractères, lettres, chiffres, point, tiret,
   souligné. Rangé en minuscules pour que « Zoro » et « zoro » soient la même
   personne — et affiché tel qu'il a été écrit. */
const clefCompte = (identifiant) => `compte:${String(identifiant).toLowerCase()}`;

function identifiantValide(brut) {
  const net = String(brut || "").trim();
  return /^[A-Za-z0-9._-]{3,30}$/.test(net) ? net : null;
}

// Un mot de passe court n'est pas un mot de passe. Huit caractères au moins, et
// pas de plafond bas : une phrase de passe doit passer.
const motValide = (brut) => typeof brut === "string" && brut.length >= 8 && brut.length <= 200;

async function trop(env, identifiant) {
  const cle = `essais:${String(identifiant).toLowerCase()}`;
  const compte = Number(await env.COFFRE.get(cle)) || 0;
  return { cle, compte, bloque: compte >= ESSAIS_MAX };
}

async function noterEchec(env, cle, compte) {
  await env.COFFRE.put(cle, String(compte + 1), { expirationTtl: VIE_ESSAIS }).catch(() => null);
}

async function ouvrirSession(env, identifiant) {
  const jeton = `${tirer(16)}${tirer(16)}`;
  await env.COFFRE.put(`jeton:${jeton}`, String(identifiant).toLowerCase(),
    { expirationTtl: VIE_JETON });
  return jeton;
}

export async function compte(request, url, env) {
  if (!env.COFFRE) return refus("comptes indisponibles", 503);
  const action = url.searchParams.get("action") || "";

  if (request.method === "GET") {
    // Qui suis-je ? — la seule question qu'un jeton permet de poser.
    const jeton = url.searchParams.get("jeton") || "";
    if (!/^[0-9A-Z]{32}$/.test(jeton)) return refus("jeton invalide", 401);
    const qui = await env.COFFRE.get(`jeton:${jeton}`);
    if (!qui) return refus("session expirée", 401);
    const brut = await env.COFFRE.get(clefCompte(qui));
    if (!brut) return refus("compte introuvable", 404);
    const fiche = JSON.parse(brut);
    return donnees({ identifiant: fiche.affiche || qui, code: fiche.code });
  }

  if (request.method !== "POST") return refus("méthode non permise", 405);

  let corps = {};
  try { corps = await request.json(); } catch { return refus("requête illisible"); }

  if (action === "sortir") {
    const jeton = String(corps.jeton || "");
    if (/^[0-9A-Z]{32}$/.test(jeton)) await env.COFFRE.delete(`jeton:${jeton}`).catch(() => null);
    return donnees({ sorti: true });
  }

  const identifiant = identifiantValide(corps.identifiant);
  if (!identifiant) {
    return refus("Un identifiant de 3 à 30 caractères : lettres, chiffres, point, tiret ou souligné.");
  }
  const cle = clefCompte(identifiant);

  if (action === "creer") {
    if (!motValide(corps.motdepasse)) return refus("Un mot de passe d'au moins 8 caractères.");
    if (await env.COFFRE.get(cle)) return refus("Cet identifiant est déjà pris.", 409);
    const sel = tirer(16);
    const selSecours = tirer(16);
    const secours = secoursNeuf();
    const fiche = {
      affiche: identifiant,
      sel,
      empreinte: await empreinte(corps.motdepasse, sel),
      selSecours,
      empreinteSecours: await empreinte(nettoyerSecours(secours), selSecours),
      code: codeNeuf(),
      cree: Date.now(),
    };
    await env.COFFRE.put(cle, JSON.stringify(fiche));
    const jeton = await ouvrirSession(env, identifiant);
    /* Le code de secours ne sort qu'ici, une seule fois. Il n'est pas rangé en
       clair, donc personne — pas même ce serveur — ne peut le redonner. */
    return donnees({ identifiant, jeton, code: fiche.code, secours });
  }

  if (action === "entrer") {
    const garde = await trop(env, identifiant);
    if (garde.bloque) return refus("Trop d'essais. Réessaie dans un quart d'heure.", 429);
    const brut = await env.COFFRE.get(cle);
    if (!brut || !motValide(corps.motdepasse)) {
      await noterEchec(env, garde.cle, garde.compte);
      // Le même message dans les deux cas : dire « ce compte n'existe pas »
      // apprendrait à un inconnu quels identifiants sont pris.
      return refus("Identifiant ou mot de passe incorrect.", 401);
    }
    const fiche = JSON.parse(brut);
    const essai = await empreinte(corps.motdepasse, fiche.sel);
    if (!memeEmpreinte(essai, fiche.empreinte)) {
      await noterEchec(env, garde.cle, garde.compte);
      return refus("Identifiant ou mot de passe incorrect.", 401);
    }
    await env.COFFRE.delete(garde.cle).catch(() => null);
    const jeton = await ouvrirSession(env, identifiant);
    return donnees({ identifiant: fiche.affiche || identifiant, jeton, code: fiche.code });
  }

  if (action === "oublie") {
    const garde = await trop(env, identifiant);
    if (garde.bloque) return refus("Trop d'essais. Réessaie dans un quart d'heure.", 429);
    if (!motValide(corps.motdepasse)) return refus("Un nouveau mot de passe d'au moins 8 caractères.");
    const brut = await env.COFFRE.get(cle);
    if (!brut) {
      await noterEchec(env, garde.cle, garde.compte);
      return refus("Identifiant ou code de secours incorrect.", 401);
    }
    const fiche = JSON.parse(brut);
    const essai = await empreinte(nettoyerSecours(corps.secours), fiche.selSecours);
    if (!memeEmpreinte(essai, fiche.empreinteSecours)) {
      await noterEchec(env, garde.cle, garde.compte);
      return refus("Identifiant ou code de secours incorrect.", 401);
    }
    /* Le code de secours ne sert qu'une fois : on en tire un neuf, et l'ancien
       ne vaut plus rien. Sinon un code recopié une fois vaudrait pour toujours. */
    const secours = secoursNeuf();
    fiche.sel = tirer(16);
    fiche.empreinte = await empreinte(corps.motdepasse, fiche.sel);
    fiche.selSecours = tirer(16);
    fiche.empreinteSecours = await empreinte(nettoyerSecours(secours), fiche.selSecours);
    await env.COFFRE.put(cle, JSON.stringify(fiche));
    await env.COFFRE.delete(garde.cle).catch(() => null);
    const jeton = await ouvrirSession(env, identifiant);
    return donnees({ identifiant: fiche.affiche || identifiant, jeton, code: fiche.code, secours });
  }

  return refus("action inconnue");
}
