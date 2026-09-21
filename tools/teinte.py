"""Harmoniser la couleur entre des rushs de vingt ans d'écart.

Un AMV monte côte à côte un cut de 2003 — transfert télécinéma, contraste mou,
couleurs délavées — et une séquence de 2024 en haute définition, contrastée,
saturée. À la coupe, ça saute : ce n'est pas le montage qu'on voit, c'est le
changement de matériel.

Un étalonnage global sur le master ne corrige pas ça. Appliquer la même courbe à
tout le monde déplace l'ensemble sans rien rapprocher : le plan mou reste mou à
côté du plan dur. Pour harmoniser, il faut MESURER chaque plan et ramener chacun
vers le milieu du montage.

C'est ce que fait ce module, sans dépendance et sans modèle : quelques images par
plan, réduites à 48 x 27 en YUV, dont on tire la luminance moyenne, le contraste
(écart type) et la saturation moyenne. La médiane du montage sert de cible, et
chaque plan reçoit une correction douce — bornée, parce qu'un plan volontairement
sombre doit rester sombre. On rapproche, on n'uniformise pas.
"""
from __future__ import annotations

import subprocess

LARGEUR = 48
HAUTEUR = 27
IMAGES_PAR_SECONDE = 4

# Ce qu'on s'autorise à corriger. Au-delà, ce n'est plus de l'harmonisation :
# c'est un parti pris qui écrase l'intention du plan d'origine.
LUMIERE_MAX = 0.06     # en unités ffmpeg « brightness », soit ±15 sur 255
CONTRASTE_MIN = 0.90
CONTRASTE_MAX = 1.14
SATURATION_MIN = 0.88
SATURATION_MAX = 1.16
# On ne ramène qu'une part du chemin vers la médiane : à un, le montage devient
# plat. Mesuré à l'œil sur des paires 2003/2024, deux tiers suffisent à ce que la
# coupe ne saute plus, et laissent à chaque plan sa personnalité.
PART = 0.66


def mesurer(source: str, ffmpeg: str = "ffmpeg", debut: float = 0.0,
            duree: float = 0.0) -> dict | None:
    """Luminance moyenne, contraste et saturation d'un plan, sur 0–255."""
    commande = [ffmpeg, "-v", "error", "-nostdin"]
    if debut > 0:
        commande += ["-ss", f"{debut:.3f}"]
    commande += ["-i", source]
    if duree > 0:
        commande += ["-t", f"{duree:.3f}"]
    commande += [
        "-vf", f"fps={IMAGES_PAR_SECONDE},scale={LARGEUR}:{HAUTEUR},format=yuv444p",
        "-f", "rawvideo", "-",
    ]
    brut = subprocess.run(commande, capture_output=True, check=False).stdout
    plan = LARGEUR * HAUTEUR
    if len(brut) < plan * 3:
        return None

    somme = 0
    carres = 0
    chroma = 0
    n = 0
    for depart in range(0, len(brut) - plan * 3 + 1, plan * 3):
        y = brut[depart:depart + plan]
        u = brut[depart + plan:depart + plan * 2]
        v = brut[depart + plan * 2:depart + plan * 3]
        for i in range(plan):
            somme += y[i]
            carres += y[i] * y[i]
            # La distance au gris, en norme de Tchebychev : c'est ce qu'on voit
            # comme « couleur », et ça ne demande pas de racine.
            chroma += max(abs(u[i] - 128), abs(v[i] - 128))
        n += plan
    if not n:
        return None
    moyenne = somme / n
    variance = max(0.0, carres / n - moyenne * moyenne)
    return {
        "lumiere": round(moyenne, 2),
        "contraste": round(variance ** 0.5, 2),
        "saturation": round(chroma / n, 2),
    }


def _mediane(valeurs: list[float]) -> float:
    ordonnees = sorted(valeurs)
    milieu = len(ordonnees) // 2
    if not ordonnees:
        return 0.0
    if len(ordonnees) % 2:
        return ordonnees[milieu]
    return (ordonnees[milieu - 1] + ordonnees[milieu]) / 2


def cible(mesures: list[dict]) -> dict | None:
    """Le milieu du montage : la médiane, pas la moyenne.

    La médiane parce qu'un seul plan de nuit noire tirerait la moyenne vers le
    bas et éclaircirait tout le reste pour rien.
    """
    vraies = [m for m in mesures if m]
    if len(vraies) < 3:
        return None
    return {
        "lumiere": _mediane([m["lumiere"] for m in vraies]),
        "contraste": _mediane([m["contraste"] for m in vraies]),
        "saturation": _mediane([m["saturation"] for m in vraies]),
    }


def _borner(valeur: float, bas: float, haut: float) -> float:
    return max(bas, min(haut, valeur))


def correction(mesure: dict | None, vise: dict | None) -> dict | None:
    """Ce qu'il faut appliquer à ce plan pour le rapprocher du montage.

    Rien quand le plan est déjà au milieu, ou quand on n'a pas de quoi juger.
    """
    if not mesure or not vise:
        return None

    # La lumière : « brightness » de ffmpeg s'ajoute au signal normalisé.
    ecart = (vise["lumiere"] - mesure["lumiere"]) / 255.0
    lumiere = _borner(ecart * PART, -LUMIERE_MAX, LUMIERE_MAX)

    # Le contraste et la saturation sont des rapports : un plan deux fois moins
    # contrasté que le montage demande un facteur deux, borné à ce qu'on s'autorise.
    def rapport(cle, bas, haut):
        if mesure[cle] <= 1:
            return 1.0
        brut = vise[cle] / mesure[cle]
        return _borner(1 + (brut - 1) * PART, bas, haut)

    contraste = rapport("contraste", CONTRASTE_MIN, CONTRASTE_MAX)
    saturation = rapport("saturation", SATURATION_MIN, SATURATION_MAX)

    # Rien à corriger : on ne met pas de filtre pour ne rien faire, ça coûte une
    # passe de calcul et ça peut arrondir des pixels pour rien.
    if abs(lumiere) < 0.004 and abs(contraste - 1) < 0.01 and abs(saturation - 1) < 0.01:
        return None
    return {
        "brightness": round(lumiere, 4),
        "contrast": round(contraste, 3),
        "saturation": round(saturation, 3),
    }


def filtre(corr: dict | None) -> str:
    """La correction, écrite comme ffmpeg l'attend."""
    if not corr:
        return ""
    return (f"eq=brightness={corr['brightness']}:contrast={corr['contrast']}"
            f":saturation={corr['saturation']}")
