"""Password hashing (Argon2id), the strength policy, SHA-256 token hashing and the session JWT."""
import hashlib
import hmac
import re
import secrets
import time

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from django.conf import settings

_hasher = PasswordHasher()          # Argon2id with the library's recommended parameters

# A real hash to verify against when the account does not exist, so a failed login costs the same either way.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


def hash_password(plain):
    return _hasher.hash(plain)


def verify_password(plain, hashed):
    try:
        return _hasher.verify(hashed, plain)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def burn_verification():
    """Spend the time of one password verification (unknown account / inactive user)."""
    verify_password('x', _DUMMY_HASH)


def random_unusable_password_hash():
    return _hasher.hash(secrets.token_urlsafe(48))


def password_problems(pw):
    """The strength policy: >= 8 chars, upper, lower, number, special. Returns the list of unmet rules (empty = OK)."""
    pw = pw or ''
    out = []
    if len(pw) < 8:
        out.append('at least 8 characters')
    if not re.search(r'[A-Z]', pw):
        out.append('an uppercase letter')
    if not re.search(r'[a-z]', pw):
        out.append('a lowercase letter')
    if not re.search(r'\d', pw):
        out.append('a number')
    if not re.search(r'[^A-Za-z0-9]', pw):
        out.append('a special character')
    return out


def password_error(pw):
    p = password_problems(pw)
    return None if not p else 'Password must contain ' + ', '.join(p) + '.'


def sha256(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def safe_equal(a, b):
    return hmac.compare_digest(a.encode(), b.encode())


# ---- session token --------------------------------------------------------------------------------------------------
_secret_cache = {}


def _jwt_secret():
    if settings.JWT_SECRET:
        return settings.JWT_SECRET
    if not settings.DEBUG:
        raise RuntimeError('JWT_SECRET must be set when DJANGO_DEBUG=0')
    # development only: a per-machine random secret kept in a git-ignored file so sessions survive restarts
    if 'dev' not in _secret_cache:
        f = settings.BASE_DIR / '.jwt_secret.local'
        if not f.exists():
            f.write_text(secrets.token_urlsafe(48), encoding='utf-8')
        _secret_cache['dev'] = f.read_text(encoding='utf-8').strip()
    return _secret_cache['dev']


def make_token(user, remember=False, scope='full'):
    """scope 'full' = normal session; 'pwchange' = only valid for the forced password change and /me."""
    now_ms = int(time.time() * 1000)
    ttl = 15 * 60 if scope == 'pwchange' else (settings.SESSION_REMEMBER_DAYS * 86400 if remember else settings.SESSION_TTL_HOURS * 3600)
    payload = {'sub': user.id, 'iat_ms': now_ms, 'exp': int(time.time() + ttl), 'scope': scope, 'rem': bool(remember)}
    return jwt.encode(payload, _jwt_secret(), algorithm='HS256'), int(ttl)


def read_token(token):
    """Decoded claims, or None if the signature or expiry is bad."""
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=['HS256'], options={'require': ['exp', 'sub', 'iat_ms']})
    except jwt.PyJWTError:
        return None
