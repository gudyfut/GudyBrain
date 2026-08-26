from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from discord.ext import commands
from discord.voice import VoiceClient

from ..audio.capture import TimelineWaveSink
from ..audio.identity import ParticipantIdentity
from ..config import (
    PYCORD_DAVE_REVISION,
    RECORDINGS_DIR,
    automatic_call_analysis_enabled,
    automatic_transcription_enabled,
    ffmpeg_help,
    ffmpeg_path,
)
from ..messaging import send_private, send_to_session_user
from ..transcription.automatic import AutomaticTranscriptionQueue, TranscriptionJob


logger = logging.getLogger("discordbot.commands.recording")


@dataclass(slots=True)
class RecordingSession:
    guild_id: int
    voice_client: VoiceClient
    sink: TimelineWaveSink
    text_channel_id: int
    requester_user_id: int
    event_loop: asyncio.AbstractEventLoop
    discard: bool = False
    finalizing: bool = False


class RecordingController:
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.sessions: dict[int, RecordingSession] = {}
        self.transcriptions = AutomaticTranscriptionQueue(self._notify_transcription)

    async def _notify_transcription(
        self, job: TranscriptionJob, message: str
    ) -> None:
        await send_to_session_user(self.bot, job, message)

    def connected_voice_client(self) -> VoiceClient | None:
        return next(
            (client for client in self.bot.voice_clients if client.is_connected()),
            None,
        )

    def current_session(self, guild_id: int | None) -> RecordingSession | None:
        if guild_id is None:
            return None
        return self.sessions.get(guild_id)

    async def finalize_recording(
        self, guild_id: int, error: Exception | None
    ) -> None:
        session = self.sessions.get(guild_id)
        if session is None or session.finalizing:
            return

        session.finalizing = True
        saved_files: list[Path] = []
        try:
            if error is not None:
                logger.error(
                    "A captura de voz terminou com erro no servidor %s: %s",
                    guild_id,
                    error,
                    exc_info=(type(error), error, error.__traceback__),
                )

            if not session.discard:
                saved_files, manifest_path = await asyncio.to_thread(
                    session.sink.finalize_files
                )
                for destination in saved_files:
                    logger.info("Áudio salvo: %s", destination)
                logger.info("Linha do tempo salva: %s", manifest_path)

                if saved_files:
                    auto_transcribe = automatic_transcription_enabled()
                    transcription_status = (
                        "A transcrição automática será executada em segundo plano. "
                        + (
                            "Depois dela, a análise da call também será executada. "
                            if automatic_call_analysis_enabled()
                            else ""
                        )
                        if auto_transcribe
                        else "A transcrição automática está desabilitada. "
                    )
                    await send_to_session_user(
                        self.bot,
                        session,
                        f"✅ Gravação concluída: **{len(saved_files)} arquivo(s)** "
                        f"salvo(s) na sessão `{session.sink.session_dir.name}`. "
                        f"A linha do tempo foi salva. {transcription_status}"
                        "Vou sair do canal.",
                    )
                    if auto_transcribe:
                        position = await self.transcriptions.enqueue(
                            TranscriptionJob(
                                session_dir=session.sink.session_dir,
                                requester_user_id=session.requester_user_id,
                                text_channel_id=session.text_channel_id,
                            )
                        )
                        if position > 1:
                            await send_to_session_user(
                                self.bot,
                                session,
                                f"⏳ A sessão `{session.sink.session_dir.name}` "
                                f"está na posição **{position}** da fila.",
                            )
                else:
                    await send_to_session_user(
                        self.bot,
                        session,
                        "⚠️ A gravação terminou, mas nenhuma trilha de áudio foi recebida.",
                    )
            else:
                await asyncio.to_thread(session.sink.discard)
                logger.info("Gravação descartada no servidor %s.", guild_id)

        except Exception:
            logger.exception("Falha ao salvar a gravação do servidor %s.", guild_id)
            await send_to_session_user(
                self.bot,
                session,
                "❌ Ocorreu um erro ao salvar os arquivos. Consulte o terminal do bot.",
            )
        finally:
            self.sessions.pop(guild_id, None)
            if session.voice_client.is_connected():
                try:
                    await session.voice_client.disconnect(force=True)
                except Exception:
                    logger.exception("Falha ao desconectar do canal de voz.")

    def recording_finished_callback(self, guild_id: int):
        def callback(_sink: TimelineWaveSink, callback_guild_id: int) -> None:
            session = self.sessions.get(callback_guild_id)
            if session is None:
                return
            try:
                _sink.close_capture()
            except Exception:
                logger.exception("Falha ao fechar os arquivos temporários da gravação.")
            reader = getattr(session.voice_client, "_reader", None)
            error = getattr(reader, "error", None)
            session.event_loop.call_soon_threadsafe(
                lambda: asyncio.create_task(
                    self.finalize_recording(callback_guild_id, error)
                )
            )

        return callback

    async def enter(self, ctx: commands.Context) -> None:
        if ctx.guild is None:
            await send_private(ctx, "❌ Este comando só pode ser usado dentro de um servidor.")
            return

        author_voice = getattr(ctx.author, "voice", None)
        if author_voice is None or author_voice.channel is None:
            await send_private(
                ctx, "❌ Você precisa estar em um canal de voz para usar `!entrar`."
            )
            return

        active_client = self.connected_voice_client()
        if active_client is not None:
            if active_client.channel.id == author_voice.channel.id:
                await send_private(
                    ctx, f"ℹ️ Já estou conectado em **{active_client.channel.name}**."
                )
            else:
                await send_private(
                    ctx,
                    f"❌ Já estou conectado em **{active_client.channel.name}**. "
                    "Use `!sair` antes de me levar para outro canal.",
                )
            return

        try:
            voice_client = await author_voice.channel.connect()
            await send_private(
                ctx, f"✅ Entrei no canal de voz **{voice_client.channel.name}**."
            )
            logger.info(
                "Conectado ao canal %s (%s), servidor %s (%s).",
                voice_client.channel.name,
                voice_client.channel.id,
                ctx.guild.name,
                ctx.guild.id,
            )
        except Exception:
            logger.exception("Falha ao entrar no canal de voz.")
            await send_private(
                ctx,
                "❌ Não consegui entrar no canal de voz. Confira minhas permissões "
                "e o terminal.",
            )

    async def record(self, ctx: commands.Context) -> None:
        if ctx.guild is None:
            await send_private(ctx, "❌ Este comando só pode ser usado dentro de um servidor.")
            return

        voice_client = ctx.guild.voice_client
        if voice_client is None or not voice_client.is_connected():
            await send_private(
                ctx, "❌ Não estou em nenhum canal de voz. Use `!entrar` primeiro."
            )
            return
        if self.current_session(ctx.guild.id) is not None or voice_client.is_recording():
            await send_private(ctx, "ℹ️ Já existe uma gravação em andamento neste servidor.")
            return

        executable = ffmpeg_path()
        if executable is None:
            await send_private(ctx, f"❌ FFmpeg não foi encontrado no PATH. {ffmpeg_help()}")
            logger.error("Gravação recusada porque o FFmpeg não está disponível no PATH.")
            return

        requested_at = datetime.now().astimezone()
        temporary_name = f"gravando_{requested_at.strftime('%Y%m%d-%H%M%S')}"
        sink: TimelineWaveSink | None = None
        try:
            dm_delivered = await send_private(
                ctx,
                f"🔴 **Gravação iniciada em {voice_client.channel.name}.** "
                "O áudio será salvo separadamente por participante. "
                "Use `!parar` para encerrar.",
            )
            if not dm_delivered:
                logger.warning(
                    "Gravação não iniciada porque o usuário %s não recebe DMs.",
                    ctx.author.id,
                )
                return

            capture_started_at = datetime.now().astimezone()
            channel_members = getattr(voice_client.channel, "members", [])
            participant_identities = {
                int(member.id): ParticipantIdentity.from_discord_user(member)
                for member in channel_members
                if not getattr(member, "bot", False)
            }

            def resolve_identity(user_id: int) -> ParticipantIdentity | None:
                member = ctx.guild.get_member(user_id)
                if member is None:
                    return None
                return ParticipantIdentity.from_discord_user(member)

            sink = TimelineWaveSink(
                RECORDINGS_DIR,
                session_id=temporary_name,
                guild_id=ctx.guild.id,
                guild_name=ctx.guild.name,
                voice_channel_id=voice_client.channel.id,
                voice_channel_name=voice_client.channel.name,
                started_at=capture_started_at,
                participant_identities=participant_identities,
                identity_resolver=resolve_identity,
            )
            session = RecordingSession(
                guild_id=ctx.guild.id,
                voice_client=voice_client,
                sink=sink,
                text_channel_id=ctx.channel.id,
                requester_user_id=ctx.author.id,
                event_loop=asyncio.get_running_loop(),
            )
            self.sessions[ctx.guild.id] = session
            voice_client.start_recording(
                sink,
                self.recording_finished_callback(ctx.guild.id),
                ctx.guild.id,
            )
            logger.info(
                "Gravação iniciada no servidor %s, sessão %s; FFmpeg: %s.",
                ctx.guild.id,
                sink.session_dir,
                executable,
            )
            if getattr(voice_client, "is_dave_connection", lambda: False)():
                logger.info(
                    "Recepção DAVE ativa com a correção %s.", PYCORD_DAVE_REVISION
                )
        except Exception:
            self.sessions.pop(ctx.guild.id, None)
            if sink is not None:
                try:
                    await asyncio.to_thread(sink.discard)
                except Exception:
                    logger.exception("Falha ao remover sessão que não iniciou.")
            logger.exception("Falha ao iniciar a gravação.")
            await send_private(
                ctx,
                "❌ Não consegui iniciar a gravação. Verifique PyNaCl, FFmpeg, "
                "permissões e o terminal do bot.",
            )

    async def stop(self, ctx: commands.Context) -> None:
        if ctx.guild is None:
            await send_private(ctx, "❌ Este comando só pode ser usado dentro de um servidor.")
            return
        session = self.current_session(ctx.guild.id)
        if session is None or not session.voice_client.is_recording():
            await send_private(ctx, "❌ Não há uma gravação em andamento neste servidor.")
            return
        try:
            await send_private(ctx, "⏹️ Encerrando a gravação e salvando as trilhas...")
            session.voice_client.stop_recording()
        except Exception:
            logger.exception("Falha ao parar a gravação.")
            await send_private(
                ctx, "❌ Não consegui parar a gravação. Consulte o terminal do bot."
            )

    async def leave(self, ctx: commands.Context) -> None:
        if ctx.guild is None:
            await send_private(ctx, "❌ Este comando só pode ser usado dentro de um servidor.")
            return
        voice_client = ctx.guild.voice_client
        if voice_client is None or not voice_client.is_connected():
            await send_private(ctx, "ℹ️ Não estou conectado a nenhum canal de voz.")
            return

        session = self.current_session(ctx.guild.id)
        try:
            if session is not None and voice_client.is_recording():
                session.discard = True
                session.text_channel_id = ctx.channel.id
                await send_private(
                    ctx, "🗑️ Saindo do canal e descartando a gravação atual."
                )
                voice_client.stop_recording()
                return
            await voice_client.disconnect(force=True)
            await send_private(ctx, "👋 Saí do canal de voz.")
        except Exception:
            logger.exception("Falha ao sair do canal de voz.")
            await send_private(
                ctx, "❌ Não consegui sair do canal de voz. Consulte o terminal do bot."
            )


def register(bot: commands.Bot) -> RecordingController:
    controller = RecordingController(bot)
    bot.command(name="entrar")(controller.enter)
    bot.command(name="gravar")(controller.record)
    bot.command(name="parar")(controller.stop)
    bot.command(name="sair")(controller.leave)
    return controller
