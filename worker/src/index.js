// Worker amvauto : sert l'interface (assets statiques) et expose l'API de
// proposition de rushs. Sakugabooru étant sans CORS, tous les appels JSON
// passent par ici.

import { rushes, searchSeries } from "./sakuga.js";
import { MOODS, moodsOf, qualityFlags, rank } from "./scoring.js";
import { findCurated, suggest } from "./series.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=900",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function serialize({ post, score }) {
  return {
    id: post.id,
    score,
    votes: post.score,
    moods: moodsOf(post),
    flags: qualityFlags(post),
    artists: post.artists.map((a) => a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())),
    width: post.width,
    height: post.height,
    mb: Math.round((post.file_size / 1e6) * 100) / 100,
    source: post.source.slice(0, 90),
    video: post.file_url,
    preview: post.preview_url,
    page: `https://www.sakugabooru.com/post/show/${post.id}`,
    tags: post.tags,
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

async function handleRushes(url) {
  const query = (url.searchParams.get("anime") || "").trim();
  if (!query) return json({ error: "Indique un animé." }, 400);

  const mood = url.searchParams.get("mood") || null;
  if (mood && !MOODS[mood]) return json({ error: `Ambiance inconnue : ${mood}` }, 400);

  const top = Math.min(60, Math.max(1, Number(url.searchParams.get("top")) || 24));
  const pool = Math.min(100, Math.max(top, Number(url.searchParams.get("pool")) || 60));

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
        if (url.pathname === "/api/rushes") return await handleRushes(url);
        if (url.pathname === "/api/suggest") {
          return json({ series: suggest(url.searchParams.get("q") || "", 10) });
        }
        if (url.pathname === "/api/moods") {
          return json({ moods: Object.entries(MOODS).map(([key, m]) => ({ key, label: m.label })) });
        }
        return json({ error: "Route inconnue." }, 404);
      } catch (error) {
        return json({ error: `Sakugabooru est injoignable : ${error.message}` }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
