#!/bin/sh
set -e
# Named volumes on Linux are initialised as root — fix ownership before running as appuser
chown -R appuser:appuser /app/validation
exec gosu appuser sh -c '
  python manage.py migrate --noinput
  exec gunicorn aif_backend.wsgi:application \
      --bind 0.0.0.0:8000 \
      --workers 2 \
      --timeout 600 \
      --access-logfile - \
      --error-logfile -
'
