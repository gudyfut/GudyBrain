from __future__ import annotations

import logging
from typing import Protocol

import discord
from discord.ext import commands


logger = logging.getLogger("discordbot.messaging")


class SessionRecipient(Protocol):
    requester_user_id: int
    text_channel_id: int


async def send_private(ctx: commands.Context, message: str) -> bool:
    try:
        await ctx.author.send(message)
        return True
    except discord.HTTPException:
        logger.warning(
            "Não foi possível enviar mensagem privada para %s (%s).",
            ctx.author,
            ctx.author.id,
            exc_info=True,
        )
        if ctx.guild is not None:
            try:
                await ctx.send(
                    "⚠️ Não consegui enviar uma mensagem privada para você. "
                    "Habilite mensagens diretas deste servidor e tente novamente."
                )
            except discord.HTTPException:
                logger.exception("Também não foi possível avisar no canal do servidor.")
        return False


async def send_to_session_user(
    bot: commands.Bot, session: SessionRecipient, message: str
) -> bool:
    user = bot.get_user(session.requester_user_id)
    if user is None:
        try:
            user = await bot.fetch_user(session.requester_user_id)
        except discord.HTTPException:
            logger.exception(
                "Não foi possível localizar o usuário %s da gravação.",
                session.requester_user_id,
            )

    if user is not None:
        try:
            await user.send(message)
            return True
        except discord.HTTPException:
            logger.warning(
                "Não foi possível enviar o resultado por DM para %s.",
                session.requester_user_id,
                exc_info=True,
            )

    channel = bot.get_channel(session.text_channel_id)
    if channel is not None:
        try:
            await channel.send(
                "⚠️ Não consegui enviar o resultado da gravação por mensagem privada. "
                "Quem iniciou a gravação deve habilitar as DMs deste servidor."
            )
        except discord.HTTPException:
            logger.exception("Não foi possível enviar o aviso de falha no canal.")
    return False
