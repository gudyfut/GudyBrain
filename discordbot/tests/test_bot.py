from __future__ import annotations

import asyncio
import inspect
import struct
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

from gudybot import discord_bot as bot_module  # noqa: E402
from gudybot.messaging import send_private  # noqa: E402


class DaveRegressionTests(unittest.IsolatedAsyncioTestCase):
    def test_gateway_intents_include_existing_voice_members(self) -> None:
        self.assertTrue(bot_module.intents.members)
        self.assertTrue(bot_module.intents.message_content)
        self.assertTrue(bot_module.intents.voice_states)

    async def test_command_response_is_sent_by_dm(self) -> None:
        author = SimpleNamespace(id=42, send=AsyncMock())
        context = SimpleNamespace(
            author=author,
            guild=SimpleNamespace(id=1),
            send=AsyncMock(),
        )

        delivered = await send_private(context, "mensagem privada")

        self.assertTrue(delivered)
        author.send.assert_awaited_once_with("mensagem privada")
        context.send.assert_not_awaited()

    def test_installed_pycord_contains_dave_receive_fix(self) -> None:
        from discord.opus import PacketDecoder
        from discord.voice.receive.reader import PacketDecryptor

        decrypt_source = inspect.getsource(PacketDecryptor.decrypt_rtp)
        decode_source = inspect.getsource(PacketDecoder._decode_packet)

        self.assertTrue(bot_module.has_dave_receive_patch())
        self.assertIn("raw_payload = dave.decrypt", decrypt_source)
        self.assertNotIn("dave.decrypt", decode_source)

    def test_packets_are_timestamped_before_jitter_buffer(self) -> None:
        from discord.voice.receive import reader

        raw_packet = struct.pack(">BBHII", 0x80, 120, 1, 2, 3) + b"x"
        packet = reader.decode(raw_packet)
        self.assertIsInstance(packet.received_monotonic, float)

    async def test_finished_callback_forwards_reader_error(self) -> None:
        guild_id = 123
        expected_error = RuntimeError("falha de teste")
        session = SimpleNamespace(
            event_loop=asyncio.get_running_loop(),
            voice_client=SimpleNamespace(
                _reader=SimpleNamespace(error=expected_error)
            ),
        )
        controller = bot_module.recording_controller
        controller.sessions[guild_id] = session

        try:
            with patch.object(
                controller, "finalize_recording", new=AsyncMock()
            ) as finalize:
                sink = SimpleNamespace(close_capture=lambda: None)
                callback = controller.recording_finished_callback(guild_id)
                callback(sink, guild_id)
                await asyncio.sleep(0)
                await asyncio.sleep(0)
                finalize.assert_awaited_once_with(guild_id, expected_error)
        finally:
            controller.sessions.pop(guild_id, None)


if __name__ == "__main__":
    unittest.main()
