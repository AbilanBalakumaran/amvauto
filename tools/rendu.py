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


def decouper(source, entree, sortie, vers, cadence, largeur, hauteur, eclair=False,
             couleur=""):
    """Un plan, normalisé au cadre commun.

    On réencode ici, et c'est voulu : les rushs viennent de sources différentes,
    avec des définitions et des cadences qui ne concordent pas. Les concaténer
    en copie de flux produirait un fichier que la plupart des lecteurs refusent.
    Le runner a le temps ; le téléphone ne l'avait pas.
    """
    duree = max(0.05, float(sortie) - float(entree))
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
        "-ss", f"{float(entree):.3f}",
        "-i", source,
        "-t", f"{duree:.3f}",
        "-an",
        "-vf", ",".join(filtres),
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


def renvoyer_les_sens(rapatries, plans):
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
        charge = json.dumps({"sens": lu["sens"], "force": lu.get("force", 0)}).encode()
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
        for rang, plan in enumerate(plans):
            morceau = os.path.join(dossier, f"plan{rang:04d}.mp4")
            decouper(rapatries[plan["video"]], plan["entree"], plan["sortie"],
                     morceau, cadence, largeur, hauteur, bool(plan.get("eclair")),
                     couleurs.get(plan["video"], ""))
            morceaux.append(morceau)
            print(f"plan {rang + 1}/{len(plans)}", flush=True)

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
            renvoyer_les_sens(rapatries, plans)
        except Exception as souci:                      # noqa: BLE001
            print(f"sens : abandonné ({souci})", flush=True)
        return 0
    finally:
        shutil.rmtree(dossier, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
