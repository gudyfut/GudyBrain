from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Any


NO_SPEECH_THRESHOLD = 0.6
LOW_LOGPROB_THRESHOLD = -1.0
HIGH_COMPRESSION_THRESHOLD = 2.4
SPAN_EPSILON = 0.002


def load_hallucination_phrases(path: Path) -> list[tuple[str, ...]]:
    if not path.is_file():
        return []
    patterns: list[tuple[str, ...]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        tokens = tuple(_tokens(line))
        if len(tokens) >= 2 and tokens not in patterns:
            patterns.append(tokens)
    return sorted(patterns, key=len, reverse=True)


def filter_timed_items(
    items: list[dict[str, Any]],
    *,
    text_key: str,
    spans: list[dict[str, Any]],
    segments: list[dict[str, Any]],
    phrase_patterns: list[tuple[str, ...]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Remove previsões fora da voz e clichês; apenas sinaliza baixa confiança."""

    rejected_indices: dict[int, str] = {}
    rejected: list[dict[str, Any]] = []

    for index, item in enumerate(items):
        midpoint = _midpoint(item)
        if midpoint is not None and spans and not _inside_any_span(midpoint, spans):
            rejected_indices[index] = "fora_de_trecho_de_voz"

    for segment in segments:
        if not _likely_silence(segment):
            continue
        start = _number(segment.get("start"))
        end = _number(segment.get("end"))
        if start is None or end is None:
            continue
        for index, item in enumerate(items):
            midpoint = _midpoint(item)
            if midpoint is not None and start <= midpoint <= end:
                rejected_indices.setdefault(index, "silencio_ou_ruido")

    phrase_matches = _find_phrase_matches(items, text_key, phrase_patterns)
    for match in phrase_matches:
        indices = match["indices"]
        if any(index in rejected_indices for index in indices):
            continue
        for index in indices:
            rejected_indices[index] = "frase_tipica_de_alucinacao"
        rejected.append(
            _decision(
                [items[index] for index in indices],
                text_key,
                "frase_tipica_de_alucinacao",
                pattern=match["pattern"],
            )
        )

    grouped: list[tuple[str, list[int]]] = []
    for index in sorted(rejected_indices):
        reason = rejected_indices[index]
        if grouped and grouped[-1][0] == reason and grouped[-1][1][-1] + 1 == index:
            grouped[-1][1].append(index)
        else:
            grouped.append((reason, [index]))
    for reason, indices in grouped:
        if reason == "frase_tipica_de_alucinacao":
            continue
        rejected.append(_decision([items[index] for index in indices], text_key, reason))

    warnings = _quality_warnings(segments)
    kept = [item for index, item in enumerate(items) if index not in rejected_indices]
    rejected.sort(key=lambda item: (item.get("audio_start") or 0, item["reason"]))
    return kept, rejected, warnings


def _find_phrase_matches(
    items: list[dict[str, Any]],
    text_key: str,
    patterns: list[tuple[str, ...]],
) -> list[dict[str, Any]]:
    flattened: list[tuple[str, int]] = []
    for index, item in enumerate(items):
        flattened.extend((token, index) for token in _tokens(str(item.get(text_key, ""))))

    matches: list[dict[str, Any]] = []
    occupied: set[int] = set()
    for position in range(len(flattened)):
        for pattern in patterns:
            matched = _match_pattern(flattened, position, pattern)
            if not matched:
                continue
            indices = sorted({flattened[token_index][1] for token_index in matched})
            if occupied.intersection(indices):
                continue
            occupied.update(indices)
            matches.append({"indices": indices, "pattern": " ".join(pattern)})
            break
    return matches


def _match_pattern(
    flattened: list[tuple[str, int]],
    start: int,
    pattern: tuple[str, ...],
) -> list[int] | None:
    if start >= len(flattened) or flattened[start][0] != pattern[0]:
        return None
    matched = [start]
    cursor = start + 1
    skips = 0
    for expected in pattern[1:]:
        if cursor < len(flattened) and flattened[cursor][0] == expected:
            matched.append(cursor)
            cursor += 1
            continue
        if (
            skips == 0
            and cursor + 1 < len(flattened)
            and flattened[cursor + 1][0] == expected
        ):
            skips = 1
            matched.extend((cursor, cursor + 1))
            cursor += 2
            continue
        return None
    return matched


def _quality_warnings(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for segment in segments:
        avg_logprob = _number(segment.get("avg_logprob"))
        compression = _number(segment.get("compression_ratio"))
        reasons = []
        if avg_logprob is not None and avg_logprob < LOW_LOGPROB_THRESHOLD:
            reasons.append("baixa_confianca")
        if compression is not None and compression > HIGH_COMPRESSION_THRESHOLD:
            reasons.append("repeticao_suspeita")
        if not reasons:
            continue
        warnings.append(
            {
                "reasons": reasons,
                "audio_start": _number(segment.get("start")),
                "audio_end": _number(segment.get("end")),
                "text": str(segment.get("text", "")).strip(),
                "avg_logprob": avg_logprob,
                "no_speech_prob": _number(segment.get("no_speech_prob")),
                "compression_ratio": compression,
            }
        )
    return warnings


def _likely_silence(segment: dict[str, Any]) -> bool:
    no_speech = _number(segment.get("no_speech_prob"))
    avg_logprob = _number(segment.get("avg_logprob"))
    return (
        no_speech is not None
        and avg_logprob is not None
        and no_speech > NO_SPEECH_THRESHOLD
        and avg_logprob < LOW_LOGPROB_THRESHOLD
    )


def _decision(
    items: list[dict[str, Any]],
    text_key: str,
    reason: str,
    *,
    pattern: str | None = None,
) -> dict[str, Any]:
    starts = [_number(item.get("start")) for item in items]
    ends = [_number(item.get("end")) for item in items]
    decision: dict[str, Any] = {
        "reason": reason,
        "audio_start": min(value for value in starts if value is not None),
        "audio_end": max(value for value in ends if value is not None),
        "text": _join_item_text(items, text_key),
    }
    if pattern:
        decision["matched_pattern"] = pattern
    return decision


def _join_item_text(items: list[dict[str, Any]], text_key: str) -> str:
    return " ".join(str(item.get(text_key, "")).strip() for item in items).strip()


def _midpoint(item: dict[str, Any]) -> float | None:
    start = _number(item.get("start"))
    end = _number(item.get("end"))
    if start is None or end is None:
        return None
    return (start + end) / 2


def _inside_any_span(value: float, spans: list[dict[str, Any]]) -> bool:
    return any(
        float(span.get("audio_start", 0)) - SPAN_EPSILON
        <= value
        <= float(span.get("audio_end", 0)) + SPAN_EPSILON
        for span in spans
    )


def _tokens(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.findall(r"[a-z0-9]+", without_accents)


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
