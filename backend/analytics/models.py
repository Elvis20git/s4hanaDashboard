"""ORM models for AIF Analytics.

Accounts:  User, PasswordResetToken
Master:    Customer, Material
Sales:     BillingLine, GoodsReceipt, OrderJournalLine, BatchUnitCost
DataMgmt:  UploadBatch, UploadRowError, SyncRun
Audit:     AuditLog
"""
import uuid

from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


def _uuid():
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

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
    role = models.CharField(max_length=12, choices=ROLES, default='VIEWER', db_index=True)
    is_data_steward = models.BooleanField(default=False)
    allowed_dashboards = models.JSONField(default=list)
    status = models.CharField(max_length=10, choices=STATUSES, default='ACTIVE', db_index=True)
    last_login = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(default=timezone.now)
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
    token_hash = models.CharField(max_length=64, unique=True)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', 'used_at', 'expires_at']),
        ]


# ---------------------------------------------------------------------------
# Master data
# ---------------------------------------------------------------------------

class Customer(TimeStampedModel):
    code = models.CharField(max_length=20, unique=True)   # SAP BusinessPartner
    name = models.CharField(max_length=160, blank=True, default='')

    def __str__(self):
        return f'{self.code} — {self.name}'


class Material(TimeStampedModel):
    code = models.CharField(max_length=40, unique=True)   # SAP Product (may be zero-padded)
    name = models.CharField(max_length=200, blank=True, default='')
    is_finished_good = models.BooleanField(default=False, db_index=True)

    def __str__(self):
        return f'{self.code} — {self.name}'


# ---------------------------------------------------------------------------
# Data management
# ---------------------------------------------------------------------------

class SyncRun(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('RUNNING', 'Running'),
        ('DONE', 'Done'), ('FAILED', 'Failed'),
    ]
    source = models.CharField(max_length=20, default='api', db_index=True)
    triggered_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='sync_runs')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='PENDING', db_index=True)
    rows_upserted = models.IntegerField(default=0)
    error_message = models.TextField(blank=True, default='')
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'SyncRun {self.id} {self.status} ({self.source})'


class UploadBatch(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('VALIDATING', 'Validating'), ('LOADED', 'Loaded'),
        ('FAILED', 'Failed'), ('ROLLED_BACK', 'Rolled back'),
    ]
    dashboard = models.CharField(max_length=24, db_index=True)
    file_name = models.CharField(max_length=260)
    stored_path = models.CharField(max_length=512, blank=True, default='')
    checksum_sha256 = models.CharField(max_length=64, unique=True)
    uploaded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name='upload_batches')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='PENDING', db_index=True)
    rows_read = models.IntegerField(default=0)
    rows_loaded = models.IntegerField(default=0)
    rows_rejected = models.IntegerField(default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'UploadBatch {self.id} {self.file_name} [{self.status}]'


class UploadRowError(models.Model):
    upload_batch = models.ForeignKey(UploadBatch, on_delete=models.CASCADE, related_name='row_errors')
    row_number = models.IntegerField()
    field_name = models.CharField(max_length=120, blank=True, default='')
    message = models.TextField()


# ---------------------------------------------------------------------------
# Sales facts
# ---------------------------------------------------------------------------

class BatchUnitCost(TimeStampedModel):
    batch = models.CharField(max_length=20, unique=True, db_index=True)
    cost = models.DecimalField(max_digits=18, decimal_places=2)
    qty_kg = models.DecimalField(max_digits=18, decimal_places=3)
    unit_cost_per_kg = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    orders = models.JSONField(default=list)        # list of SAP manufacturing order IDs
    costed = models.BooleanField(default=True)
    is_final = models.BooleanField(default=False, db_index=True)
    rule_version = models.CharField(max_length=40)  # sha1 fingerprint of cost-config; stale entries are ignored
    computed_at = models.DateTimeField()
    sync_run = models.ForeignKey(SyncRun, null=True, blank=True, on_delete=models.SET_NULL, related_name='batch_unit_costs')

    def __str__(self):
        return f'Batch {self.batch} unitCost={self.unit_cost_per_kg} final={self.is_final}'


class GoodsReceipt(models.Model):
    order_id = models.CharField(max_length=20, db_index=True)
    batch = models.CharField(max_length=20, db_index=True)
    material = models.ForeignKey(Material, on_delete=models.PROTECT, related_name='goods_receipts')
    qty_kg = models.DecimalField(max_digits=18, decimal_places=3)
    unit = models.CharField(max_length=4)
    posting_date = models.DateField(db_index=True)
    is_cancelled = models.BooleanField(default=False)
    sync_run = models.ForeignKey(SyncRun, null=True, blank=True, on_delete=models.SET_NULL, related_name='goods_receipts')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['order_id', 'batch', 'posting_date', 'is_cancelled'],
                name='uniq_goods_receipt',
            ),
        ]
        indexes = [
            models.Index(fields=['batch', 'is_cancelled']),
        ]


class OrderJournalLine(models.Model):
    order_id = models.CharField(max_length=20, db_index=True)
    accounting_document = models.CharField(max_length=20)
    gl_account = models.CharField(max_length=10, db_index=True)
    ledger = models.CharField(max_length=4)
    company_code = models.CharField(max_length=4)
    amount_usd = models.DecimalField(max_digits=18, decimal_places=2)  # signed: debit positive, credit negative
    qty = models.DecimalField(max_digits=18, decimal_places=3, default=0)
    posting_date = models.DateField(db_index=True)
    overhead_source = models.CharField(max_length=20, blank=True, default='')  # e.g. '10101303/Z1' or '10101303/Z2'
    cost_bucket = models.CharField(max_length=20, blank=True, default='')      # materials/activities/overhead/pairedOffset
    sync_run = models.ForeignKey(SyncRun, null=True, blank=True, on_delete=models.SET_NULL, related_name='order_journal_lines')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['order_id', 'accounting_document', 'gl_account', 'posting_date'],
                name='uniq_order_journal_line',
            ),
        ]
        indexes = [
            models.Index(fields=['order_id', 'cost_bucket']),
        ]


class BillingLine(models.Model):
    COST_STATUS = [
        ('final', 'Final'),
        ('provisional', 'Provisional'),
        ('assumed-zero', 'Assumed zero'),
        ('not-costed', 'Not costed'),
    ]
    SOURCE = [('api', 'SAP API'), ('spreadsheet', 'Spreadsheet')]

    billing_document = models.CharField(max_length=16, db_index=True)
    billing_item = models.CharField(max_length=6, blank=True, default='')
    billing_date = models.DateField(db_index=True)
    posting_date = models.DateField(db_index=True)
    period = models.CharField(max_length=7, db_index=True)   # MM.YYYY
    billing_type = models.CharField(max_length=4, blank=True, default='')
    material = models.ForeignKey(Material, on_delete=models.PROTECT, related_name='billing_lines', db_index=True)
    customer = models.ForeignKey(Customer, null=True, blank=True, on_delete=models.PROTECT, related_name='billing_lines', db_index=True)
    batch = models.CharField(max_length=20, blank=True, default='', db_index=True)
    qty_kg = models.DecimalField(max_digits=18, decimal_places=3, null=True, blank=True)
    qty_mt = models.DecimalField(max_digits=18, decimal_places=3, null=True, blank=True)
    base_unit = models.CharField(max_length=4, blank=True, default='')
    qty_derived = models.BooleanField(default=False)       # True when qty comes from volume extract (spreadsheet), not the line itself
    revenue_usd = models.DecimalField(max_digits=18, decimal_places=2)
    transaction_currency = models.CharField(max_length=3, blank=True, default='')
    cogm_usd = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    cm_usd = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    cm_pct = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    cost_status = models.CharField(max_length=16, choices=COST_STATUS, default='not-costed', db_index=True)
    cost_reason = models.TextField(blank=True, default='')
    batch_unit_cost = models.ForeignKey(BatchUnitCost, null=True, blank=True, on_delete=models.SET_NULL, related_name='billing_lines')
    upload_batch = models.ForeignKey(UploadBatch, null=True, blank=True, on_delete=models.SET_NULL, related_name='billing_lines')
    sync_run = models.ForeignKey(SyncRun, null=True, blank=True, on_delete=models.SET_NULL, related_name='billing_lines')
    source = models.CharField(max_length=12, choices=SOURCE, default='api', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['billing_document', 'billing_item', 'source'],
                name='uniq_billing_line',
            ),
        ]
        indexes = [
            models.Index(fields=['period', 'source']),
            models.Index(fields=['material', 'period']),
            models.Index(fields=['customer', 'period']),
            models.Index(fields=['batch', 'source']),
        ]

    def __str__(self):
        return f'{self.billing_document}/{self.billing_item} {self.period} {self.source}'


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditLog(models.Model):
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='audit_logs')
    action = models.CharField(max_length=40, db_index=True)
    entity_type = models.CharField(max_length=40, db_index=True)
    entity_id = models.CharField(max_length=36, blank=True, default='')
    before_state = models.JSONField(null=True, blank=True)
    after_state = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['actor', 'created_at']),
        ]

    def __str__(self):
        return f'{self.action} on {self.entity_type}:{self.entity_id} by {self.actor_id}'
