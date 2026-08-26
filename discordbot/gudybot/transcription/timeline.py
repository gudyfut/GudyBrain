from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

from ..config import HALLUCINATION_PHRASES_FILE, TRANSCRIPTION_CORRECTIONS_FILE
from .corrections import (
    apply_transcription_corrections,
    load_transcription_corrections,
)
from .identity import DiscordMemoryIdentityResolver
from .quality import filter_timed_items, load_hallucination_phrases


def format_offset(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def _join_words(tokens: list[str]) -> str:
    result = ""
    for token in tokens:
        if not token:
            continue
        if not result:
            result = token.strip()
        elif token[0].isspace() or re.match(r"^[,.;:!?…)]", token):
            result += token
        else:
            result += " " + token
    return result.strip()


def map_audio_time(spans: list[dict], audio_time: float) -> float:
    if not spans:
        return max(0.0, audio_time)
    ordered = sorted(spans, key=lambda span: span["audio_start"])
    epsilon = 0.002
    for span in ordered:
        if span["audio_start"] - epsilon <= audio_time <= span["audio_end"] + epsilon:
            relative = min(
                max(audio_time, span["audio_start"]), span["audio_end"]
            ) - span["audio_start"]
            return round(span["call_start"] + relative, 6)

    boundaries = []
    for span in ordered:
        boundaries.extend(
            (
                (abs(audio_time - span["audio_start"]), span["call_start"]),
                (abs(audio_time - span["audio_end"]), span["call_end"]),
            )
        )
    return round(min(boundaries, key=lambda item: item[0])[1], 6)


def _words_from_transcript(
    data: dict,
    spans: list[dict],
    phrase_patterns: list[tuple[str, ...]],
) -> tuple[list[dict], list[dict], list[dict], bool]:
    source_words = data.get("words") or data.get("word_segments") or [
        word
        for segment in data.get("segments", [])
        for word in segment.get("words", [])
    ]
    timed_words = [
        dict(word)
        for word in source_words
        if word.get("start") is not None and word.get("end") is not None
    ]
    if not timed_words:
        return [], [], [], False
    kept, rejected, warnings = filter_timed_items(
        timed_words,
        text_key="word",
        spans=spans,
        segments=[dict(segment) for segment in data.get("segments", [])],
        phrase_patterns=phrase_patterns,
    )
    words = []
    for word in kept:
        start = map_audio_time(spans, float(word["start"]))
        end = map_audio_time(spans, float(word["end"]))
        words.append(
            {
                "text": str(word.get("word", "")),
                "start": start,
                "end": max(start, end),
                "score": word.get("score"),
            }
        )
    return words, rejected, warnings, True


def _fallback_segments(
    data: dict,
    spans: list[dict],
    phrase_patterns: list[tuple[str, ...]],
) -> tuple[list[dict], list[dict], list[dict]]:
    source_segments = [
        dict(segment)
        for segment in data.get("segments", [])
        if segment.get("start") is not None and segment.get("end") is not None
    ]
    kept, rejected, warnings = filter_timed_items(
        source_segments,
        text_key="text",
        spans=spans,
        segments=source_segments,
        phrase_patterns=phrase_patterns,
    )
    utterances = []
    for segment in kept:
        start = map_audio_time(spans, float(segment["start"]))
        end = map_audio_time(spans, float(segment["end"]))
        utterances.append(
            {
                "start": start,
                "end": max(start, end),
                "text": str(segment.get("text", "")).strip(),
                "words": [],
            }
        )
    return utterances, rejected, warnings


def _group_words(words: list[dict], maximum_gap: float) -> list[dict]:
    groups: list[list[dict]] = []
    for word in words:
        if (
            not groups
            or word["start"] - groups[-1][-1]["end"] > maximum_gap
            or word["start"] < groups[-1][-1]["start"] - 0.1
        ):
            groups.append([word])
        else:
            groups[-1].append(word)
    return [
        {
            "start": group[0]["start"],
            "end": group[-1]["end"],
            "text": _join_words([word["text"] for word in group]),
            "words": group,
        }
        for group in groups
        if _join_words([word["text"] for word in group])
    ]


def _find_transcript(root: Path, audio_file: str) -> Path | None:
    stem = Path(audio_file).stem
    matches = [
        path
        for path in root.rglob(f"{stem}.json")
        if path.name not in {"conversa.json", "session.json"}
    ]
    if not matches:
        return None
    return max(matches, key=lambda path: path.stat().st_mtime)


def _absolute_time(started_at: datetime, offset: float) -> str:
    return (started_at + timedelta(seconds=offset)).isoformat()


def _mark_overlaps(utterances: list[dict]) -> None:
    active: list[dict] = []
    for utterance in utterances:
        active = [item for item in active if item["end"] > utterance["start"]]
        utterance["overlaps"] = []
        for item in active:
            if item["user_id"] == utterance["user_id"]:
                continue
            start = max(item["start"], utterance["start"])
            end = min(item["end"], utterance["end"])
            utterance["overlaps"].append(
                {
                    "user_id": item["user_id"],
                    "person_id": item.get("person_id"),
                    "display_name": item["display_name"],
                    "discord_display_name": item.get("discord_display_name"),
                    "start": start,
                    "end": end,
                }
            )
            item.setdefault("overlaps", []).append(
                {
                    "user_id": utterance["user_id"],
                    "person_id": utterance.get("person_id"),
                    "display_name": utterance["display_name"],
                    "discord_display_name": utterance.get("discord_display_name"),
                    "start": start,
                    "end": end,
                }
            )
        active.append(utterance)


def merge_session(
    session_dir: Path,
    transcripts_dir: Path | None = None,
    *,
    maximum_utterance_gap: float = 1.2,
    allow_missing: bool = False,
    identity_resolver: DiscordMemoryIdentityResolver | None = None,
    corrections_file: Path | None = TRANSCRIPTION_CORRECTIONS_FILE,
) -> tuple[Path, Path]:
    session_dir = session_dir.resolve()
    manifest_path = session_dir / "session.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    transcripts_dir = (transcripts_dir or session_dir / "transcricoes").resolve()
    started_at = datetime.fromisoformat(manifest["started_at"])
    identity_resolver = identity_resolver or DiscordMemoryIdentityResolver.from_files()
    utterances = []
    missing = []
    sources = []
    resolved_participants = []
    phrase_patterns = load_hallucination_phrases(HALLUCINATION_PHRASES_FILE)
    correction_rules = load_transcription_corrections(corrections_file)
    rejected_items = []
    warning_items = []
    correction_items = []

    for participant in manifest.get("participants", []):
        user_id = int(participant["user_id"])
        speaker = identity_resolver.resolve(user_id, str(participant["display_name"]))
        resolved_participants.append(
            {
                "user_id": str(user_id),
                "person_id": speaker.person_id,
                "display_name": speaker.display_name,
                "discord_display_name": speaker.discord_display_name,
                "identity_source": "memory" if speaker.resolved else "discord",
            }
        )
        for chunk in participant.get("chunks", []):
            transcript_path = _find_transcript(transcripts_dir, chunk["file"])
            if transcript_path is None:
                missing.append(chunk["file"])
                continue
            sources.append(str(transcript_path))
            transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
            spans = chunk.get("spans", [])
            words, rejected, warnings, used_word_timestamps = _words_from_transcript(
                transcript,
                spans,
                phrase_patterns,
            )
            if used_word_timestamps:
                chunk_utterances = _group_words(words, maximum_utterance_gap)
            else:
                chunk_utterances, rejected, warnings = _fallback_segments(
                    transcript,
                    spans,
                    phrase_patterns,
                )
            rejected_items.extend(
                _quality_context(item, spans, participant, speaker, chunk)
                for item in rejected
            )
            warning_items.extend(
                _quality_context(item, spans, participant, speaker, chunk)
                for item in warnings
            )
            for utterance in chunk_utterances:
                raw_text = str(utterance.get("text", ""))
                corrected_text, corrections = apply_transcription_corrections(
                    raw_text, correction_rules
                )
                utterance.update(
                    {
                        "user_id": str(user_id),
                        "person_id": speaker.person_id,
                        "display_name": speaker.display_name,
                        "discord_display_name": speaker.discord_display_name,
                        "audio_file": chunk["file"],
                        "absolute_start": _absolute_time(
                            started_at, utterance["start"]
                        ),
                        "absolute_end": _absolute_time(started_at, utterance["end"]),
                        "text": corrected_text,
                    }
                )
                if corrections:
                    utterance["raw_text"] = raw_text
                    utterance["transcription_corrections"] = corrections
                    correction_items.extend(
                        {
                            **correction,
                            "user_id": str(user_id),
                            "person_id": speaker.person_id,
                            "display_name": speaker.display_name,
                            "audio_file": chunk["file"],
                            "call_start": utterance["start"],
                            "call_end": utterance["end"],
                        }
                        for correction in corrections
                    )
                utterances.append(utterance)

    if missing and not allow_missing:
        formatted = "\n".join(f"- {item}" for item in missing)
        raise FileNotFoundError(
            "Não foram encontradas transcrições JSON para:\n" + formatted
        )

    utterances.sort(key=lambda item: (item["start"], item["end"], item["user_id"]))
    _mark_overlaps(utterances)
    result = {
        "schema_version": 4,
        "session_id": manifest["session_id"],
        "started_at": manifest["started_at"],
        "ended_at": manifest.get("ended_at"),
        "call_duration": manifest.get("call_duration"),
        "utterance_count": len(utterances),
        "missing_transcripts": missing,
        "transcript_sources": sources,
        "identity_warnings": list(identity_resolver.warnings),
        "participants": resolved_participants,
        "utterances": utterances,
        "transcription_quality": {
            "report": "transcricao-qualidade.json",
            "rejected_count": len(rejected_items),
            "warning_count": len(warning_items),
            "correction_count": len(correction_items),
        },
    }

    json_path = session_dir / "conversa.json"
    text_path = session_dir / "conversa.txt"
    quality_path = session_dir / "transcricao-qualidade.json"
    quality_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "session_id": manifest["session_id"],
                "phrase_filter": {
                    "file": str(HALLUCINATION_PHRASES_FILE),
                    "patterns_loaded": len(phrase_patterns),
                },
                "normalization": {
                    "file": str(corrections_file) if corrections_file else None,
                    "rules_loaded": len(correction_rules),
                },
                "rejected_count": len(rejected_items),
                "warning_count": len(warning_items),
                "correction_count": len(correction_items),
                "rejected": rejected_items,
                "warnings": warning_items,
                "corrections": correction_items,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        f"[{format_offset(item['start'])} - {format_offset(item['end'])}] "
        f"{item['display_name']}: {item['text']}"
        for item in utterances
    ]
    text_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return text_path, json_path


def _quality_context(
    item: dict,
    spans: list[dict],
    participant: dict,
    speaker,
    chunk: dict,
) -> dict:
    result = dict(item)
    audio_start = item.get("audio_start")
    audio_end = item.get("audio_end")
    result.update(
        {
            "user_id": str(participant["user_id"]),
            "person_id": speaker.person_id,
            "display_name": speaker.display_name,
            "audio_file": chunk["file"],
            "call_start": (
                map_audio_time(spans, float(audio_start))
                if audio_start is not None
                else None
            ),
            "call_end": (
                map_audio_time(spans, float(audio_end))
                if audio_end is not None
                else None
            ),
        }
    )
    return result


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mescla transcrições separadas na linha do tempo da chamada."
    )
    parser.add_argument("session", type=Path, help="pasta da sessão gravada")
    parser.add_argument(
        "--transcripts",
        type=Path,
        help="pasta com os JSONs da Groq (padrão: SESSAO/transcricoes)",
    )
    parser.add_argument("--utterance-gap", type=float, default=1.2)
    parser.add_argument("--allow-missing", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    text_path, json_path = merge_session(
        args.session,
        args.transcripts,
        maximum_utterance_gap=args.utterance_gap,
        allow_missing=args.allow_missing,
    )
    print(f"Conversa em texto: {text_path}")
    print(f"Conversa estruturada: {json_path}")


if __name__ == "__main__":
    main()
