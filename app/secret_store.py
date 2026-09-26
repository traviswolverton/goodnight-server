"""Encrypted storage for per-adapter credentials.

Secrets live in config/secrets.enc.yaml as `{secret_name: fernet_token}`
pairs; adapters.yaml references one from an option with
`password: {secret: adguard_main_password}` and load_adapters()
(app/config.py) decrypts it at load time. Encryption is Fernet
(symmetric, authenticated) keyed by the single SECRETS_MASTER_KEY
setting — the one value still held in the clear (.env), instead of one
plaintext password per adapter.

Named secret_store, not secrets, so it can never be confused with the
stdlib module of that name.

File shape:
    secrets:
      adguard_main_password: "gAAAAA..."
"""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from cryptography.fernet import Fernet, InvalidToken

from app.settings import settings


class SecretError(Exception):
    """Missing key/secret or undecryptable ciphertext. Messages never
    include plaintext or key material."""


def generate_key() -> str:
    return Fernet.generate_key().decode()


def _fernet(key: str | None) -> Fernet:
    key = key or settings.secrets_master_key
    if not key:
        raise SecretError("SECRETS_MASTER_KEY is not set")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise SecretError("SECRETS_MASTER_KEY is not a valid Fernet key") from exc


def encrypt_secret(plaintext: str, key: str | None = None) -> str:
    return _fernet(key).encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str, key: str | None = None) -> str:
    try:
        return _fernet(key).decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise SecretError("ciphertext is corrupt or was encrypted with a different key") from exc


def match_owner(tmp: Path, reference: Path) -> None:
    """Give `tmp` the owner/group (and, for an existing file, mode) of
    `reference` before it's os.replace()d over it. The container runs as
    root, so without this every atomic rewrite would turn a host-user-
    owned config file root-owned and un-editable on the host. Best
    effort: a non-root process just can't chown, and keeps its own."""
    st = reference.stat()
    try:
        os.chown(tmp, st.st_uid, st.st_gid)
    except PermissionError:
        pass
    if reference.is_file():
        os.chmod(tmp, st.st_mode & 0o7777)


def _read(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        raise SecretError(f"{path} is not valid YAML") from exc
    return dict(raw.get("secrets") or {})


def get_secret(path: str | Path, name: str, key: str | None = None) -> str:
    """Decrypt one named secret from the secrets file."""
    stored = _read(Path(path))
    if name not in stored:
        raise SecretError(f"no secret named '{name}' in {path}")
    return decrypt_secret(stored[name], key)


def _write(path: Path, stored: dict[str, str]) -> None:
    """Atomic, owner-only write of the whole secrets file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        yaml.safe_dump({"secrets": stored}, f, default_flow_style=False)
    match_owner(tmp, path if path.exists() else path.parent)
    os.replace(tmp, path)


def set_secret(path: str | Path, name: str, plaintext: str, key: str | None = None) -> None:
    """Encrypt and store one named secret, replacing any existing value."""
    path = Path(path)
    stored = _read(path)
    stored[name] = encrypt_secret(plaintext, key)
    _write(path, stored)


def delete_secret(path: str | Path, name: str) -> bool:
    """Remove one named secret; False if it wasn't there. Needs no key."""
    path = Path(path)
    stored = _read(path)
    if name not in stored:
        return False
    del stored[name]
    _write(path, stored)
    return True
