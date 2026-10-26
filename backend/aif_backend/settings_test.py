"""Test settings: identical to production settings but uses in-memory SQLite so the test
runner works without a live PostgreSQL connection. Run via:
    python manage.py test analytics --settings=aif_backend.settings_test"""
from .settings import *  # noqa: F401, F403

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}
