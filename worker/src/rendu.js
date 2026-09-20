/* Le rendu déporté, déclenché par le Worker et non par le téléphone.

   Le jeton GitHub vivait dans le navigateur — saisi une fois par appareil,
   rangé dans le stockage local, envoyé à api.github.com depuis la page. Trois
   défauts : il fallait le recopier sur chaque appareil, il était lisible par
   tout ce qui tourne dans la page, et on finissait par le coller là où il ne
   devait pas aller.

   Il devient un secret du Worker. Le téléphone demande un rendu, le Worker
   ajoute l'autorisation : le jeton ne descend jamais dans le navigateur, ne
   s'écrit nulle part dans le dépôt, et se change en un seul endroit.

   Qui peut demander un rendu ? Celui qui a un code de coffre valide — le même
   laissez-passer que la lecture des plans. Sans cela, n'importe qui userait le
   quota d'actions du compte. */

import { codeValide } from "./coffre.js";

const nettoyer = (brut) => String(brut || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

const texte = (mot, statut) => new Response(JSON.stringify({ erreur: mot }), {
  status: statut,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

// La feuille de route passe en entrée d'un « workflow_dispatch », qui plafonne
// chaque valeur à soixante-cinq mille caractères.
const ENTREE_MAX = 65_535;

async function versGitHub(chemin, jeton, options = {}) {
  return fetch(`https://api.github.com${chemin}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jeton}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "amvauto",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
}

export async function rendu(request, url, env) {
  const jeton = env.GITHUB_TOKEN;
  const depot = env.GITHUB_DEPOT || "AbilanBalakumaran/amvauto";
  if (!jeton) {
    return texte("le rendu déporté n'est pas configuré : il manque le secret GITHUB_TOKEN", 503);
  }

  const code = nettoyer(request.headers.get("x-coffre") || url.searchParams.get("code"));
  if (!codeValide(code)) return texte("code invalide", 400);

  /* Suivre une course déjà lancée : on rend ce que GitHub dit d'elle, sans
     jamais laisser filtrer le jeton. */
  if (request.method === "GET") {
    const course = url.searchParams.get("course");
    if (!course) return texte("il manque le numéro de la course", 400);
    const reponse = await versGitHub(
      `/repos/${depot}/actions/runs/${encodeURIComponent(course)}`, jeton);
    if (!reponse.ok) return texte(`GitHub a répondu ${reponse.status}`, 502);
    const suivi = await reponse.json();
    return new Response(JSON.stringify({
      etat: suivi.status, verdict: suivi.conclusion, page: suivi.html_url,
      depuis: suivi.run_started_at,
    }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }

  if (request.method !== "POST") return texte("méthode non permise", 405);

  let corps;
  try {
    corps = await request.json();
  } catch {
    return texte("contenu illisible", 400);
  }
  const entrees = corps?.entrees;
  if (!entrees || typeof entrees !== "object") return texte("il manque les entrées du rendu", 400);
  for (const [nom, valeur] of Object.entries(entrees)) {
    if (typeof valeur !== "string") return texte(`l'entrée « ${nom} » n'est pas du texte`, 400);
    if (valeur.length > ENTREE_MAX) {
      return texte(`l'entrée « ${nom} » dépasse ${ENTREE_MAX} caractères`, 413);
    }
  }

  const flux = String(corps.flux || "rendu.yml").replace(/[^a-zA-Z0-9._-]/g, "");
  const branche = String(corps.branche || "main").replace(/[^a-zA-Z0-9._/-]/g, "");

  /* L'instant du départ sert à retrouver la course : « workflow_dispatch » ne
     rend pas son numéro, il rend 204. On demandera ensuite la dernière course
     de ce flux lancée après cet instant-là. */
  const depuis = new Date(Date.now() - 5000).toISOString();

  const lance = await versGitHub(
    `/repos/${depot}/actions/workflows/${encodeURIComponent(flux)}/dispatches`, jeton,
    { method: "POST", body: JSON.stringify({ ref: branche, inputs: entrees }) });

  if (lance.status !== 204) {
    const dit = await lance.text().catch(() => "");
    let pourquoi = `GitHub a répondu ${lance.status}`;
    try { pourquoi += ` — ${JSON.parse(dit).message}`; } catch { /* réponse en texte simple */ }
    return texte(pourquoi, lance.status === 401 || lance.status === 403 ? 502 : 400);
  }

  /* On laisse à GitHub le temps d'inscrire la course, puis on la cherche.
     Sans numéro, le téléphone n'aurait rien à suivre. */
  let course = null;
  for (let essai = 0; essai < 6 && !course; essai += 1) {
    await new Promise((suite) => setTimeout(suite, 1200));
    const liste = await versGitHub(
      `/repos/${depot}/actions/workflows/${encodeURIComponent(flux)}/runs?per_page=5`, jeton);
    if (!liste.ok) continue;
    const { workflow_runs: courses = [] } = await liste.json();
    course = courses.find((x) => x.created_at >= depuis) || null;
  }

  return new Response(JSON.stringify({
    lance: true,
    course: course?.id || null,
    page: course?.html_url || `https://github.com/${depot}/actions`,
  }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
