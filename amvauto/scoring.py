"""Classement des cuts pour un usage AMV.

Sakugabooru note la prouesse d'animation ; un monteur AMV cherche autre chose :
un rush lisible, assez long, dans une ambiance donnée. On recroise donc le score
communautaire avec ce que les tags disent du plan.
"""

from __future__ import annotations

import math

from .sakuga import Post

# Ambiances : chaque tag pousse le cut vers une (ou plusieurs) catégories.
MOODS: dict[str, dict[str, object]] = {
    "combat": {
        "label": "Combat",
        "tags": {
            "fighting": 4, "impact_frames": 3, "martial_arts": 4, "weapons": 3,
            "beams": 3, "explosions": 2, "swords": 3, "shooting": 3, "creatures": 1,
        },
    },
    "effets": {
        "label": "Effets",
        "tags": {
            "effects": 1, "fire": 3, "lightning": 3, "liquid": 2, "smoke": 2,
            "debris": 2, "sparks": 2, "wind": 1, "ice": 3, "explosions": 2,
        },
    },
    "vitesse": {
        "label": "Vitesse",
        "tags": {
            "running": 4, "flying": 3, "smears": 2, "chase": 4, "vehicle": 3,
            "sports": 3, "falling": 3, "motorcycles": 3, "sliding": 2,
        },
    },
    "acting": {
        "label": "Acting",
        "tags": {
            "character_acting": 4, "hair": 1, "fabric": 1, "walk_cycle": 3,
            "dialogue": 2, "eating": 2, "crying": 3, "smoking": 2,
        },
    },
    "hype": {
        "label": "Hype / transfo",
        "tags": {
            "henshin": 4, "morphing": 3, "dancing": 4, "performance": 3,
            "background_animation": 2, "rotation": 1,
        },
    },
}

# Ce qui aide ou gêne au montage, indépendamment de l'ambiance.
BONUS_TAGS = {
    "background_animation": 6,   # le décor bouge : très payant en transition
    "impact_frames": 5,          # cale parfaitement sur un temps fort
    "effects": 4,
    "smears": 3,
    "debris": 2,
}
MALUS_TAGS = {
    "cgi": -8,                   # se marie mal avec du dessin 2D au montage
    "artist_unknown": -1,
    "web": -2,                   # souvent une capture de moins bonne qualité
    "3d_background": -4,
}


def moods_of(post: Post) -> list[str]:
    """Ambiances du cut, la plus marquée d'abord."""
    tags = set(post.tags)
    hits: list[tuple[str, int]] = []
    for key, mood in MOODS.items():
        weight = sum(w for tag, w in mood["tags"].items() if tag in tags)  # type: ignore[union-attr]
        if weight:
            hits.append((key, weight))
    hits.sort(key=lambda item: -item[1])
    return [key for key, _ in hits] or ["acting"]


def quality_flags(post: Post) -> list[str]:
    """Points d'attention à afficher au monteur avant qu'il télécharge."""
    flags: list[str] = []
    tags = set(post.tags)
    if "cgi" in tags:
        flags.append("CGI")
    if post.height < 480:
        flags.append("SD")
    elif post.height >= 1080:
        flags.append("HD")
    if "web" in tags:
        flags.append("source web")
    if "artist_unknown" in tags:
        flags.append("animateur inconnu")
    return flags


def amv_score(post: Post, mood: str | None = None, pool_max: int | None = None) -> float:
    """Note de 0 à 100 : utilisabilité du rush pour un AMV.

    ``pool_max`` = meilleur score sakuga du lot examiné. Les votes vont de 10 à
    4000 selon la popularité de la série : noter en relatif au lot garde un
    classement lisible pour un animé confidentiel comme pour un blockbuster.
    """
    tags = set(post.tags)

    votes = max(post.score, 1)
    if pool_max and pool_max > 1:
        base = 50.0 * math.log1p(votes) / math.log1p(pool_max)
    else:
        base = min(50.0, 10.0 * votes ** 0.35)

    bonus = min(10.0, float(sum(points for tag, points in BONUS_TAGS.items() if tag in tags)))
    malus = float(sum(points for tag, points in MALUS_TAGS.items() if tag in tags))

    # Un rush trop court (fichier minuscule) ne tient pas une phrase musicale.
    weight_mb = post.file_size / 1_000_000
    if weight_mb < 0.4:
        length = -6.0
    elif weight_mb < 1.2:
        length = 0.0
    else:
        length = min(6.0, 3.0 * weight_mb ** 0.5)

    resolution = 5.0 if post.height >= 720 else (2.5 if post.height >= 480 else 0.0)

    fit = 0.0
    if mood:
        mood_tags: dict[str, int] = MOODS.get(mood, {}).get("tags", {})  # type: ignore[assignment]
        fit = min(15.0, 3.0 * sum(w for tag, w in mood_tags.items() if tag in tags))

    total = base + bonus + malus + length + resolution + fit
    return round(max(0.0, min(100.0, total)), 1)


def rank(posts: list[Post], mood: str | None = None, top: int | None = None) -> list[tuple[Post, float]]:
    pool_max = max((p.score for p in posts), default=1)
    scored = [(post, amv_score(post, mood, pool_max)) for post in posts]
    scored.sort(key=lambda item: -item[1])
    return scored[:top] if top else scored
