"""Custom createsuperuser for the AIF custom User model (no django.contrib.auth required).
Usage: python manage.py createsuperuser [--username NAME] [--email EMAIL]
Passwords are always prompted interactively (never accepted on the command line)."""
import getpass
import sys

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from analytics.auth import security
from analytics.auth.permissions import DASHBOARD_KEYS
from analytics.models import User


class Command(BaseCommand):
    help = 'Create a SUPERUSER account for the AIF Analytics dashboard.'
    requires_migrations_checks = True

    def add_arguments(self, parser):
        parser.add_argument('--username', default=None)
        parser.add_argument('--email', default=None)

    def handle(self, *args, **opts):
        import re
        USERNAME_RE = re.compile(r'^[A-Za-z0-9._-]{2,64}$')
        EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

        # --- username ---
        username = (opts['username'] or '').strip()
        while not username:
            username = input('Username: ').strip()
            if not username:
                self.stderr.write('Username cannot be blank.')
                username = ''
                continue
            if not USERNAME_RE.match(username):
                self.stderr.write('Use letters, numbers, dot, dash or underscore (2–64 chars).')
                username = ''
                continue
            if User.objects.filter(username__iexact=username).exists():
                self.stderr.write(f'A user named "{username}" already exists.')
                username = ''

        # --- email ---
        email = (opts['email'] or '').strip()
        while not email:
            email = input('Email address: ').strip()
            if not email:
                self.stderr.write('Email cannot be blank.')
                email = ''
                continue
            if not EMAIL_RE.match(email):
                self.stderr.write('Enter a valid email address.')
                email = ''
                continue
            if User.objects.filter(email__iexact=email).exists():
                self.stderr.write(f'"{email}" is already in use.')
                email = ''

        # --- password ---
        password = ''
        while not password:
            try:
                password = getpass.getpass('Password: ')
                confirm = getpass.getpass('Password (again): ')
            except (KeyboardInterrupt, EOFError):
                self.stdout.write('')
                raise CommandError('Aborted.')
            if password != confirm:
                self.stderr.write('Passwords do not match.')
                password = ''
                continue
            err = security.password_error(password)
            if err:
                self.stderr.write(err)
                password = ''

        try:
            with transaction.atomic():
                u = User.objects.create(
                    username=username,
                    email=email,
                    password_hash=security.hash_password(password),
                    display_name=username,
                    role='SUPERUSER',
                    is_data_steward=True,
                    allowed_dashboards=list(DASHBOARD_KEYS),
                )
        except IntegrityError:
            raise CommandError('A user with that username or email already exists (race condition).')

        self.stdout.write(self.style.SUCCESS(f'Superuser "{u.username}" created successfully.'))
