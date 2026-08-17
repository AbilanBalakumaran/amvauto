"""CLI amvauto : un nom d'animé en entrée, une liste de rushs en sortie.

    python -m amvauto "chainsaw man"
    python -m amvauto frieren --mood combat --top 15
    python -m amvauto "jujutsu kaisen" --json > rushes.json
"""

from __future__ import annotations

import argparse
import json
import sys

from .sakuga import SakugaClient, SakugaError, TAG_ARTIST
from .scoring import MOODS, moods_of, quality_flags, rank
from .series import find_curated


def human_series(tag: str) -> str:
    return tag.replace("_", " ").replace("!", "!").title()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="amvauto",
        description="Propose des rushs / sakuga exploitables pour monter un AMV.",
    )
    parser.add_argument("anime", help="nom de l'animé (recherche approximative)")
    parser.add_argument("--mood", choices=sorted(MOODS), help="ambiance recherchée")
    parser.add_argument("--top", type=int, default=20, help="nombre de rushs (défaut : 20)")
    parser.add_argument("--pool", type=int, default=60, help="cuts examinés avant classement")
    parser.add_argument("--json", action="store_true", help="sortie JSON")
    parser.add_argument("--tag", help="forcer le tag de série au lieu de la recherche")
    return parser


def pick_series(client: SakugaClient, anime: str, pool: int) -> tuple[dict, list]:
    """Premier tag candidat qui rend réellement des rushs.

    Sakugabooru masque certains tags de série (leur page existe, la recherche
    renvoie 0) : il faut donc essayer les candidats jusqu'à en trouver un qui
    répond, au lieu de faire confiance au plus fourni.
    """
    curated = find_curated(anime)
    if curated:
        posts = client.rushes(curated[1], limit=pool)
        if posts:
            return {"name": curated[1], "display": curated[0]}, posts

    candidates = client.resolve_series(anime)
    if not candidates:
        raise SakugaError(f"aucune série ne correspond à « {anime} »")
    for candidate in candidates[:5]:
        posts = client.rushes(candidate["name"], limit=pool)
        if posts:
            return candidate, posts
    raise SakugaError(f"aucun rush vidéo exploitable pour « {anime} »")


def to_record(post, score: float) -> dict:
    return {
        "id": post.id,
        "amv_score": score,
        "sakuga_score": post.score,
        "moods": moods_of(post),
        "flags": quality_flags(post),
        "artists": post.artists or ["artist_unknown"],
        "resolution": f"{post.width}x{post.height}",
        "size_mb": round(post.file_size / 1_000_000, 2),
        "source": post.source,
        "video_url": post.file_url,
        "page_url": post.page_url,
        "tags": post.tags,
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    client = SakugaClient()

    try:
        client.load_tag_types((TAG_ARTIST,), limit=2000)
        if args.tag:
            series = {"name": args.tag, "count": 0}
            posts = client.rushes(args.tag, limit=args.pool)
        else:
            series, posts = pick_series(client, args.anime, args.pool)
    except SakugaError as exc:
        print(f"amvauto : {exc}", file=sys.stderr)
        return 1

    if not posts:
        print(f"amvauto : aucun rush vidéo trouvé pour « {series['name']} »", file=sys.stderr)
        return 1

    ranked = rank(posts, mood=args.mood, top=args.top)

    if args.json:
        json.dump(
            {
                "anime": args.anime,
                "series_tag": series["name"],
                "mood": args.mood,
                "rushes": [to_record(post, score) for post, score in ranked],
            },
            sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        print()
        return 0

    title = series.get("display") or human_series(series["name"])
    mood_label = MOODS[args.mood]["label"] if args.mood else "toutes ambiances"
    print(f"\n{title} — {len(ranked)} rushs ({mood_label})\n")
    for index, (post, score) in enumerate(ranked, start=1):
        artists = ", ".join(a.replace("_", " ").title() for a in post.artists) or "animateur inconnu"
        moods = "/".join(MOODS[m]["label"] for m in moods_of(post)[:2])
        flags = f"  [{', '.join(quality_flags(post))}]" if quality_flags(post) else ""
        print(f"{index:2}. {score:5.1f}  {moods:<20} {artists}{flags}")
        print(f"     {post.source[:70] or 'source inconnue'}")
        print(f"     {post.file_url}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
