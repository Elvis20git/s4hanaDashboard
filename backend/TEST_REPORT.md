# AIF Analytics API — Test Report

**Date:** 2026-10-26  
**Django:** 5.2.18  
**Python:** 3.14  
**Database (tests):** SQLite in-memory (`:memory:`)  
**Database (production):** PostgreSQL 16 via psycopg v3

---

## How to run

```powershell
# From backend/
python manage.py test analytics --settings=aif_backend.settings_test

# With verbose output
python manage.py test analytics --settings=aif_backend.settings_test --verbosity=2

# With coverage
python -m coverage run --source=analytics --omit="analytics/migrations/*,analytics/tests*" ^
    manage.py test analytics --settings=aif_backend.settings_test -v 0
python -m coverage report
```

> `settings_test.py` swaps the database to SQLite in-memory so tests run independently
> of a live PostgreSQL server and cannot conflict with the running dev server.

---

## Summary

| Result  | Count |
|---------|------:|
| Passed  |   116 |
| Failed  |     0 |
| Errors  |     0 |
| **Total** | **116** |

**Duration:** 16.2 s

---

## Test files

### `tests.py` — 19 tests (pure unit, no DB)

| Class | Tests |
|-------|------:|
| `JsCompat` | 6 |
| `ProductGroup` | 2 |
| `CostRules` | 7 |
| `Aggregation` | 4 |

Covers: JavaScript-compatible rounding (`round2`, `to_fixed`, `intl_en_us`), OData date parsing,
product-group classification, Z1/Z2 overhead exclusion, batch cost apportionment, `make_is_final`
business rule, aggregation invariants (children sum to parent, CM %, credit-note reversal).

---

### `tests_auth.py` — 42 tests (DB: User, PasswordResetToken)

| Class | Tests |
|-------|------:|
| `AccessControl` | 11 |
| `LoginFlow` | 6 |
| `ForcedPasswordChange` | 2 |
| `PasswordReset` | 8 |
| `AdminApi` | 8 |
| `Seed` | 5 |
| `ChatEndpoint` (chat) | 1 |

Covers: role/dashboard permission matrix, CORS and `X-AIF-Client` header enforcement,
security headers, rate limiting (login and forgot-password), remember-me cookie, token
invalidation after password change, must-change-password flow, reset token/code hashing
and expiry, code brute-force lockout, admin CRUD and self-deactivation guard, last-superuser
guard, `seed_users` idempotency (keeps changed passwords, doesn't demote existing users),
legacy `users.json` import, chat endpoint context pass-through.

---

### `tests_chat.py` — 16 tests (pure unit)

| Class | Tests |
|-------|------:|
| `Formatting` | 2 |
| `Analysis` | 13 |

Covers: compact money formatting, price/volume/cost effects decomposition (200 random trials),
every chat intent returns the required rich shape with balanced bold markers, exact figures
matched against `aggregate()` output, month/year disambiguation, follow-up context chaining,
period comparison table, Q1 range, customer/product ranking rules, best/worst-month query,
validation-access gating, junk-context robustness.

---

### `tests_persist.py` — 39 tests (DB: all new models)  *(new — Phase 5)*

| Class | Tests |
|-------|------:|
| `MasterDataUpsert` | 7 |
| `BatchUnitCostUpsert` | 6 |
| `PersistApiDataset` | 5 |
| `PersistSpreadsheetDataset` | 3 |
| `LoadBillingLinesFromDb` | 9 |
| `StateDbRestore` | 4 |
| `BackfillFactsCommand` | 3 |
| `CreateSuperuserCommand` | 2 |

Covers:

**Master data** — `upsert_materials` / `upsert_customers`: idempotent creation, finished-good
flag derivation, `product_name` dict overrides inline name, empty-input returns empty map,
customer-less lines skipped.

**Batch unit costs** — `upsert_batch_unit_costs`: creates and returns map, idempotent second
call, `is_final=True` records are immutable (cannot be overwritten), non-final records accept
updated cost, `unit_cost_per_kg` derived correctly, empty list handled.

**API persist** — `persist_api_dataset`: correct counts returned, idempotent (no duplicate
`BillingLine` rows on second call), lines carry `source='api'`, `SyncRun` FK linked, lines
without a material FK are skipped.

**Spreadsheet persist** — `persist_spreadsheet_dataset`: lines carry `source='spreadsheet'`,
idempotent, the same `billing_document`/`billing_item` pair is stored as two separate rows when
it appears in both sources (the `uniq_billing_line` constraint includes `source`).

**DB reload** — `load_billing_lines_from_db`: returns `None` for an empty source, returns
a dict with all keys `aggregate()` expects (`lines`, `periods`, `asOf`, `from`, `builtAt`,
`counts`, `frozen`, `controls`, `orderCost`, `cogmAvailable`), `controls` is `None` and
`orderCost` is `{}` (not stored in DB — require a live refresh), periods sorted
chronologically (MM.YYYY key), counts match persisted data, line dict has all fields
`aggregate()` needs, `frozen` included for API source, `frozen` is empty for spreadsheet
source, `cogmAvailable` true only for API.

**State restore** — `_load_from_db`: populates `state['api']['data']` after persisting API
lines, populates `state['spreadsheet']['data']` after persisting spreadsheet lines, leaves
both `None` when no rows exist, data loaded from DB passes through `aggregate()` without
error and returns the correct revenue total.

**Management commands** — `backfill_facts`: API backfill from a fixture JSON creates lines,
is idempotent, creates a `SyncRun` record with `status='DONE'`. `createsuperuser`: creates
a `User` with `role='SUPERUSER'`, `is_data_steward=True`, all seven `DASHBOARD_KEYS`, and
does not store the plaintext password.

---

## Coverage

```
Name                                               Stmts   Miss  Cover
----------------------------------------------------------------------
analytics\auth\admin_views.py                        139     16    88%
analytics\auth\decorators.py                          46      0   100%
analytics\auth\mail.py                                16      0   100%
analytics\auth\middleware.py                          47      8    83%
analytics\auth\permissions.py                         26      2    92%
analytics\auth\ratelimit.py                           26      1    96%
analytics\auth\security.py                            65     10    85%
analytics\auth\services.py                            43      3    93%
analytics\auth\views.py                              134     11    92%
analytics\cost\engine.py                             163     22    87%
analytics\cost\rules.py                                7      0   100%
analytics\models.py                                  176      8    95%
analytics\persist.py                                 159     20    87%
analytics\pipeline\aggregate.py                      111     10    91%
analytics\pipeline\chat.py                           586     65    89%
analytics\productgroup.py                             20      1    95%
analytics\urls.py                                      4      0   100%
----------------------------------------------------------------------
TOTAL (all files)                                   2827    790    72%
```

### Not covered — by design

| File | Cover | Reason |
|------|------:|-------|
| `management/commands/backfill_cache.py` | 0% | Requires `cache/batch-unit-cost.json` produced by a live SAP pull — never exists in CI |
| `pipeline/spreadsheet.py` | 11% | Requires real `.xlsx` files — parsing logic only runs on actual spreadsheet uploads |
| `pipeline/modetail.py` | 12% | Batch/order drill-down — needs live SAP or a captured fixture snapshot |
| `state.py` | 23% | `warm_up()` SAP branch and fixture-mode branch not exercised without a live SAP config |
| `views.py` | 40% | `/api/batch/<id>`, `/api/order/<id>`, `/api/connection-test`, `/api/export/validation.csv` need live API data or a fixture dataset |

The uncovered paths are all gated on external data (SAP OData, Excel files, frozen dataset
JSON) that cannot be present in a unit-test environment. They are exercised in integration
and manual testing against the real SAP back-end.

---

## Key assertions validated by the test suite

| Invariant | Test(s) |
|-----------|---------|
| `is_final=True` batch cost is **never overwritten** | `BatchUnitCostUpsert.test_final_batch_cost_is_immutable` |
| Same billing doc+item persisted separately per source (API vs spreadsheet) | `PersistSpreadsheetDataset.test_same_doc_and_item_stored_separately_per_source` |
| DB-loaded data satisfies `aggregate()` without modification | `StateDbRestore.test_api_data_from_db_is_usable_by_aggregate` |
| `controls` and `orderCost` always `None`/`{}` from DB | `LoadBillingLinesFromDb.test_controls_is_none_and_order_cost_is_empty` |
| Z1 overhead excluded from variable cost; Z2 included | `CostRules.test_only_z2_counts_the_higher_rate_line_is_z1` |
| Aggregation children always sum to parent | `Aggregation.test_children_sum_to_parent` |
| Last active superuser cannot be deactivated or demoted | `AdminApi.test_lockout_guards` |
| Password never stored in plaintext | `CreateSuperuserCommand.test_password_not_stored_in_plaintext` |
| API contract unchanged: status codes, response shapes, error messages | All `tests_auth.*` HTTP tests |
