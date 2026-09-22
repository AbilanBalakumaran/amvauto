#!/usr/bin/env python3
"""Le rendu d'un AMV à partir de sa seule feuille de route.

Le téléphone ne monte rien : il décrit. Ce script lit cette description, va
chercher les octets utiles de chaque rush — et rien qu'eux —, découpe, assemble
et pose la musique. Tout se fait en copie de flux quand c'est possible ; on ne
réencode que ce qui l'exige.

La feuille de route :

    {
      "cadence": 24,
      "largeur": 1280,
      "hauteur": 720,
      "musique": "https://…/piste.mp3",     (facultatif)
      "plans": [
        {"video": "https://…/rush.mp4", "entree": 12.0, "sortie": 13.1},
        …
      ]
    }

Aucune dépendance en dehors de FFmpeg et de la bibliothèque standard : ce qui
tourne ici doit tourner sur n'importe quel runner, sans installation. Les deux
modules voisins — « sens.py » et « teinte.py » — suivent la même règle.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

import sens as mesure_sens
import teinte

# Les seules sources dont on accepte de tirer des octets. Une feuille de route
# est une entrée extérieure : elle ne doit pas pouvoir faire aller chercher
# n'importe quoi n'importe où.
HOTES = {
    "www.sakugabooru.com",
    "sakugabooru.com",
    "v.animethemes.moe",
    "animethemes.moe",
    # La musique du montage, déposée par l'application le temps du rendu : elle
    # vient d'un fichier choisi sur le téléphone, elle n'a pas d'autre adresse.
    "amvauto.mangateamz2.workers.dev",
}

ENTETES = {"User-Agent": "amvauto/0.1 (+https://github.com/AbilanBalakumaran/amvauto)"}


def permise(adresse):
    from urllib.parse import urlparse

    morceau = urlparse(adresse)
    return morceau.scheme == "https" and morceau.hostname in HOTES


TAILLE_MINI = 2048          # en deçà, ce n'est pas une vidéo mais une page d'erreur
ESSAIS = 3                  # un 503 de Sakugabooru n'est pas un rush perdu
ATTENTE = 2                 # secondes, doublées à chaque essai


def telecharger(adresse, vers):
    """Un fichier, et la certitude de l'avoir reçu en entier.

    Une coupure en cours de transfert ne lève rien : « copyfileobj » s'arrête où
    le flux s'arrête, et le fichier tronqué a l'air d'un fichier. On compare donc
    ce qu'on a écrit à ce que le serveur annonçait, et on refuse ce qui est trop
    petit pour être une vidéo — une page d'erreur HTML fait deux kilo-octets.
    """
    if not permise(adresse):
        raise ValueError(f"source non autorisée : {adresse}")
    requete = urllib.request.Request(adresse, headers=ENTETES)
    with urllib.request.urlopen(requete, timeout=120) as reponse, open(vers, "wb") as fichier:
        annonce = reponse.headers.get("content-length")
        shutil.copyfileobj(reponse, fichier)
    recu = os.path.getsize(vers)
    if annonce and int(annonce) != recu:
        raise RuntimeError(f"transfert incomplet : {recu} octets sur {annonce}")
    if recu < TAILLE_MINI:
        raise RuntimeError(f"fichier trop petit pour une vidéo : {recu} octets")
    return vers


def telecharger_avec_patience(adresse, vers):
    """Trois essais, puis on renonce À CE RUSH — pas au rendu.

    Cent vingt-trois rushs téléchargés pendant trois minutes, et le rendu entier
    annulé parce que le cent-vingt-troisième a rendu un 503 : c'est le scénario
    qu'on refuse. Un rush mort est un rush remplacé, et le journal le dit.
    """
    souci = None
    for essai in range(1, ESSAIS + 1):
        try:
            return telecharger(adresse, vers)
        except Exception as raison:                      # noqa: BLE001
            souci = raison
            try:
                os.remove(vers)
            except OSError:
                pass
            if essai < ESSAIS:
                attente = ATTENTE * (2 ** (essai - 1))
                print(f"   raté ({raison}) — on réessaie dans {attente} s", flush=True)
                time.sleep(attente)
    print(f"   ABANDONNÉ après {ESSAIS} essais : {souci}", flush=True)
    return None


def ffmpeg(*arguments):
    """FFmpeg, en silence sauf s'il échoue — un log de rendu doit être lisible."""
    commande = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments]
    fait = subprocess.run(commande, capture_output=True, text=True)
    if fait.returncode != 0:
        raise RuntimeError(f"ffmpeg a refusé : {fait.stderr.strip()[:400]}")


# ---- Ce qui a été RETIRÉ, et pourquoi c'est écrit ici ---------------------
#
# Ce fichier a porté quatre effets procéduraux, tous mesurés, tous validés, tous
# retirés le 22/09/2026 sur une décision de mise en scène : un rush de sakuga se
# monte À L'ÉTAT BRUT.
#
#   l'éclair d'impact     une image blanche sur la première image du plan
#   la secousse           5 % de zoom et 3 px de déplacement, trois images
#   la rampe de vitesse   0,65× avant le pic, 1,8× après
#   la pulsation          un stroboscope d'une image sur les roulements
#
# Ils marchaient. La durée de sortie ne bougeait pas d'une image, la rampe allait
# chercher le pic à l'image près, le stroboscope stroboscopait vraiment. Ce n'est
# pas pour un défaut technique qu'ils partent : c'est que du zoom numérique et du
# ré-échantillonnage temporel posés sur de l'animation dessinée à la main la
# dénaturent. Un animateur a décidé de la vitesse de son geste ; la rejouer à
# 0,65× efface ce qu'il a fait.
#
# Ce qui RESTE, et c'est le seul survivant : l'harmonisation colorimétrique vers
# la médiane du montage. Elle ne change ni le cadre, ni la vitesse, ni une seule
# image — elle rapproche un cut de 2003 d'une séquence de 2024 pour que la coupe
# entre les deux ne saute pas.
#
# Le montage continue de MESURER les crêtes et les roulements : c'est d'eux que
# dépendent le choix du plan et la fenêtre taillée autour du coup. Mais ils ne
# traversent plus. La feuille de route portait « eclair », « pic » et
# « pulsations » ; ces trois champs ont été retirés avec les effets qu'ils
# commandaient. Une consigne que personne n'exécute n'est pas inoffensive : elle
# se relit comme une intention à honorer. Ce que la feuille de route contient est
# désormais ce que ce script fait, et rien de plus — une adresse, deux bornes, un
# nom, une famille, et la correction de couleur.


def decouper(source, entree, sortie, vers, cadence, largeur, hauteur, couleur=""):
    """Un plan, normalisé au cadre commun — et rien d'autre.

    On réencode ici, et c'est voulu : les rushs viennent de sources différentes,
    avec des définitions et des cadences qui ne concordent pas. Les concaténer en
    copie de flux produirait un fichier que la plupart des lecteurs refusent. Le
    runner a le temps ; le téléphone ne l'avait pas.

    La chaîne de filtres ne contient plus que du cadrage et, quand il y a lieu, la
    correction colorimétrique. Ni « zoompan », ni « drawbox », ni « setpts » : la
    vitesse et le cadre du rush sont ceux que l'animateur a dessinés.
    """
    duree = max(0.05, float(sortie) - float(entree))
    images_voulues = int(round(duree * cadence))

    filtres = [
        f"scale={largeur}:{hauteur}:force_original_aspect_ratio=decrease",
        f"pad={largeur}:{hauteur}:(ow-iw)/2:(oh-ih)/2:color=black",
        f"fps={cadence}",
        # La source peut être plus courte que la case — un rush de remplacement
        # dont on ne connaît pas la durée, une fenêtre qui frôle la fin du
        # fichier. « tpad » prolonge alors la dernière image indéfiniment, et
        # « -frames:v » tranche au compte exact : la case fait TOUJOURS la durée
        # annoncée. Sans ça, une source trop courte raccourcit le plan, et tout
        # ce qui suit glisse à côté de la musique.
        "tpad=stop=-1:stop_mode=clone",
        "setsar=1",
    ]
    # Le seul effet qui reste, et il ne touche ni le cadre ni la vitesse : ramener
    # la luminance, le contraste et la saturation vers la médiane du montage, pour
    # qu'un cut de 2003 ne saute pas à côté d'une séquence de 2024.
    if couleur:
        filtres.append(couleur)

    ffmpeg(
        "-ss", f"{float(entree):.4f}",
        "-i", source,
        # Deux images de rab, et « -frames:v » tranche à l'exact.
        #
        # Le banc l'a trouvé : une case de 0,5 s sortait à ONZE images au lieu de
        # douze. « -ss » tombe entre deux images de la source, ffmpeg part donc de
        # la suivante et la dernière n'entre plus dans le « -t ». Sur cent coupes
        # dont beaucoup sont courtes, ce sont des dixièmes de seconde de dérive
        # entre l'image et la musique.
        #
        # On demande donc un peu plus que nécessaire et l'on coupe au compte.
        "-t", f"{duree + 2 / cadence:.4f}",
        "-an",
        "-vf", ",".join(filtres),
        "-frames:v", str(max(1, images_voulues)),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        vers,
    )


def noircir(vers, duree, cadence, largeur, hauteur):
    """Une case noire de la durée exacte : le tout dernier recours.

    Mieux vaut deux secondes de noir dans un AMV que pas d'AMV du tout — et
    surtout, la ligne de temps garde sa longueur, donc tout ce qui suit reste
    calé sur la musique. Le journal le compte, et le rapport le dit.
    """
    images = max(1, int(round(duree * cadence)))
    ffmpeg(
        "-f", "lavfi", "-i", f"color=black:s={largeur}x{hauteur}:r={cadence}",
        # Même rapport de pixels que les autres cases : le collage se fait en
        # copie de flux, et un SAR qui diffère le ferait échouer.
        "-vf", "setsar=1",
        "-frames:v", str(images),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", vers,
    )
    return vers


def remplacants(plan, rapatries, combien=3):
    """Quelques rushs vivants pour tenir la case d'un rush mort.

    On tourne dans la liste au lieu de reprendre toujours le premier : sans ça,
    dix rushs perdus donneraient dix fois le même plan de remplacement — la
    redite, précisément ce que tout le montage s'échine à éviter. Le point de
    départ dépend de l'adresse morte, donc deux cases perdues distinctes
    reçoivent deux remplaçants distincts. Et « crc32 » plutôt que « hash » :
    celui de Python est salé à chaque démarrage, donc deux rendus de la même
    feuille de route ne choisiraient pas les mêmes images.
    """
    sienne = plan.get("video") or ""
    vivants = sorted(adresse for adresse in rapatries if adresse != sienne)
    if not vivants:
        return []
    depart = zlib.crc32(sienne.encode()) % len(vivants)
    return [vivants[(depart + i) % len(vivants)] for i in range(min(combien, len(vivants)))]


def assembler(morceaux, vers, dossier):
    """Bout à bout, sans réencoder : les morceaux partagent déjà tout."""
    liste = os.path.join(dossier, "liste.txt")
    with open(liste, "w", encoding="utf-8") as fichier:
        for morceau in morceaux:
            chemin = morceau.replace("'", "'\\''")
            fichier.write(f"file '{chemin}'\n")
    ffmpeg("-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", vers)


def poser_musique(video, musique, vers):
    """La musique donne la durée : le montage a été taillé pour elle."""
    ffmpeg(
        "-i", video,
        "-i", musique,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart",
        vers,
    )


def renvoyer_les_sens(rapatries, plans, mesures=None):
    """Le sens de chaque rush, mesuré ici et renvoyé au cache des fiches.

    Ce Worker-là ne peut pas le faire : il lit des en-têtes, il n'a pas de
    décodeur. Le runner, lui, a ffmpeg et tient déjà les fichiers — la mesure
    coûte une soixantaine de millisecondes par rush. Ce qu'il écrit sert aux
    générations suivantes : le raccord de mouvement se réveille sur un catalogue
    déjà rendu une fois.

    Rien de ce qui se passe ici ne peut faire échouer un rendu : l'AMV est déjà
    écrit sur le disque quand on arrive là.
    """
    code = os.environ.get("AMVAUTO_CODE", "").strip()
    hote = os.environ.get("AMVAUTO_HOTE", "").strip().rstrip("/")
    if not code or not hote:
        print("sens : pas de code ni d'hôte, on ne renvoie rien", flush=True)
        return 0

    # Une fenêtre par rush : celle du premier plan qu'on y a pris. Mesurer le
    # fichier entier dirait la moyenne de plusieurs scènes ; ce qui nous
    # intéresse est le morceau que le montage emploie.
    fenetre = {}
    for plan in plans:
        adresse = plan.get("video")
        if adresse and adresse not in fenetre:
            fenetre[adresse] = (float(plan.get("entree") or 0), float(plan.get("sortie") or 0))

    ecrits = 0
    for adresse, fichier in rapatries.items():
        debut, fin = fenetre.get(adresse, (0.0, 0.0))
        try:
            lu = mesure_sens.direction(fichier, debut=debut, duree=max(0.0, fin - debut))
        except Exception as souci:                      # noqa: BLE001
            print(f"sens : mesure impossible ({souci})", flush=True)
            continue
        if not lu.get("sens"):
            continue
        # La teinte part avec le sens : même fichier, même passage, même appel.
        # Elle a déjà été mesurée pour l'harmonisation, elle ne coûte rien de plus.
        dedans = {"sens": lu["sens"], "force": lu.get("force", 0)}
        # Le tiers où l'action se concentre : c'est lui qui guide le regard d'un
        # plan au suivant sur les coupes rapides.
        if lu.get("ou"):
            dedans["ou"] = lu["ou"]
        couleur = mesures.get(adresse) if mesures else None
        if couleur and couleur.get("teinte") is not None:
            dedans["teinte"] = couleur["teinte"]
            dedans["teinteForce"] = couleur.get("teinteForce", 0)
        charge = json.dumps(dedans).encode()
        cible = (f"{hote}/api/cles?code={urllib.parse.quote(code)}"
                 f"&u={urllib.parse.quote(adresse, safe='')}")
        requete = urllib.request.Request(cible, data=charge, method="PUT",
                                         headers={**ENTETES, "content-type": "application/json"})
        try:
            with urllib.request.urlopen(requete, timeout=30) as reponse:
                if reponse.status < 300:
                    ecrits += 1
        except urllib.error.HTTPError as souci:
            # 404 : la fiche n'a jamais été lue, il n'y a rien à enrichir. Ce
            # n'est pas une panne, c'est un rush que le montage a pris sans
            # passer par « /api/cles ».
            print(f"sens : {souci.code} sur {adresse[:60]}", flush=True)
        except Exception as souci:                      # noqa: BLE001
            print(f"sens : envoi impossible ({souci})", flush=True)
    print(f"sens : {ecrits}/{len(rapatries)} fiches enrichies", flush=True)
    return ecrits


def main():
    if len(sys.argv) < 3:
        print("usage : rendu.py <montage.json> <sortie.mp4>", file=sys.stderr)
        return 2
    montage = json.load(open(sys.argv[1], encoding="utf-8"))
    sortie = sys.argv[2]

    cadence = int(montage.get("cadence") or 24)
    largeur = int(montage.get("largeur") or 1280)
    hauteur = int(montage.get("hauteur") or 720)
    plans = montage.get("plans") or []
    if not plans:
        print("la feuille de route ne contient aucun plan", file=sys.stderr)
        return 1

    dossier = tempfile.mkdtemp(prefix="amvauto-")
    try:
        # Un rush sert souvent plusieurs plans : on ne le télécharge qu'une fois.
        rapatries = {}
        perdus = []
        vus = 0
        for plan in plans:
            adresse = plan["video"]
            if adresse in rapatries or adresse in perdus:
                continue
            vus += 1
            vers = os.path.join(dossier, f"rush{vus}.mp4")
            print(f"rush {vus} : {adresse}", flush=True)
            obtenu = telecharger_avec_patience(adresse, vers)
            if obtenu:
                rapatries[adresse] = obtenu
            else:
                perdus.append(adresse)
        if perdus:
            print(f"rushs perdus : {len(perdus)} sur {vus} — ils seront remplacés",
                  flush=True)
        # Rien du tout, c'est autre chose qu'un rush mort : le réseau est coupé,
        # ou la liste blanche a tout refusé. Là, il n'y a pas de rendu possible.
        if not rapatries:
            print("aucun rush n'a pu être téléchargé : rien à monter",
                  file=sys.stderr)
            return 1

        # L'harmonisation, mesurée avant de découper.
        #
        # Il faut connaître le milieu du montage pour savoir vers quoi ramener
        # chacun : la mesure passe donc sur tous les rushs d'abord, la médiane se
        # calcule, et la correction s'applique ensuite. Quelques images par rush à
        # 48 x 27 — une poignée de millisecondes chacune.
        mesures = {}
        for adresse, fichier in rapatries.items():
            try:
                mesures[adresse] = teinte.mesurer(fichier)
            except Exception:                           # noqa: BLE001
                mesures[adresse] = None
        vise = teinte.cible(list(mesures.values()))
        couleurs = {}
        if vise:
            for adresse, mesuree in mesures.items():
                couleurs[adresse] = teinte.filtre(teinte.correction(mesuree, vise))
            corriges = sum(1 for x in couleurs.values() if x)
            print(f"teinte : cible lumière {vise['lumiere']:.0f} · contraste "
                  f"{vise['contraste']:.0f} · saturation {vise['saturation']:.0f}"
                  f" — {corriges}/{len(rapatries)} rushs corrigés", flush=True)
        else:
            print("teinte : trop peu de rushs pour une médiane, rien n'est corrigé",
                  flush=True)

        morceaux = []
        remplaces = 0
        noircis = 0
        for rang, plan in enumerate(plans):
            morceau = os.path.join(dossier, f"plan{rang:04d}.mp4")
            duree = max(0.05, float(plan["sortie"]) - float(plan["entree"]))

            # Ce plan a-t-il encore sa source ? Et si oui, ffmpeg la lit-il
            # vraiment ? Trois filets, essayés dans cet ordre :
            #
            #   1. le rush du montage, avec sa correction de couleur ;
            #   2. le même sans la correction — si c'est le filtre « eq » qui
            #      coince, ce n'est pas une raison de perdre l'image ;
            #   3. un autre rush du montage, pris au début du fichier, seul
            #      endroit dont on soit sûr qu'il existe.
            #
            # Dans tous les cas la case garde sa durée : c'est elle qui tient la
            # musique, et « tpad » la remplit même si le remplaçant est court.
            propre = rapatries.get(plan["video"])
            essais = []
            if propre:
                sienne = couleurs.get(plan["video"], "")
                essais.append((propre, float(plan["entree"]), sienne, ""))
                if sienne:
                    essais.append((propre, float(plan["entree"]), "", " · sans correction"))
            for adresse in remplacants(plan, rapatries):
                essais.append((rapatries[adresse], 0.0, couleurs.get(adresse, ""),
                               " · REMPLACÉ"))

            pose = None
            for source, entree, couleur, note in essais:
                try:
                    decouper(source, entree, entree + duree, morceau,
                             cadence, largeur, hauteur, couleur)
                    pose = (couleur, note)
                    break
                except Exception as souci:               # noqa: BLE001
                    print(f"   plan {rang + 1} : {souci}", flush=True)
            if pose is None:
                # Le tout dernier recours. Mieux vaut une case noire qu'un rendu
                # annulé après trois minutes — et la ligne de temps garde sa
                # longueur, donc tout ce qui suit reste calé sur la musique.
                try:
                    noircir(morceau, duree, cadence, largeur, hauteur)
                except Exception as souci:               # noqa: BLE001
                    print(f"même le noir a échoué : {souci}", file=sys.stderr)
                    return 1
                pose = ("", " · NOIR")
                noircis += 1
            elif "REMPLACÉ" in pose[1]:
                remplaces += 1
            morceaux.append(morceau)
            # Une ligne par plan, et ce qu'elle dit est tout ce qui lui arrive :
            # le cadre commun, la cadence commune, et une correction de couleur
            # quand le plan en demande une.
            #
            # Et surtout PAS « teinte = … » ici : ce nom est celui du module
            # importé en tête. Une affectation, même soixante lignes plus bas,
            # fait de « teinte » une locale de toute la fonction — donc
            # « teinte.cible() », vingt lignes plus haut, lève
            # UnboundLocalError. C'est ce qui a tué deux rendus après deux
            # minutes cinquante de téléchargements, le 22/09/2026.
            etat = "couleur harmonisée" if pose[0] else "brut"
            print(f"plan {rang + 1}/{len(plans)} · {etat}{pose[1]}", flush=True)

        if remplaces or noircis:
            print(f"plans remplacés : {remplaces} · plans noircis : {noircis}"
                  f" sur {len(plans)} — la ligne de temps garde sa durée",
                  flush=True)

        muet = os.path.join(dossier, "muet.mp4")
        assembler(morceaux, muet, dossier)

        musique = montage.get("musique")
        if musique:
            piste = telecharger(musique, os.path.join(dossier, "musique"))
            poser_musique(muet, piste, sortie)
        else:
            shutil.move(muet, sortie)

        octets = os.path.getsize(sortie)
        print(f"rendu : {octets / 1e6:.1f} Mo, {len(plans)} plans", flush=True)

        # Le rendu est écrit : ce qui suit ne peut plus rien casser.
        try:
            renvoyer_les_sens(rapatries, plans, mesures)
        except Exception as souci:                      # noqa: BLE001
            print(f"sens : abandonné ({souci})", flush=True)
        return 0
    finally:
        shutil.rmtree(dossier, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
