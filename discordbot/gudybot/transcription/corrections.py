from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class TranscriptionCorrectionRule:
    canonical: str
    variants: tuple[str, ...]


def load_transcription_corrections(
    path: Path | None,
) -> list[TranscriptionCorrectionRule]:
    if path is None or not path.is_file():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Correções de transcrição inválidas em {path}: {error}") from error
    if not isinstance(value, dict) or not isinstance(value.get("rules"), list):
        raise ValueError(f"Correções de transcrição inválidas em {path}: 'rules' deve ser uma lista.")

    rules: list[TranscriptionCorrectionRule] = []
    owners: dict[str, str] = {}
    for index, item in enumerate(value["rules"]):
        if not isinstance(item, dict):
            raise ValueError(f"Correções de transcrição: rules[{index}] deve ser um objeto.")
        canonical = str(item.get("canonical", "")).strip()
        variants_value = item.get("variants")
        if not canonical or not isinstance(variants_value, list):
            raise ValueError(
                f"Correções de transcrição: rules[{index}] precisa de canonical e variants."
            )
        variants = tuple(
            variant
            for variant in (str(value).strip() for value in variants_value)
            if variant and variant.casefold() != canonical.casefold()
        )
        if not variants:
            raise ValueError(f"Correções de transcrição: rules[{index}] não possui variantes.")
        for variant in variants:
            key = _variant_key(variant)
            previous = owners.get(key)
            if previous and previous != canonical:
                raise ValueError(
                    f'Variante "{variant}" aponta para "{previous}" e "{canonical}".'
                )
            owners[key] = canonical
        rules.append(TranscriptionCorrectionRule(canonical, variants))
    return rules


def apply_transcription_corrections(
    text: str,
    rules: list[TranscriptionCorrectionRule],
) -> tuple[str, list[dict[str, Any]]]:
    alternatives: list[tuple[str, str]] = []
    for rule in rules:
        alternatives.extend((variant, rule.canonical) for variant in rule.variants)
    alternatives.sort(key=lambda item: (len(item[0].split()), len(item[0])), reverse=True)
    if not alternatives or not text:
        return text, []

    canonical_by_variant = {
        _variant_key(variant): canonical for variant, canonical in alternatives
    }
    pattern = re.compile(
        r"(?<!\w)(?:"
        + "|".join(_variant_pattern(variant) for variant, _ in alternatives)
        + r")(?!\w)",
        flags=re.IGNORECASE,
    )
    corrections: list[dict[str, Any]] = []

    def replace(match: re.Match[str]) -> str:
        original = match.group(0)
        canonical = canonical_by_variant[_variant_key(original)]
        corrections.append(
            {
                "original": original,
                "canonical": canonical,
                "reason": "normalizacao_configurada",
                "start_char": match.start(),
                "end_char": match.end(),
            }
        )
        return canonical

    return pattern.sub(replace, text), corrections


def _variant_pattern(value: str) -> str:
    return r"\s+".join(re.escape(part) for part in value.split())


def _variant_key(value: str) -> str:
    return " ".join(value.casefold().split())
