// Donne un nom et une place à chaque rush.
//
// Sakugabooru ne nomme pas ses cuts : un post, c'est une bouillie de tags et un
// champ source du genre « #41 (S2 #17) (BD) ». On en dérive ici un nom de
// fichier qui dit ce qui se passe à l'écran, et le dossier d'arc où le ranger.

// Action principale du plan : [tag, nom affiché, dossier d'ambiance].
// Ordre = priorité, du plus spécifique au plus vague — le premier tag trouvé
// gagne. La même entrée décide du nom ET du rangement, sinon on obtient un
// fichier « Combat… » classé dans « Moments calmes ».
const ACTIONS = [
  ["martial_arts", "Corps à corps", "combat"],
  ["swords", "Duel à l'arme blanche", "combat"],
  ["weapons", "Combat armé", "combat"],
  ["shooting", "Fusillade", "combat"],
  ["beams", "Tir d'énergie", "combat"],
  ["missiles", "Tir de missiles", "combat"],
  ["fighting", "Combat", "combat"],
  ["creatures", "Créature", "combat"],
  ["chase", "Poursuite", "vitesse"],
  ["motorcycles", "Course à moto", "vitesse"],
  ["vehicle", "Poursuite en véhicule", "vitesse"],
  ["explosions", "Explosion", "effets"],
  ["henshin", "Transformation", "hype"],
  ["morphing", "Métamorphose", "hype"],
  ["dancing", "Danse", "hype"],
  ["performance", "Performance scénique", "hype"],
  ["sports", "Action sportive", "vitesse"],
  ["flying", "Vol", "vitesse"],
  ["falling", "Chute", "vitesse"],
  ["sliding", "Glissade", "vitesse"],
  ["running", "Course", "vitesse"],
  ["animals", "Animaux", "acting"],
  ["eating", "Scène de repas", "acting"],
  ["food", "Scène de repas", "acting"],
  ["crying", "Larmes", "acting"],
  ["smoking", "Cigarette", "acting"],
  ["walk_cycle", "Marche", "acting"],
  ["dialogue", "Dialogue", "acting"],
  ["character_acting", "Jeu d'acteur", "acting"],
  ["background_animation", "Décor animé", "effets"],
  ["rotation", "Rotation", "hype"],
];

// Ce qui se passe en plus dans le plan : deux détails suffisent à situer.
// Ordonnés du plus parlant au plus banal — « effects » et « smears » sont sur
// presque tous les cuts, les citer en premier donnerait cent noms identiques.
const DETAILS = [
  ["impact_frames", "impact frames"],
  ["fire", "flammes"],
  ["lightning", "éclairs"],
  ["ice", "glace"],
  ["explosions", "explosions"],
  ["liquid", "liquide"],
  ["debris", "débris"],
  ["sparks", "étincelles"],
  ["smoke", "fumée"],
  ["wind", "vent"],
  ["hair", "cheveux"],
  ["fabric", "tissu"],
  ["background_animation", "décor animé"],
  ["smears", "smears"],
  ["effects", "effets"],
];

// Les figures de style du sakuga, taguées comme telles sur le site. C'est
// l'information que cherche un monteur qui sait ce qu'il veut.
const TECHNIQUES = {
  kanada_light_flare: "Kanada light flare",
  itano_circus: "Itano circus",
  kutsuna_lightning: "Kutsuna lightning",
  wakame_shadows: "Wakame shadows",
  yutapon_cubes: "Yutapon cubes",
  umakoshi_eye: "Umakoshi eye",
  kanada_dragon: "Kanada dragon",
  obari_punch: "Obari punch",
  ebata_walk: "Ebata walk",
  hisashi_punch: "Hisashi punch",
};

function joinFr(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

// « #41 (S2 #17) (BD) » -> E41 ; « NCOP (BD) » -> OP ; « PV » -> PV
export function episodeLabel(source) {
  const raw = (source || "").trim();
  if (!raw) return "";
  if (/^https?:/i.test(raw)) return "";
  if (/\bNCOP\b|\bOP\b/i.test(raw)) return "OP";
  if (/\bNCED\b|\bED\b/i.test(raw)) return "ED";
  if (/\bPV\b|trailer/i.test(raw)) return "PV";
  if (/movie|film/i.test(raw)) return "FILM";
  const episode = raw.match(/#(\d+)/);
  return episode ? `E${episode[1]}` : "";
}

export function episodeNumber(source) {
  const episode = (source || "").match(/#(\d+)/);
  return episode ? Number(episode[1]) : null;
}

export function techniqueOf(tags) {
  const found = tags.find((tag) => TECHNIQUES[tag]);
  return found ? TECHNIQUES[found] : null;
}

// L'ambiance déduite de l'action, quand il y en a une. Sinon null : c'est au
// barème pondéré de trancher.
export function actionMood(post) {
  const tags = new Set(post.tags);
  const action = ACTIONS.find(([tag]) => tags.has(tag));
  return action ? action[2] : null;
}

// Le nom du plan : ce qu'on y voit, pas la référence du post.
export function describe(post) {
  const tags = new Set(post.tags);
  const action = ACTIONS.find(([tag]) => tags.has(tag));
  const label = action ? action[1] : "Plan animé";

  const details = DETAILS
    .filter(([tag]) => tags.has(tag) && (!action || tag !== action[0]))
    .slice(0, 2)
    .map(([, text]) => text);

  const technique = techniqueOf(post.tags);
  const episode = episodeLabel(post.source);

  const core = details.length ? `${label}, ${joinFr(details)}` : label;
  const suffix = technique ? ` (${technique})` : "";
  return `${episode ? `${episode} · ` : ""}${core}${suffix}`;
}

// --- arcs ------------------------------------------------------------------

// Les tags de série d'un post portent l'arc : « jujutsu_kaisen_season_2 »,
// « chainsaw_man_reze-hen », « bleach:_thousand_year_blood_war_arc ». On les
// reconnaît à leur préfixe commun avec le tag interrogé — pas besoin de la
// table des types de tags.
export function seriesRoots(query) {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/^~/, ""))
    .filter(Boolean)
    .map((token) => token.replace(/_series$/, ""));
}

function prettify(text) {
  return text
    .replace(/[_:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function arcLabel(tag, roots, seriesName) {
  const root = roots.find((candidate) => tag.startsWith(candidate)) || "";
  let rest = tag.slice(root.length).replace(/^[_:\-\s]+/, "");
  if (!rest) return prettify(tag);

  const season = rest.match(/^season[_\s]?(\d+)$/i) || rest.match(/^s(\d+)$/i);
  if (season) return `Saison ${season[1]}`;
  // Un simple numéro accolé au titre, c'est un film ou un opus (« Jujutsu
  // Kaisen 0 »), certainement pas « Arc 0 ».
  if (/^\d+$/.test(rest)) return `${seriesName} ${rest}`;
  if (/^movie|^film/i.test(rest)) return `Film — ${prettify(rest.replace(/^(movie|film)[_\s:]*/i, ""))}`;
  if (/^(ii|2)$/i.test(rest)) return "Saison 2";
  if (/^(iii|3)$/i.test(rest)) return "Saison 3";
  if (/-hen$/.test(rest)) return `Arc ${prettify(rest.replace(/-hen$/, ""))}`;
  if (/^the_final_season/.test(rest)) return "Final Season";
  rest = prettify(rest);
  return /arc|saison|season|film|movie/i.test(rest) ? rest : `Arc ${rest}`;
}

// Le dossier d'arc d'un post : le tag de série le plus spécifique qu'il porte.
export function arcOf(post, query, seriesName) {
  const roots = seriesRoots(query);
  const tokens = new Set(query.split(/\s+/).map((token) => token.replace(/^~/, "")));

  const candidates = post.tags.filter(
    (tag) => !tag.endsWith("_series") && (tokens.has(tag) || roots.some((root) => tag.startsWith(root))),
  );

  if (candidates.length) {
    // Le plus long = le plus précis (« jujutsu_kaisen_season_2 » bat « jujutsu_kaisen »).
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    // Le tag racine lui-même n'est pas un arc : c'est le tronc de la série.
    if (roots.includes(best)) return { key: best, label: "Série principale" };
    const label = arcLabel(best, roots, seriesName);
    return { key: best, label: label === seriesName ? "Série principale" : label };
  }

  // Pas de tag d'arc : on retombe sur des tranches d'épisodes.
  const episode = episodeNumber(post.source);
  if (episode) {
    const start = Math.floor((episode - 1) / 12) * 12 + 1;
    return { key: `ep-${start}`, label: `Épisodes ${start}–${start + 11}` };
  }
  return { key: "divers", label: "Hors épisodes (OP, PV, films)" };
}
