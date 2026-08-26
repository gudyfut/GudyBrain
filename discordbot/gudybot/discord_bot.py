from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

import discord
import nacl
from discord.ext import commands
from discord.voice import VoiceClient

from .audio.capture import install_packet_arrival_timestamps
from .audio.recovery import migrate_legacy_session_names, recover_incomplete_sessions
from .commands.recording import register
from .analysis.runner import runtime_problems as analysis_runtime_problems
from .config import (
    COMMAND_PREFIX,
    ENV_FILE,
    PYCORD_DAVE_REVISION,
    RECORDINGS_DIR,
    TRANSCRIPTION_CORRECTIONS_FILE,
    automatic_transcription_enabled,
    automatic_call_analysis_enabled,
    automatic_call_analysis_requested,
    ensure_runtime_directories,
    ffmpeg_help,
    ffmpeg_path,
    load_environment,
)
from .messaging import send_private
from .transcription.corrections import load_transcription_corrections
from .transcription.identity import DiscordMemoryIdentityResolver
from .control_server import LocalControlServer


ensure_runtime_directories()
load_environment()
install_packet_arrival_timestamps()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("discordbot")

intents = discord.Intents.default()
intents.members = True
intents.message_content = True
intents.voice_states = True
bot = commands.Bot(command_prefix=COMMAND_PREFIX, intents=intents, help_command=None)
recording_controller = register(bot)
control_server = LocalControlServer(bot, recording_controller)
recovery_checked = False


def has_dave_receive_patch() -> bool:
    return PYCORD_DAVE_REVISION in discord.__version__


@bot.event
async def on_ready() -> None:
    global recovery_checked
    logger.info(
        "Bot conectado como %s (ID: %s). Comandos: %sentrar, %sgravar, %sparar, %ssair",
        bot.user,
        bot.user.id if bot.user else "desconhecido",
        COMMAND_PREFIX,
        COMMAND_PREFIX,
        COMMAND_PREFIX,
        COMMAND_PREFIX,
    )
    await control_server.start_if_configured()
    if ffmpeg_path():
        logger.info("FFmpeg encontrado em: %s", ffmpeg_path())
    else:
        logger.warning("FFmpeg não foi encontrado no PATH. %s", ffmpeg_help())
    if not recovery_checked:
        recovery_checked = True
        migrated = await asyncio.to_thread(
            migrate_legacy_session_names, RECORDINGS_DIR
        )
        for old_dir, new_dir in migrated:
            logger.info("Sessão antiga renomeada: %s -> %s", old_dir.name, new_dir.name)
        recovered = await asyncio.to_thread(
            recover_incomplete_sessions, RECORDINGS_DIR
        )
        for session_dir in recovered:
            logger.warning("Gravação interrompida recuperada em: %s", session_dir)


@bot.event
async def on_command_error(ctx: commands.Context, error: commands.CommandError) -> None:
    if isinstance(error, commands.CommandNotFound):
        return
    logger.error(
        "Erro no comando %s: %s",
        getattr(ctx.command, "qualified_name", "desconhecido"),
        error,
        exc_info=(type(error), error, error.__traceback__),
    )
    await send_private(
        ctx, "❌ O comando falhou. Consulte o terminal do bot para mais detalhes."
    )


def validate_installation() -> list[str]:
    problems: list[str] = []
    if sys.version_info < (3, 11):
        problems.append("É necessário Python 3.11 ou superior.")
    if not ENV_FILE.is_file():
        problems.append(f"Arquivo de ambiente não encontrado: {ENV_FILE}")
    if not os.getenv("DISCORDBOT_API_KEY"):
        problems.append(f"DISCORDBOT_API_KEY não foi definida em {ENV_FILE}.")
    if automatic_transcription_enabled() and not os.getenv("GROQ_API_KEY"):
        problems.append(
            "GROQ_API_KEY é obrigatória enquanto a transcrição automática "
            "estiver habilitada."
        )
    if automatic_call_analysis_enabled() and not os.getenv("GLM_API_KEY"):
        problems.append(
            "GLM_API_KEY é obrigatória enquanto a análise automática estiver habilitada."
        )
    if automatic_call_analysis_enabled():
        problems.extend(analysis_runtime_problems())
    if ffmpeg_path() is None:
        problems.append(f"FFmpeg não foi encontrado no PATH. {ffmpeg_help()}")
    if not hasattr(discord, "sinks") or not hasattr(discord.sinks, "Sink"):
        problems.append("A instalação atual não contém discord.sinks.Sink (Pycord 2.8).")
    if not hasattr(VoiceClient, "start_recording"):
        problems.append("A instalação atual não oferece VoiceClient.start_recording().")
    if not has_dave_receive_patch():
        problems.append(
            "A instalação do Pycord não contém a correção de recepção DAVE "
            f"({PYCORD_DAVE_REVISION}). Reinstale requirements.txt."
        )
    try:
        DiscordMemoryIdentityResolver.from_files()
    except ValueError as error:
        problems.append(str(error))
    try:
        load_transcription_corrections(TRANSCRIPTION_CORRECTIONS_FILE)
    except ValueError as error:
        problems.append(str(error))
    return problems


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bot gravador de chamadas do Discord.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="valida dependências e configuração sem conectar ao Discord",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_arguments(argv)
    problems = validate_installation()
    if args.check:
        print(f"Python: {sys.version.split()[0]}")
        print(f"Pycord: {discord.__version__}")
        print(
            "Recepção DAVE: "
            + ("correção instalada" if has_dave_receive_patch() else "correção ausente")
        )
        print(f"PyNaCl: {nacl.__version__}")
        print(f"FFmpeg: {ffmpeg_path() or 'não encontrado'}")
        print(f".env: {ENV_FILE}")
        print(f"Gravações: {RECORDINGS_DIR}")
        print(
            "Transcrição automática: "
            + ("habilitada" if automatic_transcription_enabled() else "desabilitada")
        )
        if automatic_call_analysis_enabled():
            analysis_status = "habilitada"
        elif automatic_call_analysis_requested():
            analysis_status = "inativa porque a transcrição automática está desabilitada"
        else:
            analysis_status = "desabilitada"
        print(f"Análise automática: {analysis_status}")
        try:
            identities = DiscordMemoryIdentityResolver.from_files()
            print(
                "Identidades Discord: "
                f"{identities.resolved_count}/{identities.mapped_count} resolvida(s)"
            )
            for warning in identities.warnings:
                print(f"Aviso de identidade: {warning}")
        except ValueError as error:
            print(f"Identidades Discord: inválidas ({error})")
        try:
            corrections = load_transcription_corrections(
                TRANSCRIPTION_CORRECTIONS_FILE
            )
            print(
                "Correções de transcrição: "
                f"{len(corrections)} regra(s) válida(s) em "
                f"{TRANSCRIPTION_CORRECTIONS_FILE}"
            )
        except ValueError as error:
            print(f"Correções de transcrição: inválidas ({error})")
        if problems:
            print("\nConfiguração incompleta:")
            for problem in problems:
                print(f"- {problem}")
            raise SystemExit(1)
        print("\nConfiguração válida. Nenhuma conexão com o Discord foi realizada.")
        return

    if problems:
        for problem in problems:
            logger.error(problem)
        raise SystemExit("Corrija os problemas acima antes de iniciar o bot.")
    bot.run(os.environ["DISCORDBOT_API_KEY"])


if __name__ == "__main__":
    main()
