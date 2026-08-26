from __future__ import annotations

import shutil
import subprocess
from argparse import ArgumentParser, Namespace
from pathlib import Path

from ..config import REPO_ROOT


TSX_CLI = REPO_ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"
ANALYZER_ENTRYPOINT = REPO_ROOT / "src" / "cli" / "analyze-call.ts"


def node_executable() -> str | None:
    return shutil.which("node")


def runtime_problems() -> list[str]:
    problems: list[str] = []
    if node_executable() is None:
        problems.append("Node.js não foi encontrado no PATH.")
    if not TSX_CLI.is_file():
        problems.append(
            f"Dependências TypeScript ausentes ({TSX_CLI}). Execute `npm install` na raiz."
        )
    if not ANALYZER_ENTRYPOINT.is_file():
        problems.append(f"Entrypoint do analista não encontrado: {ANALYZER_ENTRYPOINT}")
    return problems


def analysis_command(session_dir: Path, *, force: bool = False) -> list[str]:
    node = node_executable()
    if node is None:
        raise RuntimeError("Node.js não foi encontrado no PATH.")
    if not TSX_CLI.is_file():
        raise RuntimeError("Execute `npm install` na raiz antes de analisar calls.")
    command = [node, str(TSX_CLI), str(ANALYZER_ENTRYPOINT), str(session_dir)]
    if force:
        command.append("--forcar")
    return command


def configure_parser(parser: ArgumentParser) -> None:
    parser.add_argument(
        "session",
        type=Path,
        help="pasta da sessão; precisa conter conversa.txt",
    )
    parser.add_argument("--force", "--forcar", dest="force", action="store_true")


def run(args: Namespace) -> int:
    from ..transcription.groq import resolve_session

    session_dir = resolve_session(args.session)
    conversation = session_dir / "conversa.txt"
    if not session_dir.is_dir():
        print(f"ERRO: pasta de sessão não encontrada: {session_dir}")
        return 2
    if not conversation.is_file():
        print(
            f"ERRO: conversa.txt não encontrado: {conversation}. "
            "Transcreva a sessão antes de analisá-la."
        )
        return 2
    problems = runtime_problems()
    if problems:
        for problem in problems:
            print(f"ERRO: {problem}")
        return 2
    result = subprocess.run(
        analysis_command(session_dir, force=args.force),
        cwd=REPO_ROOT,
        check=False,
    )
    return result.returncode
