"""Fernet-backed secret storage (app/secret_store.py)."""
from __future__ import annotations

import stat

import pytest

from app.secret_store import (
    SecretError, decrypt_secret, encrypt_secret, generate_key, get_secret, set_secret,
)

KEY = generate_key()


def test_round_trip():
    ct = encrypt_secret("hunter2", KEY)
    assert "hunter2" not in ct
    assert decrypt_secret(ct, KEY) == "hunter2"


def test_wrong_key_fails():
    ct = encrypt_secret("hunter2", KEY)
    with pytest.raises(SecretError):
        decrypt_secret(ct, generate_key())


def test_tampered_ciphertext_fails():
    ct = encrypt_secret("hunter2", KEY)
    with pytest.raises(SecretError):
        decrypt_secret(ct[:-4] + "AAAA", KEY)


def test_missing_or_invalid_key(monkeypatch):
    monkeypatch.setattr("app.secret_store.settings.secrets_master_key", None)
    with pytest.raises(SecretError):
        encrypt_secret("x")
    with pytest.raises(SecretError):
        encrypt_secret("x", "not-a-key")


def test_set_and_get_secret(tmp_path):
    path = tmp_path / "secrets.enc.yaml"
    set_secret(path, "a", "one", KEY)
    set_secret(path, "b", "two", KEY)
    set_secret(path, "a", "uno", KEY)
    assert get_secret(path, "a", KEY) == "uno"
    assert get_secret(path, "b", KEY) == "two"
    assert "uno" not in path.read_text()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    with pytest.raises(SecretError):
        get_secret(path, "missing", KEY)
