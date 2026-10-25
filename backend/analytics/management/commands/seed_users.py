"""Idempotent user seeding.   python manage.py seed_users [--file backend/seed/users.local.json]

1. Imports the legacy users from config/users.json that are not in the database yet (they had no passwords or emails: they get a
   placeholder email and an unusable random password, so an administrator must send them a password reset).
2. Upserts the users in the seed file by case-insensitive username: an existing record is UPDATED IN PLACE (id, last_login, created_at
   are kept); a new one is created. Seed passwords are stored hashed, may be weak (the seed bypasses the strength policy), and force
   a password change at first sign-in.
3. Creates the bootstrap superuser from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD only when no SUPERUSER exists.
Nothing is ever removed or demoted. Passwords are never printed. With DJANGO_DEBUG=0 weak seed passwords are refused unless
ALLOW_WEAK_SEED=true."""
import json
import os
import sys

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from analytics.auth import security
from analytics.auth.permissions import DASHBOARD_KEYS, ROLES, SUPERUSER, VIEWER, clean_dashboards
from analytics.config import CONFIG_DIR
from analytics.models import User

PLACEHOLDER_DOMAIN = 'legacy.aif.invalid'


def _env(name):
    from aif_backend.settings import _env as env
    return env(name)


class Command(BaseCommand):
    help = 'Seed / migrate users (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('--file', default=None, help='seed file (default: seed/users.local.json, else seed/users.example.json)')
        parser.add_argument('--reset-passwords', action='store_true', help='also overwrite the password of seed users that already changed it')

    def handle(self, *args, **opts):
        seed_file = self._seed_path(opts['file'])
        with transaction.atomic():
            self._import_legacy()
            if seed_file:
                self._seed(seed_file, opts['reset_passwords'])
            self._bootstrap_admin()
        self.stdout.write(self.style.SUCCESS(f'Done. {User.objects.count()} user(s) in the database ({User.objects.filter(role=SUPERUSER).count()} superuser).'))

    # ------------------------------------------------------------------------------------------------------------------
    def _seed_path(self, given):
        base = settings.BASE_DIR / 'seed'
        for c in ([given] if given else [base / 'users.local.json', base / 'users.example.json']):
            if c and os.path.exists(c):
                return c
        self.stdout.write(self.style.WARNING('No seed file found (seed/users.local.json); skipping the seed users.'))
        return None

    def _import_legacy(self):
        f = CONFIG_DIR / 'users.json'
        if not f.exists():
            return
        for p in json.loads(f.read_text(encoding='utf-8')).get('people', []):
            name = str(p['username']).strip()
            if User.objects.filter(username__iexact=name).exists():
                continue
            rights = p.get('rights') or []
            admin = '*' in rights or p.get('role') == 'ADMIN'
            role = SUPERUSER if admin else VIEWER
            User.objects.create(
                username=name, email=f'{name.lower()}@{PLACEHOLDER_DOMAIN}', password_hash=security.random_unusable_password_hash(),
                display_name=p.get('name') or name, role=role,
                is_data_steward=admin or any(r in rights for r in ('importData', 'adminRefresh')),
                allowed_dashboards=list(DASHBOARD_KEYS),            # the old app let every account read every dashboard
                status='ACTIVE' if p.get('active', True) else 'INACTIVE', must_change_password=True)
            self.stdout.write(f'  imported legacy user {name} as {role} (placeholder email, no usable password: send a reset)')

    def _seed(self, path, reset_passwords=False):
        data = json.load(open(path, encoding='utf-8'))
        rows = data['users'] if isinstance(data, dict) else data
        prod = not settings.DEBUG
        weak = [r['username'] for r in rows if security.password_problems(r.get('password', ''))]
        if weak and prod:
            if os.environ.get('ALLOW_WEAK_SEED', '').lower() != 'true':
                raise CommandError(f'Refusing to seed weak passwords for {", ".join(weak)} in production. Set ALLOW_WEAK_SEED=true to override.')
            self.stderr.write(self.style.WARNING(f'WARNING: seeding weak passwords for {", ".join(weak)} (ALLOW_WEAK_SEED=true).'))
        for r in rows:
            username = r['username'].strip()
            role = r.get('role', VIEWER).upper()
            if role not in ROLES:
                raise CommandError(f'{username}: bad role {role}')
            fields = dict(email=r['email'].strip(), display_name=r.get('display_name', ''), job_title=r.get('job_title', ''),
                          department=r.get('department', ''), role=role, is_data_steward=bool(r.get('is_data_steward')),
                          allowed_dashboards=list(DASHBOARD_KEYS) if role == SUPERUSER else clean_dashboards(r.get('allowed_dashboards')))
            u = User.objects.filter(username__iexact=username).first()
            if u is None:
                clash = User.objects.filter(email__iexact=fields['email']).first()
                if clash:
                    raise CommandError(f'{username}: email {fields["email"]} already belongs to {clash.username}')
                User.objects.create(username=username, password_hash=security.hash_password(r['password']), must_change_password=True, **fields)
                self.stdout.write(f'  created {username}: {role}, steward={fields["is_data_steward"]}')
                continue
            before = {k: getattr(u, k) for k in ('username', 'email', 'display_name', 'job_title', 'department', 'role', 'is_data_steward', 'allowed_dashboards')}
            clash = User.objects.filter(email__iexact=fields['email']).exclude(id=u.id).first()
            if clash:
                raise CommandError(f'{username}: email {fields["email"]} already belongs to {clash.username}')
            for k, v in fields.items():
                setattr(u, k, v)
            u.username = username                                  # the seed's spelling (case-insensitive match, same record)
            # re-running the seed must not undo a password the user has already changed: the seed password is applied only while the
            # account still has no chosen password (must_change_password is still set), or with --reset-passwords
            pw_applied = u.must_change_password or reset_passwords
            if pw_applied:
                u.password_hash = security.hash_password(r['password'])
                u.password_changed_at = timezone.now()
                u.must_change_password = True
            u.save()
            after = {k: getattr(u, k) for k in before}
            changes = {k: (before[k], after[k]) for k in before if before[k] != after[k]}
            self.stdout.write(f'  updated {username} in place (id {u.id}); changed: {json.dumps(changes, default=str)}; seed password {"applied" if pw_applied else "kept (already changed)"}')

    def _bootstrap_admin(self):
        if User.objects.filter(role=SUPERUSER, status='ACTIVE').exists():
            return
        name, email, pw = _env('ADMIN_USERNAME'), _env('ADMIN_EMAIL'), _env('ADMIN_PASSWORD')
        if not (name and email and pw):
            self.stdout.write(self.style.WARNING('No active superuser exists and ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD are not set.'))
            return
        err = security.password_error(pw)
        if err:
            raise CommandError(f'ADMIN_PASSWORD: {err}')
        User.objects.create(username=name, email=email, password_hash=security.hash_password(pw), display_name=name, role=SUPERUSER,
                            is_data_steward=True, allowed_dashboards=list(DASHBOARD_KEYS))
        self.stdout.write(f'  bootstrap superuser {name} created')
