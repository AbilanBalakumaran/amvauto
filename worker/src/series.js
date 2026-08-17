// Catalogue de raccourcis : nom affiché, requête Sakugabooru, alias de recherche.
// Il ne limite pas l'outil (toute série indexée reste atteignable par recherche) :
// il sert de garde-fou. Sakugabooru masque ou déforme certains tags de série
// (homoglyphes, titres de code) qu'aucune recherche par nom ne retrouve, et il
// alimente les suggestions de l'interface.
// Généré depuis amvauto/series.py.

export const SERIES = [
  ["Chainsaw Man", "chainsaw_man_series", ["csm", "denji", "chainsawman"]],
  ["Jujutsu Kaisen", "jujutsu_kaisen_series", ["jjk", "gojo", "sukuna"]],
  ["Demon Slayer", "kimetsu_no_yaiba_series", ["kimetsu", "tanjiro", "demon slayer"]],
  ["Attack on Titan", "shingeki_no_kyojin_series", ["snk", "aot", "shingeki", "eren", "titan"]],
  ["Frieren", "sousou_no_frieren_series", ["frieren", "sousou"]],
  ["One Piece", "one_piece", ["luffy", "gear 5"]],
  ["Naruto Shippuden", "naruto_shippuuden", ["naruto", "shippuden", "sasuke"]],
  ["Bleach", "bleach_series", ["ichigo", "tybw"]],
  ["Dragon Ball", "dragon_ball_series", ["db", "goku", "dbz"]],
  ["My Hero Academia", "my_hero_academia_series", ["mha", "bnha", "deku"]],
  ["Mob Psycho 100", "~mօb_psycho_100_iii ~robert_psychosis_onehundred_s2 ~mob_psycho_100_ii", ["mob", "mp100", "shigeo"]],
  ["One Punch Man", "one-punch_man_series", ["opm", "saitama"]],
  ["Hunter x Hunter", "hunter_x_hunter_2011", ["hxh", "gon", "killua"]],
  ["Tokyo Ghoul", "tokyo_ghoul_series", ["kaneki"]],
  ["Fate", "fate_series", ["fate stay night", "ubw", "saber"]],
  ["Neon Genesis Evangelion", "neon_genesis_evangelion_series", ["eva", "evangelion", "shinji"]],
  ["Cowboy Bebop", "cowboy_bebop", ["bebop", "spike"]],
  ["Samurai Champloo", "samurai_champloo", ["champloo", "mugen"]],
  ["Gurren Lagann", "tengen_toppa_gurren_lagann_series", ["ttgl", "gurren", "simon", "kamina"]],
  ["Kill la Kill", "kill_la_kill", ["klk", "ryuko"]],
  ["Promare", "promare", ["trigger"]],
  ["Cyberpunk Edgerunners", "cyberpunk:_edgerunners", ["edgerunners", "cyberpunk", "david"]],
  ["Vinland Saga", "vinland_saga_series", ["vinland", "thorfinn"]],
  ["Spy x Family", "spy_x_family_series", ["spy family", "anya"]],
  ["Blue Lock", "blue_lock_series", ["bluelock", "isagi"]],
  ["Haikyuu", "haikyuu!!_series", ["haikyu", "volley", "hinata"]],
  ["Dandadan", "dandadan", ["dan da dan", "okarun"]],
  ["Oshi no Ko", "oshi_no_ko", ["oshi", "ai hoshino"]],
  ["Solo Leveling", "solo_leveling", ["solo leveling", "sung jinwoo"]],
  ["Made in Abyss", "made_in_abyss_series", ["abyss", "riko"]],
  ["Re:Zero", "re:_zero_kara_hajimeru_isekai_seikatsu_series", ["rezero", "subaru", "rem"]],
  ["Steins;Gate", "steins;gate", ["steins gate", "okabe"]],
  ["Code Geass", "code_geass", ["geass", "lelouch"]],
  ["Death Note", "death_note", ["light yagami", "kira"]],
  ["Fullmetal Alchemist", "fullmetal_alchemist", ["fma", "brotherhood", "edward elric"]],
  ["Jojo's Bizarre Adventure", "jojo's_bizarre_adventure_series", ["jojo", "dio", "jotaro"]],
  ["Black Clover", "black_clover", ["asta"]],
  ["Fire Force", "fire_force_series", ["enen", "shinra"]],
  ["Sword Art Online", "sword_art_online_series", ["sao", "kirito"]],
  ["Tokyo Revengers", "tokyo_revengers", ["revengers", "takemichi"]],
  ["Bocchi the Rock", "bocchi_the_rock!", ["bocchi", "kessoku"]],
  ["Akira", "akira", ["kaneda", "otomo"]],
  ["Redline", "redline", ["sweet jp"]],
  ["Ghost in the Shell", "ghost_in_the_shell_series", ["gits", "motoko"]],
  ["Eureka Seven", "eureka_seven_series", ["e7", "renton"]],
  ["Gundam", "gundam", ["mecha", "zeon"]],
  ["Macross", "macross_saga", ["macross", "valkyrie"]],
  ["Sailor Moon", "bishoujo_senshi_sailor_moon", ["sailor moon", "usagi"]],
  ["Pokemon", "pokemon", ["pikachu", "sacha", "ash"]],
  ["Digimon", "digimon", ["agumon"]],
  ["Yu-Gi-Oh!", "yu-gi-oh!", ["yugioh", "duel"]],
  ["Gintama", "gintama", ["gintoki"]],
  ["Detective Conan", "detective_conan", ["conan", "shinichi"]],
  ["Lupin III", "lupin_iii", ["lupin"]],
  ["Precure", "precure", ["pretty cure", "magical girl"]],
  ["Symphogear", "senki_zesshou_symphogear_series", ["symphogear", "hibiki"]],
  ["Little Witch Academia", "little_witch_academia", ["lwa", "akko"]],
  ["Beastars", "beastars_series", ["legosi"]],
  ["Dorohedoro", "dorohedoro", ["caiman"]],
  ["Chihayafuru", "chihayafuru_series", ["chihaya", "karuta"]],
  ["Yuri on Ice", "yuri!!!_on_ice", ["yoi", "victor"]],
  ["Sonny Boy", "sonny_boy", ["sonnyboy"]],
  ["Ping Pong", "ping_pong", ["ping pong", "yuasa"]],
  ["Devilman Crybaby", "devilman_crybaby", ["devilman", "akira fudo"]],
  ["Mushoku Tensei", "mushoku_tensei_series", ["mushoku", "rudeus"]],
  ["Kaiju No. 8", "kaiju_no._8", ["kaiju 8", "kafka"]],
  ["Wind Breaker", "wind_breaker", ["windbreaker", "sakura"]],
  ["Sakamoto Days", "sakamoto_days", ["sakamoto"]],
  ["Boruto", "boruto:_naruto_next_generations", ["boruto"]],
  ["Shangri-La Frontier", "shangri-la_frontier", ["slf", "sunraku"]],
];

export function findCurated(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const haystack = ([display, , aliases]) => [display.toLowerCase(), ...aliases.map((a) => a.toLowerCase())];
  for (const entry of SERIES) if (haystack(entry).some((item) => item === needle)) return entry;
  for (const entry of SERIES) {
    if (haystack(entry).some((item) => item.includes(needle) || needle.includes(item))) return entry;
  }
  return null;
}

export function suggest(query, limit = 8) {
  const needle = query.trim().toLowerCase();
  if (!needle) return SERIES.slice(0, limit).map(([display, tag]) => ({ display, tag }));
  const hits = SERIES.filter(([display, , aliases]) =>
    [display.toLowerCase(), ...aliases.map((a) => a.toLowerCase())].some((item) => item.includes(needle)),
  );
  return hits.slice(0, limit).map(([display, tag]) => ({ display, tag }));
}
