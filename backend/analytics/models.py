"""Users and password-reset tokens."""
import uuid

from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


def _uuid():
    return str(uuid.uuid4())


class User(models.Model):
    ROLES = [('SUPERUSER', 'Superuser'), ('ANALYST', 'Analyst'), ('VIEWER', 'Viewer')]
    STATUSES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    id = models.CharField(primary_key=True, max_length=36, default=_uuid, editable=False)
    username = models.CharField(max_length=64)
    email = models.CharField(max_length=254)
    password_hash = models.CharField(max_length=255)
    display_name = models.CharField(max_length=120, blank=True, default='')
    job_title = models.CharField(max_length=120, blank=True, default='')
    department = models.CharField(max_length=120, blank=True, default='')
    role = models.CharField(max_length=12, choices=ROLES, default='VIEWER')
    is_data_steward = models.BooleanField(default=False)     # a capability flag, NOT a role
    allowed_dashboards = models.JSONField(default=list)
    status = models.CharField(max_length=10, choices=STATUSES, default='ACTIVE')
    last_login = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(default=timezone.now)    # tokens issued before this are rejected
    must_change_password = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower('username'), name='uniq_user_username_ci'),
            models.UniqueConstraint(Lower('email'), name='uniq_user_email_ci'),
        ]

    def __str__(self):
        return self.username


class PasswordResetToken(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reset_tokens')
    token_hash = models.CharField(max_length=64, unique=True)      # SHA-256 of the emailed link token; the token itself is never stored
    code_hash = models.CharField(max_length=64)                    # SHA-256 of the 6-digit code
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
