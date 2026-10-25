"""The permission model — the single source of truth for dashboard keys, roles and presets. The front end mirrors this in
src/auth/permissions.js; no other file spells these strings out."""

# exactly 7 grantable dashboards (Administration is never grantable)
SALES, PRODUCTION, AR_AP_AGING, INVENTORY, GOODS_IN_TRANSIT, TAX, DATA_MANAGEMENT = (
    'sales', 'production', 'ar_ap_aging', 'inventory', 'goods_in_transit', 'tax', 'data_management')

DASHBOARDS = [
    (SALES, 'Sales'), (PRODUCTION, 'Production'), (AR_AP_AGING, 'AR & AP aging'), (INVENTORY, 'Inventory'),
    (GOODS_IN_TRANSIT, 'Goods in transit'), (TAX, 'Tax'), (DATA_MANAGEMENT, 'Data Mgmt'),
]
DASHBOARD_KEYS = [k for k, _ in DASHBOARDS]

PRESETS = {
    'finance': [SALES, AR_AP_AGING, TAX],
    'operations': [PRODUCTION, INVENTORY, GOODS_IN_TRANSIT],
}

SUPERUSER, ANALYST, VIEWER = 'SUPERUSER', 'ANALYST', 'VIEWER'
ROLES = [SUPERUSER, ANALYST, VIEWER]
ACTIVE, INACTIVE = 'ACTIVE', 'INACTIVE'


def clean_dashboards(values):
    """Validate against the 7 keys and de-duplicate, keeping order. Raises ValueError on an unknown key."""
    if values is None:
        return []
    if not isinstance(values, (list, tuple)):
        raise ValueError('allowed_dashboards must be a list')
    bad = [v for v in values if v not in DASHBOARD_KEYS]
    if bad:
        raise ValueError(f"Unknown dashboard(s): {', '.join(map(str, bad))}")
    return list(dict.fromkeys(values))


def effective_dashboards(user):
    """What a user can open: every dashboard for a SUPERUSER (allowed_dashboards is ignored), else the validated list."""
    if user.role == SUPERUSER:
        return list(DASHBOARD_KEYS)
    return [d for d in dict.fromkeys(user.allowed_dashboards or []) if d in DASHBOARD_KEYS]


def can_view(user, key):
    return user.role == SUPERUSER or key in effective_dashboards(user)


def can_export(user):
    return user.role in (SUPERUSER, ANALYST)          # VIEWER is view-only


def can_modify_data(user):
    return user.role == SUPERUSER or bool(user.is_data_steward)
