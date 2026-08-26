from __future__ import annotations

from dataclasses import dataclass


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


@dataclass(frozen=True, slots=True)
class ParticipantIdentity:
    """Identidade da conta, separada do apelido específico do servidor."""

    user_id: int
    username: str | None
    global_name: str | None
    guild_nickname: str | None = None

    @property
    def display_name(self) -> str:
        """Nome usado em arquivos e transcrições."""

        return self.global_name or self.username or f"usuario_{self.user_id}"

    @property
    def resolved(self) -> bool:
        return self.global_name is not None or self.username is not None

    @classmethod
    def from_discord_user(cls, user: object) -> ParticipantIdentity:
        user_id = int(getattr(user, "id"))
        return cls(
            user_id=user_id,
            username=_text(getattr(user, "name", None)),
            global_name=_text(getattr(user, "global_name", None)),
            guild_nickname=_text(getattr(user, "nick", None)),
        )


def choose_identity(
    user: object,
    known: ParticipantIdentity | None = None,
    resolved: ParticipantIdentity | None = None,
) -> ParticipantIdentity:
    """Prefere dados completos do canal/cache aos objetos mínimos do receptor."""

    packet_identity = ParticipantIdentity.from_discord_user(user)
    for candidate in (known, resolved, packet_identity):
        if candidate is not None and candidate.resolved:
            return candidate
    return known or resolved or packet_identity
