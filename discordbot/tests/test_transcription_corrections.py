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
                            {"canonical": "V3ga House", "variants": ["Vega House"]},
                            {"canonical": "V3ga", "variants": ["Vega"]},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            rules = load_transcription_corrections(path)
            text, corrections = apply_transcription_corrections(
                "A Vega House é uma referência da Vega.", rules
            )
            self.assertEqual(text, "A V3ga House é uma referência da V3ga.")
            self.assertEqual(
                [(item["original"], item["canonical"]) for item in corrections],
                [("Vega House", "V3ga House"), ("Vega", "V3ga")],
            )

    def test_partial_word_is_not_replaced(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            path = Path(directory) / "correcoes.json"
            path.write_text(
                json.dumps(
                    {"rules": [{"canonical": "V3ga", "variants": ["Vega"]}]}
                ),
                encoding="utf-8",
            )
            text, corrections = apply_transcription_corrections(
                "Vega e Veganismo", load_transcription_corrections(path)
            )
            self.assertEqual(text, "V3ga e Veganismo")
            self.assertEqual(len(corrections), 1)


if __name__ == "__main__":
    unittest.main()
