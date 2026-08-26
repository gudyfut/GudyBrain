from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
import unicodedata
import wave
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, Callable, Mapping

import discord

from .identity import ParticipantIdentity, choose_identity


logger = logging.getLogger("discordbot.recording")

SAMPLE_RATE = 48_000
CHANNELS = 2
SAMPLE_WIDTH = 2
FRAME_WIDTH = CHANNELS * SAMPLE_WIDTH
RTP_MODULUS = 1 << 32
DEFAULT_CHUNK_SECONDS = 30 * 60
DEFAULT_SEPARATOR_SECONDS = 0.5
CONTIGUOUS_TOLERANCE_SECONDS = 0.005
TIMING_REANCHOR_TOLERANCE_SECONDS = 2.0
CHECKPOINT_SECONDS = 10.0
MANIFEST_NAME = "session.json"
_arrival_hook_installed = False


def install_packet_arrival_timestamps() -> None:
    """Marca o pacote antes do buffer de jitter para preservar o tempo real."""

    global _arrival_hook_installed
    if _arrival_hook_installed:
        return
    from discord.voice.receive import reader as reader_module

    original_decode = reader_module.decode

    def decode_with_arrival(data: bytes):
        packet = original_decode(data)
        packet.received_monotonic = time.monotonic()
        return packet

    reader_module.decode = decode_with_arrival
    _arrival_hook_installed = True


def safe_name(name: str) -> str:
    value = unicodedata.normalize("NFKC", name)
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    value = re.sub(r"\s+", "_", value.strip())
    value = re.sub(r"_+", "_", value).strip(" ._")
    return (value or "usuario")[:60]


def _seconds(samples: int) -> float:
    return round(samples / SAMPLE_RATE, 6)


def _atomic_json(path: Path, data: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(temporary, path)


def _inside(base: Path, relative: str) -> Path:
    base = base.resolve()
    target = (base / relative).resolve()
    if base != target and base not in target.parents:
        raise ValueError(f"Caminho fora da sessão: {relative}")
    return target


def final_session_name(started_at: datetime, ended_at: datetime) -> str:
    """Nome legível e ordenável contendo início e fim com precisão de segundos."""

    return (
        f"{started_at.strftime('%Y%m%d-%H%M%S')}_a_"
        f"{ended_at.strftime('%Y%m%d-%H%M%S')}"
    )


def unique_session_path(parent: Path, name: str, current: Path | None = None) -> Path:
    candidate = parent / name
    suffix = 2
    current_resolved = current.resolve() if current is not None else None
    while candidate.exists() and (
        current_resolved is None or candidate.resolve() != current_resolved
    ):
        candidate = parent / f"{name}-{suffix}"
        suffix += 1
    return candidate


def pcm_to_wav(raw_path: Path, wav_path: Path) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = wav_path.with_suffix(wav_path.suffix + ".tmp")
    with raw_path.open("rb") as source, wave.open(str(temporary), "wb") as output:
        output.setnchannels(CHANNELS)
        output.setsampwidth(SAMPLE_WIDTH)
        output.setframerate(SAMPLE_RATE)
        while block := source.read(1024 * 1024):
            output.writeframesraw(block)
    os.replace(temporary, wav_path)


@dataclass(slots=True)
class TimelineSpan:
    audio_start_sample: int
    audio_end_sample: int
    call_start: float
    call_end: float
    rtp_start: int
    rtp_end: int
    sequence_start: int
    sequence_end: int
    ssrc: int
    packets: int = 1

    def to_dict(self) -> dict:
        return {
            "audio_start": _seconds(self.audio_start_sample),
            "audio_end": _seconds(self.audio_end_sample),
            "call_start": round(self.call_start, 6),
            "call_end": round(self.call_end, 6),
            "rtp_start": self.rtp_start,
            "rtp_end": self.rtp_end,
            "sequence_start": self.sequence_start,
            "sequence_end": self.sequence_end,
            "ssrc": self.ssrc,
            "packets": self.packets,
        }


@dataclass(slots=True)
class AudioChunk:
    index: int
    raw_path: Path
    wav_path: Path
    handle: BinaryIO
    samples_written: int = 0
    spans: list[TimelineSpan] = field(default_factory=list)
    closed: bool = False

    def close(self) -> None:
        if not self.closed:
            self.handle.flush()
            self.handle.close()
            self.closed = True


@dataclass(slots=True)
class ParticipantTrack:
    user_id: int
    identity: ParticipantIdentity
    chunks: list[AudioChunk] = field(default_factory=list)
    last_rtp: int | None = None
    last_ssrc: int | None = None
    last_sequence: int | None = None
    last_call_start: float | None = None
    last_call_end: float | None = None
    last_arrival: float | None = None


class TimelineWaveSink(discord.sinks.Sink):
    """Grava PCM em disco e mapeia áudio compacto para o tempo da chamada."""

    __sink_listeners__: list[tuple[str, str]] = []

    def __init__(
        self,
        recordings_dir: Path,
        *,
        session_id: str,
        guild_id: int,
        guild_name: str,
        voice_channel_id: int,
        voice_channel_name: str,
        started_at: datetime | None = None,
        clock: Callable[[], float] = time.monotonic,
        chunk_seconds: float = DEFAULT_CHUNK_SECONDS,
        participant_identities: Mapping[int, ParticipantIdentity] | None = None,
        identity_resolver: Callable[[int], ParticipantIdentity | None] | None = None,
    ) -> None:
        super().__init__()
        self.clock = clock
        self.started_monotonic = clock()
        self.ended_monotonic: float | None = None
        self.started_at = started_at or datetime.now().astimezone()
        self.ended_at: datetime | None = None
        self.session_id = session_id
        self.guild_id = guild_id
        self.guild_name = guild_name
        self.voice_channel_id = voice_channel_id
        self.voice_channel_name = voice_channel_name
        self.chunk_max_samples = max(1, int(chunk_seconds * SAMPLE_RATE))
        self.separator_max_samples = int(DEFAULT_SEPARATOR_SECONDS * SAMPLE_RATE)
        self.session_dir = self._unique_session_dir(recordings_dir, session_id)
        self.tracks_dir = self.session_dir / "tracks"
        self.tracks_dir.mkdir(parents=True)
        self.manifest_path = self.session_dir / MANIFEST_NAME
        self.participants: dict[int, ParticipantTrack] = {}
        self.participant_identities = dict(participant_identities or {})
        self.identity_resolver = identity_resolver
        self._lock = threading.RLock()
        self._closed = False
        self._finalized = False
        self._last_checkpoint = self.started_monotonic
        self._write_manifest("recording")

    @staticmethod
    def _unique_session_dir(recordings_dir: Path, session_id: str) -> Path:
        recordings_dir.mkdir(parents=True, exist_ok=True)
        candidate = recordings_dir / session_id
        suffix = 2
        while candidate.exists():
            candidate = recordings_dir / f"{session_id}-{suffix}"
            suffix += 1
        candidate.mkdir()
        return candidate

    def is_opus(self) -> bool:
        return False

    def _new_chunk(self, track: ParticipantTrack) -> AudioChunk:
        index = len(track.chunks) + 1
        stem = (
            f"{safe_name(track.identity.display_name)}_"
            f"{track.user_id}_parte{index:03d}"
        )
        raw_path = self.tracks_dir / f"{stem}.pcm.part"
        wav_path = self.tracks_dir / f"{stem}.wav"
        chunk = AudioChunk(
            index, raw_path, wav_path, raw_path.open("xb", buffering=0)
        )
        track.chunks.append(chunk)
        return chunk

    def _current_chunk(
        self, track: ParticipantTrack, required_samples: int
    ) -> AudioChunk:
        chunk = track.chunks[-1] if track.chunks else self._new_chunk(track)
        if chunk.samples_written and (
            chunk.samples_written + required_samples > self.chunk_max_samples
        ):
            chunk.close()
            chunk = self._new_chunk(track)
        return chunk

    def _packet_time(
        self,
        track: ParticipantTrack,
        *,
        rtp_timestamp: int,
        ssrc: int,
        arrival: float,
        frame_duration: float,
    ) -> float:
        arrival_offset = max(0.0, arrival - self.started_monotonic)
        reanchor = track.last_rtp is None or track.last_ssrc != ssrc

        if not reanchor:
            rtp_delta = (rtp_timestamp - track.last_rtp) % RTP_MODULUS
            rtp_elapsed = rtp_delta / SAMPLE_RATE
            arrival_elapsed = max(0.0, arrival - (track.last_arrival or arrival))
            if abs(rtp_elapsed - arrival_elapsed) > TIMING_REANCHOR_TOLERANCE_SECONDS:
                reanchor = True

        if reanchor:
            call_start = max(0.0, arrival_offset - frame_duration)
        else:
            call_start = (track.last_call_start or 0.0) + rtp_elapsed

        if track.last_call_end is not None and call_start < track.last_call_end:
            call_start = track.last_call_end
        return call_start

    def write(self, data, user) -> None:
        pcm = getattr(data, "pcm", b"")
        packet = getattr(data, "packet", None)
        if user is None or packet is None or not pcm:
            return
        if len(pcm) % FRAME_WIDTH:
            logger.warning("Pacote PCM com tamanho inválido: %s bytes", len(pcm))
            pcm = pcm[: len(pcm) - (len(pcm) % FRAME_WIDTH)]
            if not pcm:
                return

        user_id = int(user.id)
        known_identity = self.participant_identities.get(user_id)
        resolved_identity = (
            self.identity_resolver(user_id) if self.identity_resolver else None
        )
        identity = choose_identity(user, known_identity, resolved_identity)
        self.participant_identities[user_id] = identity
        frame_samples = len(pcm) // FRAME_WIDTH
        frame_duration = frame_samples / SAMPLE_RATE
        rtp_timestamp = int(packet.timestamp) & 0xFFFFFFFF
        sequence = int(getattr(packet, "sequence", -1))
        ssrc = int(packet.ssrc)
        received_at = getattr(packet, "received_monotonic", None)
        arrival = float(received_at if received_at is not None else self.clock())

        with self._lock:
            if self._closed:
                return
            track = self.participants.setdefault(
                user_id, ParticipantTrack(user_id, identity)
            )
            if not track.identity.resolved and identity.resolved:
                track.identity = identity
            call_start = self._packet_time(
                track,
                rtp_timestamp=rtp_timestamp,
                ssrc=ssrc,
                arrival=arrival,
                frame_duration=frame_duration,
            )
            call_end = call_start + frame_duration
            gap = (
                max(0.0, call_start - track.last_call_end)
                if track.last_call_end is not None
                else 0.0
            )
            new_span = (
                not track.chunks
                or gap > CONTIGUOUS_TOLERANCE_SECONDS
                or track.last_ssrc != ssrc
            )
            separator_samples = (
                min(int(gap * SAMPLE_RATE), self.separator_max_samples)
                if new_span and track.chunks
                else 0
            )
            chunk = self._current_chunk(
                track, separator_samples + frame_samples
            )
            if not chunk.samples_written:
                separator_samples = 0
            if separator_samples:
                chunk.handle.write(b"\x00" * (separator_samples * FRAME_WIDTH))
                chunk.samples_written += separator_samples

            audio_start = chunk.samples_written
            chunk.handle.write(pcm)
            chunk.samples_written += frame_samples
            audio_end = chunk.samples_written

            can_extend = (
                chunk.spans
                and not new_span
                and chunk.spans[-1].ssrc == ssrc
                and chunk.spans[-1].audio_end_sample == audio_start
            )
            if can_extend:
                span = chunk.spans[-1]
                span.audio_end_sample = audio_end
                span.call_end = call_end
                span.rtp_end = (rtp_timestamp + frame_samples) & 0xFFFFFFFF
                span.sequence_end = sequence
                span.packets += 1
            else:
                chunk.spans.append(
                    TimelineSpan(
                        audio_start,
                        audio_end,
                        call_start,
                        call_end,
                        rtp_timestamp,
                        (rtp_timestamp + frame_samples) & 0xFFFFFFFF,
                        sequence,
                        sequence,
                        ssrc,
                    )
                )

            track.last_rtp = rtp_timestamp
            track.last_ssrc = ssrc
            track.last_sequence = sequence
            track.last_call_start = call_start
            track.last_call_end = call_end
            track.last_arrival = arrival

            if new_span or arrival - self._last_checkpoint >= CHECKPOINT_SECONDS:
                self._write_manifest("recording")
                self._last_checkpoint = arrival

    def _manifest(self, status: str) -> dict:
        elapsed = max(
            0.0,
            (self.ended_monotonic or self.clock()) - self.started_monotonic,
        )
        participants = []
        for track in sorted(self.participants.values(), key=lambda item: item.user_id):
            chunks = []
            for chunk in track.chunks:
                item = {
                    "index": chunk.index,
                    "file": chunk.wav_path.relative_to(self.session_dir).as_posix(),
                    "sample_count": chunk.samples_written,
                    "audio_duration": _seconds(chunk.samples_written),
                    "spans": [span.to_dict() for span in chunk.spans],
                }
                if chunk.raw_path.exists():
                    item["pending_pcm"] = chunk.raw_path.relative_to(
                        self.session_dir
                    ).as_posix()
                chunks.append(item)
            participants.append(
                {
                    "user_id": track.user_id,
                    "display_name": track.identity.display_name,
                    "global_name": track.identity.global_name,
                    "username": track.identity.username,
                    "guild_nickname": track.identity.guild_nickname,
                    "chunks": chunks,
                }
            )
        return {
            "schema_version": 2,
            "status": status,
            "session_id": self.session_dir.name,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "call_duration": round(elapsed, 6),
            "guild": {"id": self.guild_id, "name": self.guild_name},
            "voice_channel": {
                "id": self.voice_channel_id,
                "name": self.voice_channel_name,
            },
            "audio": {
                "format": "wav",
                "sample_rate": SAMPLE_RATE,
                "channels": CHANNELS,
                "sample_width_bytes": SAMPLE_WIDTH,
                "compact_timeline": True,
            },
            "participants": participants,
        }

    def _write_manifest(self, status: str) -> None:
        _atomic_json(self.manifest_path, self._manifest(status))

    def close_capture(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self.finished = True
            self.ended_monotonic = self.clock()
            self.ended_at = datetime.now().astimezone()
            for track in self.participants.values():
                for chunk in track.chunks:
                    chunk.close()
            self._write_manifest("captured")

    def cleanup(self) -> None:
        self.close_capture()

    def finalize_files(self) -> tuple[list[Path], Path]:
        self.close_capture()
        with self._lock:
            self._write_manifest("finalizing")
            for track in self.participants.values():
                for chunk in track.chunks:
                    if chunk.raw_path.exists():
                        pcm_to_wav(chunk.raw_path, chunk.wav_path)
                        chunk.raw_path.unlink()
            self._rename_to_final_name()
            saved = [
                chunk.wav_path
                for track in self.participants.values()
                for chunk in track.chunks
                if chunk.wav_path.exists()
            ]
            self._finalized = True
            self._write_manifest("complete")
            return saved, self.manifest_path

    def _rename_to_final_name(self) -> None:
        ended_at = self.ended_at or datetime.now().astimezone()
        old_dir = self.session_dir
        destination = unique_session_path(
            old_dir.parent,
            final_session_name(self.started_at, ended_at),
            current=old_dir,
        )
        if destination == old_dir:
            return

        relative_paths = [
            (
                chunk,
                chunk.raw_path.relative_to(old_dir),
                chunk.wav_path.relative_to(old_dir),
            )
            for track in self.participants.values()
            for chunk in track.chunks
        ]
        old_dir.rename(destination)
        self.session_dir = destination
        self.session_id = destination.name
        self.tracks_dir = destination / "tracks"
        self.manifest_path = destination / MANIFEST_NAME
        for chunk, raw_relative, wav_relative in relative_paths:
            chunk.raw_path = destination / raw_relative
            chunk.wav_path = destination / wav_relative

    def discard(self) -> None:
        self.close_capture()
        base = self.session_dir.parent.resolve()
        target = self.session_dir.resolve()
        if base not in target.parents:
            raise ValueError(f"Sessão fora da pasta de gravações: {target}")
        shutil.rmtree(target)
