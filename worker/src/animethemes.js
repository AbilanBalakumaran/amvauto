// AnimeThemes.moe : les génériques d'ouverture et de fin, en fichiers WebM
// directs. Les versions « NC » (sans crédits) en 1080p Blu-ray sont le meilleur
// matériau brut qu'on trouve en libre accès — pas de texte à masquer au montage.

const BASE = "https://api.animethemes.moe";

async function api(path, ttl = 3600) {
  const response = await fetch(BASE + path, {
    // Sans User-Agent explicite, l'API répond 403.
    headers: {
      Accept: "application/json",
      "User-Agent": "amvauto/0.1 (+https://github.com/AbilanBalakumaran/amvauto)",
    },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`AnimeThemes a répondu ${response.status}`);
  return response.json();
}

// Pas de votes ici : la qualité se déduit de ce que le fichier est.
function qualite(video) {
  let note = 40;
  if (video.resolution >= 1080) note += 20;
  else if (video.resolution >= 720) note += 10;
  if (video.nc) note += 15;
  if (video.source === "BD") note += 12;
  else if (video.source === "WEB") note += 5;
  else note += 3;
  return note;
}

export async function themes(query) {
  // Les crochets et la virgule des paramètres doivent être encodés : l'API les
  // refuse tels quels.
  const params = new URLSearchParams({
    q: query,
    "fields[search]": "anime",
    "include[anime]": "animethemes.animethemeentries.videos,animethemes.song.artists",
  });
  const data = await api(`/search?${params}`);
  const animes = data?.search?.anime || [];

  const trouves = [];
  for (const anime of animes) {
    for (const theme of anime.animethemes || []) {
      const type = theme.type === "OP" ? "OP" : "ED";
      const numero = theme.sequence ? String(theme.sequence) : "1";
      const chanson = theme.song?.title || "";
      const artistes = (theme.song?.artists || []).map((a) => a.name).filter(Boolean);

      for (const entree of theme.animethemeentries || []) {
        if (entree.nsfw) continue;
        for (const video of entree.videos || []) {
          if (!video.link) continue;
          const etiquettes = [
            video.nc ? "NC" : "crédité",
            `${video.resolution}p`,
            video.source || "",
          ].filter(Boolean);

          trouves.push({
            groupe: `${anime.slug || anime.name}-${type}${numero}`,
            source: "animethemes",
            kind: type === "OP" ? "opening" : "ending",
            id: `at-${video.id}`,
            name: `${type}${numero}${chanson ? ` · ${chanson}` : ""} (${etiquettes.join(" ")})`,
            score: qualite(video),
            artists: artistes,
            serie: anime.name,
            width: video.resolution >= 1080 ? 1920 : video.resolution >= 720 ? 1280 : 0,
            height: video.resolution || 0,
            mb: video.size ? Math.round((video.size / 1e6) * 10) / 10 : 0,
            video: video.link,
            preview: null,
            page: anime.slug ? `https://animethemes.moe/anime/${anime.slug}` : "https://animethemes.moe",
            flags: [video.nc ? "sans crédits" : "avec crédits", video.source].filter(Boolean),
            episode: null,
          });
        }
      }
    }
  }

  // Toutes les versions sont conservées : une v2, une version TV et une version
  // Blu-ray du même générique n'ont ni le même montage ni la même image.
  return trouves.sort((a, b) => b.score - a.score);
}
