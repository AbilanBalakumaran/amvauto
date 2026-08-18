"""Client HTTP minimal pour l'API Sakugabooru (moebooru).

Sakugabooru indexe des « cuts » d'animation : de courts extraits vidéo isolés
d'un episode, taggés par serie, par animateur et par type d'animation. C'est la
source de rushs la plus directement exploitable pour monter un AMV.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Iterable

BASE_URL = "https://www.sakugabooru.com"
USER_AGENT = "amvauto/0.1 (+https://github.com/AbilanBalakumaran/amvauto)"

# Types de tags moebooru.
TAG_GENERAL = 0
TAG_ARTIST = 1
TAG_COPYRIGHT = 3
TAG_CHARACTER = 4

VIDEO_EXTS = {"mp4", "webm"}


class SakugaError(RuntimeError):
    pass


@dataclass
class Post:
    """Un cut d'animation."""

    id: int
    tags: list[str]
    score: int
    file_url: str
    file_ext: str
    file_size: int
    preview_url: str
    width: int
    height: int
    rating: str
    source: str
    created_at: int
    artists: list[str] = field(default_factory=list)
    series: list[str] = field(default_factory=list)

    @property
    def page_url(self) -> str:
        return f"{BASE_URL}/post/show/{self.id}"

    @property
    def is_video(self) -> bool:
        return self.file_ext in VIDEO_EXTS

    @property
    def is_production_material(self) -> bool:
        """Genga / layouts : du papier, pas du rush montable."""
        return bool({"genga", "production_materials", "layout", "douga"} & set(self.tags))

    @classmethod
    def from_json(cls, raw: dict) -> "Post":
        return cls(
            id=raw["id"],
            tags=raw.get("tags", "").split(),
            score=raw.get("score", 0),
            file_url=raw.get("file_url", ""),
            file_ext=raw.get("file_ext", ""),
            file_size=raw.get("file_size", 0),
            preview_url=raw.get("preview_url", ""),
            width=raw.get("width", 0),
            height=raw.get("height", 0),
            rating=raw.get("rating", "s"),
            source=raw.get("source", "") or "",
            created_at=raw.get("created_at", 0),
        )


class SakugaClient:
    def __init__(self, base_url: str = BASE_URL, delay: float = 0.4, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.delay = delay
        self.timeout = timeout
        self._last_call = 0.0
        self._tag_types: dict[str, int] = {}

    # -- transport ---------------------------------------------------------

    def _get(self, path: str, params: dict) -> list | dict:
        wait = self.delay - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        url = f"{self.base_url}{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # réseau, JSON, HTTP…
            raise SakugaError(f"appel {path} en échec : {exc}") from exc
        finally:
            self._last_call = time.monotonic()
        return payload

    # -- tags --------------------------------------------------------------

    def search_tags(self, pattern: str, tag_type: int | None = None, limit: int = 40) -> list[dict]:
        """Cherche des tags par motif (utilisé pour résoudre un nom d'animé)."""
        params = {"name": pattern, "limit": limit, "order": "count"}
        if tag_type is not None:
            params["type"] = tag_type
        tags = self._get("/tag.json", params)
        return [t for t in tags if t.get("count", 0) > 0]

    def top_tags(self, tag_type: int, limit: int = 500) -> list[dict]:
        return self._get("/tag.json", {"type": tag_type, "order": "count", "limit": limit})

    def load_tag_types(self, types: Iterable[int] = (TAG_ARTIST,), limit: int = 2000) -> None:
        """Pré-charge une table nom -> type, pour distinguer animateur et série."""
        for tag_type in types:
            for tag in self.top_tags(tag_type, limit=limit):
                self._tag_types[tag["name"]] = tag_type

    def tag_type(self, name: str) -> int:
        return self._tag_types.get(name, TAG_GENERAL)

    def resolve_series(self, query: str) -> list[dict]:
        """Nom d'animé libre -> tags de série candidats, le plus fourni d'abord."""
        pattern = query.strip().lower().replace(" ", "_")
        candidates = self.search_tags(pattern, tag_type=TAG_COPYRIGHT)
        if not candidates and "_" in pattern:
            # « chainsaw man reze » ne matche rien : on retente sur le 1er mot.
            candidates = self.search_tags(pattern.split("_")[0], tag_type=TAG_COPYRIGHT)
        return sorted(candidates, key=lambda t: -t.get("count", 0))

    # -- posts -------------------------------------------------------------

    def posts(self, tags: str, limit: int = 40, page: int = 1) -> list[Post]:
        raw = self._get("/post.json", {"tags": tags, "limit": limit, "page": page})
        posts = [Post.from_json(item) for item in raw]
        for post in posts:
            post.artists = [
                t for t in post.tags
                if self.tag_type(t) == TAG_ARTIST and t != "artist_unknown"
            ]
            post.series = [t for t in post.tags if self.tag_type(t) == TAG_COPYRIGHT]
        return posts

    def rushes(self, series_tag: str, limit: int = 40, extra_tags: str = "") -> list[Post]:
        """Les cuts les mieux notés d'une série, filtrés sur ce qui est montable."""
        query = f"{series_tag} order:score"
        if extra_tags:
            query = f"{query} {extra_tags}"
        found = self.posts(query, limit=limit)
        return [p for p in found if p.is_video and not p.is_production_material]
