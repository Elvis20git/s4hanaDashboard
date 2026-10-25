"""Request guards. `guard(...)` is applied to EVERY data route: it authenticates from the session cookie (or a Bearer token), loads the
user from the database on each request — so a deactivation, a role change or a revoked dashboard takes effect on the very next call —
and then enforces the dashboard / role / steward / export requirements. The UI hides things too, but this is the security boundary."""
from functools import wraps

from django.conf import settings

from ..http import jres
from ..models import User
from . import security
from .permissions import SUPERUSER, can_export, can_modify_data, can_view


def _token_from(request):
    h = request.headers.get('Authorization') or ''
    if h.startswith('Bearer '):
        return h[7:].strip()
    return request.COOKIES.get(settings.COOKIE_NAME)


def authenticate(request):
    """-> (user, claims, error_response). Rejects missing/invalid tokens, unknown or INACTIVE users and tokens issued before the
    user's last password change."""
    token = _token_from(request)
    claims = security.read_token(token) if token else None
    if not claims:
        return None, None, jres({'success': False, 'message': 'Authentication required.'}, 401)
    user = User.objects.filter(id=claims['sub']).first()
    if user is None or user.status != 'ACTIVE':
        return None, None, jres({'success': False, 'message': 'Authentication required.'}, 401)
    if claims['iat_ms'] < int(user.password_changed_at.timestamp() * 1000):
        return None, None, jres({'success': False, 'message': 'Session expired. Please sign in again.'}, 401)
    return user, claims, None


def pwchange_required():
    return jres({'success': False, 'code': 'PASSWORD_CHANGE_REQUIRED', 'message': 'You must change your password before continuing.'}, 403)


def guard(*, dashboard=None, superuser=False, steward=False, export=False, pwchange_ok=False):
    """dashboard  -> the user must hold that dashboard key (SUPERUSER always does)
    superuser  -> SUPERUSER only (all /api/admin/*)
    steward    -> data steward or SUPERUSER (upload / modify / delete of datasets)
    export     -> not a VIEWER
    pwchange_ok-> also allowed while a forced password change is pending (only /me, change-password, logout)"""
    def deco(fn):
        @wraps(fn)
        def wrapper(request, *args, **kwargs):
            user, claims, err = authenticate(request)
            if err:
                return err
            if (claims.get('scope') == 'pwchange' or user.must_change_password) and not pwchange_ok:
                return pwchange_required()
            if superuser and user.role != SUPERUSER:
                return jres({'success': False, 'message': 'Administrator access required.'}, 403)
            if dashboard and not can_view(user, dashboard):
                return jres({'success': False, 'message': 'You do not have access to this dashboard.'}, 403)
            if steward and not can_modify_data(user):
                return jres({'success': False, 'message': 'Only data stewards can upload or modify datasets.'}, 403)
            if export and not can_export(user):
                return jres({'success': False, 'message': 'Your role cannot export data.'}, 403)
            request.aif_user = user
            request.aif_claims = claims
            return fn(request, *args, **kwargs)
        return wrapper
    return deco
