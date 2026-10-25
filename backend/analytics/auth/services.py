"""User serialisation, reset-token handling and session cookies shared by the auth and admin views."""
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from ..models import PasswordResetToken
from . import mail, security
from .permissions import DASHBOARD_KEYS, can_export, can_modify_data, effective_dashboards

audit = logging.getLogger('aif.audit')


def public_user(u):
    """The session user (never includes password_hash). A SUPERUSER's allowed_dashboards is the full list of 7."""
    return {
        'id': u.id, 'username': u.username, 'display_name': u.display_name, 'email': u.email,
        'role': u.role, 'is_data_steward': u.is_data_steward, 'allowed_dashboards': effective_dashboards(u),
        'status': u.status, 'must_change_password': u.must_change_password,
        'can_export': can_export(u), 'can_modify_data': can_modify_data(u),
    }


def admin_user(u):
    d = public_user(u)
    d.update(job_title=u.job_title, department=u.department,
             last_login=u.last_login.isoformat() if u.last_login else None,
             created_at=u.created_at.isoformat(), updated_at=u.updated_at.isoformat())
    return d


def client_ip(request):
    if settings.TRUST_PROXY:
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        if xff:
            return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '?')


def set_session_cookie(response, token, ttl, remember):
    response.set_cookie(settings.COOKIE_NAME, token, max_age=ttl if remember else None, httponly=True, secure=settings.COOKIE_SECURE,
                        samesite='Strict', path='/')


def clear_session_cookie(response):
    response.delete_cookie(settings.COOKIE_NAME, path='/', samesite='Strict')


def issue_reset(user):
    """Invalidate earlier unused tokens and mint a new link token (32 random bytes) + 6-digit code. Only SHA-256 hashes are stored.
    Returns (token, code)."""
    now = timezone.now()
    PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(used_at=now)
    token = secrets.token_urlsafe(32)
    code = f'{secrets.randbelow(10 ** 6):06d}'
    PasswordResetToken.objects.create(user=user, token_hash=security.sha256(token), code_hash=security.sha256(code),
                                      expires_at=now + timedelta(minutes=settings.RESET_TOKEN_TTL_MINUTES))
    return token, code


def send_reset(user):
    token, code = issue_reset(user)
    return mail.send_reset_email(user, token, code)


def set_new_password(user, new_password):
    """Hash, save, stamp password_changed_at (which invalidates every earlier session) and clear the forced-change flag."""
    user.password_hash = security.hash_password(new_password)
    user.password_changed_at = timezone.now()
    user.must_change_password = False
    user.save(update_fields=['password_hash', 'password_changed_at', 'must_change_password', 'updated_at'])


def active_superusers():
    from ..models import User
    return User.objects.filter(role='SUPERUSER', status='ACTIVE')
