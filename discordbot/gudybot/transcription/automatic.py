from __future__ import annotations

import asyncio
import logging
import os
import sys
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from ..analysis.runner import analysis_command
from ..config import PROJECT_DIR, REPO_ROOT, automatic_call_analysis_enabled


logger = logging.getLogger("discordbot.transcription.automatic")


@dataclass(frozen=True, slots=True)
class TranscriptionJob:
    session_dir: Path
    requester_user_id: int
    text_channel_id: int


Transcriber = Callable[[TranscriptionJob], Awaitable[None]]
Analyzer = Callable[[TranscriptionJob], Awaitable[None]]
Notifier = Callable[[TranscriptionJob, str], Awaitable[None]]


class AutomaticTranscriptionQueue:
    """Executa transcrições sequencialmente sem bloquear o bot."""

    def __init__(
        self,
        notifier: Notifier,
        transcriber: Transcriber | None = None,
        analyzer: Analyzer | None = None,
    ) -> None:
        self._notifier = notifier
        self._transcriber = transcriber or self._run_subprocess
        self._analyzer = analyzer or self._run_analysis_subprocess
        self._pending: deque[TranscriptionJob] = deque()
        self._active: TranscriptionJob | None = None
        self._runner: asyncio.Task[None] | None = None

    async def enqueue(self, job: TranscriptionJob) -> int:
        position = len(self._pending) + (1 if self._active else 0) + 1
        self._pending.append(job)
        logger.info(
            "Sessão %s adicionada à fila de transcrição (posição %s).",
            job.session_dir.name,
            position,
        )
        if self._runner is None or self._runner.done():
            self._runner = asyncio.create_task(
                self._drain(), name="automatic-transcription-queue"
            )
        return position

    async def wait_idle(self) -> None:
        """Aguarda a fila atual; usado pelos testes."""

        while self._runner is not None and not self._runner.done():
            runner = self._runner
            await runner
            if runner is self._runner:
                break

    async def _drain(self) -> None:
        while self._pending:
            job = self._pending.popleft()
            self._active = job
            logger.info("Iniciando transcrição automática: %s", job.session_dir.name)
            await self._notify(
                job,
                f"📝 Iniciando a transcrição automática da sessão "
                f"`{job.session_dir.name}`.",
            )
            try:
                await self._transcriber(job)
            except Exception:
                logger.exception(
                    "Transcrição automática falhou para %s.", job.session_dir.name
                )
                await self._notify(
                    job,
                    f"❌ A transcrição da sessão `{job.session_dir.name}` falhou. "
                    "A gravação foi preservada; consulte o terminal do bot e "
                    "tente novamente pelo comando manual.",
                )
            else:
                logger.info(
                    "Transcrição automática concluída: %s", job.session_dir.name
                )
                await self._notify(
                    job,
                    f"✅ Transcrição concluída para `{job.session_dir.name}`. "
                    "Foram gerados `conversa.txt`, `conversa.json` e o relatório "
                    "`transcricao-qualidade.json`.",
                )
                if automatic_call_analysis_enabled():
                    await self._analyze(job)
            finally:
                self._active = None

    async def _notify(self, job: TranscriptionJob, message: str) -> None:
        try:
            await self._notifier(job, message)
        except Exception:
            logger.exception(
                "Falha ao enviar atualização por DM para a sessão %s.",
                job.session_dir.name,
            )

    async def _analyze(self, job: TranscriptionJob) -> None:
        logger.info("Iniciando análise automática: %s", job.session_dir.name)
        await self._notify(
            job,
            f"🧠 Iniciando a análise automática da sessão `{job.session_dir.name}`.",
        )
        try:
            await self._analyzer(job)
        except Exception:
            logger.exception("Análise automática falhou para %s.", job.session_dir.name)
            await self._notify(
                job,
                f"❌ A análise da sessão `{job.session_dir.name}` falhou. "
                "A transcrição foi preservada; consulte o terminal e tente "
                "novamente pelo comando manual.",
            )
            return
        logger.info("Análise automática concluída: %s", job.session_dir.name)
        await self._notify(
            job,
            f"✅ Análise concluída para `{job.session_dir.name}`. Foram gerados "
            "`analise-call.json` e `analise-call.md`. A memória não foi alterada; "
            "as observações ainda precisam passar pelo curador e pela revisão humana.",
        )

    @staticmethod
    async def _run_subprocess(job: TranscriptionJob) -> None:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "gudybot",
            "transcrever",
            str(job.session_dir),
            cwd=PROJECT_DIR,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        if process.stdout is None:
            raise RuntimeError("Não foi possível capturar a saída da transcrição.")

        tail: deque[str] = deque(maxlen=8)
        async for raw_line in process.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            tail.append(line)
            logger.info("[%s] %s", job.session_dir.name, line)

        return_code = await process.wait()
        if return_code != 0:
            details = " | ".join(tail) or f"código {return_code}"
            raise RuntimeError(
                f"Processo terminou com código {return_code}: {details}"
            )

        for filename in (
            "conversa.txt",
            "conversa.json",
            "transcricao-qualidade.json",
        ):
            if not (job.session_dir / filename).is_file():
                raise RuntimeError(f"A transcrição não gerou {filename}.")

    @staticmethod
    async def _run_analysis_subprocess(job: TranscriptionJob) -> None:
        process = await asyncio.create_subprocess_exec(
            *analysis_command(job.session_dir),
            cwd=REPO_ROOT,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        if process.stdout is None:
            raise RuntimeError("Não foi possível capturar a saída da análise.")

        tail: deque[str] = deque(maxlen=8)
        async for raw_line in process.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            tail.append(line)
            logger.info("[análise:%s] %s", job.session_dir.name, line)

        return_code = await process.wait()
        if return_code != 0:
            details = " | ".join(tail) or f"código {return_code}"
            raise RuntimeError(
                f"Processo de análise terminou com código {return_code}: {details}"
            )
        for filename in ("analise-call.json", "analise-call.md"):
            if not (job.session_dir / filename).is_file():
                raise RuntimeError(f"A análise não gerou {filename}.")
