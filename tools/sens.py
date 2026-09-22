"""La direction dominante d'un plan, lue dans ses images.

Le montage sait depuis longtemps qu'un raccord de mouvement compte : couper d'un
geste qui part à droite vers un geste qui part à droite se voit à peine, tandis
que l'inverse fait sursauter — et c'est justement ce qu'on garde pour les
impacts. La règle existait dans le code et ne servait à rien : aucune source ne
dit dans quel sens un plan bouge.

Ce module le mesure, et il le mesure sans rien demander à personne : ni API, ni
modèle, ni clé. Huit images par seconde, réduites à 32 x 18 en niveaux de gris,
et pour chaque paire on cherche le décalage qui superpose le mieux l'une sur
l'autre. C'est de la corrélation de blocs, la plus vieille méthode qui soit, et à
cette taille elle coûte moins qu'un millième de seconde par paire.

Ce qu'on mesure est le mouvement APPARENT, celui qui se voit à l'écran — pas
l'intention. Quand la caméra suit un personnage qui court à droite, le
personnage est immobile dans le cadre et c'est le décor qui file à gauche : la
mesure dira « gauche ». Ce n'est pas une erreur pour ce qu'on en fait. La règle
de raccord parle de ce que l'œil poursuit, et l'œil poursuit ce qui bouge sur
l'écran.
"""
from __future__ import annotations

import subprocess

# Assez petit pour que la recherche exhaustive soit gratuite, assez grand pour
# qu'un décalage d'un pixel veuille dire quelque chose : à 32 de large, un pixel
# vaut trois pour cent de l'image.
LARGEUR = 32
HAUTEUR = 18
IMAGES_PAR_SECONDE = 8
# Au-delà de trois pixels par image — soit neuf pour cent de la largeur douze
# fois par seconde — ce n'est plus un mouvement, c'est une coupe.
PORTEE = 3
# Sous ce déplacement moyen, le plan est tenu pour fixe. Mesuré sur des plans
# d'animation : un plan vraiment immobile rend 0,05 à 0,15 pixel de bruit.
SEUIL_FIXE = 0.35
# Le meilleur décalage doit battre le deuxième d'au moins ça, sinon l'image n'a
# rien dit — une trame uniforme superpose aussi bien dans tous les sens.
MARGE = 1.04


def _images(source: str, ffmpeg: str = "ffmpeg", debut: float = 0.0,
            duree: float = 0.0) -> list[bytes]:
    """Les images du plan, minuscules et en gris, telles que ffmpeg les crache."""
    commande = [ffmpeg, "-v", "error", "-nostdin"]
    if debut > 0:
        commande += ["-ss", f"{debut:.3f}"]
    commande += ["-i", source]
    if duree > 0:
        commande += ["-t", f"{duree:.3f}"]
    commande += [
        "-vf", f"fps={IMAGES_PAR_SECONDE},scale={LARGEUR}:{HAUTEUR},format=gray",
        "-f", "rawvideo", "-",
    ]
    sortie = subprocess.run(commande, capture_output=True, check=False).stdout
    taille = LARGEUR * HAUTEUR
    return [sortie[i:i + taille] for i in range(0, len(sortie) - taille + 1, taille)]


def _decalage(a: bytes, b: bytes) -> tuple[int, int, float]:
    """Le décalage qui superpose le mieux « a » sur « b », et sa netteté.

    On compare toujours la même zone — celle qui reste commune aux deux quel que
    soit le décalage — sinon un grand décalage comparerait moins de pixels et
    gagnerait par forfait.
    """
    meilleur = None
    second = None
    for dy in range(-PORTEE, PORTEE + 1):
        for dx in range(-PORTEE, PORTEE + 1):
            somme = 0
            n = 0
            for y in range(PORTEE, HAUTEUR - PORTEE):
                ligne_a = (y - dy) * LARGEUR
                ligne_b = y * LARGEUR
                for x in range(PORTEE, LARGEUR - PORTEE):
                    somme += abs(a[ligne_a + x - dx] - b[ligne_b + x])
                    n += 1
            ecart = somme / n if n else 0.0
            if meilleur is None or ecart < meilleur[2]:
                second = meilleur
                meilleur = (dx, dy, ecart)
            elif second is None or ecart < second[2]:
                second = (dx, dy, ecart)
    if meilleur is None:
        return 0, 0, 0.0
    # La netteté : de combien le gagnant bat le suivant. Un plan sans texture ne
    # départage rien, et il ne doit pas voter.
    nettete = 0.0
    if second and meilleur[2] > 0:
        nettete = second[2] / meilleur[2]
    return meilleur[0], meilleur[1], nettete


# Le tiers de l'image où l'action se concentre.
#
# L'œil suit une chose à la fois. Sur une suite de coupes rapides, si l'action
# saute du bord gauche au bord droit à chaque plan, le regard passe sa vie à
# traverser l'écran — c'est de la fatigue oculaire, et un jury la voit comme du
# désordre. Enchaîner deux plans dont l'action est au même endroit guide l'œil au
# lieu de le balader.
#
# On le mesure là où le mouvement est : pour chaque paire d'images, la colonne où
# la différence est la plus forte. Pas de détection d'objet, pas de modèle — la
# différence entre deux images EST le mouvement, et sa répartition horizontale dit
# où il se passe.
QUADRANTS = ("gauche", "centre", "droite")


def _quadrant(a: bytes, b: bytes) -> int | None:
    """Le tiers où la différence entre deux images est la plus forte."""
    parts = [0, 0, 0]
    tiers = LARGEUR / 3.0
    total = 0
    for y in range(HAUTEUR):
        ligne = y * LARGEUR
        for x in range(LARGEUR):
            ecart = abs(a[ligne + x] - b[ligne + x])
            if ecart < 6:            # le bruit de compression ne vote pas
                continue
            parts[min(2, int(x / tiers))] += ecart
            total += ecart
    if total < LARGEUR * HAUTEUR // 4:
        return None                  # rien ne bouge : aucun tiers ne domine
    fort = max(range(3), key=lambda i: parts[i])
    # Il faut une vraie dominance : à égalité, l'action est partout, et dire
    # « centre » serait inventer.
    return fort if parts[fort] > total * 0.4 else 1


def direction(source: str, ffmpeg: str = "ffmpeg", debut: float = 0.0,
              duree: float = 0.0) -> dict:
    """« left », « right », « up », « down » ou « still », avec sa force.

    Et le tiers de l'image où l'action se concentre, quand il s'en dégage un.
    """
    images = _images(source, ffmpeg, debut, duree)
    if len(images) < 3:
        return {"sens": "", "force": 0, "images": len(images)}

    sx = 0.0
    sy = 0.0
    votes = 0
    tiers = [0, 0, 0]
    for i in range(1, len(images)):
        ou = _quadrant(images[i - 1], images[i])
        if ou is not None:
            tiers[ou] += 1
        dx, dy, nettete = _decalage(images[i - 1], images[i])
        if nettete < MARGE:
            continue
        sx += dx
        sy += dy
        votes += 1

    # Le tiers dominant, s'il en est un. Une image sur deux au moins doit voter
    # pareil, sinon l'action se déplace et il n'y a pas d'ancre à raccorder.
    ou_total = sum(tiers)
    quadrant = ""
    if ou_total >= 3:
        haut = max(range(3), key=lambda i: tiers[i])
        if tiers[haut] > ou_total * 0.5:
            quadrant = QUADRANTS[haut]

    if not votes:
        return {"sens": "still", "force": 0, "images": len(images),
                **({"ou": quadrant} if quadrant else {})}

    mx = sx / votes
    my = sy / votes
    if max(abs(mx), abs(my)) < SEUIL_FIXE:
        return {"sens": "still", "force": 0, "images": len(images),
                **({"ou": quadrant} if quadrant else {})}

    if abs(mx) >= abs(my):
        # L'image se déplace de « mx » vers la droite d'une trame à l'autre :
        # le contenu va donc vers la droite quand mx est positif.
        sens = "right" if mx > 0 else "left"
        ampleur = abs(mx)
    else:
        sens = "down" if my > 0 else "up"
        ampleur = abs(my)
    # Une force de 1 à 3, comme celle que la lecture par modèle rendait : c'est
    # ce que « accordDuMouvement » sait déjà peser.
    force = 1 if ampleur < 0.8 else 2 if ampleur < 1.8 else 3
    return {"sens": sens, "force": force, "images": len(images),
            "dx": round(mx, 3), "dy": round(my, 3), "votes": votes,
            **({"ou": quadrant} if quadrant else {})}
