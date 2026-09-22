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

/* ---- Ce qui n'est pas du matériau de montage -----------------------------

   Un AMV de concours se juge aussi sur la propreté de ses sources : un carton-
   titre, une comparaison côte à côte, une capture d'écran de site sont des
   pollutions visuelles qui disqualifient un montage avant même qu'on regarde le
   rythme.

   AUCUN tag de sous-titre, de watermark ou d'incrustation TV n'existe sur
   Sakugabooru — vérifié le 22/09/2026 : « subtitled », « watermark », « credits »,
   « broadcast_screen », « lower_third », « hardsub », « tv_broadcast » rendent
   tous une liste vide. Le site n'indexe pas ça.

   Ce qu'il indexe, en revanche, et qui porte du texte ou n'est pas de l'animation
   jouable :

     comparison, genga_comparison   deux images côte à côte, avec des libellés
     title_animation                un carton-titre : du texte à l'écran
     screencap                      une capture d'écran, pas un cut
     live_action, stop_motion       ce n'est pas de l'animation dessinée
     tagme                          personne n'a su dire ce que c'est

   Et le matériel de production, déjà écarté en partie : la liste était de quatre
   tags, il en existe seize. Un « settei » ou un « color_script » n'est pas plus
   montable qu'un « genga ». */
export const PAPER_TAGS = new Set([
  // Le papier de production.
  "genga", "production_materials", "layout", "douga", "settei", "storyboard",
  "character_design", "background_design", "concept_art", "color_script",
  "timesheet", "rough", "shiage", "illustration", "sprite", "cel", "flipbook",
  // Ce qui porte du texte, ou n'est pas de l'animation.
  "comparison", "genga_comparison", "title_animation", "screencap",
  "live_action", "stop_motion", "tagme",
]);

/* ---- Le cadre : une ligne de temps 16:9 sans barres noires ----------------

   Le rendu est en 16:9. Un cut en 4:3 y entre avec deux bandes noires sur les
   côtés — ce n'est pas une déformation, le rendu ne déforme jamais, mais ça se
   voit et ça casse la ligne.

   RELEVÉ SUR LE VRAI CATALOGUE, et c'est ce qui décide de la règle : sur trois
   cents cuts vidéo de Naruto Shippuden, Chainsaw Man et Jujutsu Kaisen, les
   ratios sont 1,78 et 1,77 à 95 % — du 16:9 — avec quelques 1,85, un 1,33 et
   trois 2,40. On garde donc la fenêtre du 16:9 élargie au cinéma, et l'on écarte
   le 4:3 et le cinémascope.

   La définition, elle, NE PEUT PAS être filtrée au-dessus de 720p : sur ces trois
   cents cuts, CENT POUR CENT sont entre 480 et 719 lignes, et aucun n'atteint
   720. Sakugabooru sert des extraits volontairement légers. Exiger 720p viderait
   le catalogue entier. Le plancher est donc posé là où il protège sans rien
   casser : sous 400 lignes, ce n'est plus une source montable. */
const RATIO_MINI = 1.6;
const RATIO_MAXI = 1.9;
const LIGNES_MINI = 400;

export function cadrePropre(post) {
  const h = post.height || 0;
  const w = post.width || 0;
  if (h < LIGNES_MINI) return false;
  if (!h || !w) return true;   // sans définition connue, on ne présume rien
  const ratio = w / h;
  return ratio >= RATIO_MINI && ratio <= RATIO_MAXI;
}

// Table des animateurs : lourde à récupérer, stable dans le temps. On la garde
// dans l'isolate et on laisse le cache Cloudflare absorber le reste.
let artistCache = null;

/* ---- Ce que Sakugabooru NE dit pas : les personnages ----------------------

   Un AMV a besoin d'un fil : sur mille huit cents rushs, enchaîner des plans qui
   n'ont personne en commun donne une bande-démo d'animateurs, pas un récit. Le
   fil évident serait le personnage — suivre Naruto, ou monter un duel Naruto
   contre Sasuke.

   Sakugabooru ne le permet pas. Le site n'étiquette AUCUN personnage :
   « naruto_uzumaki », « sasuke_uchiha », « gojo_satoru » ne sont pas des tags,
   et le type 4 de son catalogue — celui que Danbooru réserve aux personnages —
   ne compte que dix tags, qui sont des signatures d'animation : kanada_light_flare,
   itano_circus, obari_punch, ebata_walk. Relevé sur le site le 21/09/2026 :
   tag.json?name=naruto_uzumaki rend une liste vide.

   La seule identité que porte un cut, c'est son ANIMATEUR — et celle-là est
   riche : « hiroyuki_yamashita », « shingo_yamashita », plusieurs par plan,
   quinze cents pour Hironori Tanaka. C'est elle qui sert de fil. Ce n'est pas la
   continuité de personnage demandée, c'est la continuité de main : le geste, le
   trait, la façon de déformer. En AMV de compétition, c'est un fil reconnu — le
   sakuga showcase se monte comme ça. */

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
      /* Les tags bruts, pas les noms rendus lisibles : c'est sur eux que le
         montage compare, et « Hiroyuki Yamashita » ne se recompare plus à
         « hiroyuki_yamashita ». « artist_unknown » est déjà écarté par la table :
         ce n'est pas une main, c'est une absence de crédit. */
      artists: tagList.filter((tag) => artists.has(tag)),
    };
  });
}

// Ce qui est réellement montable : une vidéo, pas du papier, pas de contenu
// explicite.
export const montables = (found) =>
  found.filter(
    (post) =>
      VIDEO_EXTS.has(post.file_ext) &&
      !post.tags.some((tag) => PAPER_TAGS.has(tag)) &&
      cadrePropre(post) &&
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
