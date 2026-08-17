// Donne un nom et une place à chaque rush.
//
// Sakugabooru ne nomme pas ses cuts : un post, c'est une bouillie de tags et un
// champ source du genre « #41 (S2 #17) (BD) ». On en dérive ici un nom de
// fichier qui dit ce qui se passe à l'écran, et le dossier d'arc où le ranger.

// Action principale du plan : [tag, nom affiché, dossier].
// Ordre = priorité, du plus spécifique au plus vague — le premier tag trouvé
// gagne. La même entrée décide du nom ET du rangement, sinon on obtient un
// fichier « Combat… » classé dans « Moments calmes ».
// Deux dossiers seulement : « combat » (ça bouge, ça cogne, ça explose) et
// « calme » (le personnage joue, marche, parle).
const ACTIONS = [
  ["martial_arts", "Corps à corps", "combat"],
  ["swords", "Duel à l'arme blanche", "combat"],
  ["weapons", "Combat armé", "combat"],
  ["shooting", "Fusillade", "combat"],
  ["beams", "Tir d'énergie", "combat"],
  ["missiles", "Tir de missiles", "combat"],
  ["fighting", "Combat", "combat"],
  ["creatures", "Créature", "combat"],
  ["chase", "Poursuite", "combat"],
  ["motorcycles", "Course à moto", "combat"],
  ["vehicle", "Poursuite en véhicule", "combat"],
  ["explosions", "Explosion", "combat"],
  ["henshin", "Transformation", "combat"],
  ["morphing", "Métamorphose", "combat"],
  ["dancing", "Danse", "calme"],
  ["performance", "Performance scénique", "calme"],
  ["sports", "Action sportive", "combat"],
  ["flying", "Vol", "combat"],
  ["falling", "Chute", "combat"],
  ["sliding", "Glissade", "combat"],
  ["running", "Course", "combat"],
  ["animals", "Animaux", "calme"],
  ["eating", "Scène de repas", "calme"],
  ["food", "Scène de repas", "calme"],
  ["crying", "Larmes", "calme"],
  ["smoking", "Cigarette", "calme"],
  ["walk_cycle", "Marche", "calme"],
  ["dialogue", "Dialogue", "calme"],
  ["character_acting", "Jeu d'acteur", "calme"],
  ["background_animation", "Décor animé", "calme"],
  ["rotation", "Rotation", "calme"],
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

export const FOLDERS = {
  combat: "Combats",
  calme: "Moments calmes",
};

// Le dossier du plan. Sans action identifiée, on tranche sur les effets :
// des flammes et des débris, c'est de l'action, pas un moment calme.
export function folderOf(post) {
  const tags = new Set(post.tags);
  const action = ACTIONS.find(([tag]) => tags.has(tag));
  if (action) return action[2];
  return ["fire", "explosions", "debris", "lightning", "sparks", "smoke", "impact_frames"]
    .some((tag) => tags.has(tag))
    ? "combat"
    : "calme";
}

// Le nom du plan : ce qu'on y voit, pas la référence du post.
export function describe(post) {
  const tags = new Set(post.tags);
  const action = ACTIONS.find(([tag]) => tags.has(tag));
  // Sans action identifiée, c'est presque toujours un plan d'effets purs :
  // le dire vaut mieux qu'un « plan animé » qui ne renseigne sur rien.
  const label = action
    ? action[1]
    : ["effects", "fire", "liquid", "smoke", "debris", "sparks", "lightning", "ice"].some((tag) => tags.has(tag))
      ? "Plan d'effets"
      : "Plan animé";

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

  // Les suffixes entre parenthèses (« (ova) », « (2024) ») ne sont pas des arcs.
  const nu = rest.replace(/[()]/g, "");
  if (/^ova$/i.test(nu)) return "OVA";
  if (/^ona$/i.test(nu)) return "ONA";
  if (/^tv$/i.test(nu)) return "Série TV";
  if (/^\d{4}$/.test(nu)) return `${seriesName} (${nu})`;

  const season = rest.match(/^season[_\s]?(\d+)$/i) || rest.match(/^s(\d+)$/i);
  if (season) return `Saison ${season[1]}`;
  // Un simple numéro accolé au titre, c'est un film ou un opus (« Jujutsu
  // Kaisen 0 »), certainement pas « Arc 0 ».
  if (/^\d+$/.test(rest)) return `${seriesName} ${rest}`;
  if (/^movie|^film/i.test(rest)) {
    const titre = prettify(rest.replace(/^(movie|film)[_\s:]*/i, ""));
    return /^\d*$/.test(titre.trim()) ? `Film ${titre}`.trim() : `Film — ${titre}`;
  }
  if (/^(ii|2)$/i.test(rest)) return "Saison 2";
  if (/^(iii|3)$/i.test(rest)) return "Saison 3";
  if (/-hen$/.test(rest)) return `Arc ${prettify(rest.replace(/-hen$/, ""))}`;
  if (/^the_final_season/.test(rest)) return "Final Season";
  rest = prettify(rest);
  return /arc|saison|season|film|movie/i.test(rest) ? rest : `Arc ${rest}`;
}

// La saison telle que les contributeurs la notent dans la source :
// « #39 (BD) (S3 #02) » -> 3. Plus fiable que les tags, qui regroupent
// souvent plusieurs saisons sous un même nom.
export function seasonNumber(source) {
  const season = (source || "").match(/\bS(\d+)\b/i);
  return season ? Number(season[1]) : null;
}

// Le dossier d'un post : son arc quand il en a un, sa saison sinon.
export function arcOf(post, query, seriesName) {
  const roots = seriesRoots(query);
  const tokens = new Set(query.split(/\s+/).map((token) => token.replace(/^~/, "")));

  // Un tag de série plus précis que la racine, c'est un arc nommé.
  const candidates = post.tags.filter(
    (tag) =>
      !tag.endsWith("_series") &&
      !roots.includes(tag) &&
      (tokens.has(tag) || roots.some((root) => tag.startsWith(root))),
  );

  if (candidates.length) {
    // Le plus long = le plus précis (« jujutsu_kaisen_season_2 » bat « jujutsu_kaisen »).
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    return { key: best, label: arcLabel(best, roots, seriesName) };
  }

  const season = seasonNumber(post.source);
  if (season) return { key: `saison-${season}`, label: `Saison ${season}` };

  // Ni arc ni saison notée : un plan numéroté appartient à la première saison,
  // un générique ou une bande-annonce n'appartient à aucune.
  if (episodeNumber(post.source)) return { key: "saison-1", label: "Saison 1" };
  return { key: "divers", label: "Génériques & bandes-annonces" };
}
