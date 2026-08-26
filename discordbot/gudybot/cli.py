from __future__ import annotations

import argparse

from .analysis import runner as analysis_runner
from .transcription import groq


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gudybot",
        description="Grava, transcreve e analisa chamadas do Discord.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    transcribe = commands.add_parser(
        "transcrever",
        help="transcreve uma sessão gravada usando a Groq",
    )
    groq.configure_parser(transcribe)

    analyze = commands.add_parser(
        "analisar",
        help="analisa uma conversa transcrita e gera um relatório estruturado",
    )
    analysis_runner.configure_parser(analyze)

    commands.add_parser("bot", help="inicia o bot do Discord")
    commands.add_parser("verificar", help="valida a instalação sem conectar")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "transcrever":
        return groq.run(args)
    if args.command == "analisar":
        return analysis_runner.run(args)

    from . import discord_bot

    if args.command == "verificar":
        discord_bot.main(["--check"])
    else:
        discord_bot.main([])
    return 0
