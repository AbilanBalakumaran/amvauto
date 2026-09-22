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
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

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


def telecharger(adresse, vers):
    if not permise(adresse):
        raise ValueError(f"source non autorisée : {adresse}")
    requete = urllib.request.Request(adresse, headers=ENTETES)
    with urllib.request.urlopen(requete, timeout=120) as reponse, open(vers, "wb") as fichier:
        shutil.copyfileobj(reponse, fichier)
    return vers


def ffmpeg(*arguments):
    """FFmpeg, en silence sauf s'il échoue — un log de rendu doit être lisible."""
    commande = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments]
    fait = subprocess.run(commande, capture_output=True, text=True)
    if fait.returncode != 0:
        raise RuntimeError(f"ffmpeg a refusé : {fait.stderr.strip()[:400]}")


# La secousse d'impact : trois images, et pas une de plus.
#
# Sur une crête servie par un choc — les mêmes coupes que l'éclair —, la caméra
# accuse le coup : cinq pour cent de zoom et un déplacement latéral de trois
# pixels, le temps de trois images, soit cent vingt-cinq millisecondes à 24 i/s.
# C'est sous le seuil où l'on voit « un effet » et au-dessus de celui où l'on ne
# voit rien : on sent la frappe sans savoir ce qui l'a produite.
#
# « zoompan » avec « d=1 » et une taille de sortie imposée rend exactement une
# image par image reçue : le compte est conservé, donc la ligne de temps ne bouge
# pas d'un vingt-quatrième de seconde. Vérifié : 36 images avant, 36 après, et les
# images 3 et suivantes rigoureusement identiques au plan sans secousse.
TRAMES_SECOUSSE = 3
ZOOM_IMPACT = 1.05
ECART_IMPACT = 3


def secousse(cadence):
    """Le filtre de secousse, ou rien."""
    fin = TRAMES_SECOUSSE / float(cadence)
    return (
        f"zoompan=z='if(lt(it,{fin:.4f}),{ZOOM_IMPACT},1)':d=1"
        f":x='iw/2-(iw/zoom/2)+if(lt(it,{fin:.4f}),{ECART_IMPACT}*sin(it*180),0)'"
        f":y='ih/2-(ih/zoom/2)'"
        f":s={{largeur}}x{{hauteur}}:fps={cadence}"
    )


# ---- La rampe de vitesse -------------------------------------------------
#
# Un monteur ne laisse presque jamais un plan de frappe à vitesse constante :
# l'anticipation s'étire pour faire monter la tension, puis le coup s'écrase en
# accélération pile sur le temps fort. C'est le geste le plus reconnaissable du
# montage de concours, et il ne s'improvise pas — il se calcule.
#
# LA CONTRAINTE QUI COMMANDE TOUT : la durée du segment sur la ligne de temps ne
# doit pas bouger d'un vingt-quatrième de seconde. Tout le montage est calé sur la
# musique ; un plan qui s'allonge de deux images décale tout ce qui suit.
#
# Or on ne peut pas à la fois garder la durée de sortie, garder la fenêtre source
# ET choisir les deux vitesses : les trois se contredisent. Si l'on joue [0, p) à
# 0,65× et [p, D) à 1,8×, la sortie dure p/0,65 + (D−p)/1,8, et cela ne vaut D que
# si le pic tombe pile à 45,2 % du plan. Il n'y tombe jamais.
#
# C'est donc la FENÊTRE SOURCE qu'on recalcule autour du pic, et c'est exactement
# ce que fait un monteur : il déplace son point d'entrée pour que l'impact tombe
# sur le temps. La durée de sortie, elle, ne bouge pas d'une image.
#
#   sortie : N images, dont l'impact à l'image Ni = round(f × N)
#   avant  : Ni images de sortie à 0,65×  ->  0,65 × Ni/cadence de source
#   après  : N−Ni images de sortie à 1,8× ->  1,8 × (N−Ni)/cadence de source
#
# Le point d'impact est posé à 62 % du segment : assez d'élan pour qu'on sente
# l'attente, assez de chute pour que le coup se voie.
LENT = 0.65
VIF = 1.8
PART_IMPACT = 0.62


def rampe(pic, entree, sortie, cadence, duree_source):
    """La fenêtre source et l'expression « setpts » d'une rampe, ou rien.

    Rien dès que le fichier ne peut pas fournir ce qu'il faut de part et d'autre
    du pic : mieux vaut un plan à vitesse constante qu'un plan qui déborde.
    """
    if pic is None or cadence <= 0:
        return None
    longueur = float(sortie) - float(entree)
    images = int(round(longueur * cadence))
    # Sous cinq images, une rampe ne se voit pas et ne laisse pas la place aux
    # deux phases.
    if images < 5:
        return None

    avant = int(round(PART_IMPACT * images))
    avant = max(2, min(images - 2, avant))
    apres = images - avant

    besoin_avant = LENT * avant / cadence
    besoin_apres = VIF * apres / cadence
    debut = float(pic) - besoin_avant
    fin = float(pic) + besoin_apres
    if debut < 0 or (duree_source and fin > duree_source):
        return None

    # « T » est l'instant d'entrée en secondes, remis à zéro par le « -ss ». Le
    # pic tombe donc à « besoin_avant » dans le segment découpé.
    k = besoin_avant
    expression = (f"setpts='(if(lt(T,{k:.6f}),T/{LENT},"
                  f"{k / LENT:.6f}+(T-{k:.6f})/{VIF}))/TB'")
    return {
        "debut": round(debut, 4),
        "fin": round(fin, 4),
        "images": images,
        "imageImpact": avant,
        "setpts": expression,
    }


# ---- La pulsation des roulements -----------------------------------------
#
# Dans une montée de trap, de phonk ou de drum & bass, la caisse claire et les
# charleys roulent : des doubles croches de plus en plus serrées jusqu'au drop.
# La page les repère et dit au rendu à quels instants elles tombent.
#
# Ce qu'on NE fait pas : couper à chaque frappe. Huit plans différents en une
# seconde ne se lisent pas — l'œil n'a pas le temps de comprendre une image, et
# le résultat est un bruit visuel, pas une accélération. Un monteur tient son
# plan et le fait battre.
#
# UNE image plus claire par frappe, et rien entre : c'est un stroboscope discret,
# calé au son. Et une seule, parce que le banc a montré ce qui se passe sinon.
#
# À deux images de large, les créneaux se RECOUVRENT : un roulement de doubles
# croches frappe toutes les 80 ms, une pulsation de 83 ms déborde sur la suivante,
# et les huit battements fondent en un seul éclaircissement de huit images. Ce
# n'est plus un stroboscope, c'est une lampe qu'on allume. Mesuré : images 5 à 12
# claires d'un bloc là où l'on en voulait quatre isolées.
#
# La pulsation doit donc tenir dans l'intervalle du roulement. Un peu moins d'une
# image — « between » est inclusif aux deux bouts, et à 1/cadence pile il en
# attrape deux.
#
# Comme tout le reste, ça ne touche ni la durée du plan ni son nombre d'images :
# c'est un filtre de luminance, pas une coupe.
FORCE_PULSE = 0.18
# Sous deux images d'écart, on ne peut plus alterner clair et sombre : la
# pulsation n'existe qu'à partir du moment où il y a un « entre ».
ECART_MINI_PULSE = 2


def pulsation(pulsations, cadence):
    """Le filtre qui fait battre l'image sur les frappes d'un roulement."""
    if not pulsations:
        return ""
    cadence = float(cadence)
    largeur = 0.9 / cadence
    # On écarte les frappes trop serrées pour que l'œil les distingue : sous deux
    # images d'intervalle, deux pulsations n'en feraient qu'une.
    gardees = []
    for q in sorted(float(x) for x in pulsations if float(x) >= 0):
        if gardees and (q - gardees[-1]) * cadence < ECART_MINI_PULSE:
            continue
        gardees.append(q)
    if not gardees:
        return ""
    # « eq » accepte une expression pour sa luminosité, évaluée à chaque image :
    # on somme des créneaux, un par frappe. Le plan reste le même, il bat.
    creneaux = "+".join(f"between(t,{q:.4f},{q + largeur:.4f})" for q in gardees[:24])
    return f"eq=brightness='{FORCE_PULSE}*({creneaux})':eval=frame"


def decouper(source, entree, sortie, vers, cadence, largeur, hauteur, eclair=False,
             couleur="", pic=None, duree_source=0.0, pulsations=None):
    """Un plan, normalisé au cadre commun.

    On réencode ici, et c'est voulu : les rushs viennent de sources différentes,
    avec des définitions et des cadences qui ne concordent pas. Les concaténer
    en copie de flux produirait un fichier que la plupart des lecteurs refusent.
    Le runner a le temps ; le téléphone ne l'avait pas.
    """
    duree = max(0.05, float(sortie) - float(entree))
    images_voulues = int(round(duree * cadence))

    # La rampe, quand le pic est connu ET que le fichier peut la fournir. Elle
    # recalcule la fenêtre source ; la durée de sortie, elle, ne bouge pas.
    courbe = rampe(pic, entree, sortie, cadence, duree_source) if eclair else None
    if courbe:
        entree = courbe["debut"]
        duree = courbe["fin"] - courbe["debut"]

    filtres = [
        f"scale={largeur}:{hauteur}:force_original_aspect_ratio=decrease",
        f"pad={largeur}:{hauteur}:(ow-iw)/2:(oh-ih)/2:color=black",
        f"fps={cadence}",
        "setsar=1",
    ]
    # L'harmonisation d'abord : elle corrige l'image du rush, et il ne faut pas
    # qu'elle teinte le blanc de l'éclair ni les bords noirs du cadrage.
    if couleur:
        filtres.append(couleur)
    if courbe:
        # La rampe se pose avant tout ce qui se règle sur le temps de sortie.
        # « setpts » réécrit les horodatages ; « fps » refait ensuite une cadence
        # constante, et c'est cette sortie-là que l'éclair et la secousse voient.
        filtres.append(courbe["setpts"])
        filtres.append(f"fps={cadence}")
    # La pulsation après l'harmonisation — elle s'ajoute à l'image corrigée — et
    # avant l'éclair, qui doit rester blanc pur.
    battement = pulsation(pulsations, cadence)
    if battement:
        filtres.append(battement)
    if eclair:
        # L'éclair d'impact : une seule image blanche, sur la première du plan.
        #
        # Elle REMPLACE l'image, elle ne s'insère pas. Une image ajoutée
        # décalerait tout ce qui suit d'un vingt-quatrième de seconde, et vingt
        # éclairs dans un morceau de trois minutes, c'est presque une seconde de
        # décalage entre l'image et le son — exactement ce que tout le reste du
        # montage s'échine à éviter.
        filtres.append(
            f"drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill:enable='lt(t,{1 / cadence:.4f})'")
        # La secousse accompagne l'éclair : ce sont les mêmes coupes — une crête
        # à 85 % de la frappe la plus forte, servie par un plan de la famille du
        # choc. Zoomer une image blanche la laisse blanche, l'ordre est donc sans
        # conséquence, et la secousse doit venir en dernier pour que le cadrage
        # qu'elle déplace soit celui qui sort.
        filtres.append(secousse(cadence).format(largeur=largeur, hauteur=hauteur))
    ffmpeg(
        "-ss", f"{float(entree):.4f}",
        "-i", source,
        # Deux images de rab, et « -frames:v » tranche à l'exact.
        #
        # Le banc l'a trouvé : une case de 0,5 s sortait à ONZE images au lieu de
        # douze. « -ss » tombe entre deux images de la source, ffmpeg part donc de
        # la suivante et la dernière n'entre plus dans le « -t ». Sur cent coupes
        # dont beaucoup sont courtes, ce sont des dixièmes de seconde de dérive
        # entre l'image et la musique — et c'était là avant la rampe.
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


def duree_de(fichier):
    """La durée d'un fichier, lue par ffprobe.

    La rampe en a besoin : elle recalcule la fenêtre source autour du pic, et
    déborder la fin du fichier donnerait un segment plus court que sa case —
    c'est-à-dire un décalage entre l'image et la musique. Une durée inconnue rend
    zéro, et la rampe s'abstient.
    """
    try:
        fait = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", fichier],
            capture_output=True, text=True, check=False)
        return float(fait.stdout.strip())
    except (OSError, TypeError, ValueError):
        pass
    # Pas de ffprobe : ffmpeg dit la même chose en tête de son journal. Le paquet
    # « ffmpeg » des runners fournit les deux, mais on ne le suppose pas — un
    # binaire seul suffit à tout faire tourner.
    fait = subprocess.run(["ffmpeg", "-hide_banner", "-i", fichier],
                          capture_output=True, text=True, check=False)
    trouve = re.search(r"Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)", fait.stderr or "")
    if not trouve:
        return 0.0
    heures, minutes, secondes = trouve.groups()
    return int(heures) * 3600 + int(minutes) * 60 + float(secondes)


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
        for plan in plans:
            adresse = plan["video"]
            if adresse not in rapatries:
                vers = os.path.join(dossier, f"rush{len(rapatries)}.mp4")
                print(f"rush {len(rapatries) + 1} : {adresse}", flush=True)
                rapatries[adresse] = telecharger(adresse, vers)

        # L'harmonisation, mesurée avant de découper.
        #
        # Il faut connaître le milieu du montage pour savoir vers quoi ramener
        # chacun : la mesure passe donc sur tous les rushs d'abord, la médiane se
        # calcule, et la correction s'applique ensuite. Quelques images par rush à
        # 48 x 27 — une poignée de millisecondes chacune.
        mesures = {}
        durees = {}
        for adresse, fichier in rapatries.items():
            durees[adresse] = duree_de(fichier)
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
        for rang, plan in enumerate(plans):
            morceau = os.path.join(dossier, f"plan{rang:04d}.mp4")
            decouper(rapatries[plan["video"]], plan["entree"], plan["sortie"],
                     morceau, cadence, largeur, hauteur, bool(plan.get("eclair")),
                     couleurs.get(plan["video"], ""),
                     plan.get("pic"), durees.get(plan["video"], 0.0),
                     plan.get("pulsations"))
            morceaux.append(morceau)
            marques = []
            if plan.get("eclair"):
                marques.append("éclair+secousse")
            if plan.get("eclair") and rampe(plan.get("pic"), plan["entree"], plan["sortie"],
                                            cadence, durees.get(plan["video"], 0.0)):
                marques.append("rampe 0,65× → 1,8×")
            if plan.get("pulsations"):
                marques.append(f"{len(plan['pulsations'])} pulsations")
            print(f"plan {rang + 1}/{len(plans)}"
                  + (f" · {' · '.join(marques)}" if marques else ""), flush=True)

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
