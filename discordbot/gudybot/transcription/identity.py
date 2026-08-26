from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from ..config import DISCORD_IDENTITIES_FILE, MEMORY_PEOPLE_DIR


MEMORY_ID_PATTERN = re.compile(
    r"^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
FRONTMATTER_PATTERN = re.compile(r"^---\s*\r?\n([\s\S]*?)\r?\n---", re.MULTILINE)


@dataclass(frozen=True, slots=True)
class ResolvedSpeaker:
    discord_user_id: int
    display_name: str
    discord_display_name: str
    person_id: str | None

    @property
    def resolved(self) -> bool:
        return self.person_id is not None


class DiscordMemoryIdentityResolver:
    """Resolve IDs do Discord para títulos atuais sem usar inferência ou IA."""

    def __init__(
        self,
        person_id_by_discord_id: dict[str, str],
        title_by_person_id: dict[str, str],
        warnings: tuple[str, ...] = (),
    ) -> None:
        self._person_id_by_discord_id = person_id_by_discord_id
        self._title_by_person_id = title_by_person_id
        self.warnings = warnings

    @property
    def mapped_count(self) -> int:
        return len(self._person_id_by_discord_id)

    @property
    def resolved_count(self) -> int:
        return sum(
            person_id in self._title_by_person_id
            for person_id in self._person_id_by_discord_id.values()
        )

    @classmethod
    def from_files(
        cls,
        mapping_file: Path = DISCORD_IDENTITIES_FILE,
        people_dir: Path = MEMORY_PEOPLE_DIR,
    ) -> DiscordMemoryIdentityResolver:
        warnings: list[str] = []
        if not mapping_file.is_file():
            return cls({}, {}, (f"mapa de identidades ausente: {mapping_file}",))

        try:
            raw = json.loads(mapping_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError(f"mapa de identidades Discord inválido: {error}") from error
        if not isinstance(raw, dict):
            raise ValueError("mapa de identidades Discord precisa ser um objeto JSON")

        mapping = raw.get("person_id_by_discord_id")
        if not isinstance(mapping, dict):
            raise ValueError(
                "mapa de identidades Discord precisa de person_id_by_discord_id"
            )

        normalized: dict[str, str] = {}
        for discord_id, person_id in mapping.items():
            if not isinstance(discord_id, str) or not discord_id.isdigit():
                raise ValueError(f"ID do Discord inválido no mapa: {discord_id!r}")
            if not isinstance(person_id, str) or not MEMORY_ID_PATTERN.fullmatch(
                person_id
            ):
                raise ValueError(
                    f"ID de Pessoa inválido para Discord {discord_id}: {person_id!r}"
                )
            normalized[discord_id] = person_id

        titles = _load_person_titles(people_dir)
        for discord_id, person_id in normalized.items():
            if person_id not in titles:
                warnings.append(
                    f"Discord {discord_id} aponta para Pessoa inexistente: {person_id}"
                )
        creator_id = raw.get("creator_person_id")
        if creator_id is not None and creator_id not in titles:
            warnings.append(f"creator_person_id não aponta para Pessoa existente: {creator_id}")
        return cls(normalized, titles, tuple(warnings))

    def resolve(self, discord_user_id: int, discord_display_name: str) -> ResolvedSpeaker:
        fallback = discord_display_name.strip() or f"usuario_{discord_user_id}"
        person_id = self._person_id_by_discord_id.get(str(discord_user_id))
        title = self._title_by_person_id.get(person_id) if person_id else None
        return ResolvedSpeaker(
            discord_user_id=discord_user_id,
            display_name=title or fallback,
            discord_display_name=fallback,
            person_id=person_id if title else None,
        )


def _load_person_titles(people_dir: Path) -> dict[str, str]:
    if not people_dir.is_dir():
        raise ValueError(f"pasta de Pessoas não encontrada: {people_dir}")
    titles: dict[str, str] = {}
    for path in people_dir.rglob("*.md"):
        if path.name == "index.md":
            continue
        frontmatter = _frontmatter_fields(path)
        if frontmatter.get("type", "").casefold() != "pessoa":
            continue
        person_id = frontmatter.get("id", "")
        title = frontmatter.get("title", "").strip()
        if not MEMORY_ID_PATTERN.fullmatch(person_id) or not title:
            continue
        if person_id in titles:
            raise ValueError(f"ID de Pessoa duplicado na memória: {person_id}")
        titles[person_id] = title
    return titles


def _frontmatter_fields(path: Path) -> dict[str, str]:
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError(f"não foi possível ler Pessoa {path}: {error}") from error
    match = FRONTMATTER_PATTERN.match(content)
    if not match:
        return {}
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, separator, raw_value = line.partition(":")
        if not separator:
            continue
        fields[key.strip()] = _parse_scalar(raw_value.strip())
    return fields


def _parse_scalar(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, str) else value
        except json.JSONDecodeError:
            return value[1:-1]
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value
