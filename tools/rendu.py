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
tourne ici doit tourner sur n'importe quel runner, sans installation.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

# Les seules sources dont on accepte de tirer des octets. Une feuille de route
# est une entrée extérieure : elle ne doit pas pouvoir faire aller chercher
# n'importe quoi n'importe où.
HOTES = {
    "www.sakugabooru.com",
    "sakugabooru.com",
    "v.animethemes.moe",
    "animethemes.moe",
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


def decouper(source, entree, sortie, vers, cadence, largeur, hauteur):
    """Un plan, normalisé au cadre commun.

    On réencode ici, et c'est voulu : les rushs viennent de sources différentes,
    avec des définitions et des cadences qui ne concordent pas. Les concaténer
    en copie de flux produirait un fichier que la plupart des lecteurs refusent.
    Le runner a le temps ; le téléphone ne l'avait pas.
    """
    duree = max(0.05, float(sortie) - float(entree))
    ffmpeg(
        "-ss", f"{float(entree):.3f}",
        "-i", source,
        "-t", f"{duree:.3f}",
        "-an",
        "-vf", (
            f"scale={largeur}:{hauteur}:force_original_aspect_ratio=decrease,"
            f"pad={largeur}:{hauteur}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"fps={cadence},setsar=1"
        ),
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
        morceaux = []
        for rang, plan in enumerate(plans):
            adresse = plan["video"]
            if adresse not in rapatries:
                vers = os.path.join(dossier, f"rush{len(rapatries)}.mp4")
                print(f"rush {len(rapatries) + 1} : {adresse}", flush=True)
                rapatries[adresse] = telecharger(adresse, vers)
            morceau = os.path.join(dossier, f"plan{rang:04d}.mp4")
            decouper(rapatries[adresse], plan["entree"], plan["sortie"],
                     morceau, cadence, largeur, hauteur)
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
        return 0
    finally:
        shutil.rmtree(dossier, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
