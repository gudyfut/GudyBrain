from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from dotenv import load_dotenv


PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = PACKAGE_DIR.parent
REPO_ROOT = PROJECT_DIR.parent

ENV_FILE = REPO_ROOT / ".env"
RECORDINGS_DIR = PROJECT_DIR / "gravacoes"
GLOSSARY_FILE = PROJECT_DIR / "config" / "glossario_transcricao.txt"
TRANSCRIPTION_CORRECTIONS_FILE = PROJECT_DIR / "config" / "correcoes_transcricao.json"
HALLUCINATION_PHRASES_FILE = PROJECT_DIR / "config" / "frases_alucinacao_transcricao.txt"
DISCORD_IDENTITIES_FILE = PROJECT_DIR / "config" / "identidades_discord.json"
MEMORY_PEOPLE_DIR = REPO_ROOT / "memory" / "social" / "pessoas"

COMMAND_PREFIX = "!"
PYCORD_DAVE_REVISION = "g326b72acc"

TRANSCRIPTION_MODEL = "whisper-large-v3"
TRANSCRIPTION_LANGUAGE = "pt"
TRANSCRIPTION_CHUNK_SECONDS = 8 * 60
TRANSCRIPTION_MAX_UPLOAD_BYTES = 24 * 1024 * 1024


def automatic_transcription_enabled() -> bool:
    value = os.getenv("DISCORDBOT_AUTO_TRANSCRIBE", "true").strip().lower()
    return value not in {"0", "false", "nao", "não", "off"}


def automatic_call_analysis_requested() -> bool:
    value = os.getenv("DISCORDBOT_AUTO_ANALYZE", "false").strip().lower()
    return value not in {"0", "false", "nao", "não", "off"}


def automatic_call_analysis_enabled() -> bool:
    """A análise automática nunca roda sem a transcrição automática."""

    return automatic_transcription_enabled() and automatic_call_analysis_requested()


def load_environment() -> None:
    load_dotenv(ENV_FILE)


def ensure_runtime_directories() -> None:
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)


def ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


def ffmpeg_help() -> str:
    if os.name == "nt":
        return (
            "Instale com `choco install ffmpeg` em um terminal administrativo "
            "ou baixe o binário e adicione a pasta `bin` ao PATH."
        )
    if sys.platform == "darwin":
        return "Instale com `brew install ffmpeg`."
    return "Em Debian/Ubuntu, instale com `sudo apt update && sudo apt install ffmpeg`."
