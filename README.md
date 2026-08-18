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

## Ce que l'outil fait

1. **Résout la série.** « frieren », « csm », « mob psycho » → le bon tag Sakugabooru.
2. **Ratisse large.** Jusqu'à 2000 cuts par série, paginés par vagues de cinq requêtes —
   ce qui donne 1817 rushs sur One Piece, 1494 sur Naruto Shippuden, 1869 sur Gundam.
3. **Ne garde que le montable.** Vidéos uniquement : les genga, layouts et scans de
   production sont écartés, ce n'est pas de l'image exploitable en timeline.
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
8. **Monte le projet** : les plans retenus vont dans un ou plusieurs **projets**, conservés
   dans le navigateur. L'onglet Projet est un banc de montage — prévisualisation en haut,
   piste en bas à échelle continue réglée au pincement, avec une règle graduée et le timecode
   à gauche, chaque bloc large comme sa durée et rempli de vraies images du plan — la
   pellicule ne peint que la partie visible et sa densité suit le zoom, jusqu'à une image
   par graduation (24 i/s) —, tête de lecture glissable au doigt, une voie pour une musique
   ou un SFX pris sur l'appareil, **la tête qui se pose partout où le doigt touche la piste**
   et la suit — avec défilement automatique quand le doigt atteint un bord —, et
   **enchaînement automatique des plans** (le suivant est mis en cache pendant que le
   courant se joue). Clic sur un bloc pour s'y placer. **Déplacer un plan est un mode qui
   s'active**, verrouillé par défaut : changer l'ordre des scènes est le geste le plus facile
   à faire par accident, et le plus coûteux à défaire quand on ne s'en aperçoit pas. Le même
   interrupteur gouverne le rognage par les bords : un seul mode pour les deux gestes qui
   touchent aux plans, et hors de ce mode la piste ne sert qu'à naviguer.

9. **Coupe les plans.** Dans le mode modification, les bords du bloc sélectionné se tirent
   au doigt pour rogner l'entrée et la sortie — hors de ce mode ils n'existent pas, sans quoi
   les 14 px de chaque bord rognaient le plan alors qu'on croyait déplacer le curseur ; deux boutons ramènent le début ou la fin sur la tête de lecture,
   ce qui reste praticable à fort zoom là où un glissé demanderait des milliers de pixels ;
   un coup de ciseaux coupe le plan sous la tête en deux morceaux indépendants — le même
   rush peut donc servir plusieurs fois, coupé différemment. Rien n'est réécrit : la coupe
   déplace deux bornes dans le fichier source, elle est donc instantanée et s'annule sans coût.
   Ces bornes partent dans l'EDL comme points d'entrée et de sortie source, si bien que
   Premiere ou DaVinci retrouve exactement le même découpage.

   La durée de chaque plan est lue dans le fichier lui-même — aucune source ne l'expose —
   ce qui permet le chronométrage et l'export d'une **conduite de montage EDL** (CMX 3600,
   24 i/s) ouvrable dans Premiere, DaVinci ou Final Cut. Export secondaire en `.txt`, ou
   copie des liens pour un téléchargeur.

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
Les deux mécanismes de mise à jour ne se doublonnent plus non plus : quand un service worker
pilote la page, c'est lui qui recharge, et la comparaison de version se contente d'un bandeau au
lieu de recharger à son tour.

La barre d'onglets ne porte que des icônes, à la taille d'autoshort (29 px dans une barre de
54) : un dossier, une pellicule et un « i » disent
déjà ce que les mots répétaient, et la barre y gagne en hauteur utile.

### CLI

```bash
python -m amvauto "chainsaw man"
python -m amvauto frieren --mood combat --top 15
python -m amvauto "jujutsu kaisen" --json > rushes.json
```

Aucune dépendance : bibliothèque standard uniquement.

## Structure

```
amvauto/           moteur Python (client API, scoring, CLI)
worker/src/        Worker Cloudflare
  sakuga.js        accès à l'API, pagination, filtrage
  scoring.js       barème d'utilisabilité et ambiances
  naming.js        nom des plans et détection des arcs
  series.js        raccourcis de séries (généré depuis series.py)
public/index.html  explorateur
wrangler.toml      config de déploiement
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
« teinte » pas une toile — on peut donc en relire les images, ce qui rend la bande
d'imagettes fiable. Les octets passent par `/api/media`, un relais à liste blanche stricte
(Sakugabooru, AnimeThemes) : les sources n'autorisent pas la lecture directe de leurs
octets par une page, et un relais ouvert servirait à n'importe qui.

L'importation se fait un fichier à la fois, le plan courant d'abord, avec l'avancement
affiché sur le bloc. Un plan non encore importé reste jouable en distant, avec ses limites.

## Comment la lecture est construite

L'aperçu n'est pas un lecteur : c'est un **moniteur** dessiné image par image sur une toile,
alimenté par deux lecteurs qui alternent — pendant qu'un plan passe, le suivant est déjà
chargé, donc la jointure ne marque pas.

Le temps, lui, vient d'une **horloge de transport**, pas du lecteur. C'est le fonctionnement
d'un banc de montage : l'horloge avance, l'image suit comme elle peut. La tête de lecture
bouge donc dès qu'on appuie sur lecture, même si un fichier refuse de démarrer — vérifié en
simulant un lecteur qui rejette toute lecture. Quand le lecteur avance vraiment, l'horloge se
recale sur lui.

Deux points valent d'être retenus, parce qu'ils donnaient tous les deux l'impression d'une
image figée :

- **La position visée est reprise, pas notifiée.** Une consigne de position posée pendant
  qu'un déplacement est en cours est ignorée en silence, et l'événement qui annonce l'arrivée
  se perd sur mobile. La cible est donc gardée sur le lecteur et reposée à chaque image du
  moniteur jusqu'à ce qu'elle soit atteinte, avec une date de péremption pour ne pas ramener
  indéfiniment un lecteur qui n'y arrive pas.
- **Un chien de garde surveille l'accord entre la tête et l'image.** Tout le reste vise à ce
  que l'aperçu montre ce que le curseur désigne, mais un lecteur média échoue de façons qu'on
  ne prévoit pas. À l'arrêt, si le plan affiché n'est pas celui sous la tête, ou s'en écarte de
  plus de 0,35 s pendant plus de 800 ms sans déplacement en cours, le plan est reposé. Vérifié
  en simulant un lecteur qui n'accepte qu'une consigne de position sur trois : l'image est
  fausse juste après le geste, et correcte deux secondes plus tard, à chaque fois.
  L'onglet Setting affiche en clair ce que la tête désigne et ce que le moniteur montre.
- **Un lecteur ne traite qu'un déplacement à la fois.** Lui en demander un par image
  pendant qu'un doigt glisse fait qu'il abandonne celui en cours et ne signale jamais son
  arrivée : la tête avance, l'image reste. On n'en demande donc qu'un à la fois, en gardant
  la dernière position voulue pour la poser dès que le précédent est arrivé.
- **Une toile n'a pas de `videoWidth`.** Le moniteur garde la dernière image décodée pour
  la montrer pendant qu'un déplacement est en cours ; elle vit dans une toile, et le calcul
  de format ne lisait que `videoWidth` et `naturalWidth`. La condition échouait donc, la
  fonction sortait après avoir peint le fond, et le moniteur passait au noir à chaque
  déplacement — ce qui donnait l'impression que l'aperçu ne suivait pas la tête.
- **Un geste sur la piste ne survit pas à une reconstruction.** Refaire l'arborescence sous
  le doigt détache l'élément saisi, et le navigateur annule le geste : un import qui se
  terminait au mauvais moment interrompait ainsi un rognage en pleine manipulation. Les
  reconstructions venues du fond attendent donc la fin du geste. De même, un bloc porte une
  image de fond et du texte : sans le lui interdire, le navigateur y voit de quoi lancer son
  propre glisser-déposer, prend la main et annule le nôtre au deuxième déplacement.
- **Le trait de la tête de lecture est décoratif.** Il traverse toute la piste : s'il capte
  les gestes, il rend intouchable ce qui passe dessous — les poignées de rognage du premier
  plan étaient ainsi inatteignables. Seul le bouton rond en haut se saisit ; on se déplace
  aussi depuis la règle.
- **La première imagette d'un bloc est son image d'entrée.** Chaque colonne montre l'image de
  son bord gauche et non de son milieu, et la première est demandée à l'instant exact du point
  d'entrée, hors de la grille de cache : sans quoi la couverture d'un plan rogné restait celle
  d'avant la coupe, à une demi-colonne près — plusieurs secondes une fois dézoomé. La vignette
  de fond, qui vient de la source et montre le début du fichier, s'efface dès que la vraie image
  d'entrée est disponible, pour que les deux ne se contredisent pas. Elle ne se contente jamais
  d'une approximation : à défaut de l'image exacte, elle reprend la dernière image d'entrée
  connue du plan, et n'accepte une image de la grille que si celle-ci tombe dans la demi-colonne
  — dézoomé, le pas de la grille vaut plusieurs secondes, et l'image « la plus proche » était
  celle du début du fichier. Rogner ne vide pas le cache d'imagettes : il est rangé par instant
  dans le fichier source, donc aucune image n'y périme.
- **Le point de sortie est une limite dure.** Le fichier continue au-delà, mais ce qui suit a
  été coupé et ne fait plus partie du montage. La fin d'un plan est donc surveillée sur la
  position du fichier lui-même, pas seulement sur l'horloge de transport : sur le dernier plan,
  rien n'arrêtait le lecteur et il enchaînait sur la partie retirée. Et une lecture interrompue
  par nos soins n'est jamais relancée — le rattrapage qui rejoue en sourdine après un refus
  confondait notre propre pause avec un refus du navigateur, et repartait sur le morceau coupé.
  Arrivé au bout, un appui sur lecture reprend depuis le début.
- **Un fichier ne suit pas un doigt.** Un lecteur ne traite qu'un déplacement à la fois, là où
  un défilement rapide en demanderait des dizaines par seconde : l'image se figeait le temps que
  le lecteur rattrape. Pendant un déplacement, l'aperçu montre donc l'imagette déjà capturée la
  plus proche — basse définition mais immédiate — et l'image pleine reprend la main dès que le
  doigt s'arrête. C'est ainsi qu'un banc de montage donne l'impression de faire défiler les
  images. Pour que cette réserve soit assez dense, chaque plan importé se fait échantillonner en
  tâche de fond, une image toutes les 0,4 s et au plus quarante-huit par plan, ces demandes
  passant après tout ce qui est affiché. Les images sont retrouvées par dichotomie dans une liste
  triée par instant, indépendamment de la grille sur laquelle elles ont été prises. Mesuré sur un
  balayage de bout en bout dans les deux sens, à 25 ms par pas : 12 relevés, 12 images
  différentes, contre 7 ou 8 sans la réserve.
- **La sonde à imagettes doit avoir joué une fois.** Sur iPhone, un lecteur qui n'a jamais reçu
  l'ordre de jouer ne charge rien — `preload` est ignoré en réseau mobile — et une vidéo détachée
  du document ou masquée n'est pas décodée du tout. La sonde qui fabrique la pellicule était dans
  ces deux cas : elle n'a donc jamais produit une seule image sur un téléphone, et les blocs
  n'affichaient que la vignette de la source, étirée. Elle est désormais attachée au document
  (un pixel transparent dans un coin) et réveillée par une lecture muette aussitôt coupée, que
  Safari autorise sans geste. Vérifié en simulant la contrainte : 0 colonne sur 8 remplie avant,
  8 sur 8 après.
- **Les imagettes attendent la copie locale.** Tant qu'un import est en cours pour un plan, la
  pellicule ne va pas chercher ses images sur la source distante : ce serait payer deux fois le
  même fichier en 4G. Elles partent dès que la copie est sur l'appareil.
- **La pellicule est peinte par fenêtre, pas par plan.** Un plan d'une minute zoomé à
  l'image mesure des dizaines de milliers de pixels — largeur qu'aucune toile n'accepte, et
  le bloc restait noir. Seule la partie visible est dessinée, dans une toile de la taille de
  l'écran, et les images sont demandées pour les instants réellement affichés, sur une
  grille en puissances de deux pour qu'un changement de zoom retombe sur des images déjà
  capturées. Une seule sonde vidéo sert toutes les captures : sur un fichier importé, s'y
  déplacer est immédiat.

- **Le plein écran d'iPhone n'est pas celui des autres.** Safari n'expose pas
  `requestFullscreen` sur un élément quelconque : l'écran est agrandi en CSS, et la page passe
  alors sous la barre d'état — une croix à 12 px du haut se retrouve collée à l'heure. Elle
  descend donc de la hauteur de cette barre plus une marge pour le pouce, et le plein écran a
  ses propres contrôles (lecture, retour au début, timecode) pour ne plus avoir à en sortir
  pour mettre en pause.

Le reste tient à des contraintes de lecture média sur mobile : un fichier n'est pas chargé
tant que l'utilisateur n'a pas lancé la lecture, une lecture demandée hors du geste est
refusée, une consigne de position posée trop tôt est ignorée en silence, et le nombre de
médias chargeables en parallèle est faible. D'où, respectivement : le déverrouillage au
premier geste, la lecture lancée dans le geste, la position reposée jusqu'à ce qu'elle prenne
(avec repli sur un fragment `#t=`), et une seule sonde à la fois.

## Deux pièges rencontrés, et leur contournement

- **Des tags de série sont masqués.** `mob_psycho_100_series` existe sur le site mais
  la recherche renvoie 0 post ; les cuts sont sous des tags déformés
  (`mօb_psycho_100_iii`, avec un homoglyphe, ou `robert_psychosis_onehundred_s2`).
  D'où le catalogue de raccourcis dans `series.py`, et la résolution qui essaie
  plusieurs candidats jusqu'à en trouver un qui répond réellement.
- **Le score Sakugabooru n'est pas comparable d'une série à l'autre** (10 votes sur un
  animé confidentiel, 4000 sur un blockbuster). Il est donc normalisé en logarithme
  relatif au lot examiné, pas utilisé en valeur absolue.

## Licence et contenu

Les extraits appartiennent à leurs studios. L'outil ne réhéberge rien : il pointe vers
les fichiers servis par Sakugabooru.
