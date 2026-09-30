from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

from gudybot.transcription.corrections import (  # noqa: E402
    apply_transcription_corrections,
    load_transcription_corrections,
)


class TranscriptionCorrectionsTests(unittest.TestCase):
    def test_longest_variant_wins_and_changes_are_auditable(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            path = Path(directory) / "correcoes.json"
            path.write_text(
                json.dumps(
                    {
                        "rules": [
                            {"canonical": "Equipe Aurora", "variants": ["Ekipe Orora"]},
                            {"canonical": "Aurora", "variants": ["Orora"]},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            rules = load_transcription_corrections(path)
            text, corrections = apply_transcription_corrections(
                "A Ekipe Orora é uma referência da Orora.", rules
            )
            self.assertEqual(text, "A Equipe Aurora é uma referência da Aurora.")
            self.assertEqual(
                [(item["original"], item["canonical"]) for item in corrections],
                [("Ekipe Orora", "Equipe Aurora"), ("Orora", "Aurora")],
            )

    def test_partial_word_is_not_replaced(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            path = Path(directory) / "correcoes.json"
            path.write_text(
                json.dumps(
                    {"rules": [{"canonical": "Aurora", "variants": ["Orora"]}]}
                ),
                encoding="utf-8",
            )
            text, corrections = apply_transcription_corrections(
                "Orora e Ororamente", load_transcription_corrections(path)
            )
            self.assertEqual(text, "Aurora e Ororamente")
            self.assertEqual(len(corrections), 1)


if __name__ == "__main__":
    unittest.main()
