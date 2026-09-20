/* La notification qui arrive quand l'application est fermée.

   Tout le reste des bannières d'amvauto est posé par la page : elle suit la
   course du rendu et prévient à la fin. Cela suppose qu'elle tourne encore. Un
   onglet fermé n'exécute rien, un téléphone verrouillé suspend ses minuteurs, et
   c'est exactement le moment où l'on a besoin d'être prévenu — on a lancé le
   rendu justement pour ne pas le regarder se faire.

   Seul le serveur peut parler à un appareil qui ne tourne pas. Le navigateur lui
   confie une adresse de poussée (« endpoint ») et deux clés ; le serveur signe
   son envoi avec une identité stable (VAPID) et chiffre son message pour ces
   clés-là. Le service d'acheminement — Apple, Google, Mozilla selon l'appareil —
   ne peut donc ni lire le message ni en fabriquer un.

   Ce qui est stocké ici : l'adresse de poussée et les deux clés publiques de
   l'appareil, rangées sous le code du coffre. Rien d'autre — pas de nom, pas de
   compte. Qui n'a pas le code n'a pas les abonnements.

   Le chiffrement est celui de la RFC 8291 (aes128gcm), écrit à la main : il n'y a
   pas de bibliothèque dans un Worker, et le procédé tient en trente lignes de
   WebCrypto. */

import { codeValide } from "./coffre.js";

const ABONNES_MAX = 6;          // un téléphone, une tablette, un ordinateur… et de la marge
const VIE = 180 * 24 * 3600;    // six mois sans rendu, et l'abonnement s'oublie
const TTL_POUSSEE = 3600;       // une heure d'attente si l'appareil est éteint

const json = (charge, statut = 200) =>
  new Response(JSON.stringify(charge), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const cleDesAbonnes = (code) => `pousse:${code}`;

/* base64url : la forme sous laquelle toutes les clés de ce protocole voyagent. */
const enB64u = (octets) => {
  let texte = "";
  const vue = new Uint8Array(octets);
  for (const octet of vue) texte += String.fromCharCode(octet);
  return btoa(texte).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const deB64u = (texte) => {
  const propre = String(texte || "").replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(propre + "=".repeat((4 - (propre.length % 4)) % 4));
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i);
  return octets;
};

const joindre = (...morceaux) => {
  const total = morceaux.reduce((n, x) => n + x.length, 0);
  const tout = new Uint8Array(total);
  let ou = 0;
  for (const morceau of morceaux) { tout.set(morceau, ou); ou += morceau.length; }
  return tout;
};

const enOctets = (texte) => new TextEncoder().encode(texte);

/* HKDF, en deux temps comme la RFC l'écrit : extraire, puis développer. Une
   seule itération suffit partout ici — aucune sortie ne dépasse 32 octets. */
async function hmac(cle, message) {
  const importee = await crypto.subtle.importKey("raw", cle, { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", importee, message));
}

const extraire = (sel, matiere) => hmac(sel, matiere);

async function developper(prk, info, combien) {
  const sortie = await hmac(prk, joindre(info, new Uint8Array([1])));
  return sortie.slice(0, combien);
}

/* Les deux clés VAPID, telles que Cloudflare les garde : la privée est un secret
   (le « d » d'une clé P-256), la publique une variable ordinaire — elle est
   publique, la page la reçoit pour s'abonner. */
async function cleDeSignature(env) {
  const publique = deB64u(env.VAPID_PUBLIQUE || "");
  if (publique.length !== 65 || !env.VAPID_PRIVEE) return null;
  return crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    d: String(env.VAPID_PRIVEE),
    // La clé publique non compressée porte x et y à la suite du préfixe 0x04.
    x: enB64u(publique.slice(1, 33)),
    y: enB64u(publique.slice(33, 65)),
    ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]).catch(() => null);
}

/* Le laissez-passer VAPID : un jeton signé qui dit « c'est bien le même serveur
   qu'hier », valable douze heures et destiné à un seul service d'acheminement. */
async function laissezPasser(env, endpoint) {
  const cle = await cleDeSignature(env);
  if (!cle) return "";
  const entete = enB64u(enOctets(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corps = enB64u(enOctets(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_CONTACT || "mailto:amvauto@example.invalid",
  })));
  const signe = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, cle, enOctets(`${entete}.${corps}`)));
  return `${entete}.${corps}.${enB64u(signe)}`;
}

/* Chiffrer le message pour un appareil précis (RFC 8291).

   Le secret partagé vient d'un ECDH entre une clé éphémère du serveur et la clé
   publique de l'appareil ; le secret d'authentification de l'abonnement entre
   dans la dérivation, si bien qu'un message ne peut être forgé ni par le service
   d'acheminement ni par quiconque aurait vu passer les clés publiques. */
export async function chiffrerPourAbonne(abonne, texte) {
  const ua = deB64u(abonne.p256dh);
  const auth = deB64u(abonne.auth);
  if (ua.length !== 65 || auth.length !== 16) throw new Error("clés d'abonnement invalides");

  const paire = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" },
    true, ["deriveBits"]);
  const as = new Uint8Array(await crypto.subtle.exportKey("raw", paire.publicKey));
  const leur = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" },
    false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: leur }, paire.privateKey, 256));

  const prkMatiere = await extraire(auth, partage);
  const matiere = await developper(prkMatiere,
    joindre(enOctets("WebPush: info\0"), ua, as), 32);

  const sel = crypto.getRandomValues(new Uint8Array(16));
  const prk = await extraire(sel, matiere);
  const cleContenu = await developper(prk, enOctets("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await developper(prk, enOctets("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cleContenu, { name: "AES-GCM" },
    false, ["encrypt"]);
  // Le 0x02 final est le délimiteur de remplissage du dernier bloc : sans lui,
  // le navigateur rejette le message.
  const clair = joindre(enOctets(texte), new Uint8Array([2]));
  const scelle = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, clair));

  const taille = new Uint8Array(4);
  new DataView(taille.buffer).setUint32(0, 4096);
  return joindre(sel, taille, new Uint8Array([as.length]), as, scelle);
}

async function abonnes(env, code) {
  if (!env.COFFRE) return [];
  const brut = await env.COFFRE.get(cleDesAbonnes(code), "json").catch(() => null);
  return Array.isArray(brut) ? brut : [];
}

const ecrireAbonnes = (env, code, liste) => (liste.length
  ? env.COFFRE.put(cleDesAbonnes(code), JSON.stringify(liste), { expirationTtl: VIE })
  : env.COFFRE.delete(cleDesAbonnes(code)));

/* Prévenir tous les appareils d'un code qu'un fichier vient d'arriver.

   Ce qui est envoyé est court et déjà lisible : le service worker n'a plus qu'à
   l'afficher. Un abonnement que le service d'acheminement déclare mort — 404 ou
   410 — est retiré sur place : un téléphone dont l'application a été désinstallée
   ne doit pas rester à jamais dans la liste. */
export async function annoncerDepot(env, code, rendu) {
  const liste = await abonnes(env, code);
  if (!liste.length) return { envoyes: 0, retires: 0 };
  const zip = /\.zip$/i.test(rendu?.nom || "");
  const mo = rendu?.taille
    ? `${(rendu.taille / 1e6).toFixed(rendu.taille < 1e7 ? 1 : 0)} Mo`
    : "";
  const message = JSON.stringify({
    titre: zip ? "Ton projet DaVinci est prêt" : "Ton AMV est prêt",
    corps: `« ${rendu?.projet || rendu?.nom || "Ton montage"} »${mo ? ` · ${mo}` : ""}`
      + " — ouvre AMVAuto pour le télécharger.",
    rendu: rendu?.nom || "",
  });

  const vivants = [];
  let envoyes = 0;
  for (const abonne of liste) {
    let sort = 0;
    try {
      /* eslint-disable no-await-in-loop */
      const jeton = await laissezPasser(env, abonne.endpoint);
      if (!jeton) return { envoyes: 0, retires: 0, sansCles: true };
      const corps = await chiffrerPourAbonne(abonne, message);
      const reponse = await fetch(abonne.endpoint, {
        method: "POST",
        headers: {
          authorization: `vapid t=${jeton}, k=${env.VAPID_PUBLIQUE}`,
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(TTL_POUSSEE),
          urgency: "high",
          // Une seule poussée en attente par sujet : deux rendus coup sur coup
          // ne font pas deux bannières identiques empilées.
          topic: "amvauto-rendu",
        },
        body: corps,
      });
      /* eslint-enable no-await-in-loop */
      sort = reponse.status;
      if (reponse.ok) envoyes += 1;
    } catch { sort = 0; }
    // 404 et 410 sont les deux seules réponses qui veulent dire « cet appareil
    // n'existe plus ». Tout le reste — panne, quota, réseau — se réessaiera au
    // rendu suivant.
    if (sort !== 404 && sort !== 410) vivants.push(abonne);
  }
  if (vivants.length !== liste.length) await ecrireAbonnes(env, code, vivants).catch(() => {});
  return { envoyes, retires: liste.length - vivants.length };
}

/* La route : la clé publique pour s'abonner, l'inscription, la résiliation. */
export async function pousser(request, url, env) {
  if (request.method === "GET" && !url.searchParams.has("code")) {
    // Sans clés posées sur le Worker, il n'y a pas de poussée possible : la page
    // doit pouvoir l'apprendre plutôt que d'échouer à s'abonner en silence.
    return json({ cle: env.VAPID_PUBLIQUE || "" });
  }

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) return json({ error: "code invalide" }, 403);
  if (!env.COFFRE) return json({ error: "stockage indisponible" }, 503);

  if (request.method === "GET") {
    return json({ cle: env.VAPID_PUBLIQUE || "", abonnes: (await abonnes(env, code)).length });
  }

  if (request.method === "POST") {
    const dit = await request.json().catch(() => null);
    const endpoint = String(dit?.endpoint || "");
    const p256dh = String(dit?.keys?.p256dh || "");
    const auth = String(dit?.keys?.auth || "");
    /* Une adresse de poussée est une URL en https, servie par le navigateur
       lui-même : on refuse tout le reste plutôt que d'envoyer plus tard des
       requêtes signées vers une adresse choisie par un tiers. */
    let hote;
    try { hote = new URL(endpoint); } catch { return json({ error: "adresse invalide" }, 400); }
    if (hote.protocol !== "https:" || endpoint.length > 600) {
      return json({ error: "adresse invalide" }, 400);
    }
    if (deB64u(p256dh).length !== 65 || deB64u(auth).length !== 16) {
      return json({ error: "clés invalides" }, 400);
    }
    const liste = (await abonnes(env, code)).filter((x) => x.endpoint !== endpoint);
    liste.unshift({ endpoint, p256dh, auth, quand: Date.now() });
    await ecrireAbonnes(env, code, liste.slice(0, ABONNES_MAX));
    return json({ abonnes: Math.min(liste.length, ABONNES_MAX) });
  }

  /* L'essai : la seule façon, depuis un téléphone, de savoir si la chaîne entière
     marche — signature, chiffrement, acheminement, service worker. Une bannière
     posée par la page ne prouve que la dernière étape. Il ne touche que les
     appareils de ce code : il n'y a rien à en tirer pour quelqu'un d'autre. */
  if (request.method === "PUT") {
    const bilan = await annoncerDepot(env, code, { nom: "essai.mp4", projet: "Essai de notification" });
    return json({ ...bilan, abonnes: (await abonnes(env, code)).length });
  }

  if (request.method === "DELETE") {
    const dit = await request.json().catch(() => null);
    const endpoint = String(dit?.endpoint || "");
    const liste = (await abonnes(env, code)).filter((x) => x.endpoint !== endpoint);
    await ecrireAbonnes(env, code, liste);
    return json({ abonnes: liste.length });
  }

  return json({ error: "méthode non permise" }, 405);
}
