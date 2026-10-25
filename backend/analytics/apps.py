import os
import sys
import threading

from django.apps import AppConfig


def _should_warm_up():
    """Start the data load once per server process: not for other manage.py commands (test, check, ...), and under runserver's
    auto-reloader only in the child process that actually serves requests. AIF_NO_WARMUP=1 disables it (unit tests)."""
    if os.environ.get('AIF_NO_WARMUP') == '1':
        return False
    argv = sys.argv
    if argv and os.path.basename(argv[0]) == 'manage.py':
        if len(argv) > 1 and argv[1] == 'runserver':
            return os.environ.get('RUN_MAIN') == 'true' or '--noreload' in argv
        return False
    return True      # a WSGI/ASGI server (gunicorn, waitress, ...)


class AnalyticsConfig(AppConfig):
    name = 'analytics'

    def ready(self):
        if _should_warm_up():
            from .state import warm_up
            threading.Thread(target=warm_up, name='aif-warm-up', daemon=True).start()
