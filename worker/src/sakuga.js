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

const VAGUE = 5;

export async function posts(tags, limit) {
  // L'API plafonne à 100 posts par page. Au-delà on pagine, par vagues de cinq :
  // en lancer vingt d'un coup sur un site communautaire serait grossier, et une
  // page vide signifie qu'on a atteint le fond du tag.
  const pages = Math.max(1, Math.ceil(limit / PAGE_SIZE));
  const raw = [];

  /* La première page part seule. Un tag sans vidéo — le cas de figure quand on
     essaie plusieurs candidats avant de trouver le bon — coûtait cinq requêtes
     pour apprendre qu'il n'y a rien : la vague était lancée d'un bloc. Or le
     plan gratuit plafonne à cinquante sous-requêtes par appel, et six tags
     essayés en dépassaient. Une requête suffit à le savoir. */
  const premiere = await api("/post.json", { tags, limit: PAGE_SIZE, page: 1 }, 1800);
  raw.push(...premiere);
  if (premiere.length === PAGE_SIZE) {
    for (let debut = 1; debut < pages; debut += VAGUE) {
      const vague = Array.from({ length: Math.min(VAGUE, pages - debut) }, (_, index) =>
        api("/post.json", { tags, limit: PAGE_SIZE, page: debut + index + 1 }, 1800),
      );
      const lots = await Promise.all(vague);
      raw.push(...lots.flat());
      if (lots.some((lot) => lot.length < PAGE_SIZE)) break;
    }
  }
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

// Ce qui est réellement montable : une vidéo, pas du papier, pas de contenu
// explicite.
const montables = (found) =>
  found.filter(
    (post) =>
      VIDEO_EXTS.has(post.file_ext) &&
      !post.tags.some((tag) => PAPER_TAGS.has(tag)) &&
      post.rating !== "e",
  );

// Les cuts d'une série.
export async function rushes(seriesTag, limit = 1000) {
  return montables(await posts(`${seriesTag} order:score`, limit));
}

/* Les meilleurs cuts du site, sans série imposée.

   C'est ce que demande un AMV mixte : ne pas choisir les animés soi-même, et
   laisser remonter ce que la communauté a le mieux noté. Un tag d'ambiance
   restreint la pioche sans la fermer — « fighting order:score » rend les
   meilleurs plans de combat, d'où qu'ils viennent. */
export async function rushesPartout(tagAmbiance, limit = 1000) {
  const requete = tagAmbiance ? `${tagAmbiance} order:score` : "order:score";
  return montables(await posts(requete, limit));
}

/* La série d'un post, lue dans ses tags.

   En mixte, l'animé n'est plus une donnée d'entrée : c'est une donnée de
   sortie. Sans elle, le montage afficherait deux cents plans sans savoir d'où
   ils viennent, et le chapitrage par animé n'aurait plus de sens. */
let copyrightCache = null;
export async function copyrightTags() {
  if (copyrightCache) return copyrightCache;
  const tags = await api("/tag.json", { type: TAG_COPYRIGHT, order: "count", limit: 2000 }, 86400);
  copyrightCache = new Set(tags.map((tag) => tag.name));
  return copyrightCache;
}

export function serieDe(post, series) {
  const tag = post.tags.find((nom) => series.has(nom));
  return tag ? tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}
