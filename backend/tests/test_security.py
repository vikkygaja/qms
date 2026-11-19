import re

from app.core.security import (
    hash_password,
    hash_token,
    new_token,
    password_policy_error,
    temporary_password,
    verify_password,
)
from tests.conftest import make_settings


def test_hash_is_argon2id_and_verifies():
    h = hash_password("Passw0rd1", make_settings())
    assert h.startswith("$argon2id$")
    assert "Passw0rd1" not in h
    assert verify_password(h, "Passw0rd1")
    assert not verify_password(h, "wrong")


def test_verify_handles_garbage_hash():
    assert not verify_password("not-a-hash", "x")


def test_same_password_gets_different_hashes():
    s = make_settings()
    assert hash_password("Passw0rd1", s) != hash_password("Passw0rd1", s)


def test_tokens_are_long_unique_and_hashed_deterministically():
    a, b = new_token(), new_token()
    assert a != b and len(a) >= 40
    assert hash_token(a) == hash_token(a) != hash_token(b)
    assert re.fullmatch(r"[0-9a-f]{64}", hash_token(a))


def test_policy_rules():
    assert password_policy_error("Passw0rd1") is None
    assert password_policy_error("short1") is not None  # < 8
    assert password_policy_error("allletters") is not None  # no digit
    assert password_policy_error("12345678") is not None  # no letter


def test_temporary_passwords_always_meet_the_policy():
    seen = set()
    for _ in range(300):
        p = temporary_password()
        assert password_policy_error(p) is None
        seen.add(p)
    assert len(seen) == 300
