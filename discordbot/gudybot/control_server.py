from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from types import SimpleNamespace

from aiohttp import web
from discord.ext import commands

from .config import (
    DISCORD_IDENTITIES_FILE,
    automatic_call_analysis_enabled,
    automatic_transcription_enabled,
)
from .commands.recording import RecordingController


logger = logging.getLogger("discordbot.control")


class LocalControlServer:
    """API estritamente local usada pela interface web do GudyBrain."""

    def __init__(self, bot: commands.Bot, controller: RecordingController) -> None:
        self.bot = bot
        self.controller = controller
        self.runner: web.AppRunner | None = None

    async def start_if_configured(self) -> None:
        if self.runner is not None:
            return
        token = os.getenv("GUDYBOT_CONTROL_TOKEN", "").strip()
        if not token:
            logger.info("Controle web local desabilitado (bot iniciado fora da interface).")
            return
        port = int(os.getenv("GUDYBOT_CONTROL_PORT", "8765"))
        app = web.Application(middlewares=[self._authorize])
        app["control_token"] = token
        app.router.add_get("/status", self._status)
        app.router.add_post("/actions/{action}", self._action)
        self.runner = web.AppRunner(app, access_log=None)
        await self.runner.setup()
        await web.TCPSite(self.runner, "127.0.0.1", port).start()
        logger.info("Controle web local disponível em 127.0.0.1:%s.", port)

    @web.middleware
    async def _authorize(self, request: web.Request, handler):
        expected = request.app["control_token"]
        if request.headers.get("Authorization") != f"Bearer {expected}":
            raise web.HTTPUnauthorized()
        return await handler(request)

    async def _status(self, _request: web.Request) -> web.Response:
        creator_id = _creator_discord_id(DISCORD_IDENTITIES_FILE)
        creator = self.bot.get_user(creator_id) if creator_id else None
        creator_voice = None
        guilds = []
        for guild in self.bot.guilds:
            member = guild.get_member(creator_id) if creator_id else None
            channel = getattr(getattr(member, "voice", None), "channel", None)
            if channel is not None:
                creator_voice = {
                    "guild_id": str(guild.id),
                    "guild": guild.name,
                    "channel_id": str(channel.id),
                    "channel": channel.name,
                }
            guilds.append({"id": str(guild.id), "name": guild.name})
        voice = self.controller.connected_voice_client()
        session = next(iter(self.controller.sessions.values()), None)
        return web.json_response(
            {
                "connected": self.bot.is_ready(),
                "bot_user": str(self.bot.user) if self.bot.user else None,
                "creator": str(creator) if creator else None,
                "creator_voice": creator_voice,
                "guilds": guilds,
                "voice_channel": voice.channel.name if voice else None,
                "recording": session is not None,
                "session_id": session.sink.session_dir.name if session else None,
                "automatic_transcription": automatic_transcription_enabled(),
                "automatic_analysis": automatic_call_analysis_enabled(),
            }
        )

    async def _action(self, request: web.Request) -> web.Response:
        action = request.match_info["action"]
        handlers = {
            "entrar": self.controller.enter,
            "gravar": self.controller.record,
            "parar": self.controller.stop,
            "sair": self.controller.leave,
        }
        handler = handlers.get(action)
        if handler is None:
            raise web.HTTPNotFound(text="Ação desconhecida")
        ctx = self._creator_context(require_voice=action == "entrar")
        if ctx is None:
            return web.json_response(
                {"ok": False, "message": "Você precisa estar em um canal de voz."},
                status=409,
            )
        await handler(ctx)
        return web.json_response({"ok": True})

    def _creator_context(self, *, require_voice: bool):
        creator_id = _creator_discord_id(DISCORD_IDENTITIES_FILE)
        if creator_id is None:
            return None
        for guild in self.bot.guilds:
            member = guild.get_member(creator_id)
            if member is None:
                continue
            member_channel = getattr(getattr(member, "voice", None), "channel", None)
            if require_voice and member_channel is None:
                continue
            if member_channel is None and guild.voice_client is None:
                continue

            async def _fallback_send(_message: str) -> None:
                return None

            text_channel = next(
                (
                    channel
                    for channel in guild.text_channels
                    if channel.permissions_for(guild.me).send_messages
                ),
                None,
            )
            return SimpleNamespace(
                guild=guild,
                author=member,
                channel=text_channel or SimpleNamespace(id=0),
                send=_fallback_send,
            )
        return None


def _creator_discord_id(path: Path) -> int | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        creator = data.get("creator_person_id")
        mapping = data.get("person_id_by_discord_id", {})
        return next((int(discord_id) for discord_id, person_id in mapping.items() if person_id == creator), None)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
