/* Génération de musique.

   La clé d'un fournisseur ne peut pas vivre dans la page : n'importe qui
   pourrait la lire et dépenser — ou épuiser — le compte du propriétaire. Elle
   reste donc ici, en secret du Worker, et la page ne connaît que cette route.

   Deux protections, parce que cette route consomme une ressource comptée :
   le code du coffre sert de laissez-passer — sans lui, personne ne peut tirer
   sur le quota — et un plafond quotidien borne la casse même si le code fuite.

   Trois fournisseurs, choisis par ce qui est configuré :

   — ACE-Step, par un Space Hugging Face. Gratuit : un jeton Hugging Face
     personnel, gratuit lui aussi, ouvre un quota de GPU quotidien. Le modèle
     est sous licence Apache 2.0, donc la musique produite est utilisable
     partout, publication comprise. C'est le seul chemin à la fois gratuit et
     automatique que j'aie trouvé qui tienne.
   — Lyria, par l'API Gemini. Payant, à la seconde, aucun palier gratuit — et
     pour cette raison il faut le demander explicitement par « MUSIQUE_LYRIA ».
     La même clé Gemini sert à lire les rushs, et facturer un morceau parce
     qu'un jeton gratuit a échoué serait une très mauvaise surprise.
   — Démonstration : un fichier connu, pour éprouver la chaîne sans compte. */

import { codeValide } from "./coffre.js";
import { compter } from "./quota.js";

const PAR_JOUR = 20;              // plafond de générations quotidiennes
const ATTENTE_MAX = 180000;       // trois minutes : au-delà, on rend la main

const ESPACE_DEFAUT = "ACE-Step/ACE-Step";
const ETAPES_DEFAUT = 27;         // moitié du réglage d'usine : deux fois moins de quota brûlé
const DUREE_MAX = 240;            // la borne du modèle
const DUREE_MIN = 10;

/* Un serveur personnel, annoncé par la page.

   ZeroGPU donne cinq minutes de GPU par jour. Kaggle en donne trente heures par
   semaine, Colab une quinzaine — cinquante fois plus, gratuitement. Il suffit d'y
   faire tourner le même ACE-Step derrière un Gradio, ce qui rend une adresse
   publique temporaire, et de la donner ici.

   Cette adresse ne peut pas être n'importe laquelle. Un Worker qui va chercher
   l'URL qu'on lui souffle est une porte ouverte sur tout ce qu'il peut joindre —
   y compris des services internes. On n'accepte donc que les domaines des
   tunnels connus, en HTTPS, et jamais une adresse brute. */
const TUNNELS = [".gradio.live", ".trycloudflare.com", ".ngrok-free.app", ".ngrok.io", ".loca.lt"];

function espacePersonnel(brut, local = false) {
  if (typeof brut !== "string" || !brut) return null;
  let cible;
  try { cible = new URL(brut.trim()); } catch { return null; }
  // En développement seulement, pour éprouver la bascule sans tunnel réel.
  if (local && (cible.hostname === "127.0.0.1" || cible.hostname === "localhost")) return cible.origin;
  if (cible.protocol !== "https:") return null;
  if (!TUNNELS.some((suffixe) => cible.hostname.endsWith(suffixe))) return null;
  return `${cible.origin}`;
}

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");


/* L'adresse d'un Space se déduit de son nom : « ACE-Step/ACE-Step » vit sur
   « ace-step-ace-step.hf.space ». Tout ce qui n'est pas une lettre ou un
   chiffre devient un tiret, et le tout passe en minuscules. */
const hoteEspace = (espace) => "https://" +
  String(espace).trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() +
  ".hf.space";

/* Gradio répond en deux temps : on dépose la demande, on écoute la file.

   Le second temps compte autant que le premier. La route courte
   (« /call/<nom>/<événement> ») ne rend qu'un « error » vide quand ça casse,
   alors que la file rend la phrase exacte du serveur — quota épuisé, temps
   d'attente restant. Comme la route nommée accepte qu'on lui impose le
   « session_hash », on prend la commodité de l'une et la parole de l'autre. */
async function suivreLaFile(hote, session, entetes) {
  const flux = await fetch(`${hote}/gradio_api/queue/data?session_hash=${session}`, {
    headers: { ...entetes, accept: "text/event-stream" },
  });
  if (!flux.ok || !flux.body) throw new Error(`la file du Space a répondu ${flux.status}`);

  const lecteur = flux.body.getReader();
  const decodeur = new TextDecoder();
  let reste = "";
  try {
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) throw new Error("le Space a fermé la file sans rendre de résultat");
      reste += decodeur.decode(value, { stream: true });
      // Un événement par ligne « data: … » ; le reste (commentaires, vides) s'ignore.
      let coupure = reste.indexOf("\n");
      while (coupure >= 0) {
        const ligne = reste.slice(0, coupure).trim();
        reste = reste.slice(coupure + 1);
        coupure = reste.indexOf("\n");
        if (!ligne.startsWith("data:")) continue;
        let evenement;
        try { evenement = JSON.parse(ligne.slice(5)); } catch { continue; }
        if (evenement?.msg === "process_completed") return evenement;
        if (evenement?.msg === "unexpected_error") {
          throw new Error(evenement.message || "le Space a rendu une erreur inattendue");
        }
      }
    }
  } finally {
    lecteur.cancel().catch(() => null);
  }
}

/* Le quota ZeroGPU se compte en secondes de GPU par jour et par compte. Sa
   phrase est en anglais et parle de jetons : on la traduit, parce que c'est le
   message que l'utilisateur verra le plus souvent. */
async function traduireEchec(motif, env) {
  if (/quota/i.test(motif)) {
    const dans = motif.match(/Try again in ([0-9:]+)/i)?.[1];
    const reste = motif.match(/([0-9]+)s left/i)?.[1];

    /* « 0s left » avec un délai nul, c'est la signature d'une requête anonyme :
       ZeroGPU ne reconnaît pas le jeton. Un quota réellement épuisé annonce
       toujours l'heure de sa recharge. On vérifie donc le jeton avant d'accuser
       le quota — se tromper de cause ferait attendre un jour pour rien. */
    if (reste === "0" && (!dans || dans === "0:00:00")) {
      const qui = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { authorization: `Bearer ${env.JETON_HF}` },
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!qui?.name) {
        return "Hugging Face ne reconnaît pas le jeton : les requêtes partent en anonyme, et l'anonyme n'a pas de quota. Vérifie le secret « JETON_HF » — un espace ou un retour à la ligne collé avec la clé suffit à l'invalider.";
      }
      /* ZeroGPU annonce « 0:00:00 » quand il ne reste rien : ce n'est pas un
         délai, c'est une absence de délai calculable. Le dire tel quel ferait
         réessayer en boucle. */
      return `Quota GPU du jour épuisé pour le compte « ${qui.name} ». Il se recharge vingt-quatre heures après la première génération, pas à minuit.\n\nEn attendant : « Copier le style » et « Copier les paroles » se collent dans Suno, dont le palier gratuit rend une dizaine de morceaux par jour. On télécharge le résultat, « En apporter une » l'importe, et le montage automatique marche exactement pareil dessus.`;
    }
    return "Quota GPU épuisé" + (dans && dans !== "0:00:00" ? ` : il revient dans ${dans}.` : " pour aujourd'hui.") +
      " En attendant, le brief se colle dans Suno — une dizaine de morceaux par jour sur son palier gratuit — et « En apporter une » réimporte le résultat.";
  }
  if (/GPU task aborted|ZeroGPU worker error/i.test(motif)) {
    return "Le GPU partagé a lâché en cours de route. Relance : c'est presque toujours passager.";
  }
  return motif;
}

/* On cherche l'audio dans ce que le Space a rendu, sans présumer de la forme :
   Gradio décrit un fichier tantôt par une adresse complète, tantôt par un
   chemin sur son disque. */
function trouverAudio(sortie) {
  const trouves = [];
  const parcourir = (noeud) => {
    if (!noeud || typeof noeud !== "object" || trouves.length) return;
    if (Array.isArray(noeud)) return noeud.forEach(parcourir);
    const chemin = noeud.url || noeud.path;
    if (typeof chemin === "string" && /\.(wav|mp3|flac|ogg|m4a)(\?|$)/i.test(chemin)) {
      trouves.push(noeud);
      return;
    }
    for (const valeur of Object.values(noeud)) parcourir(valeur);
  };
  parcourir(sortie);
  return trouves[0] || null;
}

/* Un seul essai, sur un serveur donné. */
async function surUnEspace(env, brief, poste) {
  const hote = /^https?:\/\//.test(poste.espace)
    ? poste.espace.replace(/\/+$/, "")
    : hoteEspace(poste.espace);
  /* Pas de jeton vers un serveur personnel : il n'en demande pas, et l'envoyer
     le donnerait à une machine que nous ne contrôlons pas. */
  const entetes = poste.jeton ? { authorization: `Bearer ${poste.jeton}` } : {};
  const session = crypto.randomUUID().replace(/-/g, "");

  const secondes = Math.min(DUREE_MAX, Math.max(DUREE_MIN, Math.round(brief.secondes) || 60));
  const etapes = Math.min(200, Math.max(1, Number(env.MUSIQUE_ETAPES) || ETAPES_DEFAUT));
  const style = String(brief.style || brief.consigne).slice(0, 1000);
  const paroles = String(brief.paroles || "[inst]").slice(0, 2000);

  /* L'ordre des arguments est celui du Space, relevé sur « /gradio_api/info ».
     Le reste garde les réglages d'usine : ce sont ceux sur lesquels le modèle
     a été montré, et les toucher au hasard ne ferait qu'abîmer le rendu. */
  const donnees = [
    secondes, style, paroles, etapes, 15, "euler", "apg", 10, null, 0.5, 0, 3,
    true, false, true, null, 0, 0, false, 0.5, null, "none",
  ];

  const depot = await fetch(`${hote}/gradio_api/call/__call__`, {
    method: "POST",
    headers: { ...entetes, "content-type": "application/json" },
    body: JSON.stringify({ data: donnees, session_hash: session }),
  });
  if (!depot.ok) {
    const detail = (await depot.text()).slice(0, 200);
    throw new Error(`le serveur a refusé la demande (${depot.status}) : ${detail}`);
  }

  const fin = await suivreLaFile(hote, session, entetes);
  if (!fin.success) {
    throw new Error(await traduireEchec(fin.output?.error || fin.title || "génération refusée", env));
  }

  const audio = trouverAudio(fin.output?.data);
  if (!audio) throw new Error("le serveur n'a rendu aucun fichier audio");
  const adresse = audio.url || `${hote}/gradio_api/file=${audio.path}`;
  const fichier = await fetch(adresse, { headers: entetes });
  if (!fichier.ok) throw new Error(`le fichier rendu est inaccessible (${fichier.status})`);

  const octets = new Uint8Array(await fichier.arrayBuffer());
  const nom = audio.orig_name || "ace-step.wav";
  return { octets, type: audio.mime_type || fichier.headers.get("content-type") || "audio/wav", nom };
}

/* Un échec qui vaut la peine d'essayer ailleurs : quota vidé, serveur saturé,
   carnet éteint, réseau coupé. Une consigne refusée, non — elle le serait
   partout, et insister ne ferait que doubler l'attente. */
const vautUnSecours = (motif) =>
  /quota|GPU|indisponible|injoignable|refusé la demande \((4|5)\d\d|n'a pas répondu|fetch failed|network|ECONN|à temps/i
    .test(String(motif));

/* Le Space public d'abord, le serveur personnel en secours.

   C'est l'ordre qui use le moins : le quota gratuit de ZeroGPU existe, autant
   le dépenser, et il n'exige rien de l'utilisateur. Quand il est vide — deux ou
   trois morceaux plus tard — la génération bascule d'elle-même sur le carnet
   Kaggle ou Colab, s'il en tourne un. L'inverse gaspillerait un quota qui se
   perd de toute façon à la fin de la journée.

   Si le carnet est éteint, le message rendu est celui du premier serveur : le
   quota, qui est la vraie cause, et non l'adresse morte. */
async function parEspaceHF(env, brief) {
  const postes = [];
  if (env.JETON_HF) {
    postes.push({ nom: "public", espace: env.ESPACE_MUSIQUE || ESPACE_DEFAUT, jeton: env.JETON_HF });
  }
  if (brief.espace) postes.push({ nom: "perso", espace: brief.espace, jeton: null });
  if (!postes.length) postes.push({ nom: "public", espace: env.ESPACE_MUSIQUE || ESPACE_DEFAUT, jeton: null });

  let premierEchec = null;
  for (let i = 0; i < postes.length; i += 1) {
    try {
      const rendu = await surUnEspace(env, brief, postes[i]);
      return { ...rendu, serveur: postes[i].nom, secours: i > 0 };
    } catch (erreur) {
      if (!premierEchec) premierEchec = erreur;
      const reste = i < postes.length - 1;
      if (!reste || !vautUnSecours(erreur.message)) throw premierEchec;
    }
  }
  throw premierEchec;
}

/* Lyria, par l'API Gemini. Une seule requête : la réponse porte l'audio en
   base64, sans file d'attente à interroger. Modèles et tarifs relevés dans la
   documentation officielle : « lyria-3-clip-preview » pour trente secondes à
   0,04 $, « lyria-3-pro-preview » pour un morceau complet à 0,08 $. Aucun des
   deux n'est offert sur le palier gratuit. */
async function parLyria(env, brief) {
  const modele = brief.court ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
  const reponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modele,
      input: brief.consigne,
      response_format: { type: "audio" },
    }),
  });
  if (!reponse.ok) {
    const detail = (await reponse.text()).slice(0, 300);
    throw new Error(`Lyria a répondu ${reponse.status} : ${detail}`);
  }
  const contenu = await reponse.json();
  // On cherche le premier bloc audio dans les étapes rendues.
  const blocs = [];
  const parcourir = (noeud) => {
    if (!noeud || typeof noeud !== "object") return;
    if (Array.isArray(noeud)) return noeud.forEach(parcourir);
    if (noeud.type === "audio" && typeof noeud.data === "string") blocs.push(noeud);
    for (const valeur of Object.values(noeud)) parcourir(valeur);
  };
  parcourir(contenu.steps || contenu);
  if (!blocs.length) throw new Error("Lyria n'a rendu aucun bloc audio");
  const brut = atob(blocs[0].data);
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i);
  return { octets, type: blocs[0].mime_type || "audio/mpeg", nom: "lyria.mp3" };
}

/* Un fournisseur de démonstration : il renvoie un fichier connu, ce qui permet
   d'éprouver toute la chaîne — laissez-passer, plafond, transport, dépôt dans la
   piste son, lecture du tempo — sans compte ni dépense. Il n'existe qu'en
   développement, quand l'adresse de démonstration est configurée. */
async function parDemonstration(env) {
  const reponse = await fetch(env.MUSIQUE_DEMO);
  if (!reponse.ok) throw new Error(`démonstration indisponible (${reponse.status})`);
  const octets = new Uint8Array(await reponse.arrayBuffer());
  return { octets, type: reponse.headers.get("content-type") || "audio/wav", nom: "demonstration.wav" };
}

export async function genererMusique(request, url, env) {
  if (request.method !== "POST") return new Response("méthode non permise", { status: 405 });

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) {
    return new Response(JSON.stringify({
      erreur: "Cette route demande un code de sauvegarde : c'est lui qui empêche un inconnu de tirer sur le quota. Active la sauvegarde en ligne dans Réglages.",
    }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  let brief;
  try {
    brief = await request.json();
  } catch {
    return new Response("consigne illisible", { status: 400 });
  }
  if (!brief?.consigne || typeof brief.consigne !== "string" || brief.consigne.length > 4000) {
    return new Response("consigne inattendue", { status: 400 });
  }
  if (brief.espace) {
    const propre = espacePersonnel(brief.espace, Boolean(env.ESPACE_LOCAL));
    if (!propre) {
      return new Response(JSON.stringify({
        erreur: `Adresse de serveur refusée. Seuls les tunnels connus sont acceptés, en HTTPS : ${TUNNELS.join(", ")}.`,
      }), { status: 400, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    brief.espace = propre;
  }

  const fournisseur = env.MUSIQUE_DEMO ? parDemonstration
    : (brief.espace || env.JETON_HF) ? parEspaceHF
    : env.MUSIQUE_LYRIA && env.GEMINI_API_KEY ? parLyria
    : null;
  if (!fournisseur) {
    return new Response(JSON.stringify({
      erreur: "Aucun fournisseur n'est configuré. Le gratuit passe par un jeton Hugging Face personnel (huggingface.co/settings/tokens), à poser en secret « JETON_HF » sur le Worker.",
    }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  const rang = await compter(env, "musique", code.slice(0, 8), PAR_JOUR);
  if (rang < 0) {
    return new Response(JSON.stringify({
      erreur: `Plafond atteint : ${PAR_JOUR} générations pour aujourd'hui. Il se remet à zéro demain.`,
    }), { status: 429, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  try {
    const attente = new Promise((_, rejeter) =>
      setTimeout(() => rejeter(new Error("le fournisseur n'a pas répondu à temps")), ATTENTE_MAX));
    const { octets, type, nom, serveur, secours } = await Promise.race([fournisseur(env, brief), attente]);
    return new Response(octets, {
      headers: {
        "content-type": type,
        "content-disposition": `inline; filename="${nom}"`,
        "cache-control": "no-store",
        "x-generations-du-jour": String(rang),
        ...(serveur ? { "x-serveur": serveur + (secours ? " (secours)" : "") } : {}),
      },
    });
  } catch (erreur) {
    return new Response(JSON.stringify({ erreur: erreur.message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
