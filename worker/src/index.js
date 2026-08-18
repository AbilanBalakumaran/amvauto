// Worker amvauto : sert l'interface (assets statiques) et expose l'API de
// proposition de rushs. Sakugabooru étant sans CORS, tous les appels JSON
// passent par ici.

import { themes } from "./animethemes.js";
import { coffre } from "./coffre.js";
import { relayerMedia } from "./media.js";
import { arcOf, describe, episodeNumber, FOLDERS, folderOf, techniqueOf } from "./naming.js";
import { rushes, searchSeries } from "./sakuga.js";
import { MOODS, moodsOf, qualityFlags, rank } from "./scoring.js";
import { findCurated, suggest } from "./series.js";
import { VERSION } from "./version.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=900",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
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

async function handleRushes(url) {
  const query = (url.searchParams.get("anime") || "").trim();
  if (!query) return json({ error: "Indique un animé." }, 400);

  const mood = url.searchParams.get("mood") || null;
  if (mood && !MOODS[mood]) return json({ error: `Ambiance inconnue : ${mood}` }, 400);

  const top = Math.min(200, Math.max(1, Number(url.searchParams.get("top")) || 24));
  const pool = Math.min(2000, Math.max(top, Number(url.searchParams.get("pool")) || 1000));

  const resolved = await resolve(query, pool);
  if (!resolved) {
    return json({ error: `Aucun rush vidéo trouvé pour « ${query} ».`, suggestions: suggest("", 6) }, 404);
  }

  return json({
    anime: resolved.display,
    tag: resolved.tag,
    mood,
    total: resolved.posts.length,
    rushes: rank(resolved.posts, mood, top).map(serialize),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/tree") return await handleTree(url);
        if (url.pathname === "/api/rushes") return await handleRushes(url);
        if (url.pathname === "/api/suggest") {
          return json({ series: suggest(url.searchParams.get("q") || "", 10) });
        }
        if (url.pathname === "/api/media") return await relayerMedia(request, url);
        if (url.pathname === "/api/coffre") return await coffre(request, url, env);
        if (url.pathname === "/api/version") {
          // Jamais en cache : la page compare cette réponse à son propre
          // horodatage. Une copie gardée au bord ferait croire à une mise à
          // jour en attente pendant un quart d'heure.
          return new Response(JSON.stringify({ version: VERSION }), {
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
        }
        if (url.pathname === "/api/moods") {
          return json({
            moods: Object.entries(MOODS).map(([key, m]) => ({ key, label: m.label })),
          });
        }
        return json({ error: "Route inconnue." }, 404);
      } catch (error) {
        return json({ error: `Sakugabooru est injoignable : ${error.message}` }, 502);
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
