"""Settings for the AIF Analytics API. The sales dataset is built in memory from S/4HANA (or a fixture); users, password-reset tokens and
sessions' server-side state live in SQLite through Django's ORM."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name, default=None):
    """Process environment first, then backend/config/.env (the file that holds the SAP settings)."""
    if name in os.environ:
        return os.environ[name]
    try:
        from analytics.config import CFG
        return CFG.get(name, default)
    except Exception:       # no .env at all (e.g. a CI run): fall back to the default
        return default


DEBUG = _env('DJANGO_DEBUG', '1') == '1'
SECRET_KEY = _env('DJANGO_SECRET_KEY') or ('dev-only-not-a-secret-aif-analytics-api' if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError('DJANGO_SECRET_KEY must be set when DJANGO_DEBUG=0')
ALLOWED_HOSTS = _env('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1],testserver').split(',')

INSTALLED_APPS = ['analytics']
MIDDLEWARE = [
    'analytics.auth.middleware.SecurityHeadersMiddleware',    # Helmet-style headers, no-store on /api
    'analytics.auth.middleware.CorsMiddleware',               # strict allow-list of origins
    'analytics.auth.middleware.ApiGuardMiddleware',           # JSON-API CSRF defence: unsafe methods need the X-AIF-Client header
]
ROOT_URLCONF = 'aif_backend.urls'
WSGI_APPLICATION = 'aif_backend.wsgi.application'
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': _env('AIF_DB_PATH') or str(BASE_DIR / 'db.sqlite3')}}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
TIME_ZONE = 'UTC'
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024        # JSON bodies are tiny; reject anything bigger
LOGGING = {
    'version': 1, 'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
}

# ---- auth -----------------------------------------------------------------------------------------------------------
APP_URL = (_env('APP_URL', 'http://localhost:5174') or '').rstrip('/')                         # used in reset links and as the CORS origin
CORS_ALLOWED_ORIGINS = [o.strip() for o in (_env('CORS_ALLOWED_ORIGINS') or f'{APP_URL},http://127.0.0.1:5174').split(',') if o.strip()]
JWT_SECRET = _env('JWT_SECRET')                                                                # required when DEBUG=0 (see auth.security)
SESSION_TTL_HOURS = float(_env('SESSION_TTL_HOURS', '8'))
SESSION_REMEMBER_DAYS = float(_env('SESSION_REMEMBER_DAYS', '7'))
RESET_TOKEN_TTL_MINUTES = 15
COOKIE_NAME = 'aif_session'
COOKIE_SECURE = not DEBUG                                                                      # Secure cookies need https; localhost dev uses http
TRUST_PROXY = _env('TRUST_PROXY', '0') == '1'                                                  # read X-Forwarded-For for rate limiting

# ---- email (password reset) ----------------------------------------------------------------------------------------
if _env('SMTP_HOST'):
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = _env('SMTP_HOST')
    EMAIL_PORT = int(_env('SMTP_PORT', '587'))
    EMAIL_HOST_USER = _env('SMTP_USER', '')
    EMAIL_HOST_PASSWORD = _env('SMTP_PASSWORD', '')
    EMAIL_USE_TLS = _env('SMTP_TLS', '1') == '1'
elif DEBUG:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'     # development: the reset link is printed to the server console
else:
    EMAIL_BACKEND = 'django.core.mail.backends.dummy.EmailBackend'       # production without a provider: nothing is sent (a warning is logged)
DEFAULT_FROM_EMAIL = _env('MAIL_FROM', 'AIF Analytics <no-reply@africaimprovedfoods.com>')
