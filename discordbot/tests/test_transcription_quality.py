from __future__ import annotations

import sys
import unittest
from pathlib import Path


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

from gudybot.config import HALLUCINATION_PHRASES_FILE  # noqa: E402
from gudybot.transcription.quality import (  # noqa: E402
    filter_timed_items,
    load_hallucination_phrases,
)


def words(text: str, *, start: float = 0.0) -> list[dict]:
    return [
        {
            "word": token,
            "start": start + index * 0.2,
            "end": start + index * 0.2 + 0.15,
        }
        for index, token in enumerate(text.split())
    ]


class TranscriptionQualityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.patterns = load_hallucination_phrases(HALLUCINATION_PHRASES_FILE)
        self.spans = [{"audio_start": 0.0, "audio_end": 30.0}]

    def test_known_cta_is_removed_without_erasing_surrounding_speech(self) -> None:
        source = words("fala real se inscreva no canal continuacao")
        kept, rejected, warnings = filter_timed_items(
            source,
            text_key="word",
            spans=self.spans,
            segments=[],
            phrase_patterns=self.patterns,
        )
        self.assertEqual([item["word"] for item in kept], ["fala", "real", "continuacao"])
        self.assertEqual(rejected[0]["reason"], "frase_tipica_de_alucinacao")
        self.assertEqual(warnings, [])

    def test_phrase_matching_tolerates_one_intrusive_word(self) -> None:
        source = words("se inscrever no Quem canal")
        kept, rejected, _ = filter_timed_items(
            source,
            text_key="word",
            spans=self.spans,
            segments=[],
            phrase_patterns=self.patterns,
        )
        self.assertEqual(kept, [])
        self.assertIn("Quem", rejected[0]["text"])

    def test_words_predicted_inside_compaction_separator_are_rejected(self) -> None:
        kept, rejected, _ = filter_timed_items(
            words("fantasma", start=0.25),
            text_key="word",
            spans=[
                {"audio_start": 0.0, "audio_end": 0.1},
                {"audio_start": 0.5, "audio_end": 0.8},
            ],
            segments=[],
            phrase_patterns=[],
        )
        self.assertEqual(kept, [])
        self.assertEqual(rejected[0]["reason"], "fora_de_trecho_de_voz")

    def test_probable_silence_is_removed_but_low_confidence_alone_is_only_flagged(self) -> None:
        source = words("audio duvidoso", start=1.0)
        silence_segment = {
            "start": 0.5,
            "end": 2.0,
            "text": "audio duvidoso",
            "avg_logprob": -1.2,
            "no_speech_prob": 0.8,
            "compression_ratio": 1.0,
        }
        kept, rejected, warnings = filter_timed_items(
            source,
            text_key="word",
            spans=self.spans,
            segments=[silence_segment],
            phrase_patterns=[],
        )
        self.assertEqual(kept, [])
        self.assertEqual(rejected[0]["reason"], "silencio_ou_ruido")
        self.assertEqual(warnings[0]["reasons"], ["baixa_confianca"])

        low_confidence = dict(silence_segment, no_speech_prob=0.0)
        kept, rejected, warnings = filter_timed_items(
            source,
            text_key="word",
            spans=self.spans,
            segments=[low_confidence],
            phrase_patterns=[],
        )
        self.assertEqual(len(kept), 2)
        self.assertEqual(rejected, [])
        self.assertEqual(warnings[0]["reasons"], ["baixa_confianca"])


if __name__ == "__main__":
    unittest.main()
