"""Settings for the AIF Analytics API. Users, password-reset tokens and sessions live in PostgreSQL through Django's ORM.
Analytics facts (billing lines, batch costs, order costs) are persisted in PostgreSQL and served from there at runtime."""
import os
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name, default=None):
    """Process environment first, then backend/config/.env."""
    if name in os.environ:
        return os.environ[name]
    try:
        from analytics.config import CFG
        return CFG.get(name, default)
    except Exception:
        return default


DEBUG = _env('DJANGO_DEBUG', '1') == '1'
SECRET_KEY = _env('DJANGO_SECRET_KEY') or ('dev-only-not-a-secret-aif-analytics-api' if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError('DJANGO_SECRET_KEY must be set when DJANGO_DEBUG=0')
ALLOWED_HOSTS = _env('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1],testserver').split(',')

INSTALLED_APPS = ['analytics']
MIDDLEWARE = [
    'analytics.auth.middleware.SecurityHeadersMiddleware',
    'analytics.auth.middleware.CorsMiddleware',
    'analytics.auth.middleware.ApiGuardMiddleware',
]
ROOT_URLCONF = 'aif_backend.urls'
WSGI_APPLICATION = 'aif_backend.wsgi.application'

# ---- database -----------------------------------------------------------------------------------

def _build_db():
    url = _env('DATABASE_URL')
    if url:
        p = urlparse(url)
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': p.path.lstrip('/'),
            'USER': p.username or 'postgres',
            'PASSWORD': p.password or '',
            'HOST': p.hostname or 'localhost',
            'PORT': str(p.port or 5432),
            'CONN_MAX_AGE': int(_env('CONN_MAX_AGE', '0' if DEBUG else '60')),
            'CONN_HEALTH_CHECKS': True,
        }
    pg_db = _env('POSTGRES_DB')
    if pg_db:
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': pg_db,
            'USER': _env('POSTGRES_USER', 'postgres'),
            'PASSWORD': _env('POSTGRES_PASSWORD', ''),
            'HOST': _env('POSTGRES_HOST', 'localhost'),
            'PORT': _env('POSTGRES_PORT', '5432'),
            'CONN_MAX_AGE': int(_env('CONN_MAX_AGE', '0' if DEBUG else '60')),
            'CONN_HEALTH_CHECKS': True,
        }
    # SQLite fallback — used only when neither DATABASE_URL nor POSTGRES_DB is set (bare CI, unit tests)
    return {'ENGINE': 'django.db.backends.sqlite3', 'NAME': _env('AIF_DB_PATH') or str(BASE_DIR / 'db.sqlite3')}


DATABASES = {'default': _build_db()}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
TIME_ZONE = _env('TIME_ZONE', 'Africa/Kigali')

DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
LOGGING = {
    'version': 1, 'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
}

# ---- auth ---------------------------------------------------------------------------------------
APP_URL = (_env('APP_URL', 'http://localhost:5174') or '').rstrip('/')
CORS_ALLOWED_ORIGINS = [o.strip() for o in (_env('CORS_ALLOWED_ORIGINS') or f'{APP_URL},http://127.0.0.1:5174').split(',') if o.strip()]
JWT_SECRET = _env('JWT_SECRET')
SESSION_TTL_HOURS = float(_env('SESSION_TTL_HOURS', '8'))
SESSION_REMEMBER_DAYS = float(_env('SESSION_REMEMBER_DAYS', '7'))
RESET_TOKEN_TTL_MINUTES = 15
COOKIE_NAME = 'aif_session'
COOKIE_SECURE = not DEBUG
TRUST_PROXY = _env('TRUST_PROXY', '0') == '1'

# ---- email (password reset) ---------------------------------------------------------------------
if _env('SMTP_HOST'):
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = _env('SMTP_HOST')
    EMAIL_PORT = int(_env('SMTP_PORT', '587'))
    EMAIL_HOST_USER = _env('SMTP_USER', '')
    EMAIL_HOST_PASSWORD = _env('SMTP_PASSWORD', '')
    EMAIL_USE_TLS = _env('SMTP_TLS', '1') == '1'
elif DEBUG:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
else:
    EMAIL_BACKEND = 'django.core.mail.backends.dummy.EmailBackend'
DEFAULT_FROM_EMAIL = _env('MAIL_FROM', 'AIF Analytics <no-reply@africaimprovedfoods.com>')
