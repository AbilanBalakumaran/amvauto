/* La veille : ce qui monte, et qu'on a le droit d'employer.

   Jamendo demandait une clé et penchait vers l'instrumental. On passe par
   Internet Archive, qui ne demande rien du tout et qui publie une donnée que
   presque personne d'autre ne publie : le nombre de téléchargements de la
   SEMAINE, item par item. C'est un signal de tendance réel, pas une estimation
   — ce que les gens prennent en ce moment, et non ce qu'ils ont pris depuis dix
   ans.

   Le catalogue « netlabels » réunit des labels qui publient sous licence libre.
   On y cherche ce qui chante : la recherche est restreinte aux sujets qui
   désignent des chansons plutôt que des nappes. Ce n'est pas une garantie —
   aucune métadonnée ne dit « il y a une voix » —, c'est un penchant, et la
   fiche montre les sujets pour qu'on en juge.

   Rien n'est stocké : on relaie, on met en cache un quart d'heure, et l'on rend
   une liste déjà triée. */

const RACINE = "https://archive.org";

/* Les sujets qui trahissent une chanson. Le premier bloc sert de filtre par
   défaut ; une recherche libre le remplace. */
const CHANTE = ["vocal", "song", "songs", "pop", "rock", "hiphop", "hip hop",
  "rap", "folk", "soul", "punk", "indie", "singer"];

const CACHE = 900;   // un quart d'heure : la tendance ne bouge pas à la minute

const json = (contenu, statut = 200, secondes = CACHE) => new Response(JSON.stringify(contenu), {
  status: statut,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${secondes}`,
  },
});

const enListe = (valeur) => (Array.isArray(valeur) ? valeur : valeur ? [String(valeur)] : []);

/* La licence, en clair. Une adresse Creative Commons dit tout ce qu'il faut
   savoir, mais elle le dit en chemin d'URL. */
function licenceLisible(adresse) {
  const dit = String(adresse || "");
  if (!dit) return { nom: "non précisée", commercial: null, adresse: "" };
  if (dit.includes("publicdomain")) return { nom: "domaine public", commercial: true, adresse: dit };
  const trouve = dit.match(/licenses\/([a-z-]+)\//);
  if (!trouve) return { nom: "libre", commercial: null, adresse: dit };
  const parts = trouve[1].toUpperCase().split("-");
  return {
    nom: `CC ${parts.join("-")}`,
    commercial: !parts.includes("NC"),
    adresse: dit,
  };
}

async function chercher(url) {
  const cherche = String(url.searchParams.get("q") || "").slice(0, 80).replace(/["\\]/g, "");
  const page = Math.max(1, Math.min(20, Number(url.searchParams.get("page")) || 1));

  const sujets = CHANTE.map((mot) => `subject:("${mot}")`).join(" OR ");
  const requete = cherche
    ? `mediatype:(audio) AND collection:(netlabels) AND (${sujets}) AND (${JSON.stringify(cherche)})`
    : `mediatype:(audio) AND collection:(netlabels) AND (${sujets})`;

  const adresse = new URL(`${RACINE}/advancedsearch.php`);
  adresse.searchParams.set("q", requete);
  for (const champ of ["identifier", "title", "creator", "week", "downloads", "licenseurl", "subject", "year"]) {
    adresse.searchParams.append("fl[]", champ);
  }
  adresse.searchParams.append("sort[]", "week desc");
  adresse.searchParams.set("rows", "24");
  adresse.searchParams.set("page", String(page));
  adresse.searchParams.set("output", "json");

  const reponse = await fetch(adresse, { headers: { "user-agent": "amvauto" } });
  if (!reponse.ok) return json({ erreur: `Internet Archive a répondu ${reponse.status}` }, 502, 0);
  const dit = await reponse.json();
  const trouves = dit?.response?.docs || [];

  /* Le score de tendance : la part de la semaine du morceau, rapportée au plus
     demandé de la page. Un pourcentage relatif se lit mieux qu'un compte brut —
     « 100 % » veut dire « c'est celui-là qu'on prend le plus en ce moment ». */
  const sommet = trouves.reduce((haut, x) => Math.max(haut, Number(x.week) || 0), 0) || 1;

  return json({
    total: dit?.response?.numFound || 0,
    pistes: trouves.map((x) => ({
      id: x.identifier,
      titre: String(x.title || x.identifier),
      artiste: enListe(x.creator).join(", "),
      semaine: Number(x.week) || 0,
      total: Number(x.downloads) || 0,
      tendance: Math.round(((Number(x.week) || 0) / sommet) * 100),
      sujets: enListe(x.subject).slice(0, 5),
      annee: x.year || null,
      licence: licenceLisible(x.licenseurl),
      page: `${RACINE}/details/${x.identifier}`,
    })),
  });
}

/* Le fichier lui-même. La recherche ne rend que des fiches ; il faut une
   seconde demande pour savoir ce qu'il y a dedans, et l'on ne la fait que
   lorsque quelqu'un choisit un morceau. */
async function piste(identifiant) {
  const propre = String(identifiant).replace(/[^A-Za-z0-9._-]/g, "");
  if (!propre) return json({ erreur: "identifiant invalide" }, 400, 0);
  const reponse = await fetch(`${RACINE}/metadata/${propre}`, { headers: { "user-agent": "amvauto" } });
  if (!reponse.ok) return json({ erreur: `Internet Archive a répondu ${reponse.status}` }, 502, 0);
  const dit = await reponse.json();
  const fichiers = (dit?.files || [])
    .filter((f) => /\.(mp3|ogg|flac|m4a)$/i.test(f.name || ""))
    /* Le format d'origine plutôt qu'une réduction : c'est celui qu'on veut
       analyser, et l'analyse du tempo aime les transitoires intactes. */
    .sort((a, c) => (Number(c.size) || 0) - (Number(a.size) || 0));
  const choisi = fichiers.find((f) => /\.mp3$/i.test(f.name)) || fichiers[0];
  if (!choisi) return json({ erreur: "aucun fichier audio dans cet item" }, 404, 0);
  return json({
    nom: choisi.name,
    octets: Number(choisi.size) || 0,
    duree: Number(choisi.length) || null,
    adresse: `${RACINE}/download/${propre}/${encodeURIComponent(choisi.name)}`,
  });
}

export async function veille(request, url) {
  if (request.method !== "GET") return json({ erreur: "méthode non permise" }, 405, 0);
  const identifiant = url.searchParams.get("piste");
  if (identifiant) return piste(identifiant);
  return chercher(url);
}
