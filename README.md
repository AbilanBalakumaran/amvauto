# amvauto

Tu donnes un nom d'animé, l'outil te sort les rushs — les cuts sakuga de la série —
classés selon ce qu'ils valent **au montage** d'un AMV, avec les liens MP4 directs.

Trois sources alimentent l'outil :

| Source | Ce qu'elle apporte | Format |
|---|---|---|
| [Sakugabooru](https://www.sakugabooru.com) | les cuts : plans d'animation isolés d'un épisode, avec leur animateur | MP4/WebM |
| [AnimeThemes](https://animethemes.moe) | openings et endings, toutes versions confondues (v2, version TV, Blu-ray) — **uniquement les versions sans crédits** | WebM |
| [AniList](https://anilist.co) | bandes-annonces officielles | lien YouTube |

Les deux premières sont interrogées en parallèle par le Worker, et l'échec de l'une
n'emporte pas l'autre : la réponse indique ce que chacune a rendu, et pourquoi elle a
échoué le cas échéant. AniList, elle, est appelée **par la page** : son pare-feu refuse
les requêtes venant d'un Worker Cloudflare (403) mais elle autorise le CORS, donc le
navigateur l'atteint en direct. Ses bandes-annonces arrivent après l'arborescence, sans
retarder l'affichage.

Les deux API refusent aussi les requêtes sans `User-Agent` explicite.

Trois autres pistes ont été écartées après essai : **Internet Archive** ne remonte que des
reuploads YouTube et des rips d'épisodes, **openings.moe** sert des liens morts sur un
catalogue arrêté en 2015, et **Danbooru** mélange animations amateurs et contenu explicite.

> **Ce que l'outil est aujourd'hui — le rendu brut et la géographie du combat**.
> La v2.0 « moteur d'impact », la v2.1 « sakuga flow », la v3.0 « elite » et la
> v3.1 « AMV France & anti-redite » restent le socle : macro-structure en six
> moments, micro-rythme `{quand, force}`, crêtes d'impact, fil d'animateur, bandes
> de fréquences, sens du plan, escalade, raccord chromatique, zéro redite. Le
> rendu, lui, ne pose **plus aucun effet** : les rushs sont montés à l'état brut,
> vitesse et cadrage natifs, et la seule retouche qui subsiste est
> l'harmonisation colorimétrique vers la médiane du montage.
> **Une musique entre, un AMV en sort.** Quatre onglets — Créer, Veille,
> Historique, Infos. Il n'y a plus d'explorateur de rushs ni d'atelier de
> montage : ni timeline multipiste, ni pellicule d'imagettes, ni poignées de
> rognage, ni ciseaux, ni zoom au pincement. Ces mille deux cent quatre-vingt-
> treize lignes ont été retirées, et ce qui les remplace est décrit dans
> [« L'architecture du tunnel »](#larchitecture-du-tunnel--une-musique-entre-un-amv-sort).
>
> Ce fichier décrit l'outil tel qu'il est. Le journal de bord — tout ce qui a été
> essayé, mesuré et abandonné, l'ancien atelier compris — est dans
> [HISTORIQUE.md](HISTORIQUE.md). Ce qui y a été mis au point sert toujours : la
> lecture des en-têtes, le découpage sur images-clés, l'écriture du MP4, le coffre
> et le grenier n'ont pas bougé.

### Le rendu brut, et la géographie du combat

Quatre ajustements de mise en scène. Les trois premiers changent ce qu'on voit ;
le quatrième, ce qui a le droit d'entrer.

| | Ce que c'est | Mesuré |
|---|---|---|
| **Rendu 100 % naturel** | Les quatre effets procéduraux du runner — éclair blanc, micro-secousse, rampe de vitesse, stroboscope — sont retirés. Les rushs sont montés à l'état brut ; seule l'harmonisation colorimétrique reste. | `zoompan`, `drawbox`, `setpts`, `brightness=`, `geq` : **aucun**, ni dans la commande ffmpeg réelle, ni dans la feuille de route |
| **Géographie du combat** | Un bloc d'action **ne peut pas** s'ouvrir autrement que sur un plan d'ensemble, et un gros plan exige un plan large dans les trois coupes d'avant. C'est un refus, pas une préférence. | **0 gros plan d'action sans repère sur 35** (avant : 3 orphelins sur 9) · blocs ouverts `large→serré→moyen` et `large→moyen→serré` |
| **Contraste d'échelles** | Quatre catégories au lieu de trois — serré, moyen, large, **effet** —, et deux plans de même échelle collés bout à bout coûtent cher. Une explosion n'est plus rangée avec les décors. | **15 %** de suites de même échelle, contre 36 % attendus de cette distribution au hasard |
| **Zéro texte incrusté** | Le « sans crédits » d'AnimeThemes devient une condition d'entrée, fichier de montage compris. Un générique qui n'existe qu'avec crédits est rejeté. | **8 génériques servis sur 8 NC, 0 avec crédits** (avant : un bonus de 15 points, qu'un 1080p crédité rachetait) |

**La rampe de vitesse est partie avec le reste, et c'est une lecture de « vitesse
native » plus large que la consigne**, qui nommait la secousse, le flash et le
stroboscope. Elle marchait — impact à l'image près, durée de sortie intacte. Elle
se remonte en rétablissant une trentaine de lignes de `tools/rendu.py` et le champ
`pic` de la feuille de route.

### La v3.1 : la redite, et quatre standards de jury

Un défaut gâchait tout le reste, et trois règles manquaient pour tenir un
visionnage de concours.

| | Ce que c'est | Mesuré |
|---|---|---|
| **Zéro redite** | Une fenêtre posée bannit sa bande — ±1,5 s — pour tout le reste du montage. Le garde-fou d'avant comparait des instants exacts : deux fenêtres à un dixième de seconde passaient toutes les deux. | **0 plan identique · 102 scènes pour 102 coupes** (avant : jusqu'à 26 emplois d'un même rush, 46 % de recouvrement) |
| **Sources propres** | Vingt-quatre tags écartés au lieu de quatre — comparaisons, cartons-titres, captures, papier de production — et le 4:3 comme le cinémascope refusés. | 1494 cuts → 1382 · plus un seul ratio hors 16:9 |
| **Synchro interne** | Quand le son s'étire, un plan qui s'éteint ; sur un break, un plan qui s'arrête net. La pente de la courbe de mouvement le dit. | 80 % des coupes longues prennent un plan qui retombe, contre 41 % des courtes |
| **Guidage du regard** | Sur les coupes rapides, l'action reste dans le même tiers de l'écran. Et un smear ou de la fumée masque un saut d'arc. | 84 % de même tiers (33 % au hasard) · 6 % de traversées (22 % au hasard) |

**Deux consignes ont été écartées après audit, et c'est ce que l'audit sert à
faire.** Aucun tag de sous-titre, de watermark ou d'incrustation TV n'existe sur
Sakugabooru — `subtitled`, `watermark`, `credits`, `broadcast_screen`,
`lower_third`, `hardsub`, `tv_broadcast` rendent tous une liste vide. Et un
plancher de définition à 720p viderait le catalogue : sur trois cents cuts réels,
**cent pour cent sont entre 480 et 719 lignes**, aucun n'atteint 720. Le site sert
des extraits volontairement légers.

### Les quatre piliers de la v3.0

Ce que la v3.0 ajoute, et qui vise une seule chose : effacer les derniers
marqueurs « automatiques » du montage.

| | Ce que c'est | Mesuré |
|---|---|---|
| ~~**Rampe de vitesse**~~ | *Retirée* : l'anticipation s'étirait à 0,65× et le coup s'écrasait à 1,8×. Ce que la crête décide encore, c'est le CHOIX du plan et la fenêtre taillée autour du coup. | durée exacte sur 4 longueurs (24/24, 12/12, 7/7, 48/48 images) — avant retrait |
| **Escalade dramatique** | Une série monte en puissance : l'intro puise tôt, le climax réserve le tiers final. L'épisode 12 ne suit plus l'épisode 350. | sur l'axe 4–477 : intro ép.84 → montée ép.234 → drop ép.290 |
| **Raccord chromatique** | La teinte se prolonge sur les passages calmes, et bascule chaud/froid sur la charnière montée → drop. | 28° d'écart moyen au calme contre 65° au vif (~120° au hasard) · charnières à 1,47 sur 2 |
| **Roulements de percussion** | Une rafale de doubles croches **n'ajoute aucune coupe** : on tient le plan. Le stroboscope qui le faisait battre, lui, est retiré. | 2 rafales, **0 coupe ajoutée** (50 contre 50) |

### Les quatre piliers de la v2.1

Le socle, toujours en place. Chacun est détaillé dans
[« L'architecture du tunnel »](#larchitecture-du-tunnel--une-musique-entre-un-amv-sort),
et chacun est tenu par son banc.

| | Ce que c'est | Mesuré |
|---|---|---|
| **Continuité de style** | Le montage suit **une main d'animateur**, ou en fait s'affronter deux — alternance sur les couplets, rencontre au drop. Sakugabooru n'étiquette aucun personnage ; l'animateur est la seule identité qu'un cut porte, et le duel de styles est une figure reconnue du sakuga AMV. | 53/105 coupes portent le fil, 47 alternances |
| **Calage audio par bandes** | Le **grave sous 150 Hz** ancre les frappes lourdes du drop ; la **voix de 1,2 à 5 kHz** protège les couplets, où une coupe cherche la respiration la plus proche plutôt que de trancher un vers. | 9 crêtes sur 9 sur un kick · coupes pendant le chant 19/21 → 11/21 |
| **Flux vectoriel en cache** | Le **sens de déplacement** de chaque plan, mesuré au rendu par le runner et rangé dans R2. Le Worker ne peut pas décoder d'images ; le runner le fait presque gratuitement, et chaque AMV réchauffe le catalogue pour le suivant. | 18 prolongements de flux contre 2 inversions, contre 5/5 sans le sens |
| **Harmonisation des teintes** | Une **correction bornée vers la médiane** du montage, qui rapproche un cut de 2003 d'une séquence de 2024. C'est la seule retouche d'image qui subsiste : la micro-secousse qui l'accompagnait a été retirée. | étendue de contraste 37,7 → 26,6 · luminance 20,2 → 11,2 |

Presque rien de tout cela n'est une règle dure : ce sont des préférences chiffrées,
que la couverture de la musique peut toujours emporter. **Deux exceptions, et deux
seulement.** L'**interdiction de recouvrement** est absolue : elle ne cède que
lorsqu'un catalogue n'a arithmétiquement pas assez de matière (quatre-vingt-dix
secondes de source pour trois minutes de musique), et le journal le dit alors en
clair. L'**ancrage spatial** est un refus lui aussi — un bloc d'action n'ouvre que
sur un plan d'ensemble — mais il ne s'arme que si le catalogue peut le tenir, parce
qu'une géographie parfaite payée d'une redite serait un mauvais échange. Pour tout
le reste, chaque préférence
reste sous le budget d'épisode, donc un fil introuvable, un morceau sans grosse
caisse, un catalogue de six épisodes, une musique sans roulement ou un catalogue
qu'aucun rendu n'a réchauffé donnent toujours un AMV qui couvre sa musique. C'est
la propriété la plus vérifiée de tout le projet.

## Ce que l'outil fait

1. **Résout la série.** « frieren », « csm », « mob psycho » → le bon tag Sakugabooru.
2. **Ratisse large.** Jusqu'à 2000 cuts par série, paginés par vagues de cinq requêtes —
   ce qui donne 1817 rushs sur One Piece, 1494 sur Naruto Shippuden, 1869 sur Gundam.
3. **Ne garde que le montable.** Vidéos uniquement : les genga, layouts et scans de
   production sont écartés, ce n'est pas de l'image exploitable au montage.
4. **Nomme chaque plan.** Sakugabooru ne nomme pas ses cuts. Le nom est reconstruit
   depuis les tags : `E41 · Combat, impact frames et flammes (Itano circus)`. Épisode,
   action principale, deux détails visuels, et la figure de style quand il y en a une.
5. **Range le tout comme un disque dur** : la série principale, puis un dossier par arc
   taggé (`Arc Mugen Train`, `Thousand Year Blood War Arc Season 2`, `Final Season`), les
   films, et les génériques à part. Dedans, deux dossiers : **Combats** et **Moments
   calmes**. Un plan n'existe qu'à un seul endroit, et son nom s'accorde toujours avec son
   dossier : la même classification décide des deux.
6. **Classe pour le montage, pas pour la performance.** Le score communautaire dit
   « belle animation » ; ce n'est pas la même chose que « bon rush ». Le classement
   croise ce score avec la durée utile du plan, la résolution, l'animation de décor,
   les impact frames, et pénalise ce qui se marie mal avec du 2D (CGI, captures web).
7. **Tient la charge côté interface** : un dossier peut contenir un millier de plans, ils
   sont posés par centaines à la demande plutôt qu'en une fois.
8. **Monte le projet, tout seul.** Les plans retenus forment le catalogue d'un
   **projet**, conservé dans le navigateur, et c'est le tunnel qui en tire le montage :
   la musique est analysée sur l'appareil (tempo, sections, énergie, crêtes), chaque
   coupe est posée sur un temps mesuré, et chaque plan est choisi par notation. Rien
   ne se place à la main — il n'y a ni piste à faire défiler, ni bloc à déplacer, ni
   poignée à tirer. Le détail du moteur est dans
   [« L'architecture du tunnel »](#larchitecture-du-tunnel--une-musique-entre-un-amv-sort).

9. **Découpe sans réécrire.** Un plan n'est jamais recopié : le tunnel pose deux
   bornes dans le fichier source, ce qui rend la décision instantanée et réversible.
   Ces bornes partent dans l'export comme points d'entrée et de sortie source, si bien
   que DaVinci, Premiere ou Final Cut retrouvent exactement le même découpage.

   La durée de chaque plan est lue dans le fichier lui-même — aucune source ne l'expose —
   ce qui permet le chronométrage, le rendu MP4 sur l'appareil et l'export d'une
   **conduite de montage** : archive DaVinci (XMEML, avec marqueurs de phase et couleurs
   de clip) ou **EDL** CMX 3600, 24 i/s. Export secondaire en `.txt`, ou copie des liens
   pour un téléchargeur.

## Deux façons de s'en servir

### Interface web (Cloudflare Worker)

```bash
npm install
npm run dev      # http://127.0.0.1:8787
npm run deploy   # -> https://amvauto.<ton-sous-domaine>.workers.dev
```

**Mais le déploiement ne demande pas d'ordinateur.** Ce projet se pilote depuis un
téléphone, et `npm run deploy` demandait un terminal, un dépôt cloné et un jeton
Cloudflare dans l'environnement. Le workflow `.github/workflows/deploy.yml` fait
maintenant les trois : **pousser sur `main` déploie**, une à deux minutes plus tard.
L'onglet Actions permet aussi de le relancer à la main, sans inventer un commit. Un
seul secret à poser une fois, `CLOUDFLARE_API_TOKEN` ; s'il manque, le workflow le
dit en clair au lieu d'échouer au milieu du journal de wrangler.

Le Worker sert l'interface **et** relaie l'API : Sakugabooru ne renvoie aucun en-tête
CORS, une page statique ne peut donc pas l'appeler directement. Les vignettes et les
MP4, eux, sont chargés en direct par le navigateur — `<img>` et `<video>` échappent au
CORS — donc le Worker ne relaie que du JSON et reste très léger.

Routes :

**Le catalogue** — ce que le tunnel interroge à l'étape « animé » :

| Route | Rôle |
|---|---|
| `GET /api/rushes?anime=frieren&mood=combat&top=24` | liste plate, classée : la pioche du tunnel |
| `GET /api/rushes?…&main=hiroyuki_yamashita` | la même pioche, restreinte à une main : elle filtre les posts déjà gardés, sans requête de plus |
| `GET /api/tree?anime=frieren` | arborescence arc → ambiance → plans |
| `GET /api/suggest?q=chain` | complétion sur le catalogue |
| `GET /api/moods` | ambiances disponibles |
| `GET /api/media?u=…` | relais à liste blanche pour les octets d'un rush |
| `GET /api/cles?u=…` | durée, images-clés et courbe de mouvement d'un plan |
| `PUT /api/cles?u=…&code=…` | le runner y écrit le sens du plan, sa teinte dominante et le tiers où l'action se concentre |
| `GET /api/casting?anime=…` | les animateurs de la série, pour choisir le fil |
| `GET /api/extrait?u=…` | vignette ou extrait calculé côté serveur |

**Le montage et le rendu** :

| Route | Rôle |
|---|---|
| `GET · POST /api/rendu` | déclenche une course GitHub, et en suit l'état |
| `PUT /api/piste` | dépose la musique pour le rendu déporté |
| `GET · PUT · DELETE /api/grenier` | les rendus qui attendent hors du téléphone (R2) |
| `GET · PUT · DELETE /api/coffre` | sauvegarde d'un projet (KV), sous code |
| `GET · POST · PUT · DELETE /api/pousser` | inscription aux notifications, et l'envoi |

**La musique et les paroles** — chaque route payante passe par le code du coffre :

| Route | Rôle |
|---|---|
| `GET /api/veille` | morceaux libres qui montent cette semaine |
| `POST /api/musique` | génération du morceau (ACE-Step, ZeroGPU) |
| `POST /api/paroles` | écriture des paroles |
| `POST /api/ecoute` | transcription minutée (Whisper) |
| `POST /api/accord` | accord des paroles sur le montage |
| `POST /api/scene` | lecture d'une scène par le modèle |

**Le service** :

| Route | Rôle |
|---|---|
| `GET /api/version` | horodatage du déploiement |
| `GET · POST /api/compte` | compte et codes |

Les cinq routes du catalogue (`tree`, `rushes`, `suggest`, `moods`, `casting`) sont
servies depuis un cache de bord : la même demande deux fois ne repart pas chez
Sakugabooru. `casting` y est pour une raison de plus — elle demande la même pioche
de deux mille posts que la génération réclamera ensuite, donc payer au moment où
l'on choisit son animé fait gagner au moment où l'on génère.

Sa clé de cache porte une **version de forme** (`&f=1`). Sans elle, changer la
forme du JSON laisse la page lire l'ancienne pendant six heures : constaté en vrai,
un menu d'animateurs vide alors que le serveur rendait bien ses trente mains.

### Application installable

L'interface s'installe sur un téléphone (manifeste + service worker) et fonctionne hors
ligne pour sa coquille — les rushs, eux, viennent du réseau. À chaque lancement elle
vérifie sa version : un `sw.js` d'un octet différent suffit à installer le nouveau worker,
qui prend la main aussitôt et fait recharger la page. Le nom du cache porte l'horodatage
posé par `tools/stamp.mjs`, donc **aucun numéro à incrémenter à la main** — l'oublier une
fois figerait l'application chez l'utilisateur.

> **Déployer passe obligatoirement par `npm run deploy`**, jamais par `wrangler deploy`
> seul : c'est le script npm qui appelle `tools/stamp.mjs` avant de publier. L'oubli ne
> casse rien de visible et c'est bien le problème — plusieurs déploiements de suite ont été
> publiés avec un `sw.js` inchangé à l'octet près. Aucun nouveau service worker ne
> s'installait, donc aucun rechargement automatique et aucun renouvellement du cache de la
> coquille ; l'application continuait de recevoir le code neuf, mais seulement parce que
> les pages sont servies par le réseau d'abord. Le bandeau « nouvelle version », lui, ne
> pouvait plus se déclencher : page et Worker portaient le même horodatage périmé, donc
> ils étaient d'accord. Et l'ordre compte : on déploie, **puis** on valide les fichiers
> estampillés, pour que le commit corresponde exactement à ce qui est en ligne.
>
> Sur le runner, cet ordre n'a plus lieu d'être : l'estampille est écrite dans les
> fichiers de la course et n'est pas recommitée — la recommiter relancerait le
> workflow, indéfiniment. Ce qui compte est que la page et le Worker soient
> estampillés dans la **même** course, et ils le sont ; c'est leur comparaison qui
> déclenche le bandeau. La valeur rangée dans le dépôt ne sert plus qu'au
> développement local.

La page est servie en `no-store` et le Worker s'exécute avant les fichiers statiques
(`run_worker_first`), sans quoi cet en-tête ne s'appliquerait jamais. Page et Worker portent
le même horodatage, posé par `tools/stamp.mjs` au déploiement : quand ils diffèrent, la page
affiche un bandeau — un navigateur qui garde une copie périmée donne sinon l'impression que
rien n'a été corrigé.

L'interface reprend la coquille d'[autoshort](https://github.com/AbilanBalakumaran/autoshort)
— fond `#0a0a0a`, surfaces `#161616`, titres en Obelix Pro, header + barre d'onglets — sur un
thème **Zoro** : accent `#35C24D → #12762E`, et pour icône ses trois katanas en éventail,
dessinés en vectoriel sur le noir de l'application. Le même dessin sert de favicon, d'icône
installée, et d'écran de démarrage. Le logo seul, sans le nom : il est déjà sous l'icône, sur
l'écran d'accueil, où l'application s'appelle **Amvauto**.

**Un seul écran de démarrage, et seulement dans l'application installée.** Les images de
lancement d'iOS (`apple-touch-startup-image`) ont été retirées : le système en garde une copie
prise à l'installation, de sorte qu'en changeant le dessin on voyait l'ancienne image puis la
nouvelle — deux écrans pour un lancement, et pas moyen d'y remédier depuis la page. iOS n'affiche
donc plus que le noir du manifeste, que l'écran de la page prolonge sans rupture. Dans un onglet,
le navigateur a déjà sa propre page de chargement : l'écran ne s'y affiche pas
(`@media (display-mode: standalone)`, avec `navigator.standalone` en repli pour les anciens iOS).

Cet écran n'est pas retiré du document, il est éteint — et rallumé juste avant un rechargement.
Une mise à jour ne montre donc plus deux démarrages successifs mais un seul écran noir continu.

**La mise à jour se fait pendant que ce rideau est encore tiré.** L'écran de démarrage demande
la version au serveur et, si elle diffère, recharge sans se lever : on n'arrive jamais dans
l'application sur du vieux code. Deux secondes et demie au plus — une version qui n'arrive pas
ne doit pas retenir quelqu'un sans réseau. Mesuré : 574 ms de noir en temps normal, 824 avec la
mise à jour, 2716 quand le serveur ne répond plus. En séance, elle ne se propose plus non plus :
elle s'applique, sauf si un rechargement détruirait quelque chose — un travail en cours, ou une
musique choisie dont aucun montage n'est sorti, parce que le fichier vient de l'appareil et que
rien ne peut le rouvrir à notre place. Une tentative par version : sans ce garde-fou, une
version que le rechargement ne corrige pas faisait tourner l'application en boucle — 94
rechargements en deux secondes, mesurés au banc. Et un bouton vert dans Infos force la mise à
jour quand on la veut tout de suite.

La barre d'onglets ne porte que des icônes, à la taille d'autoshort (29 px dans une barre de
54) : une note de musique (**Créer**), un égaliseur (**Veille**), une horloge qui remonte le
temps (**Historique**) et un « i » (**Infos**) disent déjà ce que les mots répétaient, et la
barre y gagne en hauteur utile.

### CLI

```bash
python -m amvauto "chainsaw man"
python -m amvauto frieren --mood combat --top 15
python -m amvauto "jujutsu kaisen" --json > rushes.json
```

Aucune dépendance : bibliothèque standard uniquement.

## Structure

```
amvauto/             moteur Python (client API, scoring, CLI)
worker/src/          Worker Cloudflare
  index.js           routage de toutes les routes /api/
  sakuga.js          accès à l'API, pagination, filtrage, animateurs d'un cut
  animethemes.js     openings et endings (WebM, sans crédits obligatoire)
  scoring.js         barème d'utilisabilité et ambiances
  naming.js          nom des plans et détection des arcs
  series.js          raccourcis de séries (généré depuis series.py)
  scene.js           fiche d'une scène
  cles.js            durée, images-clés, courbe de mouvement — et le sens, écrit par le runner
  media.js           relais à liste blanche pour les octets des rushs
  extrait.js         extraits calculés côté serveur
  coffre.js          sauvegarde des projets (KV), sous code
  grenier.js         dépôt des rendus (R2)
  compte.js          comptes et codes
  piste.js           dépôt de la musique pour le rendu déporté
  rendu.js           déclenchement et suivi des courses GitHub
  pousser.js         notifications poussées (VAPID + aes128gcm)
  musique.js         génération de musique
  paroles.js         écriture de paroles
  ecoute.js          transcription (Whisper)
  accord.js          accord des paroles sur le montage
  veille.js          morceaux libres qui montent cette semaine
  quota.js, version.js
public/
  index.html         toute l'application (une page)
  sw.js              service worker : coquille hors ligne, poussées, clics
  decodeur.js        décodage d'avance, sur un fil
  demux.js, mp4.js, webm.js, plage.js, copier.js, fabrique.js, juge.js
tools/
  stamp.mjs          estampille page + worker + sw au déploiement
  rendu.py           rendu du MP4 sur un runner GitHub
  sens.py            direction dominante d'un plan, et le tiers où l'action se concentre
  teinte.py          luminance, contraste, saturation, teinte dominante — et la correction
  projet.py          archive DaVinci Resolve (XMEML + EDL + sources)
.github/workflows/   rendu.yml, projet.yml
wrangler.toml        config de déploiement
HISTORIQUE.md        le journal de bord : ce qui a été essayé et mesuré
```

`worker/src/scoring.js` est le portage de `amvauto/scoring.py` : les deux doivent rester
alignés. `worker/src/series.js` est généré depuis `amvauto/series.py`.

## Les médias sont importés, pas diffusés

Un logiciel de montage ne monte pas des fichiers distants : il importe les médias, puis
travaille en local. C'est ce que fait l'application — chaque plan ajouté à un projet est
téléchargé une fois, gardé dans la base du navigateur (IndexedDB) et servi ensuite depuis
l'appareil.

Tout en découle : le déplacement dans un plan est instantané, l'image apparaît sans
négociation, aucune règle de chargement mobile ne s'applique, et une vidéo locale ne
« teinte » pas une toile — on peut donc en relire les images, ce dont le rendu
sur l'appareil a besoin. Les octets passent par `/api/media`, un relais à liste blanche stricte
(Sakugabooru, AnimeThemes) : les sources n'autorisent pas la lecture directe de leurs
octets par une page, et un relais ouvert servirait à n'importe qui.

L'importation se fait un fichier à la fois, le plan courant d'abord, avec l'avancement
affiché au journal. Un plan non encore importé reste jouable en distant, avec ses limites.

### Monter léger, rendre en pleine définition

AnimeThemes sert souvent **plusieurs fichiers pour un même générique** : un 720p et un
1080p Blu-ray. Ce sont deux poids pour la même image, pas deux plans — les deux fichiers
d'une même *entrée* partagent le montage et la durée. Mesuré sur deux paires : 0,00 s et
0,07 s d'écart de durée, et des images identiques à 1 près sur une échelle de 255 aux
instants 1 s, 5 s, 15 s, 30 s et 60 s.

Chaque rush porte donc deux adresses. Tout ce qui télécharge, lit, sonde ou range un média
passe par la plus légère ; l'EDL et l'export de liens désignent celle du rendu. On monte
sur un fichier réduit, le logiciel de montage rend sur le fichier complet, et les points de
coupe tombent au même endroit puisque les durées coïncident.

Sur *Frieren*, cela fait 41,2 Mo à télécharger au lieu de 57,6 pour l'OP1, 28,2 au lieu de
48,4 pour l'ED1-TV — de 28 % à 42 % de moins. En dessous de 15 % d'économie, l'application
ne garde qu'un seul fichier : doubler le nombre d'adresses pour rien n'apporte rien.

Le procédé **ne dépend d'aucune capacité du navigateur** : ni WebCodecs, ni encodage sur
l'appareil, rien qui existe sur un poste et manque sur un téléphone. C'est le choix d'une
adresse plutôt qu'une autre — identique sur iPhone, sur Android et sur ordinateur.

Une réserve, affichée dans la fiche du rush : le fichier léger porte parfois les crédits que
la version Blu-ray n'a pas. Même image, même durée, du texte en plus pendant le montage —
absent du rendu. Quand une variante de même nature existe (créditée comme le rendu, ou sans
crédits comme lui), c'est elle qui est préférée.

## Générer la musique depuis l'outil

Le panneau du brief porte un bouton **Générer la musique** : la consigne calculée
sur le montage part au fournisseur, le morceau revient, il se pose dans la piste
son — et son tempo est lu dans la foulée, ce qui fait apparaître la grille des
temps. La boucle se referme : du montage à la musique, et de la musique aux coupes.

Le chemin par défaut est gratuit : le Space `ACE-Step/ACE-Step` sur l'infrastructure
ZeroGPU de Hugging Face, modèle sous licence Apache 2.0 — ce qu'il produit se publie
sans réclamation. Un second fournisseur payant reste branché en secours.

**La clé ne vit jamais dans la page.** Elle serait lisible par quiconque ouvre
l'application, et dépensable par lui. Elle reste en secret du Worker, et la page ne
connaît que la route `/api/musique`. Deux protections, parce que cette route tire
sur une ressource comptée :

- **le code du coffre sert de laissez-passer** — sans lui, personne ne peut tirer
  sur le quota du compte (vérifié : 401 sans code, 401 sur un code au contrôle faux) ;
- **un plafond de vingt générations par jour** borne la casse même si le code fuite
  (vérifié : 200 jusqu'au vingtième appel, 429 au vingt et unième, remise à zéro le
  lendemain par expiration de la clé).

Le détail — les quotas relevés, le dialogue avec Gradio, le choix de la longueur, le
chanté contre l'instrumental, les fournisseurs écartés — est dans
[HISTORIQUE.md](HISTORIQUE.md#générer-la-musique-depuis-loutil).

## L'architecture du tunnel : une musique entre, un AMV sort

Ce qui suit est la spécification du moteur tel qu'il tourne aujourd'hui.
[HISTORIQUE.md](HISTORIQUE.md) raconte comment on y est arrivé.

```
  musique (fichier ou veille)
        │
        ├─ tempo, sections, frappes {quand, force}      sur l'appareil
        ├─ bandes : grave < 150 Hz, voix 1,2–5 kHz      sur l'appareil
        ├─ paroles (Whisper, /api/ecoute)               hors chemin critique
        │
  trame : une émotion par passage                        posée par l'utilisateur
  fil   : une main, ou deux qui s'affrontent             /api/casting
        │
  recherche  ──►  /api/rushes  (Sakugabooru + AnimeThemes)
        │         par ambiance : combat, vitesse, effets, acting, decor
        │
  lecture   ──►  /api/cles  (durée, images-clés, courbe, sens, teinte, tiers d'action)
        │
  ordonnanceur ─► grille de coupes ─► choix de scène ─► fenêtre dans la scène
        │         échelle · escalade · teinte · pente dE/dt · tiers d'action
        │         et RÉSERVATION des intervalles source : zéro redite
        │
        ├─► rendu MP4        GitHub Actions + ffmpeg ─► grenier (R2)
        │                    rushs à l'état brut : vitesse et cadrage natifs
        │                    teintes harmonisées vers la médiane du montage
        │                    et sens + teinte de chaque rush réécrits dans /api/cles
        └─► projet DaVinci   XMEML + EDL + sources    ─► grenier (R2)
```

### Les six moments d'un AMV

Un montage ne se contente pas d'alterner fort et faible : il pose, installe,
monte, frappe, laisse retomber, conclut. Chaque passage reçoit un moment, déduit
de sa position dans le morceau et de son énergie — la position vient du minutage,
l'énergie de l'émotion posée sur la trame.

| Moment | Quand | Ce qu'il cherche | Ce qu'il refuse |
|---|---|---|---|
| **Intro** | finit avant 18 % du morceau, ou première section calme sous 35 % | décors, vent, marche, regards | tout choc (+55), explosions et images d'impact (+25) |
| **Couplet** | le reste, énergie ≤ 1 | acting, narration | la pyrotechnie (+12) |
| **Montée** | énergie 2 | courses, poursuites, envols, déformations | le plan fixe et calme (+8) |
| **Drop** | énergie 3 | chocs, impacts, rayons | le plan calme (+14) |
| **Retombée** | suit un drop, énergie < 3 | débris, fumée, étincelles | le calme neutre et fixe (+20) |
| **Outro** | dernière section **et** énergie ≤ 1 | plan large, pose tenue | le choc (+25) |

Les pénalités sont du même ordre que celle d'une scène déjà vue : franchissables
quand il ne reste que ça — un catalogue sans une seule scène de combat monte
quand même son drop, et couvre la musique —, jamais choisies autrement.

**« La dernière section est l'outro » est faux** dès qu'un morceau finit sur son
refrain, ce qui est la règle en musique populaire. Le montage appliquait alors
les règles de la conclusion au drop : choc pénalisé, plan large préféré,
immobilité récompensée — l'inverse exact de ce que le moment demande. Une
conclusion se reconnaît à ce qu'elle retombe, pas à sa place dans la liste.

### Les cinq régimes d'un plan

« Mouvement » mettait une course, un impact et une pluie de débris dans le même
sac. Ce sont trois moments d'une même phrase.

| Régime | Étiquettes | Bande de mouvement | Tenue |
|---|---|---|---|
| **expression** | `character_acting`, `dialogue`, `crying`, `hair`… | 5 – 34 | 0,45 |
| **décor** | `background_animation`, `rotation`, `wind`, `liquid`… | 18 – 62 | 0,60 |
| **élan** | `running`, `chase`, `smears`, `flying`, `sliding`… | 55 – 200 | 0,62 |
| **choc** | `impact_frames`, `fighting`, `explosions`, `beams`… | 90 – 300 | 0,34 *(pointu)* |
| **dispersion** | `debris`, `smoke`, `sparks`, `lightning`, `fire`… | 45 – 170 | 0,45 |

La bande est en milli-octets par pixel — ce que la courbe de mouvement mesure.
« Pointu » inverse la règle de tenue : pour un choc, c'est l'irrégularité qui
vaut, pas la régularité.

La phrase — élan → choc → dispersion → calme — est tenue à part, par `FAMILLES`
et `SUIVANTE` : elle décide de l'enchaînement d'un plan au suivant et fait payer
le sur-place de plus en plus cher.

### Le micro-rythme : `{quand, force}`

La grille de coupes rendait des instants ; la force de chaque frappe était
calculée puis jetée. Toutes les cases se valaient donc, et le kick du refrain
recevait le plan qui tombait là.

Elle rend maintenant `{quand, force}`, et le montage sait sur quelle frappe
chaque plan **commence** — c'est celle-là qui décide de ce qu'il doit montrer.

- **≥ 62 % de la frappe la plus forte** : un temps qui porte. La famille du choc
  et une crête franche passent devant un plan plat (19,5 → 10,5 contre
  22,6 → 25,6, mesuré). La fenêtre vise le pic de la scène même hors des sections
  d'énergie, pour que la frappe visuelle tombe sur la frappe sonore. Et
  l'inversion du sens de déplacement, ailleurs la pire des suites, y devient
  permise : deux forces qui se font face, c'est le choc (56,8 → 46,8).
- **≥ 85 %** : une crête. Les images d'impact s'y réservent — rares dans un
  catalogue, et une fois vues elles ne frappent plus (−1,3 sur une crête contre
  16,7 sur un temps fort ordinaire).

Après un choc, un plan plat coupe l'énergie net : la dispersion passe devant lui,
et seulement là (52,6 → 60,4 pour le plat après un impact, inchangé après un plan
calme).

### Ce que l'export Resolve emporte

Le montage part en **XMEML** (Final Cut 7) et en **EDL CMX 3600**, avec les rushs
découpés — une seconde de poignée de chaque côté — et la musique.

**Une couleur par plan**, d'après sa famille, dans `labels/label2` du `clipitem` :

| Famille | `label2` | Vu dans Resolve |
|---|---|---|
| choc | `Rose` | rouge / rose |
| élan | `Lemon` | jaune |
| dispersion | `Lavender` | violet |
| calme, décor, acting | `Forest` | vert |

Les noms sortent de la liste de Final Cut 7 : une valeur inventée serait ignorée
à l'import. Un plan dont la famille n'est pas reconnue n'en porte aucune, plutôt
qu'une couleur qui mentirait.

**Un marqueur de séquence par moment**, avec le BPM et la force moyenne du
passage en commentaire :

```xml
<marker>
  <name>Drop — on frappe</name>
  <comment>142 BPM · force moyenne 0.88 · action</comment>
  <in>48</in><out>-1</out>
</marker>
```

Ils sont posés sur la **séquence**, pas sur les clips : un repère de structure
appartient à la ligne de temps et doit survivre au déplacement du plan qui se
trouve dessous. L'EDL porte la même chose à sa syntaxe — `* TEMPO: 142 BPM`,
`* CLIP COLOR: ResolveColorRed`, et des localisateurs `|C:… |M:… |D:1`.

### Ce que le journal montre pendant la génération

Relevé tel quel sur un montage de 2 min 30 — Naruto Shippuden, duel de deux mains,
paroles minutées. Chaque ligne porte ses chiffres en dessous :

```
+0.0s  Génération demandée · Naruto Shippuden · 150 s de musique · instrument caisse
       animes=naruto_shippuuden duree=150s bpm=120 passages=8 trame=calme>emotion>elan>action>emotion>elan>action>calme paroles=32 fil=hiroyuki_yamashita contre tatsuya_koyanagi (duel de mains)
+0.0s  Recherche des scènes…
+0.4s  « Naruto Shippuden » → Naruto Shippuden · 1382 scènes au catalogue
+0.4s  Recherche terminée
       scenes=172 en=422ms
+0.4s  Pioche : 172 scènes · 164 sakugabooru, 8 animethemes · 76 coupes attendues
       sources=sakugabooru:164/animethemes:8 avecFichier=172/172 parScene=2.3
+0.4s  Lecture des en-têtes…
+1.5s  Scènes lues : 120/172 durées · 120 courbes de mouvement · 0 illisibles
       en=1090ms arretA=assez lu refusees=0
+1.5s  Construction du montage…
+1.7s  Montage : 104 coupes · 150 s sur 150 s · 104 moments distincts
       en=200ms scenesEmployees=104/120 couverture=100%
+1.7s  [0:00–0:19] Intro — ambiance et décors · 9 coupes
       phase=intro emotion=calme energie=0 couvert=23s coupeMoyenne=2.53s
+1.7s  [0:19–0:38] Couplet — acting et narration · 7 coupes
+1.7s  [0:38–0:56] Montée — accélération · 19 coupes · 1 éclair
+1.7s  [0:56–1:15] Drop — impact sakuga · 19 coupes · 2 éclairs
       phase=drop emotion=action energie=3 couvert=19s coupeMoyenne=0.99s
+1.7s  [1:15–1:34] Retombée — dispersion · 7 coupes
+1.7s  [1:34–1:53] Montée — accélération · 17 coupes
+1.7s  [1:53–2:11] Drop — impact sakuga · 20 coupes
       phase=drop emotion=action energie=3 couvert=19s coupeMoyenne=0.94s
+1.7s  [2:11–2:30] Outro — plan tenu · 9 coupes
+1.7s  104 coupes · 0 à cheval sur 104 mesurées · 2 éclairs d'impact
       aCheval=0/104 eclairs=2 surQuoi=frappes ≥ 85 % servies par un choc
+1.7s  Fil du duel de mains : 54/104 coupes le portent (52 %) · 43 alternances · 0 plans à deux
       cibles=hiroyuki_yamashita contre tatsuya_koyanagi portees=54/104 ensemble=0 alternances=43 vivier=55/120
+1.7s  Escalade sur 85–477 : Intro ép.238 · Couplet ép.303 · Montée ép.245 · Drop ép.290 · Retombée ép.290
       axe=85–477 episodesConnus=77/120 scènes du vivier parMoment=intro=238 couplet=303 montee=245 drop=290 retombee=290
+1.7s  Roulements : 2 rafales sur les montées · 2 plans tenus en travers · 24 frappes traversées
       rafales=2 plansTenus=2 frappesTraversees=24 coupesAjoutees=0
+1.8s  Redites : 0 plan identique · 104 scènes pour 104 coupes · au pire 1 emploi d'une même scène
       identiques=0 scenesDistinctes=104/104 pireEmploi=1 margeInterdite=1.5s regleCedee=0
+1.8s  Bandes : 71 coupes ancrées sur le grave · 5 glissées hors d'un vers · 13 retirées pour la même raison
       surLeGrave=71/75 jugees=39 glissees=5 retireesParLeBudget=13 resteesDansUnVers=0 source=paroles minutées (Whisper)
+1.8s  Plans : du plus court 0.25 s au plus long 4.00 s · médian 1.00 s
+1.8s  Génération terminée
       total=1.8s coupes=104 appels=128 echecs=0
```

Une ligne marquée `[!]` est reprise en tête du rapport, sous « ce qui a alerté » :
on colle, et ce qui a mal tourné se lit en premier. Ce relevé-là n'en porte
aucune — zéro coupe à cheval sur cent quatre, et pas un vers tranché.

Six de ces lignes disent ce qu'un chiffre seul cacherait. **Les redites** : zéro plan
identique, cent quatre scènes pour cent quatre coupes, au pire un seul emploi d'une
même scène — c'est la ligne qui se lit en premier, parce que c'est le défaut qui se
voyait le plus. L'escalade : l'épisode médian va de 238 à 303 sur un axe qui court de
85 à 477. Les roulements : deux rafales, deux plans **tenus** en travers, **zéro coupe
ajoutée** — c'est tout l'enjeu, et depuis que le rendu ne fait plus battre l'image,
c'est le seul enjeu. Le fil : cinquante-quatre coupes sur cent quatre le portent, mais
le vivier n'en offrait que cinquante-cinq sur cent vingt — le montage a donc employé
presque tout ce qu'il avait. Les bandes : trente-neuf coupes jugées sur les passages
où la voix commande, cinq déplacées vers une respiration, treize retirées par le
budget parce que leur force avait baissé, **zéro restée dans un vers**.

« Copier le rapport » ajoute l'appareil, la version, l'écran, l'état du réseau et
de la mémoire, la demande complète (musique, tempo, trame, portée), les appels au
serveur résumés par route — et listés un par un quand ils ont raté. Le code du
coffre y est masqué.

**Deux comptes qui ne s'additionnent pas.** La somme des coupes par passage
(9 + 7 + 19 + 19 + 7 + 17 + 20 + 9 = 107) dépasse le total (104), et l'intro annonce
23 s couvertes pour un passage de 19 : une coupe qui déborde sur le passage suivant
est comptée des deux côtés, à cause de la tolérance de 10 ms qui sert à rattraper les
arrondis. Le total, lui, est juste — c'est la longueur du montage, et la couverture
est à 100 %. Le défaut est dans l'affichage, pas dans le montage.

### Ce qui n'a pas été touché, et pourquoi

Le **moteur d'aperçu** — vivier de lecteurs, moniteur, transport, environ mille
cinq cents lignes — reste en place. Il n'est plus atteignable depuis l'écran,
mais le rendu MP4 dans le navigateur s'en sert : c'est lui qui pose les rushs sur
un lecteur et recopie la toile. Le découpler demanderait de réécrire le rendu,
ce qui est une refonte et non un nettoyage — et le budget de lecteurs
(trois sur WebKit, quatre ailleurs, deux plans d'avance) a été mesuré contre les
micro-coupures sur iOS.

### Le fil : suivre une main, ou en faire s'affronter deux

Sur mille huit cents rushs, le montage enchaînait des plans qui n'ont rien en
commun : juste au rythme, sans suite.

**Le fil devrait être le personnage, et il ne peut pas l'être.** Sakugabooru
n'étiquette aucun personnage : `naruto_uzumaki`, `sasuke_uchiha`, `gojo_satoru`
ne sont pas des tags du site — `tag.json` les rend vides — et le type 4 de son
catalogue, celui que Danbooru réserve aux personnages, ne compte que dix tags qui
sont des signatures d'animation : `kanada_light_flare`, `itano_circus`,
`obari_punch`, `ebata_walk`.

La seule identité qu'un cut porte est son **animateur**, et celle-là est riche :
cent cinquante-neuf plans de Hiroyuki Yamashita sur Naruto Shippuden, vingt-neuf
de Norio Matsumoto, trente mains au menu (`/api/casting`). Le fil est donc une
continuité de main — le geste, le trait, la façon de déformer un corps. Ce n'est
pas narratif, c'est plastique, et c'est ainsi qu'un sakuga showcase se monte.

| Mode | Ce qu'il cherche | Ce qu'il ne fait pas |
|---|---|---|
| **une main** | ses plans passent devant (−14) | pénaliser un plan sans crédit — `artist_unknown` couvre cent quinze mille posts |
| **un duel** | l'alternance A → B sur couplets et montées (−16) ; les deux créditées sur le même cut au drop (−28) | dépenser un plan à deux mains ailleurs : hors du drop il vaut à peine plus qu'un plan ordinaire (−4) |

Cette réserve est la leçon des images d'impact. À vingt points partout, la
ressource était consommée avant le drop et la rencontre y tombait à 20 % contre
26 % sur le montage entier — l'inverse du but. Réservée : 24 % contre 19 %, et
l'alternance double au passage, de 8 à 17.

Tout reste franchissable — sous le budget d'épisode (60), très sous la redite
d'une scène (100). Un fil introuvable, ou un vivier de trois plans pour
cinquante-quatre coupes, couvre toujours les soixante secondes.

**Le fil pèse aussi sur la pioche, et c'est un montage réel qui l'a exigé.** Au
premier essai sur Naruto Shippuden, un duel Hiroyuki Yamashita contre Tsutomu
Oshiro ne portait que 21 coupes sur 106, et **zéro** alternance. Le barème faisait
son travail : il n'y avait presque aucun plan de ces deux mains dans la pioche,
tirée par ambiance et plafonnée à cent soixante-douze scènes. Chaque main reçoit
donc son propre seau (`/api/rushes?main=…`, qui filtre les deux mille posts déjà
gardés au bord — aucune requête de plus à Sakugabooru), et ce seau entre dans
l'entrelacement comme les autres.

| Sur Naruto Shippuden, duel de deux mains | Fil porté | Alternances |
|---|---|---|
| le fil ne pèse que sur la notation | 21/106 (20 %) | 0 |
| le fil pèse aussi sur la pioche | **53/105 (50 %)** | **47** |

Les ambiances restent : un AMV qui ne contiendrait que les plans de deux mains
n'aurait plus de quoi poser une intro calme ni une retombée.

### Les bandes ne servent pas au même moment

La séparation en quatre bandes existait, et le montage n'en employait qu'une :
la plus régulière, du début à la fin. Tous les transitoires se valaient donc, et
un kick de refrain pesait autant qu'une harmonique de guitare.

**Le grave ancre les frappes lourdes.** Sur un drop ou une montée, une coupe
adossée à un coup sous 150 Hz voit sa force montée d'un tiers ; une coupe qui n'en
a aucun la voit baisser d'un quart. La grille ne bouge pas — c'est la régularité
qui la tient — mais ce qui compte comme fort change, et c'est cette force que
lisent le choix du choc et la réservation des images d'impact. Mesuré :
les neuf crêtes du morceau tombent **toutes** sur un coup de grave, là où elles se
dispersaient sur n'importe quel transitoire.

**La voix protège les couplets.** Sur une intro, un couplet ou une outro, une
coupe qui tombe au milieu d'un vers cherche la respiration la plus proche — un
quart de seconde de rayon, en préférant une vraie frappe à un instant nu. Quand il
n'y en a pas, elle n'est pas déplacée de force : sa force baisse et le budget la
retire avant les autres. Mesuré : les coupes qui tombent pendant qu'on chante
passent de **19 sur 21 à 11 sur 21**, sans perdre une coupe. Sur le drop on ne fuit
rien : un refrain se chante sur les frappes.

Deux sources pour savoir où la voix chante : les paroles minutées de Whisper
(`/api/ecoute`) quand on les a, l'enveloppe de la bande mélodie sinon — gardée à
dix mesures par seconde sur un octet, mille huit cents octets pour trois minutes.

**Baisser la force, c'est laisser le budget finir le travail**, et le journal a
d'abord menti là-dessus : il comptait les marques sur la grille finale, où les
coupes affaiblies ont déjà été retirées, et annonçait donc « 0 glissée hors d'un
vers » alors que trente-neuf coupes avaient été jugées, cinq déplacées et treize
retirées. Le compte se fait maintenant là où la règle s'applique. Sur le montage
test : **39 jugées, 5 glissées, 13 retirées par le budget, 0 restée dans un vers**.

### Le sens d'un plan, et pourquoi il vient du runner

Le raccord cinétique était dans le barème et ne servait à rien : aucune source ne
dit dans quel sens un plan bouge.

**Le Worker ne peut pas le mesurer.** Il lit des en-têtes ; il n'a ni ffmpeg ni
décodeur, et les vecteurs de mouvement d'un H.264 sont derrière un décodage
entropique qu'on ne fait pas en trente secondes de processeur. Le runner, lui, a
ffmpeg et tient déjà les fichiers quand il rend : il mesure chaque rush — huit
images par seconde réduites à 32 × 18 en gris, et pour chaque paire le décalage
qui superpose le mieux — puis écrit le résultat dans la fiche de `/api/cles`
(`PUT`, gardé par le code du coffre). Soixante à cent soixante millisecondes par
plan.

C'est le mouvement **apparent**, pas l'intention : quand la caméra suit un
personnage qui court à droite, c'est le décor qui file à gauche et la mesure dit
« gauche ». Ce n'est pas une erreur pour ce qu'on en fait — la règle parle de ce
que l'œil poursuit, et l'œil poursuit ce qui bouge sur l'écran.

**L'écriture dépend du secret `AMVAUTO_CODE`** du dépôt — le même code de coffre
qui sert à déposer dans le grenier. Sans lui, le runner saute la mesure et le dit
dans son journal : le rendu aboutit, mais le catalogue ne se réchauffe jamais et le
raccord cinétique reste muet pour toujours. C'est la seule condition de
fonctionnement du pilier, et elle est invisible depuis l'application.

**La première génération sur une série ne trouve aucun sens** et monte comme
avant ; le premier rendu réchauffe le catalogue. Mesuré, fiche connue contre fiche
muette : 18 prolongements de flux contre 2 inversions, contre 5 contre 5 sans le
sens. L'inversion reste réservée aux crêtes — deux forces qui se font face, c'est
le choc.

La fiche n'est plus servie `immutable` pour un an : un enrichissement n'arriverait
jamais chez le visiteur. Un jour de cache, une semaine de sursis.

### Le rendu brut, et l'harmonisation des teintes

**Le rendu ne pose plus un seul effet.** Un rush de sakuga est monté tel qu'il a
été dessiné : vitesse native, cadrage natif. Quatre effets procéduraux ont vécu
ici, tous mesurés, tous validés, tous retirés :

| Ce qui a été retiré | Ce que c'était |
|---|---|
| l'éclair d'impact | une image blanche substituée à la première image du plan |
| la micro-secousse | 5 % de zoom et 3 px de déplacement, trois images (125 ms) |
| la rampe de vitesse | 0,65× sur l'anticipation, 1,8× sur le coup, l'impact à l'image |
| la pulsation | un stroboscope d'une image sur les roulements de percussion |

Ils marchaient — la durée de sortie ne bougeait pas d'une image, la rampe trouvait
le pic à l'image près. **Ce n'est pas pour un défaut technique qu'ils partent.** Du
zoom numérique et du ré-échantillonnage temporel posés sur de l'animation dessinée
à la main la dénaturent : un animateur a décidé de la vitesse de son geste, et la
rejouer à 0,65× efface ce qu'il a fait. Leur mise au point est racontée dans
[HISTORIQUE.md](HISTORIQUE.md).

**Les marques sont parties avec eux.** La feuille de route envoyée au runner
portait `eclair`, `pic` et `pulsations` ; ces trois champs ont été retirés en même
temps que les filtres qu'ils commandaient. Transmettre une consigne que personne
n'exécute n'est pas inoffensif : à la relecture, ça se lit comme une intention à
honorer. Ce que la feuille de route contient est ce que le rendu fait — une
adresse, deux bornes, un nom, une famille, une correction de couleur.

**Ce qui reste mesuré dans la page, en revanche, l'est toujours** : les crêtes et
les roulements décident des IMAGES qu'on montre, pas du traitement qu'on leur
applique. Une crête à 85 % de la frappe la plus forte appelle un plan de la famille
*choc* et taille sa fenêtre autour du coup ; un roulement de doubles croches tient
le plan au lieu de le hacher. Cette frontière est exactement celle qui a été
demandée, et le banc la tient des deux côtés : `rendu.mjs` vérifie que la feuille
de route ne commande aucun effet **et** que `tools/rendu.py` ne sait plus écrire
`zoompan`, `drawbox`, `setpts`, `brightness=` ni `geq`.

**Un seul survivant, et il ne touche ni le cadre ni la vitesse.**

Un AMV monte côte à côte un cut de 2003 — contraste mou,
couleurs délavées — et une séquence de 2024 contrastée et saturée. À la coupe, ça
saute. Un filtre global sur le master ne corrige pas ça : il déplace tout le monde
sans rien rapprocher. On mesure donc chaque rush (luminance, contraste,
saturation, sur quelques images à 48 × 27), on prend la **médiane** du montage
comme cible — pas la moyenne, un seul plan de nuit noire éclaircirait tout le
reste — et chacun reçoit une correction bornée qui parcourt deux tiers du chemin.

| Étendue entre plans | Avant | Après |
|---|---|---|
| luminance | 20,2 | **11,2** |
| contraste | 37,7 | **26,6** |
| saturation | 72,7 | **54,6** |

Bornée exprès : un plan volontairement sombre reste sombre, et l'étendue ne tombe
pas à zéro. On rapproche, on n'uniformise pas — et les bornes le disent :

| | Plancher | Plafond |
|---|---|---|
| luminance (`brightness`) | −0,06 | +0,06 *(soit ±15 sur 255)* |
| contraste | ×0,90 | ×1,14 |
| saturation | ×0,88 | ×1,16 |

Un plan déjà au milieu ne reçoit aucun filtre du tout : poser un `eq` neutre
coûterait une passe de calcul et arrondirait des pixels pour rien.

L'archive DaVinci ne la reçoit pas : elle livre les rushs tels quels pour qu'on
puisse reprendre le montage. Un étalonnage est un choix de rendu, pas une donnée
de source — et c'est maintenant le seul choix de rendu qui existe.

**Le compte d'images, lui, est un correctif qui reste.** Il a été trouvé en
mesurant la rampe, mais il n'avait rien à voir avec elle.

Le banc a montré qu'une case de 0,5 s sortait à **onze** images au lieu de douze : `-ss` tombe entre deux images de la
source, ffmpeg part de la suivante, et la dernière n'entre plus dans le `-t`. Sur
cent coupes dont beaucoup sont courtes, ce sont des dixièmes de seconde de dérive
entre l'image et la musique — tout ce que le montage s'échine à éviter, perdu au
dernier moment. On demande maintenant deux images de rab et `-frames:v` tranche au
compte exact.

### L'escalade dramatique

Enchaîner un combat d'arène de l'épisode 12 juste après l'affrontement
apocalyptique de l'épisode 350 désamorce la tension. Ce n'est pas une faute de
rythme, c'est une faute de récit — et c'est celle qui trahit le plus vite un
montage fait par une machine.

La donnée existe : Sakugabooru porte l'épisode dans la référence du post
(« #322 (BD) »). Relevé sur Naruto Shippuden, **127 rushs sur 200** en ont un, de
l'épisode 20 au 495 ; les autres sont des génériques.

| Moment | Vise | |
|---|---|---|
| intro, couplet | 15 % | l'exposition, ce qui installe |
| montée, retombée | 50 % | le milieu de série |
| drop | 80 % | le dernier tiers |
| **dernier drop** | **92 %** | le climax, et il est seul à le viser |
| outro | 85 % | on conclut là où la série conclut |

Un plan sans épisode n'est jamais pénalisé : il n'a pas de place sur l'axe et sert
partout, exactement comme un plan sans crédit d'animateur. Et la pénalité plafonne
à **14 points** — sous les 30 de deux coupes du même épisode, très sous les 100
d'une scène déjà vue : sur un catalogue de six épisodes la préférence s'écrase
d'elle-même, sur un catalogue de génériques il n'y a pas d'axe du tout, et dans les
deux cas le montage couvre sa musique.

Mesuré sur un catalogue de l'épisode 10 au 490 : intro épisode médian 116,
couplet 99, montée 278, drop 417.

### Le raccord chromatique

La teinte vient de `teinte.py`, accumulée en **vecteur** et non en angle moyen :
moyenner des angles est faux — un plan moitié rouge (341°) moitié magenta (38°)
rendrait 190°, c'est-à-dire cyan, la couleur qu'il n'a nulle part. Validé sur des
aplats : rouge 341°, magenta 38°, bleu 99°, cyan 161°, vert 218°, jaune 279°, et
les paires complémentaires tombent à **180,0° exactement**. Un aplat gris n'annonce
aucune teinte.

La règle a trois bandes, et c'est voulu :

| Écart de teinte | Sur un passage calme |
|---|---|
| sous 30° | raccord, récompensé |
| 30° à 120° | on ne se prononce pas — la plupart des coupes tombent là |
| au-delà de 120° | décrochage, payé |

Sur la charnière montée → drop, c'est l'inverse exact : on récompense l'écart
thermique maximal, l'axe chaud-froid étant celui du rouge contre le cyan. Mesuré
sur un montage entier : **28°** d'écart moyen sur les passages calmes contre 65°
sur les passages vifs, là où le hasard donnerait ~120°, et les deux charnières
basculent de 1,47 sur une échelle qui plafonne à 2.

### Les roulements de percussion : on tient le plan

Dans une montée de trap, de phonk ou de drum & bass, les charleys roulent en doubles
croches jusqu'au drop. **On ne coupe pas dessus** : huit plans différents en une
seconde ne se lisent pas, et le résultat est un bruit visuel, pas une accélération.

La page repère les rafales — au moins quatre frappes à moins de 150 ms, sur une
montée, dans la bande la plus fine disponible — et le montage les traverse **sans
ajouter une seule coupe**. Vérifié : 50 coupes avec rafales, 50 sans, à la coupe
près.

Deux garde-fous, et les deux comptent. Un roulement plus long que 2,4 s n'en est
plus un : c'est le motif ordinaire du morceau. Et une rafale n'est reconnue que sur
une **montée** — la même sur un drop est ignorée, ce que le banc vérifie
explicitement.

Le rendu, lui, y posait une pulsation de luminance d'une image. Elle est partie avec
les trois autres effets ; sa mise au point est dans
[HISTORIQUE.md](HISTORIQUE.md#la-pulsation-des-roulements).

### La géographie du combat, et le contraste d'échelles

Enchaîner des plans serrés plonge le spectateur dans l'action sans qu'il sache où
elle se déroule. Un affrontement d'animé s'ouvre sur un **plan d'établissement** —
un décor, une arène, deux silhouettes en pied — puis l'échelle se resserre :

```
large  →  moyen  →  serré
où        engagement  impact et réaction
```

Chaque rush est donc rangé dans **quatre catégories**, et la quatrième est celle
qui manquait :

| | Ce qu'on y trouve |
|---|---|
| `large` | décors animés, foule, paysage, vent, liquide |
| `moyen` | course, combat, vol, mécha, transformation |
| `serré` | acting, dialogue, larmes, cheveux, tissu |
| `effet` | explosions, débris, fumée, faisceaux, impact frames, smears |

**Une explosion n'a pas d'échelle propre.** Elle était rangée avec les décors : un
plan d'explosion passait donc pour un plan d'ensemble, c'est-à-dire pour exactement
ce qu'il ne faut pas quand on cherche à poser un lieu. Les plans d'effet ne
comptent maintenant dans aucune des trois règles — ni comme ancrage, ni comme
monotonie.

**L'ancrage est une règle dure, et c'est la deuxième du projet.** Une préférence
chiffrée ne suffisait pas : le barème est une somme, et quinze points de grammaire
se font racheter par un accord d'énergie et une scène neuve. Mesuré avant
correction : **un bloc d'action sur deux s'ouvrait sur une explosion**, et **trois
gros plans d'action sur neuf** tombaient sans qu'un plan d'ensemble ait été posé
dans les trois coupes d'avant. C'est donc un refus, comme « pas deux fois le même
rush de suite » :

- à l'**entrée d'un bloc d'action**, seul un plan d'ensemble peut ouvrir ;
- **ailleurs dans le bloc**, un gros plan exige un plan large dans les **trois
  coupes** précédentes.

Elle ne s'arme que si le catalogue peut la tenir — un projet sans le moindre plan
large viderait la pioche à chaque entrée de bloc et pousserait le montage vers la
redite, qui coûte bien plus cher au spectateur qu'un cadrage mal posé. La descente
d'échelle, elle, reste une préférence : la deuxième coupe penche vers le moyen, la
troisième vers le serré.

**L'anti-monotonie** vaut partout, y compris hors action : deux plans de même
échelle collés bout à bout aplatissent le relief. La règle existait mais ne
s'appliquait que si les DEUX plans étaient fixes — donc presque jamais dans un
drop.

Mesuré sur le catalogue réel (Naruto Shippuden, 1382 scènes, 104 coupes) :

| | Résultat |
|---|---|
| ouverture des blocs d'action | `large→serré→moyen` et `large→moyen→serré` |
| gros plans d'action sans repère spatial | **0 sur 35** |
| suites de même échelle | **15 %**, contre 36 % attendus de cette distribution au hasard |
| échelles posées | 33 larges · 20 moyens · 49 serrés · 2 effets |

### L'interdiction de recouvrement, et pourquoi elle est absolue

Le défaut que l'utilisateur a rapporté : le même plan exact — mêmes images, même
départ, même action — qui revient quatre ou cinq fois. Mesuré avant correction,
c'était pire : **jusqu'à vingt-six emplois d'un même rush, 46 % de recouvrement
temporel, cent dix-huit paires de fenêtres montrant les mêmes images.**

**La cause.** Le garde-fou existait et ne pouvait pas marcher : il comparait des
instants d'entrée exacts — `rush@12.34`. Deux fenêtres distantes d'un dixième de
seconde passaient toutes les deux. Pire, **un banc validait ce comportement** : il
comptait les « moments distincts » avec la même clé exacte, et affichait 118/118 là
où il y avait deux plans identiques. Un test qui mesure le bug avec l'outil du bug.

**La correction.** On réserve des INTERVALLES et non des instants. Une fenêtre
`[a, z]` posée bannit `[a − 1,5 s ; z + 1,5 s]` pour tout le reste du montage. Et un
rush dont plus aucun intervalle n'est libre est **épuisé** : il sort des candidats
au lieu de rendre une fenêtre déjà vue — sans cette seconde moitié, la première ne
servait à rien.

Quatre tours de choix, et la séparation des deux derniers est ce qui a fait tomber
les dernières redites :

| Tour | Ce qu'il accepte |
|---|---|
| 0 | une scène jamais employée — la règle |
| 1 | une scène déjà employée, sous son plafond, avec un intervalle libre |
| 2 | au-delà du plafond, mais **toujours** avec un intervalle libre |
| 3 | tout, y compris la redite — le dernier recours, et le journal le compte |

Le plafond d'emploi est plus strict que l'interdiction de recouvrement, et les
confondre faisait sauter les **deux** règles d'un coup : le montage rejouait des
images alors qu'il en restait de neuves à trois secondes de là. Le plafond est
d'ailleurs déduit de la source et non figé : un rush de douze secondes porte cinq
fenêtres franchement distinctes, et les employer n'est pas une redite. Restent deux
conditions dures — moins de quatre secondes de source, un seul emploi ; et jamais
deux fois dans le même moment du morceau.

Trois fuites trouvées et bouchées, dont une vicieuse : l'allongement du dernier
plan de chaque section grandissait **après** réservation, et recouvrait alors une
autre coupe du même rush.

| Configuration | Avant | Après |
|---|---|---|
| **cas réel** — 172 scènes, 102 coupes | le défaut rapporté | **0 paire · 102 scènes pour 102 coupes** |
| contraint — 50 rushs, 196 coupes | 67 paires · 27,5 % | ≤ 2 paires · < 2 % |
| insuffisant — 90 s de source pour 180 s | montage qui bégaie sans prévenir | couverture tenue, **et le journal le dit** |

**Une régression de vitesse créée puis corrigée.** Le premier jet balayait la source
par pas d'un quart de coupe pour chaque candidat de chaque coupe : le calcul du
tunnel est passé de 0,2 s à **dix-neuf secondes**. La même question — reste-t-il un
intervalle libre ? — se répond par arithmétique sur les bandes triées, trois ou
quatre comparaisons au lieu de dizaines de balayages. Retour à **312 ms**.

**Deux arbitrages, tous deux au bénéfice de l'anti-redite** : la bascule thermique
de la charnière passe de 1,47 à 0,53 sur une échelle de 2, et le drop se concentre
moins sur la fin de série. Interdire de rejouer un plan interdit aussi de
concentrer le montage sur les mêmes vingt scènes. C'est le bon sens de
l'arbitrage : une redite se voit, une concentration un peu molle ne se voit pas.

### Les bancs

Tout ce qui précède est tenu par des bancs Playwright et Python, hors du dépôt.
La suite en fait tourner **quarante**, soit **638 vérifications** ; ceux du moteur
de montage sont ici, ceux de l'interface dans
[« Le banc d'essai »](#le-banc-dessai). Au dernier passage, **638 sur 638**, aucun
raté :

| Banc | Ce qu'il tient | |
|---|---|---|
| **le rendu brut et la géographie** | | |
| `vfx.py` | l'ABSENCE de secousse, de flash, de rampe et de stroboscope | 22/22 |
| `rendu.mjs` | la feuille de route qui ne commande aucun effet, et un runner qui ne sait plus les écrire | 19/19 |
| `geographie.mjs` | l'ancrage, le gros plan sans repère, la monotonie d'échelle | 23/23 |
| `generique.mjs` | 100 % des sources AnimeThemes strictement sans crédits | 13/13 |
| **la v3.1** | | |
| `antiredite.mjs` | zéro plan identique, zéro recouvrement, et le mur arithmétique | 23/23 |
| `sources-propres.mjs` | ce qui porte du texte, et un plancher qui ne vide pas le catalogue | 27/27 |
| `synchro-interne.mjs` | la pente du mouvement contre l'enveloppe sonore | 17/17 |
| `regard.mjs` | le tiers de l'action, et les charnières masquées | 16/16 |
| **les piliers de la v3.0** | | |
| `escalade.mjs` | l'intro tôt, le climax tard, et un catalogue plat qui tient | 24/24 |
| `teinte-match.mjs` | le raccord de couleur et le clash de la charnière | 21/21 |
| `stutter.mjs` | les rafales trouvées, et aucune coupe ajoutée | 14/14 |
| **les quatre piliers de la v2.1** | | |
| `fil.mjs` | une main, un duel, et un fil introuvable qui ne bloque rien | 20/20 |
| `voix.mjs` | le grave qui ancre, la voix qu'on ne coupe pas | 17/17 |
| `raccord.mjs` | le raccord cinétique, avec et sans le sens | 15/15 |
| **le socle de la v2.0** | | |
| `macro.mjs` | les six moments, ce que chacun refuse | 13/13 |
| `impact.mjs` | la frappe forte, la retombée, la collision, les crêtes | 13/13 |
| `regimes.mjs` | les cinq régimes, au catalogue et au choix | 10/10 |
| `entrees.mjs` | l'animé unique ou mixte, la trame, le catalogue pauvre | 16/16 |
| **ce qui ne doit jamais régresser** | | |
| `vitesse.mjs` | trois minutes de musique, soixante rushs, le temps de calcul | 4/4 |
| `fuite.mjs` | trois générations sans rien qui s'empile | 14/14 |
| `couverture.mjs` | toute la musique, quoi qu'il arrive | 9/9 |
| `mp4.mjs` | Annex B, AVCC, boîtes | 22/22 |
| `resolve.py` · `davinci.mjs` | couleurs FCP7, marqueurs, EDL ; l'archive qui part | 23/23 + 6/6 · 13/13 |
| `journal.mjs` · `panne.mjs` | le rapport, et ce qu'il dit quand ça rate | 32/32 · 15/15 |
| `page-rendu.mjs` | la page d'un rendu, sa fiche et ses boutons | 19/19 |

### Ce que tout ça coûte en temps

La consigne est de deux secondes de calcul. Relevé sur un montage test réel —
Naruto Shippuden, 172 scènes en pioche, 2 min 30 de musique, 105 coupes, duel de
deux mains, paroles minutées et grosse caisse :

| | |
|---|---|
| recherche au catalogue | 0,6 s (réseau) |
| lecture des en-têtes, 122 fiches | 1,9 s (réseau, `/api/cles` gardé dans R2) |
| **construction du montage** | **0,2 s** |
| total de bout en bout | 2,7 s |

Relevé de nouveau après les quatre chantiers de la v3.0, sur le même montage :
**2,7 s** de bout en bout, 108 coupes, 100 % de couverture. Les quatre règles
ajoutées n'ont pas coûté un dixième mesurable — elles lisent des données déjà là.

Et de nouveau après la géographie du combat, sur le même montage : **1,6 s** de
bout en bout, **185 ms de construction**, 104 coupes, 150 s sur 150. L'ancrage
spatial est un refus, donc il ÉLAGUE la pioche au lieu de l'alourdir : une échelle
se lit sur les étiquettes déjà chargées, et un candidat refusé n'est pas noté.

Le calcul pur, mesuré sans réseau sur trois minutes de musique et soixante rushs :
**348 ms** pour 106 coupes et cent pour cent de couverture. Les quatre évolutions
de la v2.1 n'y ajoutent rien de mesurable — la grille est parcourue une fois de
plus, et la recherche du grave se fait par dichotomie.

## Comment l'explorateur est devenu un tunnel

L'outil a d'abord été autre chose : un explorateur qu'on manœuvre — on cherche une
série, on parcourt des dossiers, on pose des plans sur une piste, on coupe. C'était
un banc de montage, et il marchait ; [HISTORIQUE.md](HISTORIQUE.md) en garde le
détail. Mais ce n'est pas ce qu'on vient faire : on vient faire un AMV sur un
morceau qu'on aime.

L'application a donc été retournée. **Une musique entre, un AMV sort.** Cinq blocs
à la suite sur une seule page — la musique, la trame, l'animé, la génération, ce
qu'il y a à publier — et l'on descend sans naviguer. L'explorateur et l'atelier
n'ont plus d'onglet ; leur code vit toujours, parce que c'est lui qui pose les
coupes et lit les fichiers, mais on ne l'ouvre plus à la main.

### Ce que le tunnel fait de la musique

Le tempo, les sections et leur énergie se lisent sur l'appareil, sans serveur —
la mise au point de cette lecture est dans [HISTORIQUE.md](HISTORIQUE.md). Ce que
le tunnel ajoute, c'est qu'on **nomme l'émotion de chaque passage** : calme,
émotion, tension, élan, action. L'étiquette choisie
décide de l'énergie de la section, donc du rythme des coupes, donc des scènes
qu'on ira chercher.

Les **paroles** sont transcrites par Whisper sur Workers AI (`/api/ecoute`), par
tranches de quatre-vingt-dix secondes et hors du chemin critique : l'analyse rend
la main dès que le rythme est lu, et les vers arrivent après. Ils entrent dans le
choix des scènes par un lexique — « feu », « courir », « pleurer » deviennent des
étiquettes que le montage cherche dans les tags des plans.

Chaque passage s'écoute : un bouton par ligne de la trame, et **une barre de
lecture unique en bas de l'écran**, au-dessus de la barre d'onglets. Elle porte le
titre, la position, un curseur pour viser, pause, avance et recul de dix secondes.
Un seul son à la fois dans toute l'application — un extrait qui continue sur une
autre page, on ne sait plus d'où il vient ni comment l'arrêter.

### Choisir les scènes : quatre critères plutôt qu'un score

Le score de Sakugabooru dit « belle animation ». Il ne dit pas si le plan convient
à ce passage-ci. Quatre choses s'y ajoutent :

- **le mouvement**, lu dans le fichier : la taille de chaque image rapportée à sa
  surface, en milli-octets par pixel, échantillonnée toutes les demi-secondes.
  Une image lourde est une image qui bouge. L'écart-type de cette courbe distingue
  un panoramique régulier d'un impact ;
- **l'expression et le décor**, par les tags, pour les passages calmes ;
- **les paroles** du passage, par le lexique ;
- **le contraste** avec la coupe précédente, pour que deux plans voisins ne se
  ressemblent pas.

La courbe de mouvement et les images-clés sont lues **une fois pour tous les
appareils** par `/api/cles`, gardées dans R2, et rendues en quelques centaines
d'octets de JSON au lieu des quatre-vingts kilo-octets d'en-tête que chaque
téléphone lisait lui-même.

### AnimeThemes est revenu dans la pioche, en apprenant à lire le WebM

Les openings sont la meilleure matière qui soit pour un AMV — cadrés pour la
musique, 1080p, sans crédits. Ils étaient pourtant écartés : le lecteur d'en-têtes
ne savait lire que du MP4, donc aucune durée, donc aucune coupe. `public/webm.js`
lit désormais l'EBML — `Info/Duration`, `Tracks/PixelWidth`, et les `Cues` en fin
de fichier qui donnent les images-clés. Vérifié sur l'ED1 de Chainsaw Man :
91,175 s, 148 images-clés, 1920 × 1080.

Ils forment leur propre lot dans la recherche : le serveur les rend en dernier, et
l'entrelacement les noyait. Huit par génération au plus — Naruto en a cent
quarante-sept, et les lire tous épuisait le budget de lecture avant d'avoir touché
aux cuts.

**Le « sans crédits » est une condition d'entrée, et ce n'en était pas une.** Un
générique crédité porte les noms du staff en surimpression : dans un AMV de
concours, c'est du texte à l'écran, et le montage est jugé avant qu'on regarde le
rythme. Le NC n'était pourtant qu'un **bonus de quinze points** au barème de
qualité — donc un générique crédité en 1080p Blu-ray passait devant un sans-crédits
en 720p web, et entrait dans la pioche. **Un tri n'est pas un filtre.**

Maintenant : une version qui n'a aucun fichier `nc: true` est écartée entière, et
un générique qui n'existe qu'avec crédits n'entre pas. Le fichier de MONTAGE — le
léger, celui qu'on regarde pendant qu'on monte — se choisit lui aussi parmi les NC ;
c'était la dernière porte par laquelle du texte entrait, et `montageCredite` la
signalait au lieu de l'interdire. Le bonus de quinze points a disparu du barème :
depuis que tout ce qui arrive en porte un, quinze points pour tout le monde ne
trient rien.

Vérifié en direct sur Naruto Shippuden : **8 génériques servis, 8 NC, 0 avec
crédits**. Et au banc, sur un catalogue fabriqué exprès — un générique qui existe
dans les deux versions, un qui n'existe qu'avec crédits, un qui a deux NC de poids
différents : `generique.mjs` tient les sept cas.

### Le montage se cale sur la grammaire d'un générique

Un opening ne coupe pas au hasard : il pose une phrase, accélère, et retombe. Le
montage fait pareil — un plan d'ouverture tenu 3,2 s, une rampe qui raccourcit
(1,15 → 0,85 → 0,62 → 0,45 → 0,32 fois la durée de base), un pas de coupe par
énergie (4 temps en calme, 1 en action), un plancher à 0,28 s, et un plan de
clôture tenu. Mesuré sur un cas : ouverture 4,5 s, calme 1,46 s par coupe, refrain
0,50 s.

**Et l'AMV dure toute la musique.** Il sortait parfois cinquante secondes sur trois
minutes : l'unicité des scènes était une règle dure, donc le montage s'arrêtait à
court de matière. Elle est devenue une préférence — seul le même *moment* d'une
scène est interdit, la même scène peut revenir ailleurs. Mesuré : 12 scènes pour
180 s de musique, 100 % couvert.

## La veille : ce qu'on a le droit d'employer

Un onglet qui liste des morceaux sous licence libre, classés par ce que les gens en
prennent **cette semaine**. Chaque ligne s'écoute — même barre de lecture que
partout ailleurs — et se pose directement dans le tunnel, à l'étape 1.

## Le rendu déporté, et ce qu'il en revient

Le rendu ne se fait plus sur le téléphone. La feuille de route part sur un runner
GitHub (`tools/rendu.py`), qui télécharge les rushs, coupe, assemble, encode, et
**dépose le fichier dans le grenier** (R2) d'où l'application le reprend. Le jeton
GitHub est un secret du Worker : le navigateur ne présente que son code de coffre.

Le runner porte tout ce qui demande un décodeur, parce qu'il est le seul endroit
qui ait ffmpeg. Il découpe au cadre commun, il **harmonise les teintes vers la
médiane du montage**, il assemble et il encode — et c'est tout ce qu'il fait à
l'image. Il **mesure** en revanche le sens de déplacement, la teinte dominante et
le tiers d'action de chaque rush, pour les réécrire dans la fiche de `/api/cles` :
c'est ce qui réchauffe le catalogue pour les générations suivantes.

La feuille de route est le seul contrat entre les deux. Le téléphone n'envoie que
ça — quelques kilo-octets de JSON — et chaque plan y porte :

| Champ | Ce qu'il déclenche |
|---|---|
| `video`, `entree`, `sortie` | le découpage, et rien d'autre |
| `nom`, `famille` | le nom de piste et la couleur de clip dans DaVinci |

**Et rien de plus.** Le contrat portait trois champs d'effet — `eclair`, `pic`,
`pulsations` — retirés avec les filtres qu'ils commandaient. Ce que la feuille de
route contient est maintenant ce que le rendu fait, ce qui est la seule façon
qu'elle reste lisible ; `rendu.mjs` le vérifie.

### Une page par rendu, et l'accueil garde le sien

L'Historique n'a plus qu'une liste : les **rendus**. La partie « montages » —
ouvrir, ranger, renommer, supprimer — n'avait plus d'objet depuis que le tunnel
fabrique son montage par musique.

Une ligne mène à la **page du rendu** : la vidéo en pleine largeur, « Télécharger
en MP4 », l'export DaVinci, la fiche à publier dépliée, et la suppression sous un
trait. Le rendu qui vient d'être fait, lui, se pose **sur l'accueil**, à l'endroit
où on l'a lancé : il n'y a qu'un rendu à cet endroit, il n'a pas à se choisir dans
une liste.

Le grenier ne garde que les 80 premiers caractères du nom de projet dans ses
métadonnées — 120 depuis —, ce qui faisait qu'un montage au titre long n'était
jamais reconnu : ni son export DaVinci, ni sa fiche. Le rapprochement se fait
maintenant sur ce qui a été gardé, et le nom affiché est celui du montage, entier.

### L'export DaVinci Resolve

Un rendu se publie ; il ne se remonte pas. `tools/projet.py` fabrique donc une
archive à ouvrir sur un ordinateur : un **XMEML** et une **EDL CMX 3600**, les
rushs découpés avec une seconde de poignée de chaque côté, la musique, et un
LISEZ-MOI. Chaque `pathurl` est vérifié présent dans l'archive avant de la
sceller. Le téléphone n'envoie que la feuille de route, quelques kilo-octets.

## Prévenir quand c'est prêt

Le rendu prend deux à quatre minutes. Rien ne le disait quand il aboutissait : le
suivi mourait au premier redessin de l'écran — `if (!document.body.contains(etat))`
l'arrêtait dès que le nœud d'affichage quittait la page.

La course est désormais suivie **pour elle-même**, dans un registre écrit sur
l'appareil : l'écran s'y branche s'il est là, sinon le suivi continue, et il
survit à un rechargement. À la fin, une bannière et la pastille de l'icône.

Mais une page fermée n'exécute plus rien, et c'est précisément le moment où l'on
veut être prévenu. **Le serveur pousse donc la notification lui-même**, au dépôt du
fichier dans le grenier : signature VAPID, message chiffré pour l'appareil
(RFC 8291, aes128gcm, écrit à la main — il n'y a pas de bibliothèque dans un
Worker). La clé publique est dans `wrangler.toml`, sa moitié privée est un secret.
Les abonnements sont rangés sous le code du coffre, six par code, six mois ; un
appareil que le service d'acheminement déclare mort (404, 410) est retiré sur
place. Taper la bannière ouvre la page du rendu, pas seulement l'application.

Ce qui continue et ce qui dort est dit à l'écran, au moment où le rendu part : le
fichier se fabrique sur GitHub et continue écran verrouillé ; la notification, elle,
dépend de l'abonnement, et la page ne promet pas ce qu'elle ne peut pas tenir.

## Le journal : un rapport qu'on peut donner à lire

« Aucune scène trouvée » ne dit pas si la requête est partie, si elle a mis vingt
secondes, si le serveur a répondu 502 ou si le téléphone était hors ligne — ce sont
pourtant les quatre seules réponses utiles.

Sous le bouton qui lance la génération, un journal s'écrit ligne à ligne, chacune
horodatée **depuis le début** et accompagnée de ses chiffres en `clé=valeur` — le
relevé complet d'une génération est à
[« Ce que le journal montre »](#ce-que-le-journal-montre-pendant-la-génération).

Ce qui le rend collable ailleurs : `fetch` est enveloppé une fois pour toutes, donc
chaque appel au serveur est compté, minuté et pesé sans qu'aucun appelant ait à y
penser ; les lignes tiennent en mémoire jusqu'à trois cents, les appels jusqu'à
quatre-vingts ; et le code du coffre est masqué, parce qu'un rapport est fait pour
être collé dans une conversation.

Une phrase qui mentait est tombée avec : « Naruto est introuvable sur Sakugabooru »
s'affichait aussi quand le catalogue rendait 502. On ne répare pas un serveur en
corrigeant l'orthographe d'un nom.

C'est ce rapport qui a remplacé la feuille « Setting » — vingt paragraphes de
diagnostic qu'il fallait copier pour en faire quelque chose. Le bouton a disparu de
l'en-tête ; le journal du lecteur, lui, a rejoint le rapport, et la sauvegarde a
pris sa porte dans Infos, sans quoi un appareil neuf n'aurait plus aucun chemin vers
ses montages en ligne.

## Infos est une page de sections

C'étaient quatre pastilles en haut d'un panneau : elles changeaient le contenu sous
elles sans qu'on ait l'impression d'aller quelque part, et la barre débordait sur un
téléphone. Deux lignes pleine largeur avec leur chevron — **Général** et **Aide** —,
une page qui s'ouvre, un retour qui ramène. Stockage et Compte n'y sont plus
offerts : le premier ne servait qu'à regarder des chiffres, le second se fait par le
bouton de sauvegarde.

**Revenir en arrière est un seul geste**, partout le même : le mot « Retour », le
vert de ce qui compte ailleurs, quarante-huit points de haut. Il y avait deux
libellés différents et deux boutons secondaires de trente-quatre points.

## Le banc d'essai

Chaque correction a son banc, en Playwright, dans un dossier hors du dépôt. Ils tournent sur la page servie en local et mesurent plutôt qu'ils ne
supposent : les écarts en points, les statuts HTTP, le contenu du presse-papier, le
nombre de navigations. Quelques-uns, et ce qu'ils gardent :

| Banc | Ce qu'il tient |
|---|---|
| `journal.mjs`, `panne.mjs` | le rapport, et ce qu'il dit quand le catalogue rend 502 ou que les en-têtes sont illisibles |
| `prevenir.mjs`, `pousse.mjs`, `pousse-route.mjs` | la notification côté page, le chiffrement déchiffré comme un navigateur le ferait, l'inscription et ce qu'elle refuse |
| `maj.mjs`, `recharge.mjs` | la mise à jour au rideau, et la boucle de rechargement empêchée |
| `couverture.mjs`, `generique.mjs` | l'AMV qui dure toute la musique, et la grammaire du générique |
| `page-rendu.mjs`, `accueil.mjs`, `espace.mjs` | les pages de rendu, les écarts mesurés au pixel |
| `davinci.mjs` | la feuille de route, le flux demandé, la fiche qui voyage |
| `macro.mjs`, `impact.mjs`, `regimes.mjs` | les six moments, la frappe et la crête, les cinq régimes |
| `entrees.mjs`, `fuite.mjs` | ce qui entre dans le tunnel, et rien qui s'empile sur trois générations |
| `vfx.py`, `rendu.mjs` | l'absence totale d'effet : ni zoompan, ni drawbox, ni setpts, ni stroboscope — et une feuille de route qui n'en commande aucun |
| `geographie.mjs`, `stutter.mjs` | le plan d'ensemble avant le gros plan, les rafales qui n'ajoutent pas une coupe |
| `escalade.mjs`, `teinte-match.mjs` | le montage qui monte avec la série, la couleur qui se prolonge ou décharge |

Trois pièges de ce banc-là, pour qui le reprendra : la dernière route Playwright
enregistrée gagne, donc la générique se pose en premier ; les médias servis sur la
même origine sont interceptés par le service worker de l'application, donc ils
vivent sur un autre port ; et une réponse média doit porter `accept-ranges` et un
206, sinon aucun lecteur ne s'en sert.

## Deux pièges rencontrés, et leur contournement

- **Des tags de série sont masqués.** `mob_psycho_100_series` existe sur le site mais
  la recherche renvoie 0 post ; les cuts sont sous des tags déformés
  (`mօb_psycho_100_iii`, avec un homoglyphe, ou `robert_psychosis_onehundred_s2`).
  D'où le catalogue de raccourcis dans `series.py`, et la résolution qui essaie
  plusieurs candidats jusqu'à en trouver un qui répond réellement.
- **Le score Sakugabooru n'est pas comparable d'une série à l'autre** (10 votes sur un
  animé confidentiel, 4000 sur un blockbuster). Il est donc normalisé en logarithme
  relatif au lot examiné, pas utilisé en valeur absolue.

## L'historique complet

Ce README décrit l'outil tel qu'il est. Pour l'historique complet des itérations,
des mesures comparatives et de l'ancien atelier de montage manuel — piste multipiste,
pellicule d'imagettes, poignées de rognage, zoom au pincement —, voir
**[HISTORIQUE.md](HISTORIQUE.md)**. Cinq mille lignes de journal de bord y sont
sanctuarisées : ce qui a été essayé, ce qui a été mesuré, et pourquoi ça a été gardé
ou retiré.

## Licence et contenu

Les extraits appartiennent à leurs studios. L'outil ne réhéberge rien : il pointe vers
les fichiers servis par Sakugabooru.
