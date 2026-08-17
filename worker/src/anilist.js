// AniList : les bandes-annonces officielles (PV) de la série et de ses films.
//
// Ce sont les seules entrées de l'outil qui ne sont pas des fichiers : YouTube
// n'expose pas de lien direct. Elles se lisent dans la page et se récupèrent
// avec un téléchargeur ; l'interface les signale comme telles.

const ENDPOINT = "https://graphql.anilist.co";

const QUERY = `query ($s: String) {
  Page(perPage: 8) {
    media(search: $s, type: ANIME, sort: POPULARITY_DESC) {
      id
      seasonYear
      format
      title { romaji english }
      trailer { id site thumbnail }
      coverImage { large }
    }
  }
}`;

const FORMATS = { TV: "série", MOVIE: "film", OVA: "OVA", ONA: "ONA", SPECIAL: "spécial" };

export async function trailers(query) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { s: query } }),
    cf: { cacheTtl: 21600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`AniList a répondu ${response.status}`);
  const data = await response.json();

  const medias = data?.data?.Page?.media || [];
  return medias
    .filter((media) => media.trailer?.id && media.trailer.site === "youtube")
    .map((media) => {
      const titre = media.title?.romaji || media.title?.english || "Sans titre";
      const format = FORMATS[media.format] || "";
      return {
        source: "anilist",
        kind: "trailer",
        id: `al-${media.id}`,
        name: `PV · ${titre}${media.seasonYear ? ` (${media.seasonYear})` : ""}`,
        // Aucun signal de qualité exploitable : mieux vaut pas de note qu'une
        // note inventée. L'interface affiche un tiret.
        score: null,
        artists: [],
        serie: titre,
        width: 0,
        height: 0,
        mb: 0,
        video: `https://www.youtube.com/watch?v=${media.trailer.id}`,
        youtube: media.trailer.id,
        preview: media.trailer.thumbnail || media.coverImage?.large || null,
        page: `https://anilist.co/anime/${media.id}`,
        flags: [format, "lien YouTube"].filter(Boolean),
        episode: null,
      };
    });
}
