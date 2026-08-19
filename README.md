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
temps. La boucle se referme : du montage à la musique, et de la musique aux
coupes.

**La clé ne vit jamais dans la page.** Elle serait lisible par quiconque ouvre
l'application, et dépensable par lui. Elle reste en secret du Worker, et la page
ne connaît que la route `/api/musique`. Deux protections, parce que cette route
tire sur une ressource comptée :

- **le code du coffre sert de laissez-passer** — sans lui, personne ne peut tirer
  sur le quota du compte (vérifié : 401 sans code, 401 sur un code au contrôle faux) ;
- **un plafond de vingt générations par jour** borne la casse même si le code
  fuite (vérifié : 200 jusqu'au vingtième appel, 429 au vingt et unième, remise à
  zéro le lendemain par expiration de la clé).

### Gratuit, et publiable

J'avais écrit ici qu'aucun service ne générait de musique à la fois gratuitement
et par programme. **C'était faux, et le chemin gratuit est maintenant celui par
défaut** : le Space `ACE-Step/ACE-Step`, sur l'infrastructure ZeroGPU de Hugging
Face. Un jeton Hugging Face personnel — gratuit, créé en trente secondes — ouvre
un quota quotidien de GPU. Relevé dans la documentation officielle :

| Compte | Quota GPU par jour |
| --- | --- |
| sans jeton | 2 minutes |
| compte gratuit | **5 minutes** |
| PRO | 40 minutes |

Le quota se recharge vingt-quatre heures après la première utilisation. Une
génération de trente secondes de musique en tient pour une quinzaine de secondes
de GPU : cela fait une poignée de morceaux par jour, sans un centime.

Le modèle est sous **licence Apache 2.0**. Ce qu'il produit se publie sans
condition — pas de filigrane, pas de clause « usage privé ». C'est la différence
qui compte pour un AMV destiné à être mis en ligne : le palier gratuit de Suno,
lui, appose un filigrane et réserve la musique à un usage privé.

**Le jeton reste un secret du Worker**, jamais dans la page. Le quota est une
ressource comptée comme une autre : le code du coffre et le plafond quotidien
le protègent exactement comme ils protégeraient une facture.

Pour l'installer, une seule commande :

```
npx wrangler secret put JETON_HF
```

Deux réglages facultatifs : `ESPACE_MUSIQUE` pour viser un autre Space, et
`MUSIQUE_ETAPES` pour le nombre d'itérations du modèle (27 par défaut, moitié du
réglage d'usine — deux fois moins de quota brûlé pour une différence à peine
audible sur un morceau qui sert de support de montage).

`ESPACE_MUSIQUE` accepte aussi **une adresse complète**, et c'est la porte de
sortie du quota : ACE-Step tourne sur une machine personnelle munie d'un GPU, on
pointe le Worker dessus, et la limite disparaît. Même protocole, même code.

### Tirer davantage du quota gratuit

Trois leviers, avant d'aller chercher un GPU ailleurs. Ils ne demandent rien à
personne et se cumulent.

**Le nombre d'itérations.** ZeroGPU facture la durée réelle du calcul, pas la
réservation : seize pas coûtent environ quarante pour cent de moins que
vingt-sept.

**La durée produite.** C'est le levier le plus fort, et le plus négligé : le
temps de calcul suit la longueur du morceau. Demander quatre-vingt-dix secondes
pour en juger dix, c'est brûler trois fois le quota nécessaire. Le mode
**brouillon** plafonne donc la génération à trente secondes — on veut savoir si
la direction est la bonne, pas écouter le morceau. Les deux effets réunis
divisent le coût d'un essai par environ quatre.

**Ne pas payer deux fois le même brief.** Un clic répété, un « réessaie » après
une coupure, un aller-retour entre deux réglages qu'on finit par remettre comme
avant : chacun de ces gestes coûtait une génération entière. Le rendu est
maintenant gardé un jour sous l'empreinte de ce qui le détermine — style,
paroles, durée, itérations, serveur.

Éprouvé : deux appels identiques, un seul atteint le serveur, le second revient
en `x-serveur: cache` sans toucher au compteur. Et un brouillon demandé à
quatre-vingt-dix secondes arrive au Space en **trente secondes, seize
itérations**.

### Sortir du quota : son propre GPU, gratuitement

Cinq minutes de GPU par jour, c'est le plafond de ZeroGPU — deux ou trois
morceaux. Ce n'est pas le plafond d'ACE-Step, c'est celui de l'hébergement.
Ailleurs, le même modèle a bien plus de temps :

| | GPU gratuit | Rapport |
| --- | --- | --- |
| ZeroGPU, compte gratuit | 5 min/jour ≈ 35 min/semaine | — |
| Google Colab | 15 à 30 h/semaine, T4 | ~40× |
| **Kaggle** | **30 h/semaine, T4/P100** | **~50×** |

Le champ **« Serveur de secours (sans quota) »** du panneau musique reçoit
l'adresse qu'un Gradio lancé là-bas annonce. Ce n'est pas un remplacement : le
Space public passe **en premier**, parce que son quota gratuit se perd de toute
façon à la fin de la journée, autant le dépenser. Dès qu'il refuse — deux ou
trois morceaux plus tard — la génération bascule d'elle-même sur le carnet, et
la page le dit.

Un échec ne vaut pas toujours qu'on essaie ailleurs : un quota vidé, un serveur
saturé, un carnet éteint, oui ; une consigne refusée, non — elle le serait
partout, et insister ne ferait que doubler l'attente. Et si le carnet est
éteint, le message rendu est celui du **premier** serveur : le quota, qui est la
vraie cause, et non l'adresse morte.

Éprouvé en conditions réelles, deux appels de suite : le premier est passé par
le Space public, le second — son quota venant d'être vidé par le premier — a
basculé sur le serveur personnel sans rien demander, en le signalant par
l'en-tête `x-serveur: perso (secours)`. `tools/ace-step-gratuit.py` se colle dans un
carnet Kaggle ou Colab et fait le reste : clone, dépendances, lancement avec
`--share`. La ligne « Running on public URL » est celle à recopier.

L'adresse vit dans le navigateur, pas dans le projet : c'est un réglage de
machine, et elle change à chaque session du carnet.

**Elle ne peut pas être n'importe laquelle.** Un Worker qui va chercher l'URL
qu'on lui souffle est une porte ouverte sur tout ce qu'il peut joindre, services
internes compris. Seuls les domaines des tunnels connus sont acceptés, en HTTPS :
`.gradio.live`, `.trycloudflare.com`, `.ngrok-free.app`, `.ngrok.io`, `.loca.lt`.
Vérifié : un hôte quelconque, un `http://` et une adresse privée sont refusés en
400 avant tout appel sortant ; un vrai sous-domaine de tunnel passe.

Le jeton Hugging Face n'est **pas** envoyé à un serveur personnel : il n'en
demande pas, et le donner à une machine qu'on ne contrôle pas serait le perdre.

### Quatre minutes, et le choix de la longueur

Le plafond est celui du modèle : ACE-Step compose jusqu'à **240 secondes** d'un
seul tenant — la borne est lisible sur son propre réglage, et le Space donne à
chaque appel soixante secondes de GPU (`@spaces.GPU` sans argument), largement
de quoi les couvrir. Quatre minutes passent devant la quasi-totalité des AMV.

La durée **se choisit**, de 0:30 à 4:00, parce que le travail va dans les deux
sens. On peut demander une musique taillée sur un montage déjà fait ; on peut
aussi demander un morceau entier et monter dessus ensuite — c'est même le but à
terme. Un montage de trente secondes ne doit pas condamner la musique à trente
secondes.

Le conseil par défaut est la longueur du montage arrondie au demi-pas supérieur,
avec un plancher d'une minute trente et le plafond à quatre minutes. Un morceau
un peu plus long que l'image ne gêne jamais — la queue se coupe — alors qu'un
morceau trop court oblige à tout reprendre.

Vérifié dans le navigateur : montage de 16 s → 1:30 conseillé, 100 s → 2:00,
360 s → 4:00 ; et de bout en bout, 3:00 choisi dans le panneau donne bien 180 s
partis au Space, avec la piste rendue déposée dans la voie son.

Au-delà de quatre minutes, le Space expose un point d'entrée d'extension
(`right_extend_length`, chaînable par `extend_source: "last_extend"`) : il
faudrait lui repasser les paramètres de la génération précédente, et payer un
appel de quota par rallonge. Ce n'est pas écrit — la longueur d'un AMV ne le
demande pas encore.

### Deux chemins vers le même montage

Composer la musique, ou en apporter une. Le second marchait déjà — importer un
fichier lisait son tempo et découpait ses sections exactement comme pour une
musique générée — mais **le choix ne se voyait nulle part**, et un bouton
d'import perdu dans une barre ne dit pas qu'il ouvre le même chemin.

La première rangée du panneau le pose donc en toutes lettres : *La composer* ou
*En apporter une*. Le second mode efface les axes de composition — les montrer
laisserait croire qu'ils pèsent sur une musique déjà écrite — et « Monter sur la
musique » vit maintenant dans le panneau, à côté, actif dès qu'un tempo est lu.

### Un montage doit finir où finit la musique

### Un plan de travail, pas un formulaire

Le brief était entièrement déduit du montage. C'est un bon point de départ — il
ne demande rien et il tombe souvent juste — mais **ce n'est pas ainsi qu'on fait
une musique : on la choisit.** Le panneau est devenu une table de composition.

Quatre axes, en pastilles :

| Axe | Choix |
| --- | --- |
| **Voix** | Instrumental · Féminine · Masculine · Duo · Chœur |
| **Style** | Rock · Métal · Orchestral · Cinématique · Électro · Trap · Phonk · J-Pop · Lo-fi · Drum & bass · Piano |
| **Émotion** | Épique · Mélancolique · Rageur · Nostalgique · Sombre · Lumineux · Tendu · Triomphal |
| **Tempo** | de 60 à 200 BPM, au curseur |

Les pastilles plutôt qu'un menu déroulant : c'est la forme qui convient à un
choix qu'on tâtonne. Tout est visible d'un coup, et l'on voit du même coup ce
qu'on a pris **et ce qu'on a laissé**.

**Ce qui n'est pas choisi suit le montage ; ce qui l'est l'emporte.** On ouvre le
panneau, tout est déjà rempli d'après l'image, et on ne touche qu'à ce qui ne va
pas. « Repartir du montage » efface les choix d'un geste.

Deux règles apprises en le construisant :

- **Deux genres au maximum.** Au-delà, le générateur ne fait plus de choix, il
  fait de la bouillie. Le troisième clic chasse le plus ancien.
- **Les instruments déduits s'effacent dès qu'un genre est choisi.** Demander
  « piano intimiste » et recevoir des taïkos par-dessus, parce que le montage est
  un combat, serait exactement le contraire de choisir.

La ligne qui part au générateur est affichée en clair, et se réécrit à chaque
geste : montrer un brief périmé sous des boutons qu'on vient de changer serait
pire que ne rien montrer.

Vérifié : sans rien choisir, `epic orchestral hybrid, 120 BPM, taiko drums,
distorted 808s, aggressive brass, felt piano, emotional dynamics, instrumental,
no vocals` — le montage seul. Après trois clics et un curseur, `phonk, cowbell,
distorted bass, 172 BPM, aggressive, furious, female vocals, clear lead voice`.
Plus une trace des taïkos. Les choix survivent à la fermeture du panneau.

### Chanté ou instrumental

Par défaut, la musique est **instrumentale** : c'est ce que demandait le brief,
et le champ des paroles ne portait que des balises de structure. Un sélecteur
« Voix » ouvre l'autre porte — **chanté, en anglais**.

L'anglais n'est pas un jugement sur la langue. C'est ce que les modèles de
musique chantent le mieux, et de très loin : ACE-Step comme les autres ont été
entraînés sur un corpus massivement anglophone.

Écrire des paroles est un travail à part entière, et rarement celui qu'on a
envie de faire quand on monte. Le bouton **Écrire les paroles** les fait rédiger
par le modèle de langue de **Workers AI** — sur le même compte Cloudflare que le
reste, sans nouvelle clé, sans nouveau compte. Le plan gratuit donne dix mille
neurones par jour ; une chanson en coûte une centaine. La limite ne se rencontre
pas.

Le brief qui part est celui du montage : l'animé, les ambiances dominantes, le
tempo, la durée choisie, le plan des sections avec leur durée et leur humeur, et
une ligne facultative — **ce que la chanson doit raconter**.

Le texte revient **dans le panneau**, pas dans le générateur. Il se relit et se
corrige avant d'être chanté : une parole ratée coûterait un appel de quota GPU,
une parole relue n'en coûte aucun.

Trois choses ont demandé d'insister dans la consigne, parce que le modèle les
rate spontanément :

- **`[inst]` est interdit.** Il marque un passage instrumental ; le premier jet
  l'avait mis en tête et écrit des vers dessous, ce qui se contredit. La
  consigne donne maintenant la correspondance à appliquer — Intro, Ambient,
  Breakdown et Outro deviennent `[verse]`, Build devient `[bridge]`, Drop
  devient `[chorus]` — et interdit tout le reste.
- **Le nombre de sections**, sinon il en écrit autant qu'il veut.
- **L'emballage** : « Here are the lyrics: », les blocs de code, les titres en
  gras. Ils sont retirés à l'arrivée, sans toucher au texte.

Un modèle a été retiré du catalogue Cloudflare en cours de route — le premier
essai a répondu `5028: … was deprecated on 2026-05-30`. La route essaie donc
trois modèles dans l'ordre et passe au suivant sur ce genre d'erreur : une
dépréciation ne fera pas tomber la fonctionnalité entière.

Vérifié en production : quatre sections demandées, quatre sections rendues, aux
bonnes balises, en anglais, sans `[inst]`, en **3 secondes** ; et depuis le
panneau, le brief part avec l'animé, les humeurs, le tempo, l'histoire et le
plan, et le texte arrive dans le champ en 3,6 s.

### « Il revient dans 0:00:00 »

ZeroGPU annonce `Try again in 0:00:00` quand il ne reste plus rien. Ce n'est pas
un délai, c'est une absence de délai calculable — et traduit tel quel, le message
invitait à réessayer en boucle.

Pire : la même phrase sort **aussi** quand le jeton n'est pas reconnu, les
requêtes partant alors en anonyme, et l'anonyme n'a pas de quota. Deux causes
opposées derrière un texte identique : l'une se répare en trente secondes, l'autre
demande d'attendre un jour.

La route les sépare maintenant. Devant un `0s left` sans délai, elle interroge
`whoami-v2` avec le jeton avant d'accuser le quota :

- **jeton non reconnu** → « les requêtes partent en anonyme ; un espace ou un
  retour à la ligne collé avec la clé suffit à l'invalider » ;
- **compte reconnu** → « quota du jour épuisé pour le compte X, il se recharge
  vingt-quatre heures après la première génération, pas à minuit ».

Dans les deux cas le message rappelle que **« En apporter une » n'a aucun
quota** : le montage automatique marche exactement pareil sur un fichier importé.

C'est la troisième fois dans ce projet qu'un message traduit cache la preuve —
après « Groq API error » et « ElevenLabs indisponible (quota) », qui annonçait un
quota là où il manquait une clé. Une traduction qui perd le motif original
transforme un diagnostic de dix secondes en une heure de tâtonnement.

### Le dialogue avec Gradio

Un Space Gradio répond en deux temps : on dépose la demande, on écoute la file.
Les vingt-deux arguments d'ACE-Step sont relevés sur `/gradio_api/info`, dans
leur ordre exact ; seuls la durée, le style, les balises et le nombre d'étapes
sont calculés, tout le reste garde les réglages d'usine.

Deux détails appris en éprouvant la chose :

- **la route courte ne dit pas pourquoi ça a raté.** `/call/<nom>/<événement>`
  rend un `error` vide. La file, elle, rend la phrase du serveur — quota épuisé,
  temps restant avant recharge. Comme la route nommée accepte qu'on lui impose
  le `session_hash`, on prend la commodité de l'une et la parole de l'autre.
- **le flux se coupe n'importe où.** Les événements arrivent en morceaux qui
  tombent au milieu d'une ligne. Le lecteur garde donc un reste entre deux
  paquets ; éprouvé contre un faux Space qui découpe exprès tous les 37 octets.

Le message de quota est traduit, parce que c'est celui qu'on verra le plus
souvent : *« Quota GPU épuisé pour aujourd'hui : il revient dans 18:03:00. »*

### Ce qui est éprouvé, et ce qui ne l'est pas

Contre un faux Space qui parle le protocole de Gradio : la charge sortante
(22 arguments, bon ordre, jeton en `Authorization`), les bornes de durée
(900 s → 240 s, 3 s → 10 s), le flux découpé au milieu des lignes, le fichier
récupéré et rendu intact (3 244 octets attendus, 3 244 rendus), et la traduction
de l'échec.

Contre le vrai Space, sans jeton valable : la demande est acceptée, la session
honorée, la file lue, l'erreur extraite et traduite.

Et **avec un jeton, la dernière marche est franchie**. Premier morceau rendu par
la route : **1,2 Mo de MP3 en 320 kbit/s, 48 kHz stéréo, en 14 secondes** ; 29,91
secondes d'audio pour 30 demandées ; décodé dans le navigateur, RMS 0,177, pic
0,97, et l'énergie varie de 0,139 à 0,206 d'une tranche de cinq secondes à
l'autre — c'est de la musique, pas un silence ni une tenue.

La boucle entière, depuis le panneau : **10,9 secondes** du clic au morceau posé
dans la voie son, tempo lu dans la foulée. Puis la grille des temps, une fois
zoomé — au large elle reste cachée, un trait tous les six points étant le seuil
en deçà duquel elle masquerait la pellicule au lieu d'aider. Mesuré à 184,2 BPM :
35,7 px par temps pour 109,7 px/s, soit 0,3258 s — exactement 60/184,2.

Une chose à savoir : **ACE-Step ne respecte pas le tempo demandé**. Le brief
portait 120 BPM, le morceau rendu en fait 184 ; un autre, briefé à 150, en fait
191. L'étiquette de tempo est une indication, pas un contrat. Cela ne casse rien,
parce que l'outil ne fait pas confiance au brief : il **lit** le tempo du fichier
rendu et cale la grille et les coupes dessus. La musique fait foi, pas la
consigne.

### L'autre fournisseur

**Lyria**, via l'API Gemini, est implémenté d'après la documentation officielle :
`POST https://generativelanguage.googleapis.com/v1beta/interactions`, en-tête
`x-goog-api-key`, corps `{ model, input, response_format }`, réponse en une seule
requête portant l'audio en base64 — pas de file d'attente à interroger. Modèles
`lyria-3-clip-preview` (30 s, 0,04 $) et `lyria-3-pro-preview` (morceau complet,
0,08 $) — aucun des deux n'est offert sur le palier gratuit. Il ne sert que si
un jeton Hugging Face est absent et une clé Gemini présente.

**Suno a bien une API officielle**, contrairement à ce que j'avais d'abord écrit,
mais sa documentation demande un compte : l'adaptateur ne sera écrit que sur des
points d'entrée lus, jamais devinés. Le brief reste copiable à la main dans Suno
depuis le panneau, pour qui a un abonnement.

## Le tempo se lit dans la musique, sur l'appareil

Le but à terme est d'inverser le travail : au lieu de déduire une musique du
montage, déduire le montage de la musique. Tout commence par lire le tempo dans
le fichier lui-même — et le navigateur sait déjà tout ce qu'il faut. Décoder un
son, parcourir ses échantillons : le reste est du calcul, et il tient dans un
téléphone. **Pas de service, pas de clé, pas un centime, et ça marche hors
ligne.**

La méthode, et les quatre erreurs qu'il a fallu corriger — toutes trouvées en
mesurant sur des pistes dont le tempo et le premier temps sont connus au
centième :

1. **L'enveloppe d'attaque.** Ce sont les montées d'énergie qui marquent les
   frappes, pas le niveau absolu, qui suit le mixage.
2. **Le tempo se lit sur la présence des frappes, pas sur leur force.** Corréler
   l'énergie compare une grosse caisse à une caisse claire : elles s'accordent
   mal, et une piste à 174 avec caisse claire un temps sur deux se lisait 87 — le
   motif de deux temps se répétait mieux que le temps lui-même.
3. **Chaque frappe est posée comme une petite bosse, pas comme un point.** Un
   temps de 34,5 trames tombe alternativement sur 34 et 35 : la corrélation à 34
   ne voyait qu'une paire sur deux, celle à 69 les voyait toutes, et le demi-tempo
   l'emportait par pur artefact de quantification — 0,0237 contre 0,0172.
4. **Période et phase sont ajustées ensemble sur les frappes.** La corrélation ne
   donne la période qu'à la trame près, et un centième de seconde d'erreur déplace
   la grille d'une seconde au bout de trois minutes. Chaque frappe tombant sur un
   temps numéroté, il suffit de faire passer une droite par les points (numéro,
   instant) : la pente est la période, l'ordonnée à l'origine la phase. Le départ
   de l'ajustement vient d'une moyenne circulaire — partir de zéro rejetait toutes
   les frappes quand la phase réelle tombait vers le milieu d'un temps.

Résultat sur cinq pistes de 90 à 174 BPM : **tempo à 0,4 BPM près, premier temps à
6 millisecondes près** — un quart d'image. La grille des temps s'affiche alors sur
la piste, et la coupe comme le rognage s'aimantent sur le temps le plus proche
quand la tête en est à moins d'un huitième de temps. Vérifié de bout en bout : une
coupe demandée à 2,27 s se pose à 2,239 s, soit **exactement** sur le temps
détecté.

## Le brief musical, calculé sur le montage

Une musique générée sur une consigne vague ne collera jamais à un montage. Ce
qu'attend un générateur, ce n'est pas « fais-moi un truc épique » : c'est un
tempo, une durée, une structure et une intensité par section. Or tout cela se lit
**dans le montage lui-même**, et l'application le calcule sans clé, sans réseau
et sans un centime.

- **Le tempo vient du rythme des coupes.** Si les plans durent en médiane `c`
  secondes et qu'on coupe sur les temps, alors `c` vaut un nombre entier de
  temps : `BPM = 60 × k / c`. On retient le `k` qui place le tempo dans une plage
  jouable, au plus près de 128. Quatorze coupes d'une demi-seconde donnent
  120 BPM, une coupe par temps ; des plans de six secondes donnent 80 BPM, une
  coupe toutes les huit.
- **La structure vient de la courbe d'énergie.** Chaque plan porte les ambiances
  relevées à la source — combat, effets, vitesse, acting, hype — et sa technique.
  On suit cette courbe et on coupe là où elle change franchement, jamais en
  dessous de huit secondes. Un montage calme → combat → calme ressort en trois
  sections aux instants exacts des ruptures.
- **La palette suit le sommet, pas la moyenne.** Un AMV qui passe trente secondes
  en calme et douze en combat s'entend comme un morceau de combat : c'est le pic
  qui reste en tête. Chaque ambiance est donc pondérée par son énergie autant que
  par sa durée.
- **« Intro » et « Outro » se méritent.** Un montage qui ouvre sur des impact
  frames ouvre sur un drop ; l'annoncer comme une intro donnerait la consigne
  inverse de l'image.

La sortie sert deux fois. Le bouton **Générer la musique** l'envoie à ACE-Step,
qui rend le morceau directement dans la piste son. Et elle reste copiable en deux
blocs dans Suno en mode Custom — le style d'un côté, la structure balisée de
l'autre. Le tout **en anglais**, que les générateurs comprennent nettement mieux
que le français.

Les balises ne sont pas les mêmes des deux côtés, et c'est voulu : Suno lit la
prose entre crochets comme une consigne, alors qu'ACE-Step **chante** ce qu'il
trouve dans le champ des paroles. En instrumental, on ne lui donne donc que des
balises de son vocabulaire — `[inst]`, puis `[intro]`, `[break]`, `[bridge]`,
`[chorus]` dans l'ordre du montage — et jamais une phrase. En chanté, ce champ
porte les vraies paroles, et c'est le sélecteur « Voix » qui décide.

Une réserve écrite dans le panneau : le palier gratuit de Suno appose un
filigrane et réserve la musique à un usage privé. ACE-Step, sous Apache 2.0, ne
pose aucune de ces deux conditions.

## D'un projet vide à un AMV : l'assistant

Les pièces existaient toutes et **ne s'enchaînaient pas**. Il fallait savoir
qu'on compose d'abord la musique, qu'on fait ensuite lire les plans, qu'on monte
enfin — et retrouver trois boutons rangés dans la même barre sans que rien ne
dise dans quel ordre les prendre.

Un bouton **« Créer un AMV »**, visible dès le projet vide, pose l'ordre :

1. **La musique.** On la compose — voix, genre, émotion, tempo — ou on en apporte
   une. On la génère, on l'écoute.
2. **« Démarrer le montage automatique »**, qui ne s'active qu'une fois un tempo
   lu. Trois questions, et trois seulement :

| Question | Ce que ça change |
| --- | --- |
| **Un seul animé** ou **mixte** | l'outil va chercher les plans lui-même, sur un titre ou sur plusieurs |
| **Dans l'ordre** ou **libre** | la chronologie de l'animé, ou l'accord avec la musique |
| **Lecture des plans** | l'IA regarde chaque plan, ou l'on s'en tient aux étiquettes |

3. **« Automatiser l'AMV »** — recherche des plans, mesure des durées, lecture,
   montage. Il ne reste qu'à appuyer sur lecture.

**Un projet vide est exactement le moment où l'assistant sert**, puisqu'il sait
chercher les plans. Le renvoyer vers l'explorateur, comme le faisait la note
précédente, c'était lui demander de faire à la main ce qu'on venait de lui
proposer d'automatiser. Le panneau de composition marche donc désormais sans un
seul plan : faute d'image à interroger, tout devient un choix, et il le dit.

### Le montage arrive d'abord, l'IA affine ensuite

Lire quarante plans prend près de trois minutes — quatre secondes chacun pour
tenir le quota. Faire attendre devant un écran vide pendant ce temps-là est
intenable, et c'était pourtant l'enchaînement : recherche, mesure, lecture,
accord, puis enfin le montage.

L'ordre est inversé. **Le premier montage est posé dès que huit durées sont
connues** — mesuré à **deux dixièmes de seconde**, soixante-quinze coupes — et
l'on peut déjà écouter. La lecture des plans et l'accord aux paroles tournent
ensuite, et un second montage remplace le premier quand ils ont fini.

La lecture enchaînée se limite en outre aux **seize plans les mieux notés** : un
montage n'a pas besoin de quarante lectures pour être juste, les autres gardent
leurs étiquettes.

### Arrêter

Une automatisation de trois minutes qu'on ne peut pas interrompre, c'est devoir
fermer l'application. « Automatiser l'AMV » devient **« Arrêter »**, en rouge,
pendant tout le processus. Le drapeau est lu entre chaque étape et à chaque
plan ; le montage déjà posé reste en place.

Vérifié : lecture arrêtée net au clic, aucune requête supplémentaire dans les
deux secondes et demie qui suivent.

### Sans musique, rien ne démarre

C'est le tempo qui donne la grille des coupes, et les sections qui décident
quels plans vont où : un montage automatique sans musique n'a aucun sens. Le
bouton qui ouvre l'étape du montage reste donc **grisé** tant qu'aucun tempo
n'est lu, et le lancement le vérifie une seconde fois.

### Le second montage ne se construit pas sur le premier

Défaut trouvé par les tests en inversant l'ordre. Le montage repartait de
`projet.plans` — c'est-à-dire, à la seconde passe, des blocs déjà posés. Chaque
rush s'y comptait autant de fois qu'il y avait été employé, si bien qu'en
chronologie on obtenait dix blocs du même épisode à la suite au lieu de
`1 → 2 → 3 → 5 → 7 → 9`.

La liste des sources est désormais fixée avant le premier montage, dédoublonnée,
et c'est elle qu'on remonte — et qu'on donne à lire, plutôt que de faire soixante
appels pour six réponses utiles.

### « Dans l'ordre », et ce qu'on y gagne

Le montage libre laisse la musique décider : à chaque case, le rush qui lui va le
mieux. C'est le meilleur accord, et **l'ordre du récit s'y perd**.

« Dans l'ordre » suit la chronologie — épisode, puis numéro de plan — et n'y
déroge pas. On y perd l'accord d'énergie, on y gagne un récit : les plans se
suivent comme dans l'animé, et seule la durée des coupes reste dictée par la
musique.

Éprouvé de bout en bout, depuis un projet vide et sur des épisodes volontairement
mélangés à la source (5, 2, 9, 1, 7, 3) : le montage rend `1 → 2 → 3 → 5 → 7 → 9`
puis reprend le cycle. Soixante coupes pour une minute de musique.

### Combien de plans chercher

Il n'en faut pas un par coupe — un même plan sert plusieurs fois, à des instants
différents de sa source — mais il en faut assez pour que le montage ne tourne pas
en rond. Un rush par tranche de cinq secondes de musique donne une variété
honnête sans faire exploser ni l'attente ni la mémoire, plafonné à soixante.

Un défaut d'affichage corrigé au passage : `minutage` arrondissait les secondes
avant de les séparer des minutes, et rendait **« 0:60 »** pour 59,6 secondes.

## Monter sur la musique

Le travail dans l'autre sens : au lieu de déduire une musique du montage,
déduire le montage de la musique. Un bouton dans la barre du son, actif dès
qu'une piste a livré son tempo.

### Les sections

Les ruptures étaient calculées depuis longtemps et **personne ne les lisait**.
Elles disent qu'il se passe quelque chose ; elles ne disent pas quoi. Ce qui
sert au montage, c'est le morceau entre deux ruptures — sa durée et son
intensité, rapportée au plus fort passage du morceau. En valeur absolue elle ne
voudrait rien dire : un morceau doux n'a pas de drop à 0 dB, il a un drop
relatif au reste.

Éprouvé sur une piste dont la structure est connue d'avance — cinq paliers aux
instants 20, 50, 70 et 100 s. Trois défauts trouvés, chacun mesuré :

| | Erreur moyenne | Pire cas |
| --- | --- | --- |
| première version | 1,45 s | 1,9 s |
| sommet de pente au lieu du premier dépassement | 1,05 s | 1,9 s |
| franchissement exact, puis calage sur un temps | 0,85 s | 1,1 s |
| **moyenne centrée au lieu de glissante** | **0,15 s** | **0,2 s** |

Le dernier pas est le plus instructif. Une fenêtre qui ne regarde que le passé
rend une courbe en retard de la moitié de sa largeur ; les frontières héritaient
de ce retard, une seconde pleine, et toutes dans le même sens. Un montage calé
là changeait de régime avant la musique — et ça s'entend.

### Les coupes

Le tempo donne la grille : une coupe tombe sur un temps, jamais entre deux. La
section donne le régime — un drop veut des plans courts, un pont veut qu'on
laisse respirer :

| Intensité | Tenue d'un plan |
| --- | --- |
| drop | 2 temps |
| montée | 4 temps |
| pont | 8 temps |
| calme, intro, outro | 16 temps |

Chaque case reçoit le rush qui lui va le mieux. Trois critères, dans cet ordre :
l'accord d'énergie, la fraîcheur — revoir le même plan trois fois de suite tue
un AMV plus sûrement qu'un mauvais choix —, et la qualité du rush en départage.

**L'usure a dû être bornée.** Sans borne elle s'accumule : mesuré sur un morceau
à deux montées, les plans de combat sortaient de la première si usés que la
seconde se remplissait de plans calmes. Éviter la répétition ne doit jamais
valoir plus que tomber juste.

Mesuré après correction, sur cinq sections et six rushs :

```
section   énergie  plans  tenue     en temps  ambiances
intro       0        3    6,67s       16,7    acting×3
drop        3       38    0,79s        2,0    vitesse×11 combat+effets×11 combat×10
pont        1        6    3,33s        8,3    acting×4 effets×2
drop        3       38    0,79s        2,0    vitesse×11 combat+effets×11 combat×10
outro       0        3    6,67s       16,7    acting×3
```

120,0 s montés pour 120 s de musique. Jamais deux fois le même plan de suite, et
les points d'entrée avancent dans chaque source — un rush réemployé ne rejoue
pas les mêmes images.

### Deux défauts de synchronisation

Le premier découpage remplissait chaque section **au compte** : autant de cases
que la tenue le voulait. Un rush plus court que la case ne peut pas la couvrir —
mesuré, cinq cases de six secondes servies par des rushs de quatre laissaient dix
secondes de retard, et **tout ce qui suivait tombait à côté de la musique**. Les
sections se remplissent désormais au temps : on avance sur ce qui a réellement
été posé.

Le second est venu du remède. Une tenue voulue ne tombe presque jamais juste sur
la durée d'une section : trois plans de six secondes dans un passage de vingt en
laissaient un de huit dixièmes à la fin — un éclair au milieu du silence. La
tenue est maintenant répartie en parts égales, et le reliquat éventuel revient au
dernier plan si sa source le permet.

Mesuré après les deux : 120,0 s montés pour 120 s de musique avec des rushs
longs, 1:30 pour 1:30 avec des rushs de quatre secondes seulement — dans ce cas
au prix de coupes plus nombreuses, ce qui vaut mieux qu'un trou.

### Lire les plans

Il était écrit ici que l'outil ne regarde pas l'image. **Ce n'est plus vrai.**

Une route `/api/scene` donne chaque rush à lire à Gemini, qui sait prendre une
vidéo en entrée. Elle rend ce qu'aucune étiquette ne contenait :

```
{
  "resume": "Chainsaw Man et Reze s'affrontent sur un toit nocturne
             avant d'être enlacés par des chaînes et de basculer dans le vide.",
  "motscles": ["chainsaw","chains","rooftop","night","duel","falling","binding"],
  "energie": 2,
  "pic": 51,
  "emotion": "intensity"
}
```

Sakugabooru, lui, en disait : `effets, combat, vitesse, hype, acting`.

**Le `pic` est ce qui change tout.** C'est la seconde que la lecture repère
comme la plus forte — l'impact, le regard, la bascule. Un plan de deux secondes
taillé au hasard dans dix la manque presque toujours ; taillé autour d'elle,
c'est exactement ce qu'un monteur serait allé chercher. Le montage la réserve
aux passages qui frappent, et à un seul emploi : la montrer deux fois lui ôterait
ce qui en fait un pic.

Mesuré, sur des pics plantés à 15,5 s et 16,5 s dans des sources de vingt
secondes :

| | Premier emploi du plan de combat |
| --- | --- |
| sans lecture | 0 s → 0,8 s |
| **avec lecture** | **15,1 s → 15,9 s** — centre 15,50 s |

L'énergie aussi vient désormais de l'image plutôt que des mots-clés : elle est
lue sur ce qui bouge, pas sur ce que quelqu'un a tapé sur un site de partage.

### Ce que la lecture coûte, et ce qu'elle ne coûte pas

**Un plan ne se lit qu'une fois.** Le résultat est rangé dans le KV par
identifiant de rush, sans expiration — ce qu'un plan montre ne changera pas. La
seconde demande revient en **0,55 s** sans toucher au quota, quel que soit le
montage qui l'emploie, et pour tout le monde.

Le Worker va chercher la vidéo lui-même : le téléphone n'envoie pas les
mégaoctets, ce qui sur un lien mobile serait de loin la partie la plus lente.

Deux chemins selon le poids, parce que beaucoup de rushs sakuga dépassent
largement la limite de l'envoi en ligne :

| Poids | Chemin | Mesuré |
| --- | --- | --- |
| ≤ 18 Mo | dans la requête | 6,5 Mo en **10,3 s** |
| > 18 Mo | API Files, avec attente de traitement | 34,8 Mo en **18,7 s** |

Les identifiants de modèle sont essayés dans l'ordre, et un modèle saturé se
contourne en changeant de modèle — le second essai l'a prouvé en direct, Gemini
ayant répondu « high demand » sur le premier. Un quota dépassé ou une clé
refusée, en revanche, ne se contourne pas : insister ne ferait que brûler ce qui
reste.

**Une clé Gemini ne déclenche plus Lyria.** La même clé sert maintenant à lire
les rushs, et facturer une génération musicale parce qu'un jeton gratuit a
échoué serait une très mauvaise surprise : Lyria demande désormais un
`MUSIQUE_LYRIA` explicite.

### Un mashup, pas un plan étalé

Un rush réemployé donnait ses secondes **dans l'ordre** : premier emploi le
début, deuxième la suite. Recollés dans un montage, ces morceaux racontaient la
scène d'origine en pointillé. Ce n'est pas un mashup, c'est le plan de départ
étalé sur toute la durée.

Chaque source est maintenant découpée en cases, servies dans un **ordre
dispersé**. Le pas d'or fait cela mieux qu'un tirage au sort : il ne repasse
jamais deux fois au même endroit et ne laisse aucun trou, là où le hasard fait
les deux. Deux emplois successifs d'une même source tombent aux deux bouts du
fichier, jamais côte à côte.

Et **deux blocs de suite venus du même rush sont interdits** — règle dure, plus
une pénalité qu'on pouvait franchir : c'est le plan d'origine qui réapparaîtrait.

Mesuré sur cinq sources de vingt-quatre secondes, soixante-quinze coupes :

```
p0, entrées successives dans le montage :
0,1 → 14,1 → 5,1 → 20,1 → 11,1 → 2,1 → 16,1 → 7,1 → 22,1 → 13,1 → …
```

43 % seulement des emplois successifs avancent dans le fichier — c'est le
hasard, donc aucune dérive. Écart moyen entre deux emplois d'une même source :
cinq blocs. Aucun doublon collé.

### Le raccord de mouvement

Couper d'un geste qui part à droite vers un geste qui part à droite se voit à
peine : l'œil suit, et c'est ce qui fait qu'un mashup s'enchaîne au lieu de
claquer. L'inverse — droite puis gauche — est la coupure qui fait sursauter,
celle qu'on garde pour les impacts.

**Il s'agit du mouvement de l'action, jamais de la caméra.** C'est écrit ainsi
dans la consigne de lecture : un personnage qui bondit à droite pendant que la
caméra l'accompagne compte comme « droite » ; un personnage immobile filmé par
un panoramique compte comme « immobile ». La lecture rend donc, en plus du
reste, une direction et sa force.

Rien à calculer sur l'appareil : la question part avec la vidéo qu'on envoyait
déjà. Sur un plan de Chainsaw Man où des mains jaillissent du sol, elle rend
`mouvement: "up", force: 2`.

Mesuré sur six sources — trois qui vont à droite, trois à gauche, tout le reste
identique :

| | Enchaînements dans le même sens |
| --- | --- |
| sans lecture | 34 % |
| **avec lecture** | **74 %** |

Le montage produit des séries — `l l l r r r l l l` — : il continue tant qu'il
peut, et ne rompt que lorsque la fraîcheur l'exige.

### Cinq sources ne doivent pas défiler en rond

Défaut visible dès le premier essai de dispersion : à énergie et à note
strictement égales, les candidats se relayaient dans un ordre parfaitement
cyclique — `p0 p1 p2 p3 p4`, quinze fois de suite. Un grain de sable déterministe,
tiré de l'identifiant et du rang, départage désormais les ex æquo. Sa valeur
reste sous le plus petit écart qui ait un sens, donc il ne dérange aucune
préférence réelle.

### Les paroles choisissent les plans

Le montage s'accordait sur l'énergie : un drop appelait un plan de combat, un
pont un plan calme. C'est juste, et c'est **sourd** — les paroles disent quelque
chose, et rien ne l'écoutait.

Depuis que les plans sont lus, on sait ce qu'ils montrent. Rapprocher « une fille
marche sous la pluie » d'un vers sur la pluie n'est plus un problème de vision,
c'est un problème de langue — et le modèle de Workers AI le traite pour rien.

Un seul appel par montage, quel que soit le nombre de plans. Éprouvé sur des
paroles et des plans construits pour la démonstration :

```
[verse] Rain on the empty street / I walk away from you
   → pluie/marche  >  chat endormi

[chorus] Burn it all down / Steel and fire
   → explosion  >  épées  >  course

[verse] Quiet now, the smoke is gone
   → fumée sur les ruines
```

« Steel » a trouvé les épées, « smoke » les ruines. Ce n'est pas de l'énergie,
c'est du sens.

Ce qui revient est **un ordre de préférence par section, pas un choix ferme** :
le montage garde la main, parce qu'il connaît des contraintes que le modèle
ignore — la durée des sources, la fraîcheur, ce qui vient d'être montré.

Le poids a demandé un réglage. L'accord doit l'emporter sur **un** écart
d'énergie — un plan de pluie sur un vers de pluie vaut mieux qu'un plan d'énergie
parfaite qui ne parle de rien — mais pas sur trois, sinon un drop se remplirait
de plans calmes. Il ne doit pas non plus écraser la fraîcheur : revoir six fois
le même plan « juste » resterait pire que varier.

Mesuré, sur trois sections de même énergie et six plans — de sorte que seul
l'accord puisse les départager :

| | Section 0 | Section 1 | Section 2 |
| --- | --- | --- | --- |
| sans accord | tout à 4–5 emplois | tout à 4–5 | tout à 4–5 |
| **avec accord** | **pluie ×7, explosion ×7** | **épées ×9, ruines ×8** | **course ×9, chat ×8** |

Chaque section est dominée par exactement la paire qu'on lui avait désignée, et
les autres plans continuent d'apparaître — la variété survit à la pertinence.

Deux détails de mise au point valent d'être notés. Workers AI rend selon le
modèle soit du texte, soit l'objet déjà analysé : le premier essai butait sur
« [object Object] », et le message d'erreur, qui ne montrait pas la réponse, ne
le disait pas. Et les identifiants rendus par le modèle ne sont pas crus sur
parole — ce qui ne correspond à aucun plan connu est écarté à l'arrivée plutôt
que de faire échouer le montage plus loin.

### Une scène ne doit jamais revenir

Le montage acceptait de reprendre une source déjà employée dès que la note le
justifiait : sur un morceau de cinq minutes, la même scène pouvait revenir sept
ou huit fois. Le coût est fait pour être écrasant — cent points de pénalité, là
où l'écart d'énergie en vaut six — de sorte qu'aucune autre préférence ne puisse
le racheter. Ce n'est pas une interdiction, c'est un dernier recours : quand les
sources manquent, il vaut mieux répéter que laisser un trou.

Il fallait aussi de quoi tenir. Une piste de quatre minutes découpée en coupes
courtes réclame deux cents scènes distinctes, et la recherche s'arrêtait à
soixante. `casesAttendues` compte les coupes que le montage va poser, avant de
chercher, et la recherche vise ce nombre — plafond porté à 240.

```
— de quoi tenir : 90 sources, 75 coupes
  sources employées : 75 ; emplois par source : min 1, max 1
  ✔ aucune scène deux fois

— pas assez : 20 sources, 75 coupes
  emplois par source : min 3, max 4
  ✔ dégradation propre
```

Quand il y a de quoi, personne ne repasse. Quand il n'y a pas de quoi, la charge
se répartit à une unité près au lieu de s'entasser sur les mêmes.

### Le noir entre deux plans

L'unicité a un prix, et il se voit tout de suite : deux cents fichiers
différents à rapatrier au lieu de vingt relus. En 4G, la lecture rattrape le
téléchargement, et l'écran devient noir le temps que le plan suivant arrive.

Deux corrections, mesurées séparément.

**Tenir la dernière image.** Le moniteur peignait du noir dès que le plan
courant n'avait pas d'image à donner. Il tient désormais la dernière image
décodée pendant 700 ms — quel que soit le plan dont elle vient. Au-delà, le noir
redevient honnête : il dit qu'il manque quelque chose.

Éprouvé sur un montage de deux plans dont le second ne répond pas — ni en direct
ni par le relais du Worker, sans quoi le fichier finit par arriver et le trou ne
se produit jamais :

| | luminance du moniteur |
| --- | --- |
| avant, à la bascule | **0,1** — noir |
| après, à la bascule | **201,9** — l'image tenue |
| après, 1 s plus tard | 0,1 — la tenue est bornée |

**Télécharger dans l'ordre où l'on regarde.** La file suivait l'ordre du
montage, pas la tête de lecture. Poser la tête au milieu de la piste laissait la
file finir tranquillement les plans du début, et les plans dont l'écran avait
besoin tout de suite passaient derniers. `prioriserImports` remonte en tête les
huit plans à venir à chaque changement de plan ; le tri est stable, donc le
reste garde son ordre.

Dix plans, un fichier par seconde, saut au huitième :

```
sans          après le saut : 3 4 5 6      ← la file continue son chemin
avec          après le saut : 7 8 9 3      ← elle se retourne vers l'écran
```

### Ce que ça ne fait pas

**Sans lecture, l'outil reste aveugle.** Tant qu'on n'a pas appuyé sur l'œil, il
s'accorde sur les étiquettes de Sakugabooru et coupe au début des plans.

Il choisit parmi les rushs **déjà posés** dans le montage : il n'en cherche pas
de nouveaux. La sélection reste une décision humaine.

Le résultat est une proposition. Elle passe par l'historique, donc « annuler »
la défait d'un coup — l'essayer ne coûte rien.

## Un message qui montre une porte fermée

Trois routes demandent le code du coffre — génération, paroles, lecture des
plans. Elles disaient : « active la sauvegarde en ligne dans Réglages ». Or le
bouton Réglages n'apparaissait **que si le projet contenait déjà des plans**, et
l'assistant démarre justement d'un projet vide. Le message envoyait vers une
porte qui n'existait pas.

Deux corrections, et la seconde vaut pour toutes les autres :

- **Les réglages s'ouvrent dès qu'un projet existe**, vide ou non. C'est là que
  vit la sauvegarde en ligne, et un projet vide est justement celui d'où l'on
  part. L'export, lui, n'aurait rien à écrire : il se grise.
- **Le message ouvre le panneau lui-même** au lieu d'expliquer où le trouver.
  Un passage obligé qui décrit un chemin est un passage obligé raté.

Un défaut plus grave découvert en corrigeant celui-là : la lecture des plans
utilisait un paramètre `enchaine` **jamais déclaré**. La fonction levait donc une
erreur en fin de parcours, et l'assistant s'arrêtait là. Le test de bout en bout
ne l'avait pas vu — il avait choisi « sans lecture », le seul chemin qui
n'atteignait pas la ligne fautive.

## Archiver, plutôt que supprimer

Un montage terminé n'a pas à disparaître pour cesser d'encombrer. Un quatrième
onglet, **Historique**, range ce qu'on ne veut plus voir sans rien détruire :
le projet quitte la barre, il garde ses plans, ses coupes, sa musique et son
tempo, et il revient d'un geste.

C'est aussi pourquoi l'archive n'est **pas** une suppression. La corbeille pose
une pierre tombale et oublie le montage sur tous les appareils au bout de
quatre-vingt-dix jours ; archiver ne promet rien de tel. Les deux boutons
existent côte à côte dans les réglages du projet, et seule la suppression
demande confirmation.

Trois points qu'il a fallu traiter pour que le rangement tienne :

- **L'archive voyage.** L'empreinte qui décide si un projet a changé ne retenait
  que son nom et ses plans : ranger un montage ne bougeait donc pas sa date de
  modification, et l'autre appareil continuait de l'afficher dans sa barre. Elle
  retient maintenant l'archive.
- **Un projet rangé ne se rouvre pas tout seul.** Au chargement comme après une
  fusion avec le coffre, le projet actif est choisi parmi les vivants — sans
  quoi l'onglet Projet montrait ce qu'on venait d'en retirer.
- **Le choix « dans quel projet ranger ce plan » ignore les archives.** Elles
  encombraient une liste qui sert à travailler.

Éprouvé : archiver retire le montage de la barre et déplace l'actif vers un
projet vivant ; l'historique l'affiche avec ses cinq plans, son tempo et sa date ;
« Rouvrir » le rend à la barre, le rend actif, et rien n'a bougé — plans, tempo
et drapeau d'archive compris.

## Un champ vide qui se prend pour un champ rempli

Le champ des animés affichait `Chainsaw Man, Jujutsu Kaisen, Demon Slayer…` en
gris. C'est un exemple, pas une valeur — mais rien ne le disait, et le
lancement partait chercher des plans pour personne avant de rendre « Aucun plan
trouvé. Vérifie le nom de l'animé », ce qui accusait l'orthographe d'un titre
qui n'existait pas.

Deux corrections, et la seconde vaut mieux que la première :

- **Le lancement refuse tôt**, avant toute recherche, et dit exactement ce qui
  manque : « le champ affiche un exemple en gris, mais il est vide ».
- **Des propositions à taper** sous le champ, tirées de `/api/suggest`. Elles
  remplissent, et montrent du même coup ce que l'outil sait trouver à coup sûr.
  En « un seul animé » la proposition remplace ; en mixte elle s'ajoute — c'est
  tout l'objet du mode.

Un défaut trouvé en les éprouvant : après une tape, la liste se vidait. Le terme
cherché était le dernier morceau du champ, c'est-à-dire le titre qu'on venait de
choisir — aussitôt écarté comme déjà pris. Le terme est maintenant vide quand ce
morceau correspond à un titre déjà retenu.

Vérifié : deux tapes en mixte donnent `Chainsaw Man, Jujutsu Kaisen` avec six
nouvelles propositions derrière ; une tape en « un seul animé » remplace.

## Importer ne doit pas faire sortir du parcours

Choisir un fichier fermait le panneau. On se retrouvait devant le montage, sans
rien qui dise qu'il fallait rouvrir « Créer un AMV » pour continuer — l'assistant
posait un ordre, et la première étape en éjectait.

On reste désormais dedans : le bouton passe à **« Lecture du tempo… »**, le
fichier se charge, son tempo se lit, et l'étape du montage s'ouvre d'elle-même.
Si le tempo ne se lit pas en trente secondes, le panneau le dit et rend la main
plutôt que de laisser tourner.

Vérifié : import d'un MP3 depuis l'étape « En apporter une », et le panneau
bascule seul sur « Montage automatique » avec **162,4 BPM** relevés et
« Automatiser l'AMV » prêt.

## Importer un MP3 sur iPhone

`accept="audio/*"` suffit partout sauf là où ça compte. Sur iPhone, ce type
générique fait ouvrir la **bibliothèque Musique** — dont les morceaux achetés
sont protégés et refusent d'être choisis — au lieu de l'application Fichiers, où
vit le MP3 qu'on vient de télécharger. Résultat : un sélecteur qui s'ouvre, et
aucun fichier sélectionnable.

Énumérer les extensions avant le type générique fait basculer le sélecteur sur
les documents :

```
.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.aif,.aiff,.webm,audio/*
```

Le message d'échec le dit aussi, maintenant : un morceau de la bibliothèque
Musique est protégé, et **aucune** application ne peut l'ouvrir — il faut passer
par un fichier téléchargé.

Le reste de la chaîne n'était pas en cause. Vérifié avec un vrai MP3 de 1,2 Mo :
importé, durée lue à 29,91 s, tempo à **162,4 BPM**, deux sections découpées,
sans une erreur.

## Sauvegarder un montage

Ce qu'un montage a d'irremplaçable tient dans presque rien. Mesuré : un plan
pèse **609 octets**, soixante plans **37 Ko**. Les vidéos, elles, font des
gigaoctets — mais l'application sait les retrouver seule depuis leur source. On
ne sauvegarde donc que les décisions : l'ordre des plans, les coupes, les noms.

Le risque est réel. Sur iPhone, [WebKit efface le stockage d'un site après sept
jours sans interaction](https://webkit.org/blog/14403/updates-to-storage-policy/) ;
une application posée sur l'écran d'accueil a son propre compteur, remis à zéro
à chaque usage, mais deux semaines sans y toucher, un effacement des données de
site ou un changement de téléphone emportaient tout. Et jusqu'ici, **un
enregistrement qui échouait ne disait rien** : le quota plein était attrapé et
ignoré, on continuait à monter en croyant que tout était conservé. Un bandeau le
signale désormais, avec le bouton qui sauvegarde immédiatement dans un fichier.

Deux chemins, parce qu'ils ne protègent pas des mêmes accidents.

### Le fichier

`Réglages → Sauvegarde → Sauvegarder dans un fichier` produit un `.json` de
quelques kilo-octets, à poser où l'on veut. La restauration **n'écrase jamais** :
un projet du fichier remplace celui de même identifiant s'il est plus récent, les
autres s'ajoutent. Restaurer une vieille sauvegarde ne peut donc pas emporter un
montage commencé depuis.

### Le coffre

Sauvegarde automatique sur [Workers KV](https://developers.cloudflare.com/kv/platform/limits/) :
1 Go de stockage, 1 000 écritures et 100 000 lectures par jour sur le plan
gratuit — et **au plus une écriture par seconde sur une même clé**, ce que nos
envois visent tous.

Trois délais se composent donc : dix secondes de calme après le dernier geste,
trente secondes au minimum entre deux écritures, et un retard maximum d'une
minute qui finit par l'emporter sur le calme. Sans ce dernier, un montage mené
sans répit repoussait l'envoi à chaque geste et n'en déclenchait aucun : une
heure de travail pouvait n'avoir jamais quitté l'appareil. Mesuré sur quarante
modifications en quatre-vingts secondes : **deux envois, soit 89 écritures par
heure** — onze heures de montage d'affilée avant d'inquiéter le quota. Et ce qui
attend part quand l'application passe à l'arrière-plan, par `sendBeacon`, le seul
moyen qui survive à une mise en veille.

Un montage de 37 Ko tient vingt-sept mille fois dans le gigaoctet offert.

Pas de compte, pas d'adresse e-mail : un **code tiré au hasard sur l'appareil**
sert d'adresse et de clé — vingt caractères de l'alphabet de Crockford (ni I, ni
L, ni O, ni U : rien qui se confonde à la recopie), dont dix-huit tirés au sort,
soit quatre-vingt-dix bits. Taper ce code sur un autre appareil y fait arriver
les montages ; c'est ainsi qu'on commence sur le téléphone et qu'on continue sur
l'ordinateur.

Les deux derniers caractères sont une **clé de contrôle vérifiée par le Worker
avant tout accès au stockage** : un code mal recopié, ou tenté au hasard, est
rejeté sans consommer une seule lecture. Contrepartie assumée de l'absence de
compte : qui détient le code détient les montages.

En cas de conflit, la fusion se fait **projet par projet, le plus récemment
modifié gagne**, et un projet qui n'existe que d'un côté n'est jamais supprimé.
Vérifié : deux appareils ayant chacun retouché le même montage plus un projet
qui leur est propre se retrouvent avec les trois, dans leur dernière version.

Enfin, le bouton de restauration apparaît **aussi sur l'écran vide**, sans
projet. C'est exactement l'état d'un téléphone réinstallé : le panneau vivait
derrière un bouton qui n'existe qu'avec un projet ouvert, donc le chemin de
secours était fermé au moment précis où il sert.

## Ce que l'application coûte à un téléphone

Un montage se fait sur un appareil qui chauffe vite et se décharge encore plus
vite. L'aperçu était un **moniteur peint sur une toile, soixante fois par
seconde, en permanence** — même à l'arrêt, même quand la vue du projet n'était
pas affichée. Mesuré au compteur du navigateur, sur un projet de deux plans :

| situation | avant | après |
|---|---|---|
| projet ouvert, à l'arrêt | 31 % de processeur, 54 images/s | **0 %, 0 image/s** |
| onglet Explorer affiché | 14 % de processeur, 60 images/s | **0 %, 0 image/s** |
| lecture en cours | 61 % de processeur, 93 images/s | **35 %, 18 images peintes/s** |

Cinq changements, tous invisibles à l'usage :

1. **Le moniteur ne peint que lorsqu'il a quelque chose de neuf à montrer.**
   Un déplacement, un doigt sur la piste, un changement de plan le réveillent ;
   sinon un battement de quatre par seconde suffit à faire vivre le chien de
   garde et le rattrapage de position. Rien de ce qu'il garantissait n'est perdu.
2. **Une seule boucle d'images à la fois.** Pendant la lecture, c'est celle du
   transport qui peint ; ailleurs, celle du moniteur. Elles tournaient toutes
   les deux.
3. **Une image identique n'est pas repeinte.** Pendant la lecture, l'instant est
   arrondi au trentième de seconde : une animation en compte vingt-quatre,
   peindre soixante fois refaisait deux fois le même travail. L'arrondi porte sur
   le temps du média, pas sur l'horloge — même résultat sur tous les appareils.
4. **La toile fait la taille à laquelle on la regarde**, et non 1280 × 720 : sur
   un téléphone, près de trois fois moins de pixels à produire par image. Elle
   est déclarée opaque, ce qui évite au navigateur de la mélanger avec ce qu'il y
   a derrière — à elle seule, cette ligne a retiré dix points de processeur en
   lecture.
5. **La réserve d'imagettes ne se constitue que pour les blocs visibles**, à un
   écran près de part et d'autre, et le défilement prépare la suite. Un projet de
   dix plans lançait jusqu'à quatre cent quatre-vingts décodages d'un coup pour
   des blocs hors de l'écran.

La sonde à imagettes relâche par ailleurs sa source trois secondes après la
dernière capture : elle gardait un fichier ouvert et décodé pour rien.

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
- **La pellicule est peinte à l'ouverture d'un projet.** Rien ne s'en chargeait : elle
  n'apparaissait que si un autre événement provoquait un redessin — une durée mesurée, un import
  qui se termine. Sur un projet déjà en cache, rien ne venait et les blocs restaient noirs.
- **Aucune colonne vide.** À défaut de l'image de son instant, une colonne reçoit l'image connue
  la plus proche : la bande reste continue et se précise à mesure que les images arrivent, au
  lieu de se remplir par plaques. L'image d'entrée d'un plan, elle, ne patiente pas derrière
  l'import — elle ne coûte qu'une lecture par plage, quand l'import en télécharge vingt
  mégaoctets.
- **La pellicule ne dispute jamais le réseau aux vidéos.** La sonde à imagettes ouvrait des
  connexions vers le même relais que les téléchargements, et un élément vidéo continue de
  remplir son tampon tout seul une fois sa source posée : mesuré, plus de vingt secondes de
  réseau pour quelques images dont on n'a pas besoin tout de suite. Elle ne travaille donc que
  sur des copies déjà présentes sur l'appareil, sa source distante est relâchée dès qu'un
  téléchargement démarre, et les blocs montrent en attendant la vignette de la source. Deux
  exceptions : un plan sans vignette, qui n'aurait rien à montrer, et un import qui a échoué,
  dont le fichier ne viendra jamais. Résultat sur quatre plans de douze mégaoctets, réseau bridé
  à six mégabits : premier plan disponible à 8,9 s au lieu de 11,9 s, tout importé en 26,5 s au
  lieu de 29,6 s.
- **Le rapatriement commence pendant qu'on regarde le rush.** Ouvrir la prévisualisation d'un
  plan lance son téléchargement au bout d'une seconde : l'attente se confond alors avec le temps
  qu'on passait de toute façon devant. Refermer sans l'ajouter interrompt le transfert, et ce qui
  est déjà arrivé est gardé à part ; la fois suivante reprend par une requête par plage, à
  l'octet où l'on s'était arrêté. Rien n'est jamais téléchargé deux fois.
- **Ce qu'on ne peut pas accélérer.** Mesuré : lire un fichier dans un lecteur vidéo ne rend pas
  son téléchargement ultérieur plus rapide (5,87 s contre 5,85 s sans lecture préalable) — le
  navigateur garde ses octets média dans un cache séparé du reste. Demander le fichier par plages
  plutôt qu'en une fois ne change rien non plus. Sur le premier passage, il n'y a donc rien à
  gagner côté application : il faut que les octets traversent le réseau. Tout le reste consiste à
  placer cette attente là où elle ne se remarque pas, et à ne jamais la refaire.
- **Un seul téléchargement à la fois, le plan courant d'abord.** Les requêtes partagent la même
  connexion vers le même domaine : les paralléliser ne gagne rien en débit et retarde le premier
  fichier — celui sur lequel on travaille. Mesuré : premier plan à 8,9 s en séquentiel, 11,9 s à
  deux de front, 14,8 s à trois, pour un total identique.
- **La sonde à imagettes passe par le relais tant que la copie locale n'est pas là.** Une image
  prise en direct sur la source « teinte » définitivement toute toile où on la dessine — la
  pellicule, puis le moniteur — et interdit d'en relire les pixels. Le relais, lui, renvoie les
  en-têtes qui l'autorisent.
- **La vignette de la source est la première image du fichier.** C'est ce que le moniteur
  affichait faute de mieux, tant que le lecteur n'avait rien à montrer — y compris sur un plan
  fractionné dont on venait de retirer le début, où elle exhibait précisément ce qu'on avait
  supprimé. Le repli puise maintenant dans la réserve d'imagettes du plan, à la position de la
  tête, puis dans son image d'entrée ; la vignette de la source ne sert plus que si le plan
  commence bien au début de son fichier, et à défaut on laisse du noir — une image fausse est
  pire que pas d'image. Un plan rogné n'a pas non plus d'affiche. Vérifié en fractionnant un
  plan, en supprimant la première partie et en rechargeant : le moniteur ne dessine plus que la
  vidéo, là où il commençait par la vignette.
- **Le plan suivant est garé sur son point d'entrée.** Il est préchargé pendant que le plan
  courant se joue, mais il restait au début de son fichier : à la bascule, le lecteur devient
  visible immédiatement et montrait les premières images du fichier — celles-là mêmes qui
  avaient été coupées — le temps que la position s'applique. Mesuré : 0 s au lieu de 4 s avant
  correction. Le moniteur refuse en outre de dessiner une image située avant le point d'entrée.
- **Une cible périmée n'est pas une consigne.** La reprise de position, qui repose la cible tant
  qu'elle n'est pas atteinte, ne distinguait pas un reste d'une demande vivante : posée juste
  avant un démarrage, elle tirait le lecteur en arrière pendant qu'il jouait. Interdire toute
  reprise pendant la lecture a été une erreur — cela abandonnait aussi les positions demandées
  par l'utilisateur, et l'image ne suivait plus le curseur. Le critère est donc la fraîcheur :
  une cible redemandée dans les 400 dernières millisecondes est une consigne et s'applique
  toujours, même vers l'arrière ; une cible plus ancienne que la lecture a dépassée est un reste
  et s'oublie. Les deux exigences sont vérifiées ensemble — l'image suit le curseur à l'arrêt
  comme pendant la lecture, et quarante relevés sur quatre secondes de lecture ne montrent aucun
  retour en arrière.
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

## Sur ordinateur : un poste de travail, pas un téléphone étiré

La page d'ordinateur était la page de téléphone agrandie : une colonne de 900
points au milieu de 1440, deux larges bandes noires de chaque côté, et une barre
d'onglets en bas — un geste de pouce, sur une machine qui n'en a pas. Les
commandes s'écartaient jusqu'aux bords opposés : plein écran à gauche, lecture au
centre, historique à droite, sans rien pour les relier. La barre d'outils
traversait toute la fenêtre alors que le contenu n'en occupait que les deux
tiers. L'aperçu, enfin, était enfermé dans un cadre de 868 × 304 — bien plus
large que le 16/9 de l'image, d'où deux bandes noires de plus.

À partir de 1024 points de large, la disposition change, sur le modèle d'un
logiciel de gestion :

- **La navigation passe à gauche**, en clair et toujours visible. Le nom de
  chaque destination est déjà écrit dans son étiquette d'accessibilité : sur un
  écran large, rien ne justifie de le cacher.
- **Le contenu occupe la place restante** avec une gouttière constante. La page
  est une grille : navigation, vue, barre d'outils — celle-ci s'arrête donc au
  bord de la navigation au lieu de traverser l'écran.
- **L'aperçu prend la hauteur** (46 % de la fenêtre, mesuré 734 × 412 sur un
  écran de 1440 et 881 × 495 sur un 1920) et **le cadre épouse l'image** : plus
  de bandes noires sur les côtés.
- **Les commandes tiennent exactement la largeur de l'image**, calculée comme
  elle. Rien ne dépasse du cadre qu'elles pilotent.
- **Les lignes de l'explorateur deviennent des lignes de tableau** : vignette,
  nom et description, puis les étiquettes remontées à droite juste avant la note
  et le bouton d'ajout. La largeur d'un écran doit porter de l'information, pas
  de l'écart.
- **Le champ de recherche et les textes sont bornés** — 640 et 760 points. Un
  texte se lit sur soixante à quatre-vingts signes ; étalé sur onze cents points,
  l'œil perd sa ligne en revenant à la marge.

Les espacements suivent désormais **une échelle de quatre pas** (4, 8, 12, 16, 24,
32) au lieu de valeurs posées au cas par cas — 5, 7, 9, 10, 12, 14 px se
côtoyaient, et deux éléments voisins ne respiraient jamais pareil.

Entre les deux, de 768 à 1023 points, la barre reste en bas mais la lecture
respire déjà. **Rien de tout cela ne touche au téléphone** : vérifié à 320, 414,
820, 1440 et 1920 points, sans débordement horizontal nulle part.

## Centrage et espacement, mesurés au pixel

Un « ✓ » posé de travers dans son bouton a lancé une revue de tous les contrôles.
La cause était générale : **on centrait par la ligne de texte, pas par la
boîte**. Un caractère seul dans un bouton n'est pas centré — le navigateur le
pose sur une ligne dont la hauteur vient des métriques de la police, jambages
compris, même quand le signe n'en a aucun. Mesuré, chaque pastille et chaque
bouton de texte portait son contenu de 0,7 à 1 point trop haut, toujours dans le
même sens.

La mesure a été faite deux fois, et la seconde a corrigé la première. Comparer le
rectangle du texte au rectangle de la boîte donne une réponse commode mais
fausse : ce rectangle est celui de la ligne, pas celui de l'encre. La vérité se
lit en capturant chaque contrôle à quatre fois la définition et en cherchant où
sont réellement les pixels qui diffèrent du fond. C'est ce que l'œil juge, et
rien d'autre.

Ce qui a changé :

- **Les deux signes du bouton d'ajout sont devenus des dessins.** Un « ✓ » et un
  « + » de police n'ont ni la même hauteur ni le même centre optique ; les
  dessins de l'application sont tracés sur une grille de 24 et tombent juste par
  construction. Vérifié : décalage de 0,00 point en x comme en y.
- **Tout ce qui centre du contenu le fait par sa boîte** — notes, étiquettes,
  pastilles, boutons de texte.
- **Les colonnes de chiffres ne bougent plus** : la note a une largeur minimale
  et une hauteur fixe, si bien que « 7 » et « 82 » n'écartent plus ce qui suit.
- **Les étiquettes ont une hauteur fixe**, pour former un bandeau régulier quel
  que soit leur texte.
- **Les écarts sont tous sur l'échelle.** Il en restait douze pris au cas par cas
  — 5, 6, 7, 9, 10, 14 px — dans l'en-tête, les onglets, les lignes de
  l'explorateur, les étiquettes, le transport, les cartes de projet.
- **Deux voisins de même nature ont la même taille** : les boutons de l'en-tête
  se répondaient à un point près ; la vignette d'une carte de projet dépassait
  son texte de trois points.
- Un rose du thème rouge d'avant traînait encore sur les étiquettes, posé sur un
  fond vert.

### Zoomé, la pellicule montre les images une par une

Même juste à la demi-colonne près, la pellicule ne pouvait pas répondre à la
question que se pose un monteur : *quelle image y a-t-il sous mon curseur ?* À
360 points par seconde, une colonne de 64 points couvre **quatre images de la
source** — le moniteur change donc quatre fois pendant que le curseur traverse
une seule colonne. Sur une suite d'impact frames, où deux images voisines n'ont
rien à voir, l'aperçu montrait un éclair magenta et la colonne un plan calme.

Dès qu'une image de la source occupe **onze points ou plus**, la pellicule change
de régime : une colonne vaut une image, calée sur la trame du fichier. Le curseur
tombe alors dans la colonne de l'image que le moniteur affiche. Vérifié : à 448
points par seconde, 34 colonnes pour 1,01 image chacune ; à 1331, 12 colonnes
pour 0,96. Et sur six positions successives, la colonne sous le curseur montre
bien l'image de l'aperçu.

Le seuil se juge **en points, pas en pixels d'écran** : sinon il se déclencherait
deux fois plus tôt sur un téléphone que sur un ordinateur, pour des images larges
de cinq points — invisibles — et deux fois plus de captures.

À ce régime, aucune image de remplacement n'est tolérée : l'image voisine est une
autre image du film, et la montrer serait exactement l'erreur qu'on cherche à
supprimer. Une colonne reste sombre le temps de sa capture.

Enfin, **l'ordre de service suit le curseur**. La file se servait par la fin, et
les colonnes sont demandées de gauche à droite : la dernière colonne du dernier
bloc arrivait la première. On sert désormais l'image exacte la plus proche de la
tête de lecture — la pellicule se remplit autour de ce qu'on regarde.

### La pellicule doit dire où l'on est

Une colonne de pellicule ne montrait pas l'image de sa position, mais celle du
point le plus proche d'une **grille en puissances de deux** — un pas arrondi à la
puissance la plus proche, donc jusqu'à une fois et demie plus grossier qu'une
colonne. Deux colonnes voisines retombaient alors sur la même image, et une
colonne pouvait montrer une image prise une seconde plus loin : vingt-quatre
images d'écart. Pour choisir un point de coupe, c'est une erreur de coupe.

Trois réglages, tous dans le même sens :

- **Le pas de la grille est arrondi vers le bas**, donc toujours au plus égal à
  la durée d'une colonne. L'écart entre l'image montrée et la position de la
  colonne ne peut plus dépasser une demi-colonne — l'image appartient toujours à
  la colonne qui la porte.
- **Les images de secours respectent la même limite.** À défaut d'image, on
  descendait jusqu'à une grille deux cent cinquante-six fois plus grossière, ou
  on acceptait une image prise quatre colonnes plus loin. Les deux sont ramenés à
  la demi-colonne.
- **Une capture impossible n'est plus retentée sans fin.** Un instant illisible —
  au-delà de la fin réelle du fichier, par exemple — était redemandé à chaque
  redessin, échouait au bout de huit secondes, et bloquait pendant tout ce temps
  toutes les autres captures. Une seule position impossible suffisait à laisser
  la pellicule presque vide. Les échecs sont désormais retenus.

Une tentative intermédiaire a été écartée : demander en plus l'image exacte de
chaque colonne. C'était plus juste encore, mais la file s'en trouvait saturée et
la pellicule restait vide plusieurs secondes après chaque déplacement — une bande
vide renseigne moins bien qu'une bande juste à la demi-colonne près.

Vérifié en posant la tête de lecture au bord de quatre colonnes successives et en
comparant l'image de la colonne à celle du moniteur : les quatre concordent.

### Un bloc ne montre que son propre plan

Le bloc portait en fond **la vignette fournie par la source** — c'est-à-dire la
première image du fichier d'origine — en attendant sa vraie image d'entrée. Sur
un plan rogné, cette vignette montrait donc exactement ce qu'on venait de
couper, et elle restait là jusqu'à la capture. Un bloc doit montrer son plan, pas
ce qu'il n'est plus : la vignette de source a disparu des blocs, qui restent sur
leur surface nue le temps que leur première image arrive.

Et cette image arrive maintenant en premier. La file des captures se servait par
la fin, alors que les colonnes sont demandées de gauche à droite : la couverture
du premier bloc arrivait **bonne dernière**, après toutes les colonnes de tous
les blocs. Sur un montage de deux plans, on voyait le second se remplir pendant
que le premier restait nu. L'image d'entrée passe désormais devant toutes les
autres.

### Le décalage qui restait : la forme, pas la boîte

Une seconde capture, prise sur l'iPhone, montrait encore un décalage. Les boîtes
étaient pourtant centrées au pixel. Le défaut était **d'un cran en dessous** :
chaque dessin est tracé dans une grille de 24 sur 24, et **treize des
vingt-deux n'étaient pas centrés dans leur propre grille**. Le tiret d'entrée
penchait d'une unité à droite, celui de sortie d'une unité à gauche, les ciseaux
tombaient de 0,8 vers le bas, la corbeille de 0,5 — une unité vaut quatre pour
cent de la largeur du dessin, soit près d'un point sur un bouton de la barre
d'outils. Le bouton avait beau être juste, la forme qu'il contenait ne l'était
pas.

Plutôt que de retoucher des tracés — qu'on relit ensuite mal —, on décale le
cadre de lecture : déplacer l'origine de la grille de (dx, dy) recentre le
dessin d'autant, sans toucher à une seule coordonnée. Vérifié dessin par dessin :
vingt et un tombent maintenant exactement au centre, et aucun n'est rogné par son
cadre. Le vingt-deuxième est le triangle de lecture, décalé d'une unité à droite
**volontairement** : un triangle centré géométriquement paraît penché à gauche.

Deux autres causes tenaient au rendu, et pas à la mise en page :

- **Trois dessins avaient une taille impaire dans une boîte paire** — 21 dans 40,
  29 dans 54, 19 dans 38. Le milieu tombe alors sur un demi-point, qui n'existe
  pas sur un écran à deux ou trois pixels par point : le dessin se pose entre
  deux pixels et paraît décalé. Tous les dessins sont maintenant pairs, et une
  mesure vérifie qu'ils atterrissent sur des pixels entiers aux trois densités.
- **La barre d'onglets répartissait ses boutons par espaces égaux** autour de
  largeurs fixes : 31,5 points de marge sur un écran de 414. Les trois boutons se
  partagent désormais la largeur à parts égales.
- **L'aperçu, en 16/9 sur une largeur quelconque, avait une hauteur à virgule**
  — 382 points de large font 214,875 de haut — et toute la colonne en dessous se
  posait entre deux pixels. Cette hauteur est arrondie une fois.

Enfin, les boutons perdent leur habillage natif (`appearance: none`). Safari leur
applique un rendu système avec ses propres marges internes et sa propre façon
d'aligner le contenu : c'est la raison la plus probable pour qu'un même bouton
paraisse centré sur un ordinateur et de travers sur un iPhone.

Reste un demi-point de décalage vers le bas sur les petites étiquettes. Il tient
aux métriques de la police à cette taille, il vaut deux sous-pixels sur un écran
de téléphone, et le corriger demanderait un calage dépendant de la police — ce
serait échanger un défaut invisible contre un défaut fragile.

## Audit : quatorze défauts trouvés et corrigés

Une revue complète du code et un passage en force sur l'interface, geste par
geste, en relevant chaque erreur. L'interface elle-même s'est révélée saine — pas
une erreur de script sur vingt-trois gestes enchaînés. Les défauts étaient
ailleurs.

**Perte de données**

- **Un montage supprimé revenait d'entre les morts.** Vérifié : effacé sur le
  téléphone, il subsistait sur l'ordinateur, qui le redéposait au coffre et le
  renvoyait au téléphone. Une fusion qui ne sait qu'ajouter ne peut pas propager
  un retrait. Les suppressions sont désormais datées et voyagent avec les
  projets — et surtout, **le dépôt fusionne au lieu d'écraser, côté serveur** :
  deux appareils ouverts en même temps déposaient chacun leur état, et le dernier
  à parler effaçait le travail de l'autre. Aucun appareil ne peut connaître
  l'état de l'autre au moment où il parle ; le coffre, lui, les voit tous les
  deux.
- **Ouvrir un projet suffisait à le déclarer « plus récent ».** L'horodatage
  suivait la durée lue dans les fichiers — une donnée que l'application se
  procure toute seule. Lancer l'application sur le second appareil pouvait donc
  écarter une vraie modification faite sur le premier. L'empreinte ne retient
  plus que les décisions : le nom, la suite des plans, leurs bornes.
- **Un projet malformé emportait toute l'application.** Un seul projet sans
  tableau de plans — écriture interrompue, fichier bricolé — et l'affichage
  échouait ; comme le bouton de restauration vit dans cet affichage, on se
  retrouvait devant une application morte, sans retour possible. Ce qui est lu
  est maintenant filtré sur sa forme.

**Robustesse**

- **Une panne passagère devenait durable.** Les réponses en erreur portaient
  `public, max-age=900` comme les autres : une recherche tombée sur un hoquet de
  Sakugabooru renvoyait « Rien trouvé » pendant un quart d'heure, y compris pour
  un animé qui existe. Elles sont en `no-store`.
- **Un fichier manquant figeait l'application chez l'utilisateur.** Le service
  worker mettait sa coquille en cache d'un bloc ; une icône renommée dans un
  déploiement faisait échouer l'installation entière, le nouveau worker ne
  prenait jamais la main, et la mise à jour n'arrivait plus jamais. Chaque
  fichier est désormais mis en cache pour lui-même.
- **Une panne du serveur devenait la page hors ligne**, gardée telle quelle.
  Seule une réponse valable est conservée.
- **Le budget de sous-requêtes était atteignable.** Le plan gratuit en autorise
  cinquante par appel ; essayer six tags avant de trouver le bon en coûtait
  jusqu'à cinquante-quatre, parce qu'un tag vide déclenchait une vague de cinq
  requêtes pour apprendre qu'il n'y a rien. La première page part seule : une
  requête suffit à le savoir.
- **« Sakugabooru est injoignable » s'affichait pour tout**, y compris une panne
  d'AnimeThemes ou du coffre. Le message nomme la route qui a échoué.

**Sécurité et ressources**

- **Le relais était ouvert à tout le web.** Il annonçait
  `access-control-allow-origin: *` : n'importe quel site pouvait servir des
  vidéos à travers ce Worker, aux frais du compte et sur son quota de cent mille
  requêtes par jour. Le cas principal — une balise `<video>` posée ailleurs —
  n'envoie aucun en-tête `Origin` : c'est `Sec-Fetch-Site` qui le trahit, et
  c'est lui qu'on regarde. Vérifié en production : `cross-site` → 403, notre page
  → 206.
- **Les redirections n'étaient pas vérifiées.** Une source de la liste blanche
  qui renverrait ailleurs faisait de ce relais un passe-plat vers n'importe quel
  hôte. Chaque saut est revérifié.
- **La mémoire des imagettes ne se libérait jamais.** Elles sont rangées par
  identifiant de plan, et rien n'effaçait celles d'un plan disparu — or
  fractionner un plan donne au second morceau un identifiant neuf. Six cents
  images de 160 × 90 font trente-quatre méga-octets pour un seul plan : sur une
  longue séance, la mémoire ne faisait que monter, jusqu'à ce que le système
  referme l'onglet. Les pellicules orphelines sont maintenant purgées.

**Détails**

- L'en-tête débordait de la fenêtre sur un écran de 320 points, et toute la page
  défilait latéralement. Mesuré : 354 pixels dans une fenêtre de 320.
- Deux coupes dans la même milliseconde produisaient deux plans de même
  identifiant, ce qui dérègle la sélection et l'historique.
- L'export échouait sur un rush sans adresse de fichier.

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
