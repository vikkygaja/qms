"""Password hashing (argon2id), session tokens and password policy. Never log any of these."""

import hashlib
import re
import secrets
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings

POLICY_MESSAGE = "Use at least 8 characters with letters and numbers."


@lru_cache
def _hasher(time_cost: int, memory_cost: int, parallelism: int) -> PasswordHasher:
    return PasswordHasher(time_cost=time_cost, memory_cost=memory_cost, parallelism=parallelism)


def hash_password(password: str, settings: Settings) -> str:
    return _hasher(
        settings.argon2_time_cost, settings.argon2_memory_cost, settings.argon2_parallelism
    ).hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Parameters are read from the hash itself, so any stored hash verifies."""
    try:
        return _hasher(3, 65536, 4).verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, VerificationError):
        return False


@lru_cache
def _dummy_hash() -> str:
    return _hasher(1, 8, 1).hash("dummy-password-for-timing")


def burn_verify_time(password: str) -> None:
    """Verify against a dummy hash so unknown users cost the same as known ones."""
    verify_password(_dummy_hash(), password)


def password_policy_error(password: str) -> str | None:
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return POLICY_MESSAGE
    return None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


_LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"  # no look-alikes (l, I, O, 0 ...)
_DIGITS = "23456789"


def temporary_password(length: int = 12) -> str:
    """Random, readable, and always meets the password policy."""
    chars = [secrets.choice(_LETTERS), secrets.choice(_DIGITS)]
    chars += [secrets.choice(_LETTERS + _DIGITS) for _ in range(length - 2)]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


__all__ = [
    "POLICY_MESSAGE",
    "burn_verify_time",
    "hash_password",
    "hash_token",
    "new_token",
    "password_policy_error",
    "temporary_password",
    "verify_password",
]
