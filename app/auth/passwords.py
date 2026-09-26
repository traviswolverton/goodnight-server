"""Argon2id password hashing (argon2-cffi defaults = RFC 9106 low-memory
profile). Hashing is CPU-heavy on purpose, so callers run it off the event
loop via the async wrappers."""
from __future__ import annotations

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 256   # bounds the work an attacker can force per request

_hasher = PasswordHasher()
# Verified against when the username doesn't exist, so "no such user" costs
# the same as "wrong password" (no account enumeration by timing).
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


class PasswordPolicyError(ValueError):
    pass


def validate_password(password: str, username: str | None = None) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise PasswordPolicyError(f"password must be at most {MAX_PASSWORD_LENGTH} characters")
    if username and password.lower() == username.lower():
        raise PasswordPolicyError("password must not be the same as the username")


def _verify(stored: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored or _DUMMY_HASH, password) and stored is not None
    except (VerificationError, InvalidHashError):
        return False


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(stored_hash: str | None, password: str) -> bool:
    """True only when `stored_hash` exists and matches. A missing hash still
    burns a full verification (against a dummy) for timing parity."""
    return await asyncio.to_thread(_verify, stored_hash, password)
