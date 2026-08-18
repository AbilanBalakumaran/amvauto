// Classement des cuts pour un usage AMV.
// Portage de amvauto/scoring.py : les deux doivent rester alignés.

export const MOODS = {
  combat: {
    label: "Combat",
    tags: { fighting: 4, impact_frames: 3, martial_arts: 4, weapons: 3, beams: 3, explosions: 2, swords: 3, shooting: 3, creatures: 1 },
  },
  effets: {
    label: "Effets",
    tags: { effects: 1, fire: 3, lightning: 3, liquid: 2, smoke: 2, debris: 2, sparks: 2, wind: 1, ice: 3, explosions: 2 },
  },
  vitesse: {
    label: "Vitesse",
    tags: { running: 4, flying: 3, smears: 2, chase: 4, vehicle: 3, sports: 3, falling: 3, motorcycles: 3, sliding: 2 },
  },
  acting: {
    label: "Acting",
    tags: { character_acting: 4, hair: 1, fabric: 1, walk_cycle: 3, dialogue: 2, eating: 2, crying: 3, smoking: 2 },
  },
  hype: {
    label: "Hype / transfo",
    tags: { henshin: 4, morphing: 3, dancing: 4, performance: 3, background_animation: 2, rotation: 1 },
  },
};

// Ce qui aide ou gêne au montage, indépendamment de l'ambiance.
const BONUS_TAGS = { background_animation: 6, impact_frames: 5, effects: 4, smears: 3, debris: 2 };
const MALUS_TAGS = { cgi: -8, artist_unknown: -1, web: -2, "3d_background": -4 };

export function moodsOf(post) {
  const tags = new Set(post.tags);
  const hits = [];
  for (const [key, mood] of Object.entries(MOODS)) {
    let weight = 0;
    for (const [tag, w] of Object.entries(mood.tags)) if (tags.has(tag)) weight += w;
    if (weight) hits.push([key, weight]);
  }
  hits.sort((a, b) => b[1] - a[1]);
  return hits.length ? hits.map(([key]) => key) : ["acting"];
}

export function qualityFlags(post) {
  const tags = new Set(post.tags);
  const flags = [];
  if (tags.has("cgi")) flags.push("CGI");
  if (post.height < 480) flags.push("SD");
  else if (post.height >= 1080) flags.push("HD");
  if (tags.has("web")) flags.push("source web");
  if (tags.has("artist_unknown")) flags.push("animateur inconnu");
  return flags;
}

// pool_max = meilleur score sakuga du lot. Les votes vont de 10 à 4000 selon la
// popularité de la série : noter en relatif garde un classement lisible pour un
// animé confidentiel comme pour un blockbuster.
export function amvScore(post, mood, poolMax) {
  const tags = new Set(post.tags);
  const votes = Math.max(post.score, 1);

  const base = poolMax > 1
    ? 50 * (Math.log1p(votes) / Math.log1p(poolMax))
    : Math.min(50, 10 * votes ** 0.35);

  let bonus = 0;
  for (const [tag, points] of Object.entries(BONUS_TAGS)) if (tags.has(tag)) bonus += points;
  bonus = Math.min(10, bonus);

  let malus = 0;
  for (const [tag, points] of Object.entries(MALUS_TAGS)) if (tags.has(tag)) malus += points;

  // Un rush trop court (fichier minuscule) ne tient pas une phrase musicale.
  const mb = post.file_size / 1e6;
  const length = mb < 0.4 ? -6 : mb < 1.2 ? 0 : Math.min(6, 3 * Math.sqrt(mb));
  const resolution = post.height >= 720 ? 5 : post.height >= 480 ? 2.5 : 0;

  let fit = 0;
  if (mood && MOODS[mood]) {
    let raw = 0;
    for (const [tag, w] of Object.entries(MOODS[mood].tags)) if (tags.has(tag)) raw += w;
    fit = Math.min(15, 3 * raw);
  }

  const total = base + bonus + malus + length + resolution + fit;
  return Math.round(Math.max(0, Math.min(100, total)) * 10) / 10;
}

export function rank(posts, mood, top) {
  const poolMax = posts.reduce((max, p) => Math.max(max, p.score), 1);
  const scored = posts.map((post) => ({ post, score: amvScore(post, mood, poolMax) }));
  scored.sort((a, b) => b.score - a.score);
  return top ? scored.slice(0, top) : scored;
}
