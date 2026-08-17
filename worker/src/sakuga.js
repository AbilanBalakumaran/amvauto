// Accès à l'API Sakugabooru depuis le Worker.
// Le site ne renvoie aucun en-tête CORS : le navigateur ne peut pas l'appeler
// directement, c'est tout l'intérêt de passer par ici. Les médias (vignettes,
// mp4), eux, sont chargés en direct par la page — <img> et <video> ne sont pas
// soumis au CORS.

const BASE = "https://www.sakugabooru.com";
const UA = "amvauto/0.1 (+https://github.com/AbilanBalakumaran/amvauto)";

const TAG_ARTIST = 1;
const TAG_COPYRIGHT = 3;
const VIDEO_EXTS = new Set(["mp4", "webm"]);
const PAPER_TAGS = new Set(["genga", "production_materials", "layout", "douga"]);

// Table des animateurs : lourde à récupérer, stable dans le temps. On la garde
// dans l'isolate et on laisse le cache Cloudflare absorber le reste.
let artistCache = null;

async function api(path, params, ttl) {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Sakugabooru a répondu ${response.status}`);
  return response.json();
}

export async function artistTags() {
  if (artistCache) return artistCache;
  const tags = await api("/tag.json", { type: TAG_ARTIST, order: "count", limit: 2000 }, 86400);
  artistCache = new Set(tags.map((tag) => tag.name).filter((name) => name !== "artist_unknown"));
  return artistCache;
}

export async function searchSeries(query) {
  const pattern = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!pattern) return [];
  let tags = await api("/tag.json", { name: pattern, type: TAG_COPYRIGHT, order: "count", limit: 30 }, 3600);
  if (!tags.length && pattern.includes("_")) {
    tags = await api("/tag.json", { name: pattern.split("_")[0], type: TAG_COPYRIGHT, order: "count", limit: 30 }, 3600);
  }
  return tags.filter((tag) => tag.count > 0).sort((a, b) => b.count - a.count);
}

const PAGE_SIZE = 100;

export async function posts(tags, limit) {
  // L'API plafonne à 100 posts par page : au-delà on pagine, en parallèle.
  const pages = Math.max(1, Math.ceil(limit / PAGE_SIZE));
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      api("/post.json", { tags, limit: Math.min(PAGE_SIZE, limit), page: index + 1 }, 1800),
    ),
  );
  const raw = batches.flat();
  const artists = await artistTags();
  return raw.map((item) => {
    const tagList = (item.tags || "").split(" ").filter(Boolean);
    return {
      id: item.id,
      tags: tagList,
      score: item.score || 0,
      file_url: item.file_url || "",
      file_ext: item.file_ext || "",
      file_size: item.file_size || 0,
      preview_url: item.preview_url || "",
      sample_url: item.sample_url || "",
      width: item.width || 0,
      height: item.height || 0,
      rating: item.rating || "s",
      source: item.source || "",
      artists: tagList.filter((tag) => artists.has(tag)),
    };
  });
}

// Les cuts d'une série, filtrés sur ce qui est réellement montable.
export async function rushes(seriesTag, limit = 300) {
  const found = await posts(`${seriesTag} order:score`, limit);
  return found.filter(
    (post) =>
      VIDEO_EXTS.has(post.file_ext) &&
      !post.tags.some((tag) => PAPER_TAGS.has(tag)) &&
      post.rating !== "e",
  );
}
