"""Authentication endpoints: login, me, logout, forced password change, forgot / reset password."""
import time

from django.db.models import Q
from django.utils import timezone

from ..http import body_json, jres
from ..models import PasswordResetToken, User
from . import ratelimit, security, services
from .decorators import guard

LOGIN_WINDOW = 15 * 60
LOGIN_MAX_FAILURES = 5
FORGOT_WINDOW = 15 * 60
FORGOT_MAX = 3
RESET_MAX_ATTEMPTS = 5
GENERIC_FORGOT = 'If an account exists, reset instructions have been sent.'
INVALID_TOKEN = {'success': False, 'message': 'Invalid or expired token.'}


def _method(request, *allowed):
    if request.method not in allowed:
        return jres({'success': False, 'message': 'Method not allowed.'}, 405)
    return None


def _find_user(identifier):
    ident = (identifier or '').strip()
    if not ident:
        return None
    return User.objects.filter(Q(username__iexact=ident) | Q(email__iexact=ident)).first()


def login(request):
    bad = _method(request, 'POST')
    if bad:
        return bad
    b = body_json(request)
    ident = str(b.get('username_or_email') or '').strip()
    password = str(b.get('password') or '')
    remember = bool(b.get('remember'))
    key = f'login|{services.client_ip(request)}|{ident.lower()}'
    if ratelimit.count(key, LOGIN_WINDOW) >= LOGIN_MAX_FAILURES:
        return jres({'success': False, 'message': 'Too many failed attempts. Try again in a few minutes.'}, 429)
    user = _find_user(ident) if ident and password else None
    if user is None or user.status != 'ACTIVE':
        security.burn_verification()          # same cost as a real check; INACTIVE gets the same generic 401
        ok = False
    else:
        ok = security.verify_password(password, user.password_hash)
    if not ok:
        ratelimit.hit(key, LOGIN_WINDOW)
        services.audit.info('login failed identifier=%s ip=%s', ident.lower(), services.client_ip(request))
        return jres({'success': False, 'message': 'Invalid username or password'}, 401)
    ratelimit.clear(key)
    user.last_login = timezone.now()
    user.save(update_fields=['last_login'])
    scope = 'pwchange' if user.must_change_password else 'full'
    token, ttl = security.make_token(user, remember=remember and scope == 'full', scope=scope)
    resp = jres({'success': True, 'token': token, 'must_change_password': user.must_change_password, 'user': services.public_user(user)})
    services.set_session_cookie(resp, token, ttl, remember and scope == 'full')
    services.audit.info('login ok user=%s scope=%s', user.username, scope)
    return resp


@guard(pwchange_ok=True)
def me(request):
    return jres({'success': True, 'must_change_password': request.aif_user.must_change_password, 'user': services.public_user(request.aif_user)})


def logout(request):
    bad = _method(request, 'POST')
    if bad:
        return bad
    resp = jres({'success': True})
    services.clear_session_cookie(resp)
    return resp


@guard(pwchange_ok=True)
def change_password(request):
    bad = _method(request, 'POST')
    if bad:
        return bad
    u = request.aif_user
    b = body_json(request)
    current, new = str(b.get('current_password') or ''), str(b.get('new_password') or '')
    if not security.verify_password(current, u.password_hash):
        return jres({'success': False, 'field': 'current_password', 'message': 'Current password is incorrect.'}, 400)
    err = security.password_error(new)
    if err:
        return jres({'success': False, 'field': 'new_password', 'message': err}, 400)
    if new == current:
        return jres({'success': False, 'field': 'new_password', 'message': 'The new password must be different from the current one.'}, 400)
    services.set_new_password(u, new)
    services.audit.info('password changed user=%s', u.username)
    token, ttl = security.make_token(u, remember=bool(request.aif_claims.get('rem')))
    resp = jres({'success': True, 'message': 'Password successfully updated.', 'token': token, 'user': services.public_user(u)})
    services.set_session_cookie(resp, token, ttl, bool(request.aif_claims.get('rem')))
    return resp


def forgot_password(request):
    bad = _method(request, 'POST')
    if bad:
        return bad
    started = time.monotonic()
    ident = str(body_json(request).get('identifier') or '').strip()
    ip = services.client_ip(request)
    limited = (ratelimit.hit(f'forgot-ip|{ip}', FORGOT_WINDOW) > FORGOT_MAX
               or (ident and ratelimit.hit(f'forgot-id|{ident.lower()}', FORGOT_WINDOW) > FORGOT_MAX))
    if limited:
        return jres({'success': False, 'message': 'Too many requests. Try again later.'}, 429)
    user = _find_user(ident)
    if user is not None and user.status == 'ACTIVE':
        services.send_reset(user)
        services.audit.info('password reset requested user=%s', user.username)
    else:
        security.burn_verification()           # unknown / inactive account: no token, same response and timing
    # pad to a constant minimum so timing does not reveal whether the account exists
    time.sleep(max(0.0, 0.35 - (time.monotonic() - started)))
    return jres({'success': True, 'message': GENERIC_FORGOT})


def reset_password(request):
    bad = _method(request, 'POST')
    if bad:
        return bad
    b = body_json(request)
    token, ident, code, new = (str(b.get('token') or '').strip(), str(b.get('identifier') or '').strip(),
                               str(b.get('code') or '').strip(), str(b.get('new_password') or ''))
    now = timezone.now()
    rec = None
    if token:
        rec = PasswordResetToken.objects.select_related('user').filter(token_hash=security.sha256(token)).first()
        if rec is None or rec.used_at or rec.expires_at <= now or rec.user.status != 'ACTIVE':
            return jres(INVALID_TOKEN, 400)
    elif ident and code:
        user = _find_user(ident)
        rec = (PasswordResetToken.objects.select_related('user').filter(user=user, used_at__isnull=True, expires_at__gt=now)
               .order_by('-created_at').first()) if user and user.status == 'ACTIVE' else None
        if rec is None:
            security.burn_verification()
            return jres(INVALID_TOKEN, 400)
        rec.attempts += 1
        if rec.attempts > RESET_MAX_ATTEMPTS:
            rec.used_at = now                       # too many wrong codes: the token is dead
            rec.save(update_fields=['attempts', 'used_at'])
            return jres(INVALID_TOKEN, 400)
        rec.save(update_fields=['attempts'])
        if not security.safe_equal(security.sha256(code), rec.code_hash):
            return jres(INVALID_TOKEN, 400)
    else:
        return jres(INVALID_TOKEN, 400)
    err = security.password_error(new)
    if err:
        return jres({'success': False, 'field': 'new_password', 'message': err}, 400)     # the token stays valid so they can retry
    services.set_new_password(rec.user, new)         # also clears must_change_password and invalidates existing sessions
    PasswordResetToken.objects.filter(user=rec.user, used_at__isnull=True).update(used_at=now)
    services.audit.info('password reset completed user=%s', rec.user.username)
    return jres({'success': True, 'message': 'Password successfully updated.'})
