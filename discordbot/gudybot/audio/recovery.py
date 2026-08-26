from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path

from .capture import (
    FRAME_WIDTH,
    MANIFEST_NAME,
    SAMPLE_RATE,
    _atomic_json,
    _inside,
    _seconds,
    final_session_name,
    pcm_to_wav,
    unique_session_path,
)


logger = logging.getLogger("discordbot.recording.recovery")
FINAL_NAME_PATTERN = re.compile(
    r"^\d{8}-\d{6}_a_\d{8}-\d{6}(?:-\d+)?$"
)


def migrate_legacy_session_names(recordings_dir: Path) -> list[tuple[Path, Path]]:
    """Renomeia sessões concluídas antigas e atualiza referências estruturadas."""

    migrated: list[tuple[Path, Path]] = []
    if not recordings_dir.exists():
        return migrated

    for original_manifest_path in recordings_dir.glob(f"*/{MANIFEST_NAME}"):
        original_dir = original_manifest_path.parent
        if FINAL_NAME_PATTERN.fullmatch(original_dir.name):
            continue
        try:
            manifest = json.loads(original_manifest_path.read_text(encoding="utf-8"))
            if manifest.get("status") not in {"complete", "recovered"}:
                continue
            started_at = datetime.fromisoformat(manifest["started_at"])
            ended_value = manifest.get("ended_at")
            ended_at = (
                datetime.fromisoformat(ended_value)
                if ended_value
                else started_at
                + timedelta(seconds=float(manifest.get("call_duration") or 0.0))
            )
            destination = unique_session_path(
                recordings_dir,
                final_session_name(started_at, ended_at),
                current=original_dir,
            )
            if destination == original_dir:
                continue

            original_dir.rename(destination)
            manifest["session_id"] = destination.name
            _atomic_json(destination / MANIFEST_NAME, manifest)

            conversation_path = destination / "conversa.json"
            if conversation_path.is_file():
                conversation = json.loads(conversation_path.read_text(encoding="utf-8"))
                conversation["session_id"] = destination.name
                conversation["transcript_sources"] = [
                    str(source).replace(str(original_dir), str(destination), 1)
                    for source in conversation.get("transcript_sources", [])
                ]
                _atomic_json(conversation_path, conversation)
            migrated.append((original_dir, destination))
        except Exception:
            logger.exception("Falha ao migrar nome da sessão: %s", original_dir)
    return migrated


def recover_incomplete_sessions(recordings_dir: Path) -> list[Path]:
    recovered: list[Path] = []
    if not recordings_dir.exists():
        return recovered

    for original_manifest_path in recordings_dir.glob(f"*/{MANIFEST_NAME}"):
        try:
            data = json.loads(original_manifest_path.read_text(encoding="utf-8"))
            if data.get("status") not in {"recording", "captured", "finalizing"}:
                continue
            session_dir = original_manifest_path.parent
            changed = False
            for participant in data.get("participants", []):
                for chunk in participant.get("chunks", []):
                    pending = chunk.get("pending_pcm")
                    if not pending:
                        continue
                    raw_path = _inside(session_dir, pending)
                    wav_path = _inside(session_dir, chunk["file"])
                    if raw_path.exists():
                        actual_samples = raw_path.stat().st_size // FRAME_WIDTH
                        recorded_samples = int(chunk.get("sample_count", 0))
                        if actual_samples > recorded_samples and chunk.get("spans"):
                            extra_samples = actual_samples - recorded_samples
                            last_span = chunk["spans"][-1]
                            last_span["audio_end"] = _seconds(actual_samples)
                            last_span["call_end"] = round(
                                float(last_span["call_end"])
                                + extra_samples / SAMPLE_RATE,
                                6,
                            )
                        chunk["sample_count"] = actual_samples
                        chunk["audio_duration"] = _seconds(actual_samples)
                        pcm_to_wav(raw_path, wav_path)
                        raw_path.unlink()
                        changed = True
                    if "pending_pcm" in chunk:
                        chunk.pop("pending_pcm")
                        changed = True

            if not changed:
                continue

            maximum_end = max(
                (
                    float(span["call_end"])
                    for participant in data.get("participants", [])
                    for chunk in participant.get("chunks", [])
                    for span in chunk.get("spans", [])
                ),
                default=float(data.get("call_duration") or 0.0),
            )
            started_at = datetime.fromisoformat(data["started_at"])
            ended_at = started_at + timedelta(seconds=maximum_end)
            destination = unique_session_path(
                recordings_dir,
                final_session_name(started_at, ended_at),
                current=session_dir,
            )
            if destination != session_dir:
                session_dir.rename(destination)
                session_dir = destination

            data["status"] = "recovered"
            data["session_id"] = session_dir.name
            data["ended_at"] = ended_at.isoformat()
            data["recovered_at"] = datetime.now().astimezone().isoformat()
            data["call_duration"] = round(maximum_end, 6)
            manifest_path = session_dir / MANIFEST_NAME
            _atomic_json(manifest_path, data)
            recovered.append(session_dir)
        except Exception:
            logger.exception(
                "Falha ao recuperar sessão: %s", original_manifest_path.parent
            )
    return recovered
