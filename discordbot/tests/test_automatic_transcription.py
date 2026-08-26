from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

from gudybot.config import (  # noqa: E402
    automatic_call_analysis_enabled,
    automatic_transcription_enabled,
)
from gudybot.transcription.automatic import (  # noqa: E402
    AutomaticTranscriptionQueue,
    TranscriptionJob,
)


def job(name: str, user_id: int = 1) -> TranscriptionJob:
    return TranscriptionJob(Path(name), user_id, 10)


class AutomaticTranscriptionTests(unittest.IsolatedAsyncioTestCase):
    async def test_queue_processes_only_one_session_at_a_time(self) -> None:
        active = 0
        maximum_active = 0
        processed: list[str] = []
        notifications: list[str] = []

        async def transcribe(item: TranscriptionJob) -> None:
            nonlocal active, maximum_active
            active += 1
            maximum_active = max(maximum_active, active)
            await asyncio.sleep(0.01)
            processed.append(item.session_dir.name)
            active -= 1

        async def notify(_item: TranscriptionJob, message: str) -> None:
            notifications.append(message)

        queue = AutomaticTranscriptionQueue(notify, transcribe)
        first_position = await queue.enqueue(job("sessao-1"))
        second_position = await queue.enqueue(job("sessao-2"))
        await queue.wait_idle()

        self.assertEqual(first_position, 1)
        self.assertEqual(second_position, 2)
        self.assertEqual(maximum_active, 1)
        self.assertEqual(processed, ["sessao-1", "sessao-2"])
        self.assertEqual(sum("Iniciando" in value for value in notifications), 2)
        self.assertEqual(sum("concluída" in value for value in notifications), 2)

    async def test_failure_does_not_block_next_session(self) -> None:
        attempted: list[str] = []
        notifications: list[str] = []

        async def transcribe(item: TranscriptionJob) -> None:
            attempted.append(item.session_dir.name)
            if item.session_dir.name == "falha":
                raise RuntimeError("erro esperado")

        async def notify(_item: TranscriptionJob, message: str) -> None:
            notifications.append(message)

        queue = AutomaticTranscriptionQueue(notify, transcribe)
        await queue.enqueue(job("falha"))
        await queue.enqueue(job("sucesso"))
        await queue.wait_idle()

        self.assertEqual(attempted, ["falha", "sucesso"])
        self.assertTrue(any("falhou" in value for value in notifications))
        self.assertTrue(any("concluída" in value for value in notifications))

    def test_feature_can_be_disabled_by_environment(self) -> None:
        with patch.dict("os.environ", {"DISCORDBOT_AUTO_TRANSCRIBE": "false"}):
            self.assertFalse(automatic_transcription_enabled())
        with patch.dict("os.environ", {"DISCORDBOT_AUTO_TRANSCRIBE": "true"}):
            self.assertTrue(automatic_transcription_enabled())

    def test_analysis_requires_both_automatic_flags(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "DISCORDBOT_AUTO_TRANSCRIBE": "true",
                "DISCORDBOT_AUTO_ANALYZE": "true",
            },
        ):
            self.assertTrue(automatic_call_analysis_enabled())
        with patch.dict(
            "os.environ",
            {
                "DISCORDBOT_AUTO_TRANSCRIBE": "false",
                "DISCORDBOT_AUTO_ANALYZE": "true",
            },
        ):
            self.assertFalse(automatic_call_analysis_enabled())

    async def test_analysis_runs_after_successful_transcription(self) -> None:
        order: list[str] = []
        notifications: list[str] = []

        async def transcribe(_item: TranscriptionJob) -> None:
            order.append("transcrever")

        async def analyze(_item: TranscriptionJob) -> None:
            order.append("analisar")

        async def notify(_item: TranscriptionJob, message: str) -> None:
            notifications.append(message)

        with patch.dict(
            "os.environ",
            {
                "DISCORDBOT_AUTO_TRANSCRIBE": "true",
                "DISCORDBOT_AUTO_ANALYZE": "true",
            },
        ):
            queue = AutomaticTranscriptionQueue(notify, transcribe, analyze)
            await queue.enqueue(job("sessao-com-analise"))
            await queue.wait_idle()

        self.assertEqual(order, ["transcrever", "analisar"])
        self.assertTrue(any("Iniciando a análise" in value for value in notifications))
        self.assertTrue(any("Análise concluída" in value for value in notifications))

    async def test_failed_transcription_does_not_start_analysis(self) -> None:
        analyzed: list[str] = []

        async def transcribe(_item: TranscriptionJob) -> None:
            raise RuntimeError("falha esperada")

        async def analyze(item: TranscriptionJob) -> None:
            analyzed.append(item.session_dir.name)

        async def notify(_item: TranscriptionJob, _message: str) -> None:
            return None

        with patch.dict(
            "os.environ",
            {
                "DISCORDBOT_AUTO_TRANSCRIBE": "true",
                "DISCORDBOT_AUTO_ANALYZE": "true",
            },
        ):
            queue = AutomaticTranscriptionQueue(notify, transcribe, analyze)
            await queue.enqueue(job("falha-antes-da-analise"))
            await queue.wait_idle()

        self.assertEqual(analyzed, [])


if __name__ == "__main__":
    unittest.main()
