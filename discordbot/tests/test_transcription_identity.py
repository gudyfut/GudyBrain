from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

from gudybot.transcription.identity import (  # noqa: E402
    DiscordMemoryIdentityResolver,
)


ALEX_ID = "mem_1a2b3c4d-0000-4000-8000-000000000001"
BIANCA_ID = "mem_1a2b3c4d-0000-4000-8000-000000000002"


class TranscriptionIdentityTests(unittest.TestCase):
    def make_files(self, root: Path) -> tuple[Path, Path]:
        people = root / "memory" / "social" / "pessoas"
        people.mkdir(parents=True)
        (people / "alex.md").write_text(
            "---\n"
            "type: Pessoa\n"
            f"id: {ALEX_ID}\n"
            "title: Alex Moreira\n"
            "---\n",
            encoding="utf-8",
        )
        (people / "bianca.md").write_text(
            "---\n"
            "type: Pessoa\n"
            f"id: {BIANCA_ID}\n"
            'title: "Bianca Duarte"\n'
            "---\n",
            encoding="utf-8",
        )
        mapping = root / "identidades_discord.json"
        mapping.write_text(
            json.dumps(
                {
                    "creator_person_id": ALEX_ID,
                    "person_id_by_discord_id": {
                        "100000000000000001": ALEX_ID,
                        "100000000000000002": BIANCA_ID,
                    },
                }
            ),
            encoding="utf-8",
        )
        return mapping, people

    def test_resolves_discord_id_to_current_memory_title(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            mapping, people = self.make_files(Path(directory))
            resolver = DiscordMemoryIdentityResolver.from_files(mapping, people)

            speaker = resolver.resolve(100000000000000002, "bi_discord")

            self.assertTrue(speaker.resolved)
            self.assertEqual(speaker.person_id, BIANCA_ID)
            self.assertEqual(speaker.display_name, "Bianca Duarte")
            self.assertEqual(speaker.discord_display_name, "bi_discord")

    def test_new_resolution_uses_title_after_name_change(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            mapping, people = self.make_files(Path(directory))
            bianca = people / "bianca.md"
            bianca.write_text(
                bianca.read_text(encoding="utf-8").replace(
                    'title: "Bianca Duarte"', "title: Bianca Atualizada"
                ),
                encoding="utf-8",
            )

            resolver = DiscordMemoryIdentityResolver.from_files(mapping, people)

            self.assertEqual(
                resolver.resolve(100000000000000002, "nome_antigo").display_name,
                "Bianca Atualizada",
            )

    def test_unmapped_discord_user_keeps_discord_name(self) -> None:
        resolver = DiscordMemoryIdentityResolver({}, {})

        speaker = resolver.resolve(999, "Pessoa não cadastrada")

        self.assertFalse(speaker.resolved)
        self.assertIsNone(speaker.person_id)
        self.assertEqual(speaker.display_name, "Pessoa não cadastrada")

    def test_invalid_mapping_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            root = Path(directory)
            mapping, people = self.make_files(root)
            mapping.write_text(
                json.dumps(
                    {
                        "creator_person_id": ALEX_ID,
                        "person_id_by_discord_id": {"discord-invalido": BIANCA_ID},
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "ID do Discord inválido"):
                DiscordMemoryIdentityResolver.from_files(mapping, people)


if __name__ == "__main__":
    unittest.main()
