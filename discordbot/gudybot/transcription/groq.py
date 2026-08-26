from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config import (
    ENV_FILE,
    GLOSSARY_FILE,
    TRANSCRIPTION_CHUNK_SECONDS,
    TRANSCRIPTION_LANGUAGE,
    TRANSCRIPTION_MAX_UPLOAD_BYTES,
    TRANSCRIPTION_MODEL,
    load_environment,
)
from .identity import DiscordMemoryIdentityResolver


DEFAULT_GLOSSARY = GLOSSARY_FILE
DEFAULT_MODEL = TRANSCRIPTION_MODEL
MAX_PART_SECONDS = TRANSCRIPTION_CHUNK_SECONDS
MAX_UPLOAD_BYTES = TRANSCRIPTION_MAX_UPLOAD_BYTES


@dataclass(frozen=True, slots=True)
class AudioPart:
    index: int
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(temporary, path)


def _inside(base: Path, relative: str) -> Path:
    base = base.resolve()
    target = (base / relative).resolve()
    if target != base and base not in target.parents:
        raise ValueError(f"Caminho fora da sessão: {relative}")
    return target


def build_prompt(manifest: dict, glossary_file: Path | None) -> str:
    names = [
        str(participant.get("display_name", "")).strip()
        for participant in manifest.get("participants", [])
        if str(participant.get("display_name", "")).strip()
    ]
    glossary = ""
    if glossary_file and glossary_file.is_file():
        glossary = " ".join(glossary_file.read_text(encoding="utf-8").split())

    parts = [
        "Conversa informal em português brasileiro gravada no Discord.",
        "Preserve nomes próprios, termos em inglês e pontuação natural.",
    ]
    if names:
        parts.append("Participantes: " + ", ".join(names) + ".")
    if glossary:
        parts.append("Grafias esperadas: " + glossary)

    # A API aceita no máximo 224 tokens. Este corte conservador evita rejeições
    # sem trazer uma dependência de tokenização para o projeto.
    return " ".join(parts)[:800].rstrip()


def plan_audio_parts(
    duration: float,
    spans: list[dict],
    maximum_seconds: float = MAX_PART_SECONDS,
) -> list[AudioPart]:
    if duration <= 0:
        return []
    if maximum_seconds < 10:
        raise ValueError("Cada trecho deve ter pelo menos 10 segundos.")

    ordered = sorted(spans, key=lambda item: float(item.get("audio_start", 0)))
    silence_boundaries: list[float] = []
    for current, following in zip(ordered, ordered[1:]):
        current_end = float(current.get("audio_end", 0))
        following_start = float(following.get("audio_start", current_end))
        if following_start > current_end:
            silence_boundaries.append((current_end + following_start) / 2)

    ranges: list[tuple[float, float]] = []
    start = 0.0
    while duration - start > maximum_seconds:
        target = start + maximum_seconds
        candidates = [
            boundary
            for boundary in silence_boundaries
            if start + 10 <= boundary <= target
        ]
        end = max(candidates) if candidates else target
        ranges.append((start, end))
        start = end
    if duration > start:
        ranges.append((start, duration))

    return [
        AudioPart(index, round(start, 6), round(end, 6))
        for index, (start, end) in enumerate(ranges, 1)
    ]


def convert_part(ffmpeg: str, source: Path, part: AudioPart, destination: Path) -> None:
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{part.start:.6f}",
        "-t",
        f"{part.duration:.6f}",
        "-i",
        str(source),
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-map",
        "0:a:0",
        "-c:a",
        "flac",
        "-compression_level",
        "5",
        str(destination),
    ]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        detail = result.stderr.strip() or "erro desconhecido do FFmpeg"
        raise RuntimeError(f"FFmpeg não conseguiu preparar {source.name}: {detail}")
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError(f"FFmpeg não produziu áudio para {source.name}.")
    if destination.stat().st_size > MAX_UPLOAD_BYTES:
        raise RuntimeError(
            f"O trecho {destination.name} ficou com mais de 24 MB. "
            "Reduza --chunk-seconds e tente novamente."
        )


def _response_dict(response: Any) -> dict[str, Any]:
    if isinstance(response, dict):
        return response
    if hasattr(response, "to_dict"):
        return response.to_dict()
    if hasattr(response, "model_dump"):
        return response.model_dump()
    raise TypeError("A Groq devolveu uma resposta em formato desconhecido.")


def transcribe_part(
    client: Any,
    audio_path: Path,
    *,
    model: str,
    language: str,
    prompt: str,
) -> dict[str, Any]:
    response = client.audio.transcriptions.create(
        file=audio_path,
        model=model,
        language=language,
        prompt=prompt,
        response_format="verbose_json",
        timestamp_granularities=["word", "segment"],
        temperature=0.0,
    )
    return _response_dict(response)


def _cache_matches(cache: dict, expected: dict) -> bool:
    metadata = cache.get("_cache", {})
    return all(metadata.get(key) == value for key, value in expected.items())


def _offset_item(item: Any, offset: float, duration: float) -> dict | None:
    value = item if isinstance(item, dict) else _response_dict(item)
    if value.get("start") is None or value.get("end") is None:
        return None
    result = dict(value)
    result["start"] = round(min(duration, offset + float(value["start"])), 6)
    result["end"] = round(
        max(result["start"], min(duration, offset + float(value["end"]))), 6
    )
    return result


def combine_parts(
    source: Path,
    duration: float,
    parts: list[tuple[AudioPart, dict]],
    *,
    model: str,
    language: str,
) -> dict[str, Any]:
    words: list[dict] = []
    segments: list[dict] = []
    texts: list[str] = []
    for part, response in parts:
        text = str(response.get("text", "")).strip()
        if text:
            texts.append(text)
        for word in response.get("words") or response.get("word_segments") or []:
            adjusted = _offset_item(word, part.start, duration)
            if adjusted is not None:
                words.append(adjusted)
        for segment in response.get("segments") or []:
            adjusted = _offset_item(segment, part.start, duration)
            if adjusted is not None:
                segments.append(adjusted)

    words.sort(key=lambda item: (item["start"], item["end"]))
    segments.sort(key=lambda item: (item["start"], item["end"]))
    return {
        "provider": "groq",
        "model": model,
        "language": language,
        "source_file": source.name,
        "duration": duration,
        "text": " ".join(texts),
        "words": words,
        "word_segments": words,
        "segments": segments,
        "api_parts": [
            {"index": part.index, "start": part.start, "end": part.end}
            for part, _ in parts
        ],
    }


def transcribe_track(
    client: Any,
    ffmpeg: str,
    source: Path,
    output_path: Path,
    spans: list[dict],
    duration: float,
    *,
    model: str,
    language: str,
    prompt: str,
    chunk_seconds: float,
    force: bool,
) -> str:
    source_stat = source.stat()
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    if output_path.is_file() and not force:
        try:
            existing = json.loads(output_path.read_text(encoding="utf-8"))
            if (
                existing.get("provider") == "groq"
                and existing.get("model") == model
                and existing.get("language") == language
                and existing.get("source_size") == source_stat.st_size
                and existing.get("source_mtime_ns") == source_stat.st_mtime_ns
                and existing.get("prompt_sha256") == prompt_hash
            ):
                return "cached"
        except (OSError, ValueError, TypeError):
            pass

    planned = plan_audio_parts(duration, spans, chunk_seconds)
    if not planned:
        raise RuntimeError(f"A trilha {source.name} está vazia.")

    parts_dir = output_path.parent / "partes"
    parts_dir.mkdir(parents=True, exist_ok=True)
    completed: list[tuple[AudioPart, dict]] = []

    with tempfile.TemporaryDirectory(prefix="groq-", dir=output_path.parent) as temp:
        temp_dir = Path(temp)
        for part in planned:
            cache_path = parts_dir / f"parte{part.index:03d}.json"
            expected = {
                "source_size": source_stat.st_size,
                "source_mtime_ns": source_stat.st_mtime_ns,
                "model": model,
                "language": language,
                "prompt_sha256": prompt_hash,
                "start": part.start,
                "end": part.end,
            }
            cached: dict | None = None
            if cache_path.is_file() and not force:
                try:
                    candidate = json.loads(cache_path.read_text(encoding="utf-8"))
                    if _cache_matches(candidate, expected):
                        cached = candidate
                except (OSError, ValueError, TypeError):
                    pass

            if cached is None:
                prepared = temp_dir / f"parte{part.index:03d}.flac"
                print(
                    f"    trecho {part.index}/{len(planned)} "
                    f"({part.start:.1f}s–{part.end:.1f}s): preparando...",
                    flush=True,
                )
                convert_part(ffmpeg, source, part, prepared)
                size_mb = prepared.stat().st_size / (1024 * 1024)
                print(f"    enviando {size_mb:.1f} MB para a Groq...", flush=True)
                response = transcribe_part(
                    client,
                    prepared,
                    model=model,
                    language=language,
                    prompt=prompt,
                )
                cached = dict(response)
                cached["_cache"] = expected
                _atomic_json(cache_path, cached)
            else:
                print(
                    f"    trecho {part.index}/{len(planned)}: usando cache.",
                    flush=True,
                )
            completed.append((part, cached))

    combined = combine_parts(
        source, duration, completed, model=model, language=language
    )
    combined.update(
        {
            "source_size": source_stat.st_size,
            "source_mtime_ns": source_stat.st_mtime_ns,
            "prompt_sha256": prompt_hash,
        }
    )
    _atomic_json(output_path, combined)
    return "transcribed"


def configure_parser(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("session", type=Path, help="pasta da sessão gravada")
    parser.add_argument(
        "--model",
        "--modelo",
        dest="model",
        choices=("whisper-large-v3", "whisper-large-v3-turbo"),
        default=DEFAULT_MODEL,
        help="modelo de transcrição da Groq",
    )
    parser.add_argument(
        "--language",
        "--idioma",
        dest="language",
        default=TRANSCRIPTION_LANGUAGE,
        help="idioma ISO-639-1 do áudio (padrão: pt)",
    )
    parser.add_argument(
        "--glossary",
        "--glossario",
        dest="glossary",
        type=Path,
        default=DEFAULT_GLOSSARY,
        help="arquivo com nomes e grafias esperadas",
    )
    parser.add_argument(
        "--chunk-seconds",
        type=float,
        default=MAX_PART_SECONDS,
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--minutos-por-trecho",
        type=float,
        help="duração máxima de cada envio (1 a 8 minutos)",
    )
    parser.add_argument("--force", "--forcar", dest="force", action="store_true")


def run(args: argparse.Namespace) -> int:
    if args.minutos_por_trecho is not None:
        if not 1 <= args.minutos_por_trecho <= 8:
            print("ERRO: --minutos-por-trecho deve estar entre 1 e 8.", file=sys.stderr)
            return 2
        args.chunk_seconds = args.minutos_por_trecho * 60
    session_dir = resolve_session(args.session)
    if not session_dir.is_dir():
        print(f"ERRO: pasta de sessão não encontrada: {session_dir}", file=sys.stderr)
        return 2
    manifest_path = session_dir / "session.json"
    if not manifest_path.is_file():
        print(f"ERRO: manifesto não encontrado: {manifest_path}", file=sys.stderr)
        return 2

    load_environment()
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        print(
            f"ERRO: defina GROQ_API_KEY no arquivo {ENV_FILE}.", file=sys.stderr
        )
        return 2
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print(
            "ERRO: FFmpeg não foi encontrado no PATH. Instale-o e abra um novo terminal.",
            file=sys.stderr,
        )
        return 2

    try:
        from groq import Groq
    except ImportError:
        print(
            "ERRO: pacote 'groq' ausente. Ative discordbot/.venv e execute "
            "python -m pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 2

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") not in {"complete", "recovered"}:
        print(
            f"ERRO: sessão ainda não está pronta (status: {manifest.get('status')}).",
            file=sys.stderr,
        )
        return 2
    try:
        identity_resolver = DiscordMemoryIdentityResolver.from_files()
    except ValueError as error:
        print(f"ERRO: {error}", file=sys.stderr)
        return 2
    for warning in identity_resolver.warnings:
        print(f"AVISO: {warning}", file=sys.stderr)
    prompt = build_prompt(manifest, args.glossary.resolve())
    transcripts_dir = session_dir / "transcricoes"
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    tracks = [
        (participant, chunk)
        for participant in manifest.get("participants", [])
        for chunk in participant.get("chunks", [])
    ]
    if not tracks:
        print("ERRO: a sessão não contém trilhas de áudio.", file=sys.stderr)
        return 2

    client = Groq(api_key=api_key, timeout=300.0, max_retries=5)
    print(f"Groq · {args.model} · idioma {args.language}")
    print(f"Sessão: {session_dir}")
    print(f"Trilhas: {len(tracks)} · trechos de até {args.chunk_seconds / 60:.1f} min")
    print(f"Contexto: {prompt}\n")

    try:
        for position, (participant, chunk) in enumerate(tracks, 1):
            speaker = identity_resolver.resolve(
                int(participant["user_id"]), str(participant["display_name"])
            )
            source = _inside(session_dir, str(chunk["file"]))
            if not source.is_file():
                raise FileNotFoundError(f"Trilha não encontrada: {source}")
            stem = source.stem
            output = transcripts_dir / stem / f"{stem}.json"
            print(
                f"[{position}/{len(tracks)}] {speaker.display_name} · {source.name}",
                flush=True,
            )
            result = transcribe_track(
                client,
                ffmpeg,
                source,
                output,
                chunk.get("spans", []),
                float(chunk.get("audio_duration", 0)),
                model=args.model,
                language=args.language,
                prompt=prompt,
                chunk_seconds=args.chunk_seconds,
                force=args.force,
            )
            if result == "cached":
                print("    transcrição completa já existente; reutilizando.")

        from .timeline import merge_session

        print("\nMesclando falas na linha do tempo global...", flush=True)
        text_path, json_path = merge_session(
            session_dir,
            transcripts_dir,
            identity_resolver=identity_resolver,
        )
        print(f"Conversa em texto: {text_path}")
        print(f"Conversa estruturada: {json_path}")
        conversation = json.loads(json_path.read_text(encoding="utf-8"))
        quality = conversation.get("transcription_quality", {})
        print(
            "Qualidade: "
            f"{quality.get('rejected_count', 0)} trecho(s) removido(s), "
            f"{quality.get('warning_count', 0)} aviso(s) para revisão, "
            f"{quality.get('correction_count', 0)} correção(ões) de grafia."
        )
        print(f"Relatório de qualidade: {session_dir / 'transcricao-qualidade.json'}")
        return 0
    except Exception as error:
        try:
            from groq import AuthenticationError, PermissionDeniedError, RateLimitError

            if isinstance(error, AuthenticationError):
                message = "a GROQ_API_KEY foi recusada. Confira a chave no .env."
            elif isinstance(error, PermissionDeniedError):
                message = "a conta Groq não tem acesso ao modelo solicitado."
            elif isinstance(error, RateLimitError):
                message = (
                    "o limite gratuito da Groq foi atingido. Aguarde a janela indicada "
                    "pela API e execute novamente; os trechos concluídos serão reutilizados."
                )
            else:
                message = str(error)
        except ImportError:
            message = str(error)
        print(f"\nERRO: {message}", file=sys.stderr)
        return 1


def resolve_session(value: Path) -> Path:
    from ..config import RECORDINGS_DIR

    candidates = [value]
    if not value.is_absolute():
        candidates.extend((Path.cwd() / value, RECORDINGS_DIR / value.name))
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_dir():
            return resolved
    return value.resolve()


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcreve uma sessão do bot pela Groq e alinha os participantes."
    )
    configure_parser(parser)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    return run(parse_arguments(argv))


if __name__ == "__main__":
    raise SystemExit(main())
