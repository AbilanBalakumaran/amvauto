// Worker amvauto : sert l'interface (assets statiques) et expose l'API de
// proposition de rushs. Sakugabooru étant sans CORS, tous les appels JSON
// passent par ici.

import { themes, themesLarges } from "./animethemes.js";
import { coffre } from "./coffre.js";
import { genererMusique } from "./musique.js";
import { relayerMedia } from "./media.js";
import { extrait } from "./extrait.js";
import { cles } from "./cles.js";
import { grenier } from "./grenier.js";
import { piste } from "./piste.js";
import { compte } from "./compte.js";
import { ecrireParoles } from "./paroles.js";
import { accorderParoles } from "./accord.js";
import { lireScene } from "./scene.js";
import { ecoute } from "./ecoute.js";
import { arcOf, describe, episodeNumber, FOLDERS, folderOf, techniqueOf } from "./naming.js";
import { copyrightTags, rushes, rushesPartout, searchSeries, serieDe } from "./sakuga.js";
import { rendu } from "./rendu.js";
import { veille } from "./veille.js";
import { MOODS, TAGS_MONTAGE, TAG_PHARE, moodsOf, qualityFlags, rank } from "./scoring.js";
import { findCurated, SERIES, suggest } from "./series.js";
import { VERSION } from "./version.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  /* Six heures au bord, et une journée de sursis pendant lequel la réponse
     périmée est servie tout de suite pendant qu'une fraîche se prépare. Un
     catalogue de rushs ne change pas d'un quart d'heure à l'autre, et attendre
     une seconde pour l'apprendre est une seconde de trop. */
  "cache-control": "public, max-age=21600, stale-while-revalidate=86400",
};

/* Une réponse en erreur n'est jamais gardée. Elle l'était un quart d'heure comme
   les autres : une recherche tombée sur une panne passagère de Sakugabooru
   renvoyait « Rien trouvé » pendant quinze minutes, y compris pour un animé qui
   existe — et rien, côté page, ne permettait de s'en sortir. */
function json(payload, status = 200) {
  const entetes = status >= 400
    ? { ...JSON_HEADERS, "cache-control": "no-store" }
    : JSON_HEADERS;
  return new Response(JSON.stringify(payload), { status, headers: entetes });
}

function serialize({ post, score }) {
  const moods = moodsOf(post);
  return {
    id: post.id,
    name: describe(post),
    // Le dossier suit l'action nommée, jamais le barème : le nom du fichier et
    // son rangement doivent raconter la même chose.
    folder: folderOf(post),
    score,
    votes: post.score,
    moods,
    // Ce que le plan montre, en mots que le montage sait enchaîner : un élan
    // n'appelle pas la même suite qu'un impact.
    tags: post.tags.filter((tag) => TAGS_MONTAGE.has(tag)),
    technique: techniqueOf(post.tags),
    flags: qualityFlags(post),
    artists: post.artists.map((a) => a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())),
    width: post.width,
    height: post.height,
    mb: Math.round((post.file_size / 1e6) * 100) / 100,
    episode: episodeNumber(post.source),
    provider: "sakugabooru",
    ref: post.source.slice(0, 90),
    video: post.file_url,
    preview: post.preview_url,
    page: `https://www.sakugabooru.com/post/show/${post.id}`,
  };
}

// Premier tag qui rend réellement des rushs : le plus fourni n'est pas toujours
// interrogeable (certains tags de série sont masqués côté Sakugabooru).
async function resolve(query, pool) {
  const curated = findCurated(query);
  if (curated) {
    const found = await rushes(curated[1], pool);
    if (found.length) return { display: curated[0], tag: curated[1], posts: found };
  }

  const candidates = await searchSeries(query);
  for (const candidate of candidates.slice(0, 5)) {
    const found = await rushes(candidate.name, pool);
    if (found.length) {
      const display = candidate.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return { display, tag: candidate.name, posts: found };
    }
  }
  return null;
}

// Les sources externes ne parlent pas la même langue que Sakugabooru : on les
// ramène à la forme d'un rush pour que l'explorateur n'ait qu'un seul modèle.
function fromSource(item) {
  return {
    id: item.id,
    name: item.name,
    score: item.score,
    votes: null,
    moods: [],
    technique: null,
    flags: item.flags || [],
    artists: item.artists || [],
    width: item.width,
    height: item.height,
    mb: item.mb,
    episode: item.episode,
    provider: item.source,
    ref: item.serie || "",
    video: item.video,
    // Deux adresses quand la source en offre : celle du rendu, et une plus
    // légère pour monter. Le montage n'a pas besoin de 1080p, le rendu si.
    montage: item.montage || null,
    montageHauteur: item.montageHauteur || 0,
    montageCredite: item.montageCredite || false,
    mbRendu: item.mbRendu || null,
    youtube: item.youtube || null,
    preview: item.preview,
    page: item.page,
  };
}

// Deux plans de la même scène produisent le même nom : on les numérote plutôt
// que de laisser deux fichiers identiques dans un dossier.
function dedupe(rushes) {
  const seen = new Map();
  return rushes.map((rush) => {
    const count = (seen.get(rush.name) || 0) + 1;
    seen.set(rush.name, count);
    return count > 1 ? { ...rush, name: `${rush.name} (${count})` } : rush;
  });
}

// Arborescence arc -> ambiance -> rushs. Chaque rush ne va que dans une seule
// ambiance (la plus marquée) : c'est un classement de fichiers, pas un jeu de
// filtres, un plan ne peut pas être rangé à deux endroits.
function buildTree(posts, query, seriesName) {
  const ranked = rank(posts, null);
  const arcs = new Map();

  for (const entry of ranked) {
    const arc = arcOf(entry.post, query, seriesName);
    if (!arcs.has(arc.key)) {
      arcs.set(arc.key, { key: arc.key, label: arc.label, count: 0, folders: new Map() });
    }
    const node = arcs.get(arc.key);
    const rush = serialize(entry);

    if (!node.folders.has(rush.folder)) {
      node.folders.set(rush.folder, {
        key: rush.folder,
        label: FOLDERS[rush.folder],
        count: 0,
        rushes: [],
      });
    }
    node.folders.get(rush.folder).rushes.push(rush);
    node.folders.get(rush.folder).count += 1;
    node.count += 1;
  }

  const order = Object.keys(FOLDERS);
  // Ordre de lecture d'une série : le tronc, puis les arcs nommés (dans l'ordre
  // quand leur nom porte un numéro de saison), puis les films et les OVA, et
  // pour finir les génériques.
  const rang = (arc) => {
    if (arc.key === "principale") return 0;
    if (arc.key === "divers") return 1e6;
    if (/^film/i.test(arc.label)) return 2000;
    if (/^(ova|ona)/i.test(arc.label)) return 2100;
    const numero = arc.label.match(/(?:saison|season)\s*(\d+)/i);
    if (numero) return 1000 + Number(numero[1]);
    if (/final/i.test(arc.label)) return 1090;
    return 1500;
  };
  return [...arcs.values()]
    .sort((a, b) => rang(a) - rang(b) || b.count - a.count)
    .map((arc) => ({
      key: arc.key,
      label: arc.label,
      count: arc.count,
      folders: [...arc.folders.values()]
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
        .map((folder) => ({
          ...folder,
          rushes: dedupe(
            folder.rushes.sort((a, b) => (a.episode ?? 1e6) - (b.episode ?? 1e6) || b.score - a.score),
          ),
        })),
    }));
}

async function handleTree(url) {
  const query = (url.searchParams.get("anime") || "").trim();
  if (!query) return json({ error: "Indique un animé." }, 400);

  const pool = Math.min(2000, Math.max(50, Number(url.searchParams.get("pool")) || 2000));

  // Les deux sources sont interrogées de front, et l'échec de l'une ne doit pas
  // emporter l'autre : un générique reste utile si Sakugabooru tousse.
  // Les bandes-annonces AniList, elles, sont chargées par la page : AniList
  // refuse les requêtes venant d'un Worker (403) mais autorise le CORS, donc
  // le navigateur l'appelle en direct.
  const [cuts, generiques] = await Promise.allSettled([resolve(query, pool), themes(query)]);

  const resolved = cuts.status === "fulfilled" ? cuts.value : null;
  const listeThemes = generiques.status === "fulfilled" ? generiques.value : [];

  if (!resolved && !listeThemes.length) {
    return json({ error: `Rien trouvé pour « ${query} ».`, suggestions: suggest("", 6) }, 404);
  }

  const nom = resolved?.display || listeThemes[0]?.serie || query;
  const arcs = resolved ? buildTree(resolved.posts, resolved.tag, resolved.display) : [];

  const openings = listeThemes.filter((item) => item.kind === "opening").map(fromSource);
  const endings = listeThemes.filter((item) => item.kind === "ending").map(fromSource);
  if (openings.length || endings.length) {
    arcs.push({
      key: "generiques",
      label: "Openings & endings",
      count: openings.length + endings.length,
      folders: [
        { key: "opening", label: "Openings", count: openings.length, rushes: dedupe(openings) },
        { key: "ending", label: "Endings", count: endings.length, rushes: dedupe(endings) },
      ].filter((dossier) => dossier.count),
    });
  }

  return json({
    anime: nom,
    tag: resolved?.tag || null,
    total: (resolved?.posts.length || 0) + listeThemes.length,
    sources: {
      sakugabooru: resolved?.posts.length || 0,
      animethemes: listeThemes.length,
      // La raison de l'échec est renvoyée : une source qui tombe doit se
      // diagnostiquer sans avoir à relire les logs.
      echecs: [
        [cuts, "sakugabooru"],
        [generiques, "animethemes"],
      ]
        .filter(([resultat]) => resultat.status === "rejected")
        .map(([resultat, nom]) => `${nom} : ${resultat.reason?.message || "erreur inconnue"}`),
    },
    arcs,
  });
}

/* Les propositions : le raccourci d'abord, puis tout le catalogue du site.

   « Quand j'écris Naruto ça me propose que Naruto Shippuden. » C'était vrai :
   les propositions ne sortaient que d'une liste écrite à la main de
   soixante-treize séries, où « naruto » est un alias de Shippuden. Or le tag
   « naruto » existe sur le site et porte 2833 posts — presque deux fois
   Shippuden. Le raccourci, censé être un garde-fou, fermait la porte.

   On interroge donc le catalogue des tags de copyright, qui en compte des
   milliers, et l'on annonce pour chacun le nombre de posts. Le raccourci reste
   devant quand il répond : c'est lui qui sait rattraper les titres déformés du
   site — homoglyphes, titres de code — qu'aucune recherche par nom ne retrouve. */
async function propositions(question, limite = 10) {
  const vus = new Set();
  const liste = [];
  for (const { display, tag } of suggest(question, limite)) {
    if (vus.has(tag)) continue;
    vus.add(tag);
    liste.push({ display, tag, raccourci: true });
  }
  if (!question.trim()) return liste.slice(0, limite);
  try {
    for (const tag of await searchSeries(question)) {
      if (vus.has(tag.name)) continue;
      vus.add(tag.name);
      liste.push({ display: joliTag(tag.name), tag: tag.name, scenes: tag.count });
    }
  } catch { /* le site ne répond pas : le raccourci suffit */ }
  return liste.slice(0, limite);
}

// Un tag de copyright, écrit pour être lu : « naruto_(2002) » → « Naruto (2002) ».
const joliTag = (nom) => nom.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function handleRushes(url) {
  const query = (url.searchParams.get("anime") || "").trim();

  const mood = url.searchParams.get("mood") || null;
  if (mood && !MOODS[mood]) return json({ error: `Ambiance inconnue : ${mood}` }, 400);

  const top = Math.min(200, Math.max(1, Number(url.searchParams.get("top")) || 24));
  const pool = Math.min(2000, Math.max(top, Number(url.searchParams.get("pool")) || 1000));

  const generiquesVoulus = url.searchParams.get("generiques") === "1";

  /* Un tag exact court-circuite toute résolution.

     Quand la proposition vient du catalogue, la page connaît déjà le tag : le
     renvoyer en clair évite de repasser par une recherche par nom, qui pouvait
     retomber sur le raccourci — « Naruto » redevenait « Naruto Shippuden ». */
  const tagExact = (url.searchParams.get("tag") || "").trim();
  if (tagExact) {
    /* Un tag est un seul mot du catalogue, jamais une requête.

       Il part dans une recherche Sakugabooru — « <tag> order:score ». Une
       espace y ajouterait un second terme : on n'en accepte aucune. Le
       deux-points, en revanche, appartient à de vrais tags du site —
       « boruto:_naruto_next_generations », « naruto_shippuuden_movie_3:_… » —,
       on ne peut donc pas l'interdire. On refuse seulement ce qui, avant ce
       deux-points, est un opérateur de recherche, et la négation en tête.

       Les raccourcis écrits à la main font exception : certains sont justement
       une alternative entre plusieurs tags, espaces comprises. */
    const OPERATEURS = new Set(["order", "rating", "user", "md5", "id", "score", "source",
      "width", "height", "date", "parent", "pool", "limit", "vote", "holds", "unlocked"]);
    const connuDavance = SERIES.find(([, tag]) => tag === tagExact);
    const premierMot = tagExact.split(":")[0].toLowerCase();
    if (!connuDavance && (/\s/.test(tagExact) || tagExact.startsWith("-")
      || (tagExact.includes(":") && OPERATEURS.has(premierMot)))) {
      return json({ error: `Tag invalide : « ${tagExact} ».` }, 400);
    }
    const posts = await rushes(tagExact, pool);
    if (!posts.length) {
      return json({ error: `Aucun rush vidéo sous le tag « ${tagExact} ».` }, 404);
    }
    const nomLisible = connuDavance ? connuDavance[0] : joliTag(tagExact);
    return json({
      anime: nomLisible,
      tag: tagExact,
      mood,
      total: posts.length,
      rushes: [...rank(posts, mood, top).map(serialize),
        ...(generiquesVoulus ? await generiquesDe(nomLisible, posts.length) : [])],
    });
  }

  /* Sans animé : l'AMV mixte. On ne choisit pas les séries, on prend les
     meilleurs cuts du site et l'animé de chaque plan est lu dans ses tags — il
     devient un résultat au lieu d'être une consigne. */
  if (!query) {
    const tagAmbiance = mood ? TAG_PHARE[mood] : null;
    const trouves = await rushesPartout(tagAmbiance, pool);
    if (!trouves.length) {
      return json({ error: "Sakugabooru n'a rien rendu pour cette recherche." }, 502);
    }
    const series = await copyrightTags();
    /* En mixte, les génériques viennent de partout eux aussi : c'est la seule
       façon d'avoir une deuxième source sans nommer d'animé. La page est tirée
       dans les douze premières pour que deux AMV mixtes ne se ressemblent pas. */
    const largesVoulus = generiquesVoulus
      ? await themesLarges(16, 1 + Math.floor(Math.random() * 12)).catch(() => [])
      : [];
    return json({
      anime: "",
      tag: tagAmbiance || "order:score",
      mood,
      total: trouves.length,
      rushes: [
        ...rank(trouves, mood, top).map((entree) => ({
          ...serialize(entree),
          anime: serieDe(entree.post, series),
        })),
        ...largesVoulus.map(fromSource).map((rush) => ({ ...rush, provider: "animethemes" })),
      ],
    });
  }

  /* Les génériques, quand on les demande.

     AnimeThemes sert les ouvertures et les fins en WebM 1080p sans crédits :
     quatre-vingt-dix secondes de matériau propre par générique, là où une série
     peu indexée ne compte que trente scènes sur Sakugabooru. Ils ne passent pas
     par le classement par ambiance — ils ne portent aucune étiquette — mais ils
     entrent dans la pioche, et le montage y découpe des plans comme dans un rush.

     La route ne les sert que sur demande : l'explorateur les montrait à part, et
     tout le monde n'en veut pas dans son AMV. */
  const resolved = await resolve(query, pool);
  if (!resolved) {
    return json({ error: `Aucun rush vidéo trouvé pour « ${query} ».`, suggestions: suggest("", 6) }, 404);
  }

  return json({
    anime: resolved.display,
    tag: resolved.tag,
    mood,
    total: resolved.posts.length,
    rushes: [...rank(resolved.posts, mood, top).map(serialize),
      ...(generiquesVoulus ? await generiquesDe(query, resolved.posts.length) : [])],
  });
}

/* Les génériques d'une série, prêts à entrer dans une pioche. Un échec ne coûte
   rien : la pioche se fait sans eux, comme avant.

   Les huit meilleurs, et pas les cent quarante-sept que Naruto compte. Chacun
   pèse quatre-vingt-dix secondes de matériau : huit suffisent à nourrir un AMV
   de douze minutes. En rendre cent quarante-sept noyait les scènes de
   Sakugabooru et faisait lire cent quarante-sept fichiers d'en-tête pour rien —
   mesuré : deux cent quarante scènes dans la pioche, cent une durées lues dans
   le temps imparti. */
const GENERIQUES_MAX = 8;
const GENERIQUES_MAX_MAIGRE = 24;
// En dessous de cent vingt scènes montables, une série est maigre : c'est là que
// les génériques comptent vraiment, et l'on en prend trois fois plus.
const CATALOGUE_MAIGRE = 120;

async function generiquesDe(question, scenes = Infinity) {
  try {
    const liste = await themes(question);
    const combien = scenes < CATALOGUE_MAIGRE ? GENERIQUES_MAX_MAIGRE : GENERIQUES_MAX;
    return liste
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, combien)
      .map(fromSource)
      .map((rush) => ({ ...rush, provider: "animethemes" }));
  } catch {
    return [];
  }
}

/* Les routes dont la réponse ne dépend que de l'adresse : deux fois la même
   question, deux fois la même réponse. Elles peuvent donc être gardées au bord
   du réseau, entières.

   Les appels à Sakugabooru étaient déjà mis en cache, mais pas la réponse
   assemblée — or une recherche en enchaîne plusieurs, puis trie, note et
   sérialise. Mesuré sur le Worker en ligne : 2,4 s à froid, 1,1 s encore à
   chaud, et aucun en-tête « cf-cache-status », donc rien de gardé. Une réponse
   déjà calculée devrait coûter une consultation, pas une seconde. */
/* Déposer une réponse au bord, sans faire attendre celui qui l'a demandée.
   « waitUntil » laisse le dépôt se terminer après l'envoi. Une réponse en échec
   n'est jamais gardée : une panne d'une seconde ne doit pas durer six heures. */
async function garder(coffreBord, request, ctx, reponse) {
  if (!coffreBord || !reponse.ok) return reponse;
  const copie = reponse.clone();
  if (ctx?.waitUntil) ctx.waitUntil(coffreBord.put(request, copie));
  else await coffreBord.put(request, copie).catch(() => null);
  return reponse;
}

const ROUTES_GARDEES = new Set(["/api/tree", "/api/rushes", "/api/suggest", "/api/moods"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      /* Le cache du bord, consulté avant tout travail. La clé est l'adresse
         complète : deux recherches différentes ne se confondent pas. */
      const gardable = request.method === "GET" && ROUTES_GARDEES.has(url.pathname);
      let coffreBord = null;
      if (gardable) {
        try {
          coffreBord = caches.default;
          const dejaVu = await coffreBord.match(request);
          if (dejaVu) return dejaVu;
        } catch { coffreBord = null; }
      }
      try {
        if (url.pathname === "/api/tree") return await garder(coffreBord, request, ctx, await handleTree(url));
        if (url.pathname === "/api/rushes") return await garder(coffreBord, request, ctx, await handleRushes(url));
        if (url.pathname === "/api/suggest") {
          return await garder(coffreBord, request, ctx,
            json({ series: await propositions(url.searchParams.get("q") || "", 10) }));
        }
        if (url.pathname === "/api/media") return await relayerMedia(request, url);
        if (url.pathname === "/api/extrait") return await extrait(request, url, env, ctx);
        if (url.pathname === "/api/cles") return await cles(request, url, env, ctx);
        if (url.pathname === "/api/coffre") return await coffre(request, url, env);
        if (url.pathname === "/api/grenier") return await grenier(request, url, env);
        if (url.pathname === "/api/piste") return await piste(request, url, env);
        if (url.pathname === "/api/compte") return await compte(request, url, env);
        if (url.pathname === "/api/musique") return await genererMusique(request, url, env);
        if (url.pathname === "/api/paroles") return await ecrireParoles(request, url, env);
        if (url.pathname === "/api/scene") return await lireScene(request, url, env);
        if (url.pathname === "/api/ecoute") return await ecoute(request, url, env);
        if (url.pathname === "/api/rendu") return await rendu(request, url, env);
        if (url.pathname === "/api/veille") return await veille(request, url);
        if (url.pathname === "/api/accord") return await accorderParoles(request, url, env);
        if (url.pathname === "/api/version") {
          // Jamais en cache : la page compare cette réponse à son propre
          // horodatage. Une copie gardée au bord ferait croire à une mise à
          // jour en attente pendant un quart d'heure.
          return new Response(JSON.stringify({ version: VERSION }), {
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
        }
        if (url.pathname === "/api/moods") {
          return await garder(coffreBord, request, ctx, json({
            moods: Object.entries(MOODS).map(([key, m]) => ({ key, label: m.label })),
          }));
        }
        return json({ error: "Route inconnue." }, 404);
      } catch (error) {
        // Le nom de la route, pas celui d'une source au hasard : « Sakugabooru
        // est injoignable » s'affichait aussi bien pour une panne d'AnimeThemes
        // que du coffre, et envoyait chercher au mauvais endroit.
        return json({ error: `${url.pathname} a échoué : ${error.message}` }, 502);
      }
    }

    // La page ne doit jamais être servie depuis un cache local : un navigateur
    // qui garde l'ancienne donne l'impression que rien n'a été corrigé.
    const reponse = await env.ASSETS.fetch(request);
    const type = reponse.headers.get("content-type") || "";
    if (!type.includes("text/html")) return reponse;
    const entetes = new Headers(reponse.headers);
    entetes.set("cache-control", "no-store, must-revalidate");
    return new Response(reponse.body, { status: reponse.status, headers: entetes });
  },
};
