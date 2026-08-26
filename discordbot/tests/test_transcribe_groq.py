from __future__ import annotations

import sys
import unittest
from pathlib import Path


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

from gudybot.config import GLOSSARY_FILE, TRANSCRIPTION_MODEL  # noqa: E402
from gudybot.transcription.groq import (  # noqa: E402
    AudioPart,
    build_prompt,
    combine_parts,
    plan_audio_parts,
)


class GroqTranscriptionTests(unittest.TestCase):
    def test_large_v3_is_the_default_model(self) -> None:
        self.assertEqual(TRANSCRIPTION_MODEL, "whisper-large-v3")

    def test_parts_prefer_silence_before_limit(self) -> None:
        parts = plan_audio_parts(
            700,
            [
                {"audio_start": 0, "audio_end": 400},
                {"audio_start": 400.5, "audio_end": 470},
                {"audio_start": 470.5, "audio_end": 700},
            ],
            480,
        )
        self.assertEqual(len(parts), 2)
        self.assertAlmostEqual(parts[0].end, 470.25)
        self.assertEqual(parts[1].start, parts[0].end)
        self.assertEqual(parts[1].end, 700)

    def test_parts_fall_back_to_exact_limit(self) -> None:
        parts = plan_audio_parts(1_100, [], 480)
        self.assertEqual(
            [(part.start, part.end) for part in parts],
            [(0.0, 480.0), (480.0, 960.0), (960.0, 1_100.0)],
        )

    def test_api_timestamps_are_offset_into_original_track(self) -> None:
        result = combine_parts(
            Path("Gudy.wav"),
            30,
            [
                (
                    AudioPart(1, 10, 20),
                    {
                        "text": "Olá mundo",
                        "words": [
                            {"word": "Olá", "start": 1.0, "end": 1.4},
                            {"word": "mundo", "start": 1.5, "end": 2.0},
                        ],
                        "segments": [
                            {"text": "Olá mundo", "start": 1.0, "end": 2.0}
                        ],
                    },
                )
            ],
            model="whisper-large-v3",
            language="pt",
        )
        self.assertEqual(result["words"][0]["start"], 11.0)
        self.assertEqual(result["words"][1]["end"], 12.0)
        self.assertEqual(result["segments"][0]["start"], 11.0)

    def test_prompt_includes_participants_and_glossary(self) -> None:
        prompt = build_prompt(
            {
                "participants": [
                    {"user_id": 10, "display_name": "Gudy"},
                    {"user_id": 20, "display_name": "Bianca"},
                ]
            },
            GLOSSARY_FILE,
        )
        self.assertIn("Gudy", prompt)
        self.assertIn("Bianca", prompt)
        self.assertIn("Grafias esperadas:", prompt)
        self.assertLessEqual(len(prompt), 800)


if __name__ == "__main__":
    unittest.main()
