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
        const variantes = [];
        for (const video of entree.videos || []) {
          if (!video.link) continue;
          variantes.push(video);
        }

        // Les fichiers d'une même entrée sont le même générique à plusieurs
        // définitions : ce ne sont pas des plans différents, mais deux poids
        // pour la même image. Une « entrée » chez AnimeThemes est une version
        // donnée du générique (v1, v2, télé, Blu-ray) : ses fichiers partagent
        // le même montage et la même durée — vérifié sur deux paires, 0,00 s et
        // 0,07 s d'écart, images identiques à 1 près sur une échelle de 255.
        // C'est ce qui permet de monter sur l'un et de rendre sur l'autre :
        // les points de coupe tombent au même endroit.
        if (!variantes.length) continue;
        const parQualite = [...variantes].sort((a, b) => qualite(b) - qualite(a));
        const rendu = parQualite[0];
        // À poids égal on préfère la variante qui montre la même chose que le
        // rendu — créditée ou non : pendant le montage, autant voir l'image
        // qu'on rendra. Et on ne double le nombre de fichiers que si le gain
        // est réel : en dessous de 15 % d'économie, un seul fichier suffit.
        const candidats = variantes
          .filter((v) => v.link !== rendu.link && v.size && rendu.size && v.size < rendu.size * 0.85)
          .sort(
            (a, b) =>
              Number(b.nc === rendu.nc) - Number(a.nc === rendu.nc) ||
              a.size - b.size ||
              (a.resolution || 0) - (b.resolution || 0),
          );
        const montage = candidats[0] || null;

        const etiquettes = [
          rendu.nc ? "NC" : "crédité",
          `${rendu.resolution}p`,
          rendu.source || "",
        ].filter(Boolean);

        trouves.push({
          groupe: `${anime.slug || anime.name}-${type}${numero}`,
          source: "animethemes",
          kind: type === "OP" ? "opening" : "ending",
          id: `at-${rendu.id}`,
          name: `${type}${numero}${chanson ? ` · ${chanson}` : ""} (${etiquettes.join(" ")})`,
          score: qualite(rendu),
          artists: artistes,
          serie: anime.name,
          width: rendu.resolution >= 1080 ? 1920 : rendu.resolution >= 720 ? 1280 : 0,
          height: rendu.resolution || 0,
          mb: (montage || rendu).size ? Math.round(((montage || rendu).size / 1e6) * 10) / 10 : 0,
          mbRendu: rendu.size ? Math.round((rendu.size / 1e6) * 10) / 10 : 0,
          video: rendu.link,
          // Adresse de montage : la même image, en plus léger. Absente quand la
          // source n'offre qu'un seul fichier.
          montage: montage ? montage.link : null,
          montageHauteur: montage ? montage.resolution || 0 : 0,
          // Le fichier de montage porte parfois les crédits que le rendu n'a
          // pas : même image, même durée, du texte en plus. À dire, sinon la
          // surprise arrive au rendu.
          montageCredite: montage ? montage.nc !== rendu.nc : false,
          preview: null,
          page: anime.slug ? `https://animethemes.moe/anime/${anime.slug}` : "https://animethemes.moe",
          flags: [rendu.nc ? "sans crédits" : "avec crédits", rendu.source].filter(Boolean),
          episode: null,
        });
      }
    }
  }

  // Toutes les versions sont conservées : une v2, une version TV et une version
  // Blu-ray du même générique n'ont ni le même montage ni la même image.
  return trouves.sort((a, b) => b.score - a.score);
}
