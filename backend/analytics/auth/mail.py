"""Password-reset email. Uses Django's mail layer: SMTP when SMTP_HOST is set; in development the message (with the link) is printed to
the server console; in production with no provider nothing is sent and a warning is logged.
send_reset_email returns what happened: 'sent' (handed to SMTP), 'console' (development: printed to the server console, NOT emailed),
'none' (no provider configured) or 'failed' (the provider refused it)."""
import logging

from django.conf import settings
from django.core.mail import send_mail

log = logging.getLogger('aif.auth')


def send_reset_email(user, token, code):
    link = f'{settings.APP_URL}/reset-password?token={token}'
    body = (f'Hello {user.display_name or user.username},\n\n'
            f'A password reset was requested for your AIF Analytics account.\n\n'
            f'Reset link (valid {settings.RESET_TOKEN_TTL_MINUTES} minutes, single use):\n{link}\n\n'
            f'Or enter this 6-digit code on the reset page: {code}\n\n'
            f'If you did not ask for this, you can ignore this message.\n')
    if settings.EMAIL_BACKEND.endswith('dummy.EmailBackend'):
        log.warning('Password reset requested for %s but no email provider is configured (set SMTP_HOST); nothing was sent.', user.username)
        return 'none'
    try:
        send_mail('AIF Analytics — reset your password', body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)
        return 'console' if settings.EMAIL_BACKEND.endswith('console.EmailBackend') else 'sent'
    except Exception as e:  # never reveal delivery problems to the requester
        log.error('Could not send the reset email to user %s: %s', user.username, e)
        return 'failed'
