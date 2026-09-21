# amvauto

Tu donnes un nom d'animé, l'outil te sort les rushs — les cuts sakuga de la série —
classés selon ce qu'ils valent **au montage** d'un AMV, avec les liens MP4 directs.

Trois sources alimentent l'outil :

| Source | Ce qu'elle apporte | Format |
|---|---|---|
| [Sakugabooru](https://www.sakugabooru.com) | les cuts : plans d'animation isolés d'un épisode, avec leur animateur | MP4/WebM |
| [AnimeThemes](https://animethemes.moe) | openings et endings, toutes versions confondues (v2, version TV, Blu-ray), souvent en 1080p sans crédits | WebM |
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

> **Ce que l'outil est aujourd'hui — v2.0, « moteur d'impact ».**
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

Le Worker sert l'interface **et** relaie l'API : Sakugabooru ne renvoie aucun en-tête
CORS, une page statique ne peut donc pas l'appeler directement. Les vignettes et les
MP4, eux, sont chargés en direct par le navigateur — `<img>` et `<video>` échappent au
CORS — donc le Worker ne relaie que du JSON et reste très léger.

Routes :

| Route | Rôle |
|---|---|
| `GET /api/tree?anime=frieren` | arborescence arc → ambiance → plans |
| `GET /api/rushes?anime=frieren&mood=combat&top=24` | liste plate, classée |
| `GET /api/suggest?q=chain` | complétion sur le catalogue |
| `GET /api/moods` | ambiances disponibles |
| `GET /api/version` | horodatage du déploiement |

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
  sakuga.js          accès à l'API, pagination, filtrage
  animethemes.js     openings et endings (WebM, 1080p sans crédits)
  scoring.js         barème d'utilisabilité et ambiances
  naming.js          nom des plans et détection des arcs
  series.js          raccourcis de séries (généré depuis series.py)
  scene.js           fiche d'une scène
  cles.js            durée, images-clés et courbe de mouvement d'un fichier
  media.js           relais à liste blanche pour les octets des rushs
  extrait.js         extraits calculés côté serveur
  coffre.js          sauvegarde des montages (KV)
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
  projet.py          archive DaVinci Resolve (XMEML + EDL + sources)
.github/workflows/   rendu.yml, projet.yml
wrangler.toml        config de déploiement
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
        ├─ paroles (Whisper, /api/ecoute)               hors chemin critique
        │
  trame : une émotion par passage                        posée par l'utilisateur
        │
  recherche  ──►  /api/rushes  (Sakugabooru + AnimeThemes)
        │         par ambiance : combat, vitesse, effets, acting, decor
        │
  lecture   ──►  /api/cles  (durée, images-clés, courbe de mouvement)
        │
  ordonnanceur ─► grille de coupes ─► choix de scène ─► fenêtre dans la scène
        │
        ├─► rendu MP4        GitHub Actions + ffmpeg ─► grenier (R2)
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

### L'éclair d'impact

Sur les crêtes servies par un choc, le rendu pose **une image blanche sur la
première image du plan** — deux sur cinquante coupes, par construction.

Elle **remplace** l'image, elle ne s'insère pas. Une image ajoutée décalerait
tout ce qui suit d'un vingt-quatrième de seconde, et vingt éclairs dans un
morceau de trois minutes feraient presque une seconde de déphasage — exactement
ce que tout le reste du montage s'échine à éviter. Un filtre en fin de chaîne
ffmpeg suffit, sans coût d'encodage :

```
drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill:enable='lt(t,0.0417)'
```

L'archive DaVinci, elle, ne flashe pas : elle livre les rushs tels quels, pour
qu'on puisse reprendre le montage. Un éclair est un choix de rendu, pas une
donnée de source.

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

```
+0.0s  Génération demandée · Chainsaw Man · 45 s · instrument tempo
+0.3s  Pioche : 52 scènes · 44 sakugabooru, 8 animethemes · 28 coupes attendues
+1.1s  Scènes lues : 52/52 durées · 52 courbes · 0 illisibles
+1.1s  [0:00–0:15] Intro — ambiance et décors · 9 coupes
+1.1s  [0:15–0:30] Couplet — acting et narration · 9 coupes
+1.1s  [0:30–0:45] Drop — impact sakuga · 20 coupes · 2 éclairs
+1.1s  36 coupes · 0 à cheval sur 36 mesurées · 2 éclairs d'impact
```

« Copier le rapport » y ajoute l'appareil, la version, l'état du réseau, la
demande, les appels au serveur résumés par route — et listés un par un quand ils
ont raté — et ce qui a alerté, en tête. Le code du coffre y est masqué.

### Ce qui n'a pas été touché, et pourquoi

Le **moteur d'aperçu** — vivier de lecteurs, moniteur, transport, environ mille
cinq cents lignes — reste en place. Il n'est plus atteignable depuis l'écran,
mais le rendu MP4 dans le navigateur s'en sert : c'est lui qui pose les rushs sur
un lecteur et recopie la toile. Le découpler demanderait de réécrire le rendu,
ce qui est une refonte et non un nettoyage — et le budget de lecteurs
(trois sur WebKit, quatre ailleurs, deux plans d'avance) a été mesuré contre les
micro-coupures sur iOS.

### Les bancs

Tout ce qui précède est tenu par des bancs Playwright et Python, hors du dépôt.
Au dernier passage :

| Banc | Ce qu'il tient | |
|---|---|---|
| `macro.mjs` | les six moments, ce que chacun refuse | 13/13 |
| `impact.mjs` | la frappe forte, la retombée, la collision, les éclairs | 13/13 |
| `entrees.mjs` | l'animé unique ou mixte, la trame, le catalogue pauvre | 16/16 |
| `regimes.mjs` | les cinq régimes, au catalogue et au choix | 10/10 |
| `fuite.mjs` | trois générations sans rien qui s'empile | 14/14 |
| `rendu.mjs` | le rendu sans l'atelier : 53 images, un MP4 écrit | 12/12 |
| `mp4.mjs` | Annex B, AVCC, avcC non vide, boîtes du fichier | 22/22 |
| `resolve.py` | couleurs FCP7, marqueurs de séquence, EDL, éclair | 23/23 + 6/6 |
| `journal.mjs` · `panne.mjs` | le rapport, et ce qu'il dit quand ça rate | 32/32 · 15/15 |
| `davinci.mjs` · `page-rendu.mjs` | l'archive qui part, la page du rendu | 13/13 · 19/19 |
| `couverture.mjs` · `generique.mjs` | toute la musique, la grammaire du générique | 9/9 · 6/6 |

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
horodatée **depuis le début** et accompagnée de ses chiffres en `clé=valeur` :

```
+0.3s  Pioche : 55 scènes · 47 sakugabooru, 8 animethemes · 28 coupes attendues
       sources=sakugabooru:47/animethemes:8 avecFichier=55/55 parScene=2.0
+1.1s  Scènes lues : 55/55 durées · 55 courbes · 0 illisibles
       en=727ms arretA=assez lu refusees=0
+1.1s  Passage 2 (tension) : 9 coupes sur 15 s  de=15s a=30s energie=1 couvert=16s
```

« Copier le rapport » y ajoute l'appareil, la version, l'état du réseau, la demande
(musique, trame, animé), **les appels au serveur** — résumés par route, et listés un
par un quand ils ont raté — et ce qui a alerté, en tête. `fetch` est enveloppé une
fois pour toutes ; le code du coffre est masqué, parce qu'un rapport est fait pour
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
| `macro.mjs`, `impact.mjs`, `regimes.mjs` | les six moments, la frappe et l'éclair, les cinq régimes |
| `entrees.mjs`, `fuite.mjs` | ce qui entre dans le tunnel, et rien qui s'empile sur trois générations |

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
