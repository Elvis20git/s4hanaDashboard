# AIF Analytics API — Django backend

The API behind the React front end: SAP S/4HANA OData client, cost engine, aggregation for every card, chart and drill-down, sign-in and user
administration. It serves JSON under `/api` on port 5180 (the Vite dev server proxies `/api` to it). Formulas and rules: [`../docs/DASHBOARD_CALCULATION_SPEC.md`](../docs/DASHBOARD_CALCULATION_SPEC.md).

## Sign-in, roles and administration

Every route needs a signed-in user (httpOnly cookie session, Argon2id passwords, 8 h or 7 d "remember" tokens). One-time setup:

```bash
pip install -r backend/requirements.txt
python backend/manage.py migrate
python backend/manage.py seed_users        # imports the old users.json users, then upserts backend/seed/users.local.json (git-ignored)
```

Seeded users (`derrick-a`, `eric-a`, `elvis2-a`, all SUPERUSER + data steward) start with a weak initial password and **must change it at first
sign-in** (the API returns `PASSWORD_CHANGE_REQUIRED` for every other endpoint until they do). Re-running the seed is safe: it updates records in
place, never removes or demotes anyone and never reverts a password the user already changed (`--reset-passwords` forces it). With
`DJANGO_DEBUG=0` weak seed passwords are refused unless `ALLOW_WEAK_SEED=true`. Copy `backend/seed/users.example.json` for the file's shape.

| | |
|---|---|
| Roles | `SUPERUSER` (all 7 dashboards + Administration), `ANALYST` (allowed dashboards, may export), `VIEWER` (allowed dashboards, no export). *Data steward* is a flag, not a role: it gates refresh / spreadsheet upload. |
| Dashboard keys | `sales, production, ar_ap_aging, inventory, goods_in_transit, tax, data_management` (`analytics/auth/permissions.py`, mirrored in `src/auth/permissions.js`) |
| Enforcement | `analytics/auth/decorators.py::guard(...)` on every route: loads the user on each request (deactivation / revocation apply immediately), checks dashboard, role, steward and export rights. |
| Endpoints | `POST /api/auth/login · GET /api/auth/me · POST /api/auth/logout · POST /api/auth/change-password · POST /api/auth/forgot-password · POST /api/auth/reset-password` and, SUPERUSER only, `GET/POST /api/admin/users · PUT/DELETE /api/admin/users/<id> · POST …/activate · POST …/reset-password` |
| Password reset | Email with a link (`APP_URL/reset-password?token=…`) and a 6-digit code, valid 15 min, single use, stored as SHA-256 hashes. With no `SMTP_HOST` in development the message is printed to the server console. |
| Tests | `npm run test:api` (58 tests incl. the access matrix, lockout guards, reset flow and seeding) |

## Run

```bash
pip install -r backend/requirements.txt        # Django 5, openpyxl, argon2-cffi, PyJWT
npm run dev                                    # from the repository root: Django on :5180 + Vite on :5174
npm run dev:api                                # the API alone
npm run test:api                               # unit tests (python backend/manage.py test analytics)
```

On start-up the API warms both sources in a background thread: the spreadsheet source, then SAP (connection check + a full dataset
build, about 35 s the first time while batch costs are computed). `/api/status` reports progress; `/api/data` answers 503 until the
dataset exists.

## Configuration

`backend/config/.env` (git-ignored; copy `config/.env.example`); `AIF_ENV_FILE=<path>` overrides it. Variables: `SAP_HOST`, `SAP_USER`, `SAP_PASS`, `COMPANY_CODE`, `SALES_ORG`, `LEDGER`,
`PERIOD_FROM`, `REPORT_TO`, `OVERHEAD_GL`, `BATCH_CHUNK`. Cost rules: `config/sources.json`; users and rights: `config/users.json`.
Other environment variables: `AIF_FIXTURE_DATASET` / `AIF_FIXTURE_DIR` (test mode: load a saved dataset, serve batch/order snapshots, no SAP),
`AIF_SPREADSHEET_DIR` (where the two spreadsheet extracts are looked up; default `backend/data/`), `AIF_NO_WARMUP=1`.

Written at run time (git-ignored): `cache/batch-unit-cost.json` (frozen batch unit costs, stamped with a fingerprint of the
cost rules: change the rules and the cache is discarded) and `validation/dataset.json` (the last built dataset).

## Layout

| Path | Role |
|---|---|
| `analytics/sap.py` | read-only OData v2 client (GET only) |
| `analytics/pipeline/build.py` | billing → ledger join → batches → order cost → COGM → controls |
| `analytics/cost/{engine,cache,rules}.py` | VC engine (materials + activities + Utilities Z2 + paired offset; Z1 excluded), frozen cost cache |
| `analytics/pipeline/aggregate.py` | every card / table / chart / drill figure |
| `analytics/pipeline/{controls,modetail,chat,spreadsheet}.py` | validation controls, order/batch drill-down, rule-based chat, spreadsheet source |
| `analytics/views.py`, `urls.py` | HTTP API; every route is wrapped by `auth/decorators.py::guard` |
| `analytics/state.py`, `apps.py` | in-memory datasets, start-up load (SAP build in a background thread) |
| `analytics/auth/` | sign-in, password reset, roles and dashboard permissions, administration API |
| `analytics/jsutil.py` | reproduces JavaScript `Math.round`, `toFixed`, `Intl` and date semantics so the figures match what the front end displays |
| `analytics/tests.py`, `tests_auth.py` | 58 tests: number helpers, cost rules, aggregation invariants, access matrix, reset flow, seeding |

## Testing

`npm run test:api` (from the repository root) runs the 58 Python tests. They cover the JavaScript-compatible number helpers, the Finished-Goods rule,
the VC rules (cost buckets, Z1/Z2 overhead identification, apportionment, credit notes), the aggregation invariants (children sum to the parent,
Finished-Goods CM %), and the whole authentication and authorisation matrix. The figures themselves are specified in
[`../docs/DASHBOARD_CALCULATION_SPEC.md`](../docs/DASHBOARD_CALCULATION_SPEC.md), which cites this code line by line.
