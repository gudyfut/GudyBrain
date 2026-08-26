from __future__ import annotations

import json
import sys
import tempfile
import unittest
import wave
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

from gudybot.transcription.timeline import _mark_overlaps, merge_session  # noqa: E402
from gudybot.transcription.identity import (  # noqa: E402
    DiscordMemoryIdentityResolver,
)
from gudybot.audio.capture import (  # noqa: E402
    FRAME_WIDTH,
    SAMPLE_RATE,
    TimelineWaveSink,
    final_session_name,
)
from gudybot.audio.recovery import (  # noqa: E402
    migrate_legacy_session_names,
    recover_incomplete_sessions,
)
from gudybot.audio.identity import ParticipantIdentity  # noqa: E402


class FakeClock:
    def __init__(self, value: float = 100.0) -> None:
        self.value = value

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def voice_data(timestamp: int, sequence: int, ssrc: int, samples: int = 960):
    packet = SimpleNamespace(timestamp=timestamp, sequence=sequence, ssrc=ssrc)
    pcm = b"\x00\x00\x01\x00" * samples
    return SimpleNamespace(packet=packet, pcm=pcm)


def user(user_id: int, name: str):
    return SimpleNamespace(
        id=user_id,
        name=name.lower(),
        global_name=name,
        nick=f"apelido-{name}",
    )


class TimelineRecordingTests(unittest.TestCase):
    def make_sink(self, root: Path, clock: FakeClock, **kwargs) -> TimelineWaveSink:
        return TimelineWaveSink(
            root,
            session_id="sessao-teste",
            guild_id=1,
            guild_name="Servidor",
            voice_channel_id=2,
            voice_channel_name="Call",
            started_at=datetime(2026, 8, 7, tzinfo=timezone.utc),
            clock=clock,
            **kwargs,
        )

    def test_timeline_survives_compaction_and_merges_transcript_words(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            root = Path(directory)
            clock = FakeClock()
            sink = self.make_sink(root, clock)
            alice = user(10, "Alice")
            bob = user(20, "Bob")

            clock.advance(0.02)
            sink.write(voice_data(1_000, 1, 100), alice)
            clock.advance(0.02)
            sink.write(voice_data(1_960, 2, 100), alice)
            clock.advance(1.98)
            sink.write(voice_data(8_000, 1, 200), bob)
            clock.advance(2.98)
            sink.write(voice_data(241_000, 3, 100), alice)

            saved, manifest_path = sink.finalize_files()
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "complete")
            self.assertEqual(len(saved), 2)

            alice_chunk = next(
                participant for participant in manifest["participants"]
                if participant["user_id"] == 10
            )["chunks"][0]
            self.assertEqual(len(alice_chunk["spans"]), 2)
            self.assertAlmostEqual(alice_chunk["spans"][0]["call_start"], 0.0, places=3)
            self.assertAlmostEqual(alice_chunk["spans"][1]["call_start"], 5.0, places=3)
            self.assertAlmostEqual(alice_chunk["spans"][1]["audio_start"], 0.54, places=3)

            for path in saved:
                with wave.open(str(path), "rb") as wav_file:
                    self.assertEqual(wav_file.getframerate(), SAMPLE_RATE)
                    self.assertEqual(wav_file.getnchannels(), 2)
                    self.assertEqual(wav_file.getsampwidth(), FRAME_WIDTH // 2)

            transcripts = sink.session_dir / "transcricoes"
            for participant in manifest["participants"]:
                for chunk in participant["chunks"]:
                    stem = Path(chunk["file"]).stem
                    output = transcripts / stem
                    output.mkdir(parents=True)
                    if participant["user_id"] == 10:
                        words = [
                            {"word": "Olá", "start": 0.01, "end": 0.03, "score": 0.9},
                            {"word": " Vega", "start": 0.031, "end": 0.035, "score": 0.9},
                            {"word": " fantasma", "start": 0.2, "end": 0.3, "score": 0.1},
                            {"word": " voltei", "start": 0.545, "end": 0.558, "score": 0.8},
                        ]
                    else:
                        words = [
                            {"word": "Sim", "start": 0.005, "end": 0.015, "score": 0.9}
                        ]
                    (output / f"{stem}.json").write_text(
                        json.dumps({"word_segments": words}), encoding="utf-8"
                    )

            alice_person_id = "mem_00000000-0000-4000-8000-000000000010"
            resolver = DiscordMemoryIdentityResolver(
                {"10": alice_person_id},
                {alice_person_id: "Alice Cadastrada"},
            )
            text_path, json_path = merge_session(
                sink.session_dir,
                transcripts,
                identity_resolver=resolver,
            )
            result = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(result["schema_version"], 4)
            self.assertEqual(
                [item["text"] for item in result["utterances"]],
                ["Olá V3ga", "Sim", "voltei"],
            )
            self.assertAlmostEqual(result["utterances"][0]["start"], 0.01, places=3)
            self.assertAlmostEqual(result["utterances"][1]["start"], 2.005, places=3)
            self.assertAlmostEqual(result["utterances"][2]["start"], 5.005, places=3)
            self.assertIn(
                "Alice Cadastrada: Olá", text_path.read_text(encoding="utf-8")
            )
            alice_utterance = result["utterances"][0]
            self.assertEqual(alice_utterance["person_id"], alice_person_id)
            self.assertEqual(alice_utterance["display_name"], "Alice Cadastrada")
            self.assertEqual(alice_utterance["discord_display_name"], "Alice")
            bob_participant = next(
                item for item in result["participants"] if item["user_id"] == "20"
            )
            self.assertEqual(bob_participant["identity_source"], "discord")
            self.assertIsNone(bob_participant["person_id"])
            self.assertEqual(result["transcription_quality"]["rejected_count"], 1)
            self.assertEqual(result["transcription_quality"]["correction_count"], 1)
            self.assertEqual(result["utterances"][0]["raw_text"], "Olá Vega")
            quality = json.loads(
                (sink.session_dir / "transcricao-qualidade.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(quality["rejected"][0]["text"], "fantasma")
            self.assertEqual(
                quality["rejected"][0]["reason"], "fora_de_trecho_de_voz"
            )
            self.assertEqual(quality["corrections"][0]["canonical"], "V3ga")

    def test_account_name_wins_over_server_nickname(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            clock = FakeClock()
            sink = self.make_sink(Path(directory), clock)
            member = SimpleNamespace(
                id=10,
                name="alice_username",
                global_name="Alice Global",
                display_name="Apelido do servidor",
                nick="Apelido do servidor",
            )

            clock.advance(0.02)
            sink.write(voice_data(1_000, 1, 100), member)
            saved, manifest_path = sink.finalize_files()

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            participant = manifest["participants"][0]
            self.assertEqual(participant["display_name"], "Alice Global")
            self.assertEqual(participant["global_name"], "Alice Global")
            self.assertEqual(participant["username"], "alice_username")
            self.assertEqual(participant["guild_nickname"], "Apelido do servidor")
            self.assertIn("Alice_Global_10", saved[0].name)
            self.assertNotIn("Apelido", saved[0].name)

    def test_preloaded_identity_handles_minimal_voice_user(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            clock = FakeClock()
            identity = ParticipantIdentity(
                user_id=20,
                username="bianca_username",
                global_name="Bianca",
                guild_nickname="Outro apelido",
            )
            sink = self.make_sink(
                Path(directory),
                clock,
                participant_identities={20: identity},
            )
            minimal_user = SimpleNamespace(id=20)

            clock.advance(0.02)
            sink.write(voice_data(1_000, 1, 200), minimal_user)
            saved, manifest_path = sink.finalize_files()

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            participant = manifest["participants"][0]
            self.assertEqual(participant["display_name"], "Bianca")
            self.assertEqual(participant["username"], "bianca_username")
            self.assertIn("Bianca_20", saved[0].name)

    def test_rtp_timestamp_rollover_remains_continuous(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            clock = FakeClock()
            sink = self.make_sink(Path(directory), clock)
            person = user(30, "Pessoa")
            first_timestamp = 0xFFFFFF00
            clock.advance(0.02)
            sink.write(voice_data(first_timestamp, 65_535, 300), person)
            delayed_packet = voice_data(
                (first_timestamp + 960) & 0xFFFFFFFF, 0, 300
            )
            delayed_packet.packet.received_monotonic = clock.value + 0.02
            clock.advance(10.02)
            sink.write(delayed_packet, person)
            _, manifest_path = sink.finalize_files()
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            span = manifest["participants"][0]["chunks"][0]["spans"][0]
            self.assertEqual(span["packets"], 2)
            self.assertAlmostEqual(span["call_end"], 0.04, places=3)

    def test_chunks_rotate_and_interrupted_session_is_recovered(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            root = Path(directory)
            clock = FakeClock()
            sink = self.make_sink(root, clock, chunk_seconds=0.03)
            person = user(40, "Pessoa")
            clock.advance(0.02)
            sink.write(voice_data(1_000, 1, 400), person)
            clock.advance(0.02)
            sink.write(voice_data(1_960, 2, 400), person)
            sink.close_capture()

            recovered = recover_incomplete_sessions(root)
            self.assertEqual(len(recovered), 1)
            self.assertRegex(
                recovered[0].name,
                r"^20260807-000000_a_20260807-000000(?:-\d+)?$",
            )
            manifest = json.loads(
                (recovered[0] / "session.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["status"], "recovered")
            self.assertEqual(len(manifest["participants"][0]["chunks"]), 2)
            for chunk in manifest["participants"][0]["chunks"]:
                self.assertTrue((recovered[0] / chunk["file"]).is_file())
                self.assertNotIn("pending_pcm", chunk)

    def test_final_session_name_contains_start_and_end_seconds(self) -> None:
        started = datetime(2026, 8, 7, 18, 52, 40, tzinfo=timezone.utc)
        ended = datetime(2026, 8, 7, 18, 53, 12, tzinfo=timezone.utc)
        self.assertEqual(
            final_session_name(started, ended),
            "20260807-185240_a_20260807-185312",
        )

    def test_completed_session_directory_is_renamed(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            clock = FakeClock()
            sink = self.make_sink(Path(directory), clock)
            temporary_dir = sink.session_dir
            clock.advance(0.02)
            sink.write(voice_data(1_000, 1, 500), user(50, "Pessoa"))
            sink.close_capture()
            sink.ended_at = datetime(2026, 8, 7, 0, 0, 12, tzinfo=timezone.utc)

            saved, manifest_path = sink.finalize_files()

            self.assertFalse(temporary_dir.exists())
            self.assertEqual(
                sink.session_dir.name,
                "20260807-000000_a_20260807-000012",
            )
            self.assertEqual(manifest_path.parent, sink.session_dir)
            self.assertTrue(all(path.is_file() for path in saved))
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["session_id"], sink.session_dir.name)
            self.assertEqual(manifest["status"], "complete")

    def test_legacy_session_name_and_transcript_sources_are_migrated(self) -> None:
        with tempfile.TemporaryDirectory(dir=BOT_DIR / "tests") as directory:
            root = Path(directory)
            legacy = root / "20260807-185240_123456"
            legacy.mkdir()
            manifest = {
                "status": "complete",
                "session_id": legacy.name,
                "started_at": "2026-08-07T18:52:40+00:00",
                "ended_at": "2026-08-07T18:53:12+00:00",
            }
            (legacy / "session.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )
            source = legacy / "transcricoes" / "trilha.json"
            conversation = {
                "session_id": legacy.name,
                "transcript_sources": [str(source)],
            }
            (legacy / "conversa.json").write_text(
                json.dumps(conversation), encoding="utf-8"
            )

            migrated = migrate_legacy_session_names(root)

            self.assertEqual(len(migrated), 1)
            destination = root / "20260807-185240_a_20260807-185312"
            self.assertEqual(migrated[0], (legacy, destination))
            self.assertFalse(legacy.exists())
            updated_manifest = json.loads(
                (destination / "session.json").read_text(encoding="utf-8")
            )
            updated_conversation = json.loads(
                (destination / "conversa.json").read_text(encoding="utf-8")
            )
            self.assertEqual(updated_manifest["session_id"], destination.name)
            self.assertEqual(updated_conversation["session_id"], destination.name)
            self.assertTrue(
                updated_conversation["transcript_sources"][0].startswith(
                    str(destination)
                )
            )

    def test_overlaps_are_marked_for_both_speakers(self) -> None:
        utterances = [
            {"user_id": 1, "display_name": "A", "start": 1.0, "end": 3.0},
            {"user_id": 2, "display_name": "B", "start": 2.0, "end": 4.0},
        ]
        _mark_overlaps(utterances)
        self.assertEqual(utterances[0]["overlaps"][0]["user_id"], 2)
        self.assertEqual(utterances[1]["overlaps"][0]["user_id"], 1)
        self.assertEqual(utterances[0]["overlaps"][0]["start"], 2.0)
        self.assertEqual(utterances[0]["overlaps"][0]["end"], 3.0)


if __name__ == "__main__":
    unittest.main()
