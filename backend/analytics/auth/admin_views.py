"""Administration endpoints — SUPERUSER only. Users are never hard-deleted: DELETE deactivates (status = INACTIVE)."""
import re

from django.db import IntegrityError, transaction
from django.db.models import Q

from ..http import body_json, jres
from ..models import User
from . import security, services
from .decorators import guard
from .permissions import DASHBOARD_KEYS, ROLES, SUPERUSER, clean_dashboards

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
USERNAME_RE = re.compile(r'^[A-Za-z0-9._-]{2,64}$')


def _err(message, field=None, status=400):
    d = {'success': False, 'message': message}
    if field:
        d['field'] = field
    return jres(d, status)


def _log(actor, what, target):
    services.audit.info('admin %s: %s -> %s', actor.username, what, target.username)


def _last_active_superuser(target):
    return target.role == SUPERUSER and target.status == 'ACTIVE' and not services.active_superusers().exclude(id=target.id).exists()


def _prepare_fields(b, partial=False):
    """Validate the editable profile fields. Returns (clean dict, error response | None)."""
    out = {}
    for f in ('display_name', 'job_title', 'department'):
        if f in b or not partial:
            out[f] = str(b.get(f) or '').strip()[:120]
    if 'email' in b or not partial:
        email = str(b.get('email') or '').strip()
        if not email:
            return None, _err('Email is required.', 'email')
        if not EMAIL_RE.match(email):
            return None, _err('Enter a valid email address.', 'email')
        out['email'] = email
    if 'role' in b or not partial:
        role = str(b.get('role') or 'VIEWER').upper()
        if role not in ROLES:
            return None, _err('Role must be SUPERUSER, ANALYST or VIEWER.', 'role')
        out['role'] = role
    if 'is_data_steward' in b or not partial:
        out['is_data_steward'] = bool(b.get('is_data_steward'))
    if 'allowed_dashboards' in b or not partial:
        try:
            out['allowed_dashboards'] = clean_dashboards(b.get('allowed_dashboards'))
        except ValueError as e:
            return None, _err(str(e), 'allowed_dashboards')
    return out, None


@guard(superuser=True)
def users(request):
    if request.method == 'GET':
        rows = list(User.objects.all().order_by('username'))
        return jres({'summary': {'total_members': len(rows), 'active_members': sum(1 for u in rows if u.status == 'ACTIVE'),
                                 'total_dashboards': len(DASHBOARD_KEYS)},
                     'users': [services.admin_user(u) for u in rows]})
    if request.method != 'POST':
        return _err('Method not allowed.', status=405)
    b = body_json(request)
    username, password = str(b.get('username') or '').strip(), str(b.get('password') or '')
    if not username:
        return _err('Username is required.', 'username')
    if not USERNAME_RE.match(username):
        return _err('Username may use letters, numbers, dot, dash and underscore (2–64 characters).', 'username')
    if not password:
        return _err('Password is required.', 'password')
    perr = security.password_error(password)
    if perr:
        return _err(perr, 'password')
    fields, bad = _prepare_fields(b)
    if bad:
        return bad
    if User.objects.filter(username__iexact=username).exists():
        return _err('That username is already taken.', 'username', 409)
    if User.objects.filter(email__iexact=fields['email']).exists():
        return _err('That email address is already in use.', 'email', 409)
    if fields['role'] == SUPERUSER:
        fields['allowed_dashboards'] = list(DASHBOARD_KEYS)
    try:
        with transaction.atomic():
            u = User.objects.create(username=username, password_hash=security.hash_password(password),
                                    must_change_password=True, **fields)
    except IntegrityError:
        return _err('A user with that username or email already exists.', None, 409)
    _log(request.aif_user, f'created role={u.role} steward={u.is_data_steward} dashboards={u.allowed_dashboards}', u)
    return jres({'success': True, 'user': services.admin_user(u)}, 201)


@guard(superuser=True)
def user_detail(request, user_id):
    target = User.objects.filter(id=user_id).first()
    if target is None:
        return _err('User not found.', status=404)
    me = request.aif_user
    if request.method == 'DELETE':
        if target.id == me.id:
            return _err('You cannot deactivate your own account.')
        if _last_active_superuser(target):
            return _err('You cannot deactivate the last active superuser.')
        target.status = 'INACTIVE'
        target.save(update_fields=['status', 'updated_at'])
        _log(me, 'deactivated', target)
        return jres({'success': True, 'user': services.admin_user(target)})
    if request.method != 'PUT':
        return _err('Method not allowed.', status=405)
    b = body_json(request)
    fields, bad = _prepare_fields(b, partial=True)
    if bad:
        return bad
    new_role = fields.get('role', target.role)
    if target.role == SUPERUSER and new_role != SUPERUSER:
        if target.id == me.id:
            return _err('You cannot change your own role away from Superuser.', 'role')
        if _last_active_superuser(target):
            return _err('You cannot demote the last active superuser.', 'role')
    if 'email' in fields and User.objects.filter(email__iexact=fields['email']).exclude(id=target.id).exists():
        return _err('That email address is already in use.', 'email', 409)
    if new_role == SUPERUSER:
        fields['allowed_dashboards'] = list(DASHBOARD_KEYS)
    before = (target.role, target.is_data_steward, list(target.allowed_dashboards or []))
    for k, v in fields.items():
        setattr(target, k, v)
    target.save()
    _log(me, f'updated role {before[0]}->{target.role} steward {before[1]}->{target.is_data_steward} '
             f'dashboards {before[2]}->{target.allowed_dashboards}', target)
    return jres({'success': True, 'user': services.admin_user(target)})


@guard(superuser=True)
def user_activate(request, user_id):
    if request.method != 'POST':
        return _err('Method not allowed.', status=405)
    target = User.objects.filter(id=user_id).first()
    if target is None:
        return _err('User not found.', status=404)
    target.status = 'ACTIVE'
    target.save(update_fields=['status', 'updated_at'])
    _log(request.aif_user, 'reactivated', target)
    return jres({'success': True, 'user': services.admin_user(target)})


@guard(superuser=True)
def user_force_password_change(request, user_id):
    if request.method != 'POST':
        return _err('Method not allowed.', status=405)
    target = User.objects.filter(id=user_id).first()
    if target is None:
        return _err('User not found.', status=404)
    if target.status != 'ACTIVE':
        return _err('Reactivate the user before requiring a password change.')
    target.must_change_password = True
    target.save(update_fields=['must_change_password', 'updated_at'])
    _log(request.aif_user, 'forced password change', target)
    return jres({'success': True, 'user': services.admin_user(target)})


@guard(superuser=True)
def user_reset_password(request, user_id):
    if request.method != 'POST':
        return _err('Method not allowed.', status=405)
    target = User.objects.filter(id=user_id).first()
    if target is None:
        return _err('User not found.', status=404)
    if target.status != 'ACTIVE':
        return _err('Reactivate the user before sending a password reset.')
    outcome = services.send_reset(target)
    _log(request.aif_user, f'requested password reset (outcome={outcome})', target)
    messages = {
        'sent': f'Password reset email sent to {target.email}.',
        'console': f'Development mode: no email was sent. The reset link for {target.email} was printed in the server console (set SMTP_HOST to send real email).',
        'none': 'No email provider is configured (set SMTP_HOST in backend/config/.env), so nothing was sent.',
        'failed': f'The email to {target.email} could not be sent. Check the SMTP settings and the server log.',
    }
    return jres({'success': outcome in ('sent', 'console'), 'delivered': outcome == 'sent', 'outcome': outcome, 'message': messages[outcome]},
                200 if outcome in ('sent', 'console') else 502)
