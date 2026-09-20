#!/usr/bin/env python3
"""Un projet DaVinci Resolve, à partir de la même feuille de route.

Le rendu donne une vidéo : elle se publie, elle ne se remonte pas. Pour reprendre
le montage — déplacer un plan, rallonger une coupe, changer un ordre — il faut un
projet et ses médias. C'est ce que fabrique ce script : une archive qui s'ouvre
dans Resolve et qui contient de quoi travailler.

Ce qu'elle contient, et pourquoi :

  Sources/     un fichier par coupe, avec UNE SECONDE de marge de chaque côté.
               C'est la pratique du conformage : le plan est à sa place sur la
               ligne de temps, et il reste de la matière pour l'étirer. Exporter
               les rushs entiers serait plus souple encore et pèserait des
               gigaoctets — un rush de Sakugabooru fait huit mégaoctets pour
               trente secondes, et un AMV en emploie cent.

  Montage.xml  la ligne de temps au format XMEML (Final Cut Pro 7), celui que
               Resolve importe le plus sûrement. Chaque plan y porte ses points
               d'entrée et de sortie dans son fichier : les marges sont là, mais
               hors du montage.

  Montage.edl  la même chose en CMX3600, au cas où. Une liste de coupes se lit
               partout et ne dépend d'aucune version.

  Musique/     la piste, telle quelle.

Aucune dépendance en dehors de FFmpeg et de la bibliothèque standard.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from urllib.parse import quote

from rendu import HOTES, telecharger, ffmpeg          # noqa: F401  (même liste blanche)

POIGNEE = 1.0            # secondes de marge de part et d'autre de chaque coupe
CRF = "23"   # un plan de travail, pas un master : on le remontera de toute façon


def sonder(fichier):
    """Durée et cadence réelles d'un fichier, lues par ffprobe."""
    sortie = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=avg_frame_rate:format=duration",
         "-of", "json", fichier],
        capture_output=True, text=True, check=False)
    try:
        lu = json.loads(sortie.stdout or "{}")
        duree = float((lu.get("format") or {}).get("duration") or 0)
        brut = ((lu.get("streams") or [{}])[0]).get("avg_frame_rate") or "0/1"
        haut, bas = (brut.split("/") + ["1"])[:2]
        cadence = float(haut) / float(bas or 1) if float(bas or 1) else 0
        return duree, (cadence or 0)
    except Exception:
        return 0.0, 0.0


def images(secondes, cadence):
    return max(0, int(round(secondes * cadence)))


def timecode(secondes, cadence):
    total = images(secondes, cadence)
    par_heure = int(round(cadence)) * 3600
    heures, reste = divmod(total, par_heure)
    minutes, reste = divmod(reste, int(round(cadence)) * 60)
    secs, trames = divmod(reste, int(round(cadence)))
    return f"{heures:02d}:{minutes:02d}:{secs:02d}:{trames:02d}"


def echapper(texte):
    return (str(texte).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def xmeml(nom, coupes, cadence, largeur, hauteur, musique):
    """La ligne de temps, au format que Resolve lit le mieux.

    Les adresses sont relatives au fichier XML : l'archive se déplace d'un
    ordinateur à l'autre sans rien casser. Si Resolve demande malgré tout où sont
    les médias, le dossier Sources est à côté et les noms concordent.
    """
    fin = sum(c["duree"] for c in coupes)
    lignes = ['<?xml version="1.0" encoding="UTF-8"?>', "<!DOCTYPE xmeml>",
              '<xmeml version="5">', "  <sequence>",
              f"    <name>{echapper(nom)}</name>",
              f"    <duration>{images(fin, cadence)}</duration>",
              f"    <rate><timebase>{int(round(cadence))}</timebase><ntsc>FALSE</ntsc></rate>",
              "    <media>", "      <video>",
              "        <format><samplecharacteristics>",
              f"          <width>{largeur}</width><height>{hauteur}</height>",
              f"          <rate><timebase>{int(round(cadence))}</timebase><ntsc>FALSE</ntsc></rate>",
              "        </samplecharacteristics></format>",
              "        <track>"]

    position = 0.0
    for rang, coupe in enumerate(coupes):
        debut = images(position, cadence)
        arret = images(position + coupe["duree"], cadence)
        source_cadence = coupe["cadence"] or cadence
        entree = images(coupe["marge"], source_cadence)
        sortie = entree + images(coupe["duree"], source_cadence)
        adresse = "file://./Sources/" + quote(coupe["fichier"])
        lignes += [
            f'          <clipitem id="plan{rang + 1}">',
            f"            <name>{echapper(coupe['titre'])}</name>",
            f"            <duration>{images(coupe['source'], source_cadence)}</duration>",
            f"            <rate><timebase>{int(round(source_cadence))}</timebase><ntsc>FALSE</ntsc></rate>",
            f"            <start>{debut}</start><end>{arret}</end>",
            f"            <in>{entree}</in><out>{sortie}</out>",
            f'            <file id="fichier{rang + 1}">',
            f"              <name>{echapper(coupe['fichier'])}</name>",
            f"              <pathurl>{echapper(adresse)}</pathurl>",
            f"              <rate><timebase>{int(round(source_cadence))}</timebase><ntsc>FALSE</ntsc></rate>",
            f"              <duration>{images(coupe['source'], source_cadence)}</duration>",
            "              <media><video><samplecharacteristics>",
            f"                <width>{largeur}</width><height>{hauteur}</height>",
            "              </samplecharacteristics></video></media>",
            "            </file>",
            "          </clipitem>",
        ]
        position += coupe["duree"]

    lignes += ["        </track>", "      </video>"]

    if musique:
        lignes += [
            "      <audio>", "        <track>",
            '          <clipitem id="musique">',
            f"            <name>{echapper(musique['fichier'])}</name>",
            f"            <duration>{images(musique['duree'], cadence)}</duration>",
            f"            <rate><timebase>{int(round(cadence))}</timebase><ntsc>FALSE</ntsc></rate>",
            f"            <start>0</start><end>{images(musique['duree'], cadence)}</end>",
            f"            <in>0</in><out>{images(musique['duree'], cadence)}</out>",
            '            <file id="fichierMusique">',
            f"              <name>{echapper(musique['fichier'])}</name>",
            f"              <pathurl>file://./Musique/{quote(musique['fichier'])}</pathurl>",
            f"              <rate><timebase>{int(round(cadence))}</timebase><ntsc>FALSE</ntsc></rate>",
            f"              <duration>{images(musique['duree'], cadence)}</duration>",
            "              <media><audio><samplecharacteristics>",
            "                <depth>16</depth><samplerate>48000</samplerate>",
            "              </samplecharacteristics><channelcount>2</channelcount></audio></media>",
            "            </file>",
            "          </clipitem>",
            "        </track>", "      </audio>",
        ]

    lignes += ["    </media>", "  </sequence>", "</xmeml>", ""]
    return "\n".join(lignes)


def edl(nom, coupes, cadence):
    """La même chose en CMX3600 : une liste de coupes, lisible partout."""
    lignes = [f"TITLE: {nom}", "FCM: NON-DROP FRAME", ""]
    position = 0.0
    for rang, coupe in enumerate(coupes):
        src_debut = coupe["marge"]
        src_fin = coupe["marge"] + coupe["duree"]
        lignes.append(
            f"{rang + 1:03d}  AX       V     C        "
            f"{timecode(src_debut, cadence)} {timecode(src_fin, cadence)} "
            f"{timecode(position, cadence)} {timecode(position + coupe['duree'], cadence)}")
        lignes.append(f"* FROM CLIP NAME: {coupe['fichier']}")
        lignes.append("")
        position += coupe["duree"]
    return "\n".join(lignes)


LISEZMOI = """Projet {nom}

Ouvrir dans DaVinci Resolve
---------------------------
1. Décompresse cette archive quelque part sur ton disque, sans rien déplacer :
   le montage cherche ses médias dans le dossier « Sources » qui est à côté.
2. Dans Resolve : Fichier > Importer > Chronologie, puis choisis
   « Montage.xml ». Coche « Importer automatiquement les médias ».
3. Si Resolve demande où sont les fichiers, désigne-lui le dossier « Sources » :
   les noms concordent, il relie tout d'un coup.

La musique est dans « Musique » et se pose sur la piste audio 1.
« Montage.edl » contient la même liste de coupes, au cas où l'XML poserait
problème sur une version ancienne.

Ce qu'il y a dans Sources
-------------------------
Un fichier par coupe, avec une seconde de marge avant et après. La coupe est
déjà placée au bon endroit sur la ligne de temps ; la marge est là pour que tu
puisses l'étirer des deux côtés sans aller rechercher le rush d'origine.

{plans} plans · {duree} · {cadence} images par seconde · {largeur}x{hauteur}

Les images appartiennent à leurs ayants droit.
Fabriqué avec AMVAuto.
"""


def main():
    if len(sys.argv) < 3:
        print("usage : projet.py <montage.json> <sortie.zip>", file=sys.stderr)
        return 2
    montage = json.load(open(sys.argv[1], encoding="utf-8"))
    sortie = sys.argv[2]

    cadence = float(montage.get("cadence") or 24)
    largeur = int(montage.get("largeur") or 1280)
    hauteur = int(montage.get("hauteur") or 720)
    nom = str(montage.get("nom") or "AMV").strip() or "AMV"
    plans = montage.get("plans") or []
    if not plans:
        print("la feuille de route ne contient aucun plan", file=sys.stderr)
        return 1

    dossier = tempfile.mkdtemp(prefix="amvauto-projet-")
    try:
        sources = os.path.join(dossier, "Sources")
        os.makedirs(sources, exist_ok=True)
        rapatries = {}
        coupes = []

        for rang, plan in enumerate(plans):
            adresse = plan["video"]
            if adresse not in rapatries:
                vers = os.path.join(dossier, f"rush{len(rapatries)}.mp4")
                print(f"rush {len(rapatries) + 1} : {adresse}", flush=True)
                rapatries[adresse] = telecharger(adresse, vers)
            rush = rapatries[adresse]
            duree_rush, cadence_rush = sonder(rush)
            entree = float(plan["entree"])
            sortie_plan = float(plan["sortie"])
            duree = max(0.04, sortie_plan - entree)
            depart = max(0.0, entree - POIGNEE)
            arret = min(duree_rush, sortie_plan + POIGNEE) if duree_rush else sortie_plan + POIGNEE
            fichier = f"{rang + 1:03d} - plan.mp4"
            chemin = os.path.join(sources, fichier)
            # Jamais agrandi, et jamais complété de noir.
            #
            # Le rendu normalise tout au cadre commun parce qu'il colle les plans
            # bout à bout sans réencoder : il leur faut la même définition. Un
            # projet, lui, se monte dans Resolve, qui met chaque plan à l'échelle
            # de la ligne de temps tout seul. Agrandir un rush de 854 sur 480 vers
            # 1280 sur 720 ne lui ajoute aucun détail et multiplie son poids par
            # deux — mesuré : 2,7 Mo pour trois plans, soit plus de cent mégaoctets
            # pour un AMV entier, au-dessus de ce que le grenier accepte.
            ffmpeg(
                "-ss", f"{depart:.3f}", "-i", rush, "-t", f"{max(0.08, arret - depart):.3f}",
                "-an",
                "-vf", (f"scale='min({largeur},iw)':'min({hauteur},ih)'"
                        f":force_original_aspect_ratio=decrease,fps={cadence},setsar=1"),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", CRF,
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", chemin)
            coupes.append({
                "fichier": fichier,
                "titre": plan.get("nom") or f"Plan {rang + 1}",
                "duree": duree,
                "marge": entree - depart,
                "source": max(0.08, arret - depart),
                "cadence": cadence,
            })
            print(f"plan {rang + 1}/{len(plans)}", flush=True)

        musique = None
        adresse_musique = montage.get("musique")
        if adresse_musique:
            os.makedirs(os.path.join(dossier, "Musique"), exist_ok=True)
            nom_musique = "musique.mp3"
            piste = os.path.join(dossier, "Musique", nom_musique)
            telecharger(adresse_musique, piste)
            duree_musique, _ = sonder(piste)
            musique = {"fichier": nom_musique,
                       "duree": duree_musique or sum(c["duree"] for c in coupes)}

        total = sum(c["duree"] for c in coupes)
        with open(os.path.join(dossier, "Montage.xml"), "w", encoding="utf-8") as f:
            f.write(xmeml(nom, coupes, cadence, largeur, hauteur, musique))
        with open(os.path.join(dossier, "Montage.edl"), "w", encoding="utf-8") as f:
            f.write(edl(nom, coupes, cadence))
        with open(os.path.join(dossier, "LISEZ-MOI.txt"), "w", encoding="utf-8") as f:
            f.write(LISEZMOI.format(nom=nom, plans=len(coupes),
                                    duree=f"{int(total // 60)} min {int(total % 60):02d}",
                                    cadence=int(round(cadence)),
                                    largeur=largeur, hauteur=hauteur))
        fiche = montage.get("fiche")
        if fiche:
            with open(os.path.join(dossier, "Fiche.txt"), "w", encoding="utf-8") as f:
                f.write(f"TITRE\n{fiche.get('titre', '')}\n\n"
                        f"DESCRIPTION\n{fiche.get('description', '')}\n\n"
                        f"TAGS\n{fiche.get('tags', '')}\n")

        # Rangé sans compression : des mp4 ne se compriment plus, et l'archive
        # s'ouvre d'autant plus vite.
        racine = "".join(c if c.isalnum() or c in " -_." else "-" for c in nom)[:60] or "AMV"
        with zipfile.ZipFile(sortie, "w", zipfile.ZIP_STORED) as zip_:
            for chemin_complet, _, fichiers in os.walk(dossier):
                relatif = os.path.relpath(chemin_complet, dossier)
                if relatif.startswith("rush"):
                    continue
                for nom_fichier in fichiers:
                    if nom_fichier.startswith("rush") and relatif == ".":
                        continue
                    dans = os.path.join(chemin_complet, nom_fichier)
                    sous = os.path.join(racine, relatif, nom_fichier) if relatif != "." \
                        else os.path.join(racine, nom_fichier)
                    zip_.write(dans, sous)

        octets = os.path.getsize(sortie)
        with zipfile.ZipFile(sortie) as zip_:
            dedans = set(zip_.namelist())
            manquants = [c["fichier"] for c in coupes
                         if os.path.join(racine, "Sources", c["fichier"]) not in dedans]
            print(f"archive : {len(dedans)} entrées", flush=True)
            for nom_entree in sorted(dedans)[:8]:
                print(f"  {nom_entree}", flush=True)
            if len(dedans) > 8:
                print(f"  … et {len(dedans) - 8} autres", flush=True)
        if manquants:
            print(f"le montage pointe vers {len(manquants)} fichiers absents de l'archive",
                  file=sys.stderr)
            return 1
        print(f"projet : {octets / 1e6:.1f} Mo, {len(coupes)} plans", flush=True)
        if octets > 95_000_000:
            print("l'archive dépasse 95 Mo : le grenier la refusera, "
                  "elle restera dans les artefacts de la course", flush=True)
        return 0
    finally:
        shutil.rmtree(dossier, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
