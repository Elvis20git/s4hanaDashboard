# PROMPT — BACKEND (Django API) · bring production to the reference version of 2026-11-06

You are a senior engineer updating the **production backend** of "AIF Analytics" (Django, `backend/`, SAP S/4HANA Public Cloud OData, read-only) so it matches our reference version exactly. Do the work below, then run the verification checklist and report any difference. Do not change anything in SAP: every SAP call stays a read-only GET.

## 1. Why (the bug being fixed)
The dashboard stopped at September 2026 although October was closed. Root cause: `REPORT_TO=2026-09-30` was a **stored, hard-coded end date** in `backend/config/.env`. `pipeline/build.py` used it as the upper bound of the billing query, and `state.cap_to_report_window` clipped data to it. Refresh only re-ran the same window, so the "last refresh" time moved while the end date never did. There was no concept of a closed period anywhere in the app.

## 2. What the reference version does (implement all of it)

### 2.1 One shared helper decides period status — `analytics/periods.py` (new)
- Single source of truth for "closed / open / loaded / included". The build, refresh, `/api/periods`, the Periods panel and the "Data through" pill all use it so they cannot disagree.
- **Closed** is decided, in priority order, by: (1) manual override saved from the UI (`backend/config/period_overrides.json`, with who/when); (2) `.env` lists `PERIOD_CLOSED` / `PERIOD_OPEN` (comma-separated `YYYY-MM`; `PERIOD_OPEN` wins); (3) calendar rule — a month is Closed once the current **Africa/Kigali (UTC+2, no DST)** month is past it. SAP posting-period status is NOT available to the communication user (service catalog and ~17 period-control services return 403), so this is an interim rule; the helper accepts a `provider(ym) -> (status, source)` hook so a real SAP feed can replace it later.
- `effective_cfg(CFG)` merges the saved overrides over the `.env` lists; every caller that decides closed/open must pass it.
- `window_end(frm, now, cfg)` = last day of the latest closed period. **It is derived on every build, never stored.**
- `get_period_statuses(lines=, frm=, now=, cfg=, controls=, frozen=, loaded_at=, errors=, provider=)` returns `{rows, summary, windowEnd}`; one row per month from `PERIOD_FROM` to the current Kigali month. Row fields: `period` (`YYYY-MM`), `code` (`MM.YYYY`), `label` ("Oct 2026"), `closeStatus` (Closed/Open/Unknown), `closeSource` (`manual|config|calendar`), `loaded` (Yes/No/Partial), `rows`, `revenue`, `breaches{batch,order,quantity}`, `breachCount`, `lastLoaded`, `error`, `badge` (green/amber/grey/red), `included` (Yes/No), `reason`.
  - badge: green = closed & loaded; amber = closed with closure-control breaches, or partial (load error, or lines without a billing-item match) — **still included** (existing convention: load it, flag it); grey = open/unknown (excluded); red = closed but not loaded / load failed.
  - A batch/quantity breach belongs to every period that sold that batch; an order breach to every period that sold a batch the order fed.
  - `summary.text` example: `Included: Jul 2025 – Oct 2026 · 16 closed periods · 1 open (Nov 2026)`.

### 2.2 Window end replaces `REPORT_TO`
- `pipeline/build.py`: `as_of = as_of or window_end(PERIOD_FROM, cfg=effective_cfg(CFG))`; raise if nothing is closed. `_today()` now uses Kigali time (also drives `closure_as_of`). If `REPORT_TO` is still set, log a note that it is ignored.
- `state.cap_to_report_window` clips to the same derived window (so a spreadsheet source cannot show an open month).
- Remove `REPORT_TO` from `.env` and `.env.example`. Start date `PERIOD_FROM=2025-07-01` was not stale — keep.

### 2.3 Extraction per month, concurrent or one by one
- `build._extract_sales()` fetches billing headers + items **per month** and the revenue ledger once, as separate tasks. `LOAD_MODE=concurrent` (default) runs them in a `ThreadPoolExecutor` (`LOAD_WORKERS`, default 4); `sequential` runs them in calendar order. Results are gathered in month order, so **both modes return identical data**. Only reads from SAP are parallelised; the cost side (batches/orders/freeze/controls) spans months and runs once afterwards. **No calculation logic changed** (FG/Other split, VC = Direct Materials + Utilities (Z2), Overheads (Z1) excluded, CM, rounding).
- `build(..., mode=None, workers=None, progress=None)` calls `progress(kind, key, status)` with kind `period|journal|phase`, status `loading|done|error` (phase `costing`).

### 2.4 Non-blocking loading with progress (`state.py`)
- One loader at a time (`_refresh_lock`). `start_refresh(mode, reason)` returns immediately and runs the load in a background thread; `refresh_api(mode, reason)` is the blocking variant (start-up, tests, scripts).
- `state['api']` gains `warming`, `progress` (`phase extracting|costing|done|error`, `mode`, `reason`, `startedAt`, `finishedAt`, `total`, `done`, `journal`, `periods{ym: pending|loading|done|error}`), `fromCache`, `cachedAt`, `periodLoadedAt`, `periodErrors`.
- On success: store data, record `periodLoadedAt` for every loaded month, write `validation/dataset.json` (as before) **and** the disk cache. On failure: keep the previous data, set `error`, and record the error against every closed period.

### 2.5 First-load disk cache — `analytics/datacache.py` (new) + `warm_up()`
- Writes `backend/cache/dataset-cache.json` atomically (temp file + `os.replace`). Ignored if company/sales org/ledger/start date or `RULE_VERSION` differ (never trusted blindly).
- `warm_up()` (background thread, started in `apps.ready`, which also sets `warming=True` so the UI shows "Loading data…" from the first request): load spreadsheets; open the cached dataset instantly if valid; check SAP connection; **only if there is no cache, or a month has closed since the cache was saved, run a load** (reason `startup` / `startup: newly closed …`). Otherwise read nothing from SAP until a user presses Refresh. If SAP is unreachable but a cache exists, serve the cache.
- Known caveat to accept: a month that closes while the server is already running is not picked up until someone presses Refresh (the Periods panel shows it red "closed but not loaded", so it is visible, not silent).

### 2.6 API (all under `/api`, JSON)
- `GET /api/status` — `sources.api` additionally returns `warming`, `progress`, `fromCache`, `cachedAt`, `loadMode`. (`periodTo` = derived window end, so the Reporting-source line reads e.g. `2025-07-01 → 2026-10-31`.)
- `GET /api/periods?source=api|spreadsheet` (dashboard `sales`) → `{source, rows[], summary, windowEnd}`; each row also has `override: {status, by, at} | null`. Non-Data-Management users get `error` stripped.
- `POST /api/periods/<YYYY-MM>/reload` (data_management + steward) — re-extract. Honest limit: batch cost links across months, so this re-extracts the whole live window and re-evaluates every status; it reports the requested month. 404 outside the window, 409 if the month is not closed.
- `POST /api/periods/<YYYY-MM>/status` body `{"status":"Closed"|"Open"|"auto"}` (data_management + steward) — saves the manual override with the username, then reloads so the window follows. Refuses (409) a change that would leave **no** closed period. This only changes the app; nothing is written to SAP.
- `POST /api/refresh` — unchanged default (synchronous, so existing callers/tests still work).
- The three POSTs above accept optional `{"async": true, "mode": "concurrent"|"sequential"}`; with `async` they return at once `{ok, started, running}` and the client follows `/api/status`.

### 2.7 Controls
- `pipeline/controls.py` REGRESSION target for `10.2026` changed from the 15-Oct snapshot (19 lines, 728,937.90) to the 6-Nov-2026 snapshot **[2,008,956.72, 73 lines]**. **Confirm this figure with finance on the production data before keeping it** (it was set from our own build output on request).

## 3. Apply the change
Preferred: apply the patch in Appendix A, then add the new files in Appendix B verbatim (`git apply --whitespace=nowarn backend.patch`). Files are CRLF on our Windows machines; line endings do not matter. If the production tree has diverged, port the changes by hand following section 2 — the patch is the exact reference.

## 4. Production configuration & deployment notes
- `backend/config/.env`: delete `REPORT_TO`; add `LOAD_MODE=concurrent`, `LOAD_WORKERS=4`; optionally `PERIOD_CLOSED=2026-10` (explicit statement that October is closed). Keep `PERIOD_FROM=2025-07-01`.
- The app process must be able to **write** `backend/cache/` and `backend/config/period_overrides.json` (git-ignored; both are runtime files).
- **State is in-process memory.** Run a single worker process (or one process owning the loader). With several gunicorn workers each would run its own warm-up/load and see different progress and statuses. If multiple workers are unavoidable, tell us — the loader would need a shared lock.
- Warm-up runs in a background thread; the API answers immediately (401/data 503 until data exists) while the first load runs (~35 s concurrent vs ~70 s one-by-one on our data).
- After deploy: restart, wait for the first load to finish, then press Refresh once so the dataset is built by the production code.

## 5. Verification checklist (report actual vs expected)
1. `python backend/manage.py test analytics` → all pass (reference: **97 tests**; new files `tests_periods.py`, `tests_loading.py`).
2. Logs: first start prints `SAP connection OK — first load, building live dataset…` then `live dataset ready (cached for next start)`; a second start prints `live dataset opened from cache … — no SAP read until Refresh` within ~1 s.
3. `GET /api/status` → `sources.api.periodTo` = `2026-10-31` (or the last day of the latest closed month in prod).
4. `GET /api/periods` → 16+ rows from Jul 2025; Oct 2026 `Closed/Yes/green`, current month `Open/grey/excluded`; summary `Included: Jul 2025 – Oct 2026 · 16 closed periods · 1 open (Nov 2026)` (when today is in Nov 2026).
5. Reference October 2026 figures (our data, 6 Nov 2026): lines 73, revenue 2,008,956.72, B2B/B2C (FG) 1,998,247.25, Other 10,709.47, VC 1,391,048.11, CM 617,908.61 (30.76 %), QTY 1,365.65 MT. Sep 2026: 106 lines, 2,725,630.53, VC 1,931,822.14, CM 793,808.39. Totals must tie across periods, products and customers. Differences mean prod data differs — report them, do not "fix" them.
6. Concurrent and one-by-one loads produce identical `lines` (compare sorted JSON); concurrent is roughly 2x faster.
7. `POST /api/periods/2026-10/status {"status":"Open"}` then `{"status":"auto"}` as a steward: window shrinks to Sep then returns; the last remaining closed period cannot be opened (409).
8. Confirm no write to SAP: `sap.py` still issues GET only.

---
# APPENDIX A — patch for modified files (`git diff` against our previous commit)
```diff
diff --git a/backend/.gitignore b/backend/.gitignore
index 2b4ff59..b69a5a3 100644
--- a/backend/.gitignore
+++ b/backend/.gitignore
@@ -7,3 +7,4 @@ seed/users.local.json
 db.sqlite3
 .jwt_secret.local
 config/Live API and Credentials.txt
+config/period_overrides.json
diff --git a/backend/analytics/apps.py b/backend/analytics/apps.py
index 12b3147..50415f7 100644
--- a/backend/analytics/apps.py
+++ b/backend/analytics/apps.py
@@ -24,4 +24,6 @@ class AnalyticsConfig(AppConfig):
     def ready(self):
         if _should_warm_up():
             from .state import warm_up
+            from .state import state
+            state['api']['warming'] = True          # the UI shows "Loading data…" from the first request, before the thread has begun
             threading.Thread(target=warm_up, name='aif-warm-up', daemon=True).start()
diff --git a/backend/analytics/config.py b/backend/analytics/config.py
index 61c73d6..f2b1813 100644
--- a/backend/analytics/config.py
+++ b/backend/analytics/config.py
@@ -34,7 +34,7 @@ def load_env(path):
 FIXTURE_DATASET = Path(os.environ['AIF_FIXTURE_DATASET']).resolve() if os.environ.get('AIF_FIXTURE_DATASET') else None
 FIXTURE_DIR = Path(os.environ['AIF_FIXTURE_DIR']).resolve() if os.environ.get('AIF_FIXTURE_DIR') else None
 
-_SCOPE_KEYS = ['PORT', 'REPORT_TO', 'COMPANY_CODE', 'SALES_ORG', 'LEDGER', 'PERIOD_FROM', 'OVERHEAD_GL', 'BATCH_CHUNK']
+_SCOPE_KEYS = ['PORT', 'PERIOD_CLOSED', 'PERIOD_OPEN', 'LOAD_MODE', 'LOAD_WORKERS', 'COMPANY_CODE', 'SALES_ORG', 'LEDGER', 'PERIOD_FROM', 'OVERHEAD_GL', 'BATCH_CHUNK']
 
 
 def _find_env():
diff --git a/backend/analytics/pipeline/build.py b/backend/analytics/pipeline/build.py
index ee09240..8e787f1 100644
--- a/backend/analytics/pipeline/build.py
+++ b/backend/analytics/pipeline/build.py
@@ -1,6 +1,7 @@
 """Full pipeline: billing -> revenue (USD) -> batches -> order cost -> frozen unit cost -> COGM per (line,batch) -> contribution margin
 -> controls. Every join to delivery, batch or order is a LEFT join (rule 1 — completeness)."""
 import time
+from concurrent.futures import ThreadPoolExecutor
 from datetime import datetime, timezone
 
 from .. import sap
@@ -8,40 +9,98 @@ from ..config import CFG
 from ..cost import cache
 from ..cost.engine import (apportion, cost_lines, freeze_unit_costs, make_is_final, order_costs, round2)
 from ..jsutil import js_round, num, odata_date, to_fixed
+from ..periods import effective_cfg, kigali_today, last_day, month_range, window_end
 from .controls import run_controls
 
 KG_PER_MT = 1000
 
 
 def _today():
-    return datetime.now(timezone.utc).strftime('%Y-%m-%d')
+    return kigali_today()      # Africa/Kigali (UTC+2): "today" and month boundaries are the business's, not UTC's
 
 
 def _period(d):
     return d[5:7] + '.' + d[0:4]
 
 
-def build(as_of=None, closure_as_of=None, log=None):
-    """`as_of` is the reporting cutoff: the upper bound on BillingDocumentDate, i.e. what the dashboard actually shows. Capping it
-    (via config REPORT_TO) removes a period from the dashboard completely — it is never fetched, not merely filtered client-side.
+def _extract_sales(frm, as_of, chunk, mode, workers, log, progress):
+    """Stages 1, 1b and 1c — everything read from SAP for the sales side — one task per closed month plus one for the revenue ledger.
+    `mode` 'concurrent' runs the tasks in a small thread pool (every call is a read-only GET); 'sequential' runs them one by one, in
+    order. Both return the same data: results are gathered in month order, so downstream joins see the same sequence either way.
+    The cost side (batches, orders) is NOT here — it spans months and runs once afterwards over all lines."""
+    months = [(ym, max(frm, ym + '-01'), min(as_of, last_day(ym))) for ym in month_range(frm, as_of)]
+
+    def month_task(ym, start, end):
+        progress('period', ym, 'loading')
+        try:
+            hdrs_all = sap.get_all('billing', 'A_BillingDocument', {
+                '$filter': f"SalesOrganization eq '{CFG['SALES_ORG']}' and CompanyCode eq '{CFG['COMPANY_CODE']}'"
+                           f" and BillingDocumentDate ge datetime'{start}T00:00:00'"
+                           f" and BillingDocumentDate le datetime'{end}T00:00:00'",
+                '$select': 'BillingDocument,BillingDocumentDate,BillingDocumentType,BillingDocumentIsCancelled,'
+                           'CancelledBillingDocument,SoldToParty,AccountingDocument,FiscalYear,CompanyCode,'
+                           'AccountingPostingStatus,TransactionCurrency',
+            }, page=5000)
+            posted = [h for h in hdrs_all if h.get('AccountingPostingStatus') == 'C']
+            items_all = sap.get_by_keys('billing', 'A_BillingDocumentItem', 'BillingDocument', [h['BillingDocument'] for h in posted],
+                                        chunk=chunk, params={
+                '$select': 'BillingDocument,BillingDocumentItem,Material,Batch,Plant,BillingQuantity,'
+                           'BillingQuantityUnit,BillingQuantityInBaseUnit,BaseUnit,NetAmount,TransactionCurrency,'
+                           'ReferenceSDDocument,ReferenceSDDocumentItem,SalesDocument'})
+        except Exception:
+            progress('period', ym, 'error')
+            raise
+        progress('period', ym, 'done')
+        return hdrs_all, items_all
+
+    def journal_task():
+        progress('journal', '', 'loading')
+        try:
+            rows = sap.get_all('journal', 'YY1_AIF_JOURNAL_REV', {
+                '$filter': f"Ledger eq '{CFG['LEDGER']}' and CompanyCode eq '{CFG['COMPANY_CODE']}' and startswith(GLAccount,'41')",
+            }, page=5000)
+        except Exception:
+            progress('journal', '', 'error')
+            raise
+        progress('journal', '', 'done')
+        return rows
+
+    tasks = [journal_task] + [(lambda m=m: month_task(*m)) for m in months]       # the ledger first: it is the longest single read
+    log(f"extracting {len(months)} period(s) {'concurrently, up to ' + str(workers) + ' at a time' if mode == 'concurrent' else 'one by one'}")
+    if mode == 'sequential':
+        results = [t() for t in tasks]
+    else:
+        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
+            futures = [ex.submit(t) for t in tasks]
+            results = [f.result() for f in futures]
+    jrev_all = results[0]
+    hdrs_all = [h for r in results[1:] for h in r[0]]
+    items_all = [i for r in results[1:] for i in r[1]]
+    return hdrs_all, items_all, jrev_all
+
+
+def build(as_of=None, closure_as_of=None, log=None, mode=None, workers=None, progress=None):
+    """`as_of` is the reporting cutoff: the upper bound on BillingDocumentDate, i.e. what the dashboard actually shows. It is DERIVED on
+    every build — the last day of the latest closed period (periods.window_end: config override, else the Kigali calendar rule) — so an
+    open month is never fetched and a newly closed month is picked up by the next refresh. There is no stored end date.
     `closure_as_of` is the REAL current date, used only to decide whether a batch's feeding orders are still open."""
-    as_of = as_of or CFG.get('REPORT_TO') or _today()
-    closure_as_of = closure_as_of or _today()
     log = log or (lambda m: None)
     started = time.time()
     frm = CFG['PERIOD_FROM']
+    if CFG.get('REPORT_TO'):
+        log('NOTE: REPORT_TO is no longer used — the window end is derived from closed periods. Remove it from .env.')
+    as_of = as_of or window_end(frm, cfg=effective_cfg(CFG))
+    if not as_of:
+        raise RuntimeError(f'No closed period on or after {frm} — nothing to report yet.')
+    closure_as_of = closure_as_of or _today()
     chunk = int(CFG.get('BATCH_CHUNK') or 50)
     log(f'scope {frm} .. {as_of}' + (f' (period-closure evaluated as of {closure_as_of})' if closure_as_of != as_of else ''))
 
-    # ---------- Stage 1: billing documents in scope ----------
-    hdrs_all = sap.get_all('billing', 'A_BillingDocument', {
-        '$filter': f"SalesOrganization eq '{CFG['SALES_ORG']}' and CompanyCode eq '{CFG['COMPANY_CODE']}'"
-                   f" and BillingDocumentDate ge datetime'{frm}T00:00:00'"
-                   f" and BillingDocumentDate le datetime'{as_of}T00:00:00'",
-        '$select': 'BillingDocument,BillingDocumentDate,BillingDocumentType,BillingDocumentIsCancelled,'
-                   'CancelledBillingDocument,SoldToParty,AccountingDocument,FiscalYear,CompanyCode,'
-                   'AccountingPostingStatus,TransactionCurrency',
-    }, page=5000)
+    # ---------- Stage 1 / 1b / 1c: billing documents, their items and the revenue ledger — per month, in the chosen mode ----------
+    mode = mode or CFG.get('LOAD_MODE') or 'concurrent'
+    workers = workers or int(CFG.get('LOAD_WORKERS') or 4)
+    progress = progress or (lambda kind, key, status: None)
+    hdrs_all, items_all, jrev_all = _extract_sales(frm, as_of, chunk, mode, workers, log, progress)
     hdrs = [h for h in hdrs_all if h.get('AccountingPostingStatus') == 'C']
     log(f'billing documents: {len(hdrs_all)} retrieved, {len(hdrs)} posted to accounting')
 
@@ -51,12 +110,7 @@ def build(as_of=None, closure_as_of=None, log=None):
     by_acct = {acct_key(h): h for h in hdrs}
     by_doc = {h['BillingDocument']: h for h in hdrs}
 
-    # ---------- Stage 1b: billing items (these carry the batch split) ----------
-    items_all = sap.get_by_keys('billing', 'A_BillingDocumentItem', 'BillingDocument', [h['BillingDocument'] for h in hdrs],
-                                chunk=chunk, params={
-        '$select': 'BillingDocument,BillingDocumentItem,Material,Batch,Plant,BillingQuantity,'
-                   'BillingQuantityUnit,BillingQuantityInBaseUnit,BaseUnit,NetAmount,TransactionCurrency,'
-                   'ReferenceSDDocument,ReferenceSDDocumentItem,SalesDocument'})
+    # ---------- billing items (these carry the batch split) ----------
     # Split parents carry zero quantity AND zero value. They contribute nothing and would double-count the document if kept.
     items = [i for i in items_all if num(i.get('BillingQuantityInBaseUnit')) != 0 or num(i.get('NetAmount')) != 0]
     log(f'billing items: {len(items_all)} ({len(items_all) - len(items)} zero-value split parents set aside)')
@@ -81,9 +135,6 @@ def build(as_of=None, closure_as_of=None, log=None):
     # ---------- Stage 1c: revenue in GLOBAL CURRENCY from the ledger ----------
     # Revenue originates from the billing document set (rule 6). The ledger supplies the USD valuation because the billing API
     # exposes transaction currency only.
-    jrev_all = sap.get_all('journal', 'YY1_AIF_JOURNAL_REV', {
-        '$filter': f"Ledger eq '{CFG['LEDGER']}' and CompanyCode eq '{CFG['COMPANY_CODE']}' and startswith(GLAccount,'41')",
-    }, page=5000)
     jrev = []
     for r in jrev_all:
         d = odata_date(r.get('PostingDate'))
@@ -138,6 +189,7 @@ def build(as_of=None, closure_as_of=None, log=None):
         })
     log(f"lines assembled: {len(lines)} ({sum(1 for l in lines if not l['itemResolved'])} without a billing-item match)")
 
+    progress('phase', 'costing', 'running')
     # ---------- Stage 2: batches sold, and the orders behind them ----------
     sold_set = set(l['batch'] for l in lines if l['batch'])
     log(f'distinct batches sold: {len(sold_set)}')
diff --git a/backend/analytics/pipeline/controls.py b/backend/analytics/pipeline/controls.py
index bd26a9e..1d865a4 100644
--- a/backend/analytics/pipeline/controls.py
+++ b/backend/analytics/pipeline/controls.py
@@ -16,7 +16,7 @@ REGRESSION = {
     '01.2026': [816326.03, 31], '02.2026': [469566.78, 104], '03.2026': [2056492.74, 96],
     '04.2026': [1362331.79, 75], '05.2026': [1235940.20, 61], '06.2026': [1886271.46, 76],
     '07.2026': [1887630.70, 84], '08.2026': [1628675.64, 62], '09.2026': [2725630.53, 106],
-    '10.2026': [728937.90, 19],
+    '10.2026': [2008956.72, 73],   # snapshot 2026-11-06 (October closed); replaces the 15 Oct figure (19 lines, 728,937.90)
 }
 
 
diff --git a/backend/analytics/state.py b/backend/analytics/state.py
index 216b723..7f67ff5 100644
--- a/backend/analytics/state.py
+++ b/backend/analytics/state.py
@@ -7,15 +7,19 @@ from datetime import datetime, timezone
 from pathlib import Path
 
 from .config import BASE_DIR, CFG, FIXTURE_DATASET, VALIDATION_DIR, redact
+from . import datacache
+from .periods import _ym, effective_cfg, get_period_statuses, month_range, window_end
 from .pipeline.build import build
 from .pipeline.spreadsheet import build_from_files
 
 state = {
-    'api': {'data': None, 'error': None, 'lastRefresh': None, 'refreshing': False, 'log': []},
-    'spreadsheet': {'data': None, 'error': None, 'lastRefresh': None, 'loadHistory': []},
+    'api': {'data': None, 'error': None, 'lastRefresh': None, 'refreshing': False, 'warming': False, 'log': [], 'periodLoadedAt': {},
+            'periodErrors': {}, 'progress': None, 'fromCache': False, 'cachedAt': None},
+    'spreadsheet': {'data': None, 'error': None, 'lastRefresh': None, 'loadHistory': [], 'periodLoadedAt': {}, 'periodErrors': {}},
     'connection': {'ok': None, 'checkedAt': None, 'detail': None},
 }
 _refresh_lock = threading.Lock()
+_progress_lock = threading.Lock()
 
 # The two spreadsheet extracts warmed at start-up, looked up in AIF_SPREADSHEET_DIR, then backend/data/.
 DEFAULT_SPREADSHEETS = [
@@ -30,11 +34,13 @@ def iso_now():
 
 
 def cap_to_report_window(data):
-    """`REPORT_TO` removes a period from the dashboard completely, regardless of which source serves it. build() already applies it
-    inside the SAP query for the live API source, but a spreadsheet's full contents are read as given — this is the one place both
-    sources pass through before being stored, so a cutoff set here can never be bypassed by switching source."""
-    cutoff = CFG.get('REPORT_TO')
-    if not cutoff or not data or 'lines' not in data:
+    """The window end is derived (periods.window_end), never stored. build() applies it inside the SAP query for the live API source,
+    but a spreadsheet's full contents are read as given — this is the one place both sources pass through before being stored, so an
+    open month can never reach the dashboard by switching source."""
+    if not data or 'lines' not in data:
+        return data
+    cutoff = window_end(data.get('from') or CFG['PERIOD_FROM'], cfg=effective_cfg(CFG))
+    if not cutoff:
         return data
 
     def pkey(p):
@@ -58,25 +64,94 @@ def cap_to_report_window(data):
     return out
 
 
-def refresh_api():
+def period_statuses(src='api', now=None):
+    """The shared status of every month for a source — used by the Periods panel, the "Data through" popover and the refresh."""
+    s = state[src]
+    d = s['data'] or {}
+    frm = d.get('from') or CFG['PERIOD_FROM']
+    return get_period_statuses(lines=d.get('lines') or [], frm=frm, now=now, cfg=effective_cfg(CFG), controls=d.get('controls'), frozen=d.get('frozen'),
+                               loaded_at=s.get('periodLoadedAt'), errors=s.get('periodErrors'))
+
+
+def _scope_months():
+    frm = CFG['PERIOD_FROM']
+    end = window_end(frm, cfg=effective_cfg(CFG))
+    return month_range(frm, end[:7]) if end else []
+
+
+def _begin(mode, reason):
+    """Claim the single loader. Returns False if a load is already running (never two at once)."""
     api = state['api']
     if not _refresh_lock.acquire(blocking=False):
-        return api
+        return False
+    months = _scope_months()
+    mode = mode if mode in ('concurrent', 'sequential') else (CFG.get('LOAD_MODE') or 'concurrent')
     api['refreshing'] = True
     api['log'] = []
+    api['progress'] = {'phase': 'extracting', 'mode': mode, 'reason': reason, 'startedAt': iso_now(), 'finishedAt': None,
+                       'total': len(months) + 1, 'done': 0, 'journal': 'pending', 'periods': {m: 'pending' for m in months}}
+    return True
+
+
+def _progress(kind, key, status):
+    api = state['api']
+    with _progress_lock:
+        p = api['progress']
+        if kind == 'period':
+            p['periods'][key] = status
+        elif kind == 'journal':
+            p['journal'] = status
+        elif kind == 'phase':
+            p['phase'] = key
+        p['done'] = sum(1 for v in p['periods'].values() if v == 'done') + (1 if p['journal'] == 'done' else 0)
+
+
+def _run(reason):
+    """Extract the closed window from SAP (read-only), then store, cache and record it. Caller holds the loader (see _begin)."""
+    api = state['api']
     try:
-        data = cap_to_report_window(build(log=api['log'].append))
+        # 1. the window is re-derived from the period statuses inside build(); 2. extract (per month, in the chosen mode); 3. cost + controls
+        data = cap_to_report_window(build(log=api['log'].append, mode=api['progress']['mode'], progress=_progress))
         api['data'] = data
         api['error'] = None
         api['lastRefresh'] = iso_now()
+        loaded = sorted({_ym(l['period']) for l in data['lines']})
+        api['periodLoadedAt'] = {p: api['lastRefresh'] for p in loaded}
+        api['periodErrors'] = {}
+        api['fromCache'], api['cachedAt'] = False, None
+        api['log'].append(f"window {data['from']} → {data['asOf']} · {len(loaded)} period(s) loaded")
         VALIDATION_DIR.mkdir(parents=True, exist_ok=True)
         (VALIDATION_DIR / 'dataset.json').write_text(json.dumps(data), encoding='utf-8')
+        try:
+            datacache.save(data, {'lastRefresh': api['lastRefresh'], 'periodLoadedAt': api['periodLoadedAt'],
+                                  'mode': api['progress']['mode'], 'reason': reason})
+        except Exception as e:       # a cache that cannot be written must never fail the load itself
+            api['log'].append('cache not saved: ' + redact(str(e)))
+        api['progress']['phase'] = 'done'
     except Exception as e:  # surfaced to the UI as "Data unavailable"
         api['error'] = redact(str(e) or repr(e))
+        api['periodErrors'] = {r['period']: api['error'] for r in period_statuses('api')['rows'] if r['closeStatus'] == 'Closed'}
+        api['progress']['phase'] = 'error'
     finally:
+        api['progress']['finishedAt'] = iso_now()
         api['refreshing'] = False
         _refresh_lock.release()
-    return api
+
+
+def refresh_api(mode=None, reason='refresh'):
+    """Blocking load (start-up, tests, scripts). The web UI uses start_refresh so the page stays responsive."""
+    if _begin(mode, reason):
+        _run(reason)
+    return state['api']
+
+
+def start_refresh(mode=None, reason='refresh'):
+    """Non-blocking load: returns at once; the work runs in a background thread and is reported through state['api']['progress'].
+    Returns False if a load is already running."""
+    if not _begin(mode, reason):
+        return False
+    threading.Thread(target=_run, args=(reason,), name='aif-load', daemon=True).start()
+    return True
 
 
 def load_spreadsheets(entries):
@@ -89,6 +164,7 @@ def load_spreadsheets(entries):
     ss['data'] = data
     ss['lastRefresh'] = iso_now()
     ss['error'] = None
+    ss['periodLoadedAt'] = {p: ss['lastRefresh'] for p in sorted({_ym(l['period']) for l in data['lines']})}
     for l in data['loaded']:
         ss['loadHistory'].insert(0, {
             'file': l['file'], 'kind': l['kind'], 'rows': l['rows'],
@@ -112,30 +188,47 @@ def _find_default_files():
 
 
 def warm_up():
-    """Warm both sources so the dashboard opens with data ."""
+    """Open with every closed period loaded. First run: load them all from SAP (the UI shows "Loading data…") and cache the result.
+    Later runs: open from that cache at once and read nothing from SAP until Refresh — except a month that has closed since the cache
+    was written, which is loaded now. Runs in a background thread so the server answers immediately."""
     from . import sap
+    api = state['api']
+    api['warming'] = True
     try:
-        load_spreadsheets(_find_default_files())
-        print('  spreadsheet source loaded')
-    except Exception as e:
-        state['spreadsheet']['error'] = redact(str(e))
-        print('  spreadsheet source failed:', state['spreadsheet']['error'])
-    if FIXTURE_DATASET:
         try:
-            data = json.loads(Path(FIXTURE_DATASET).read_text(encoding='utf-8'))
-            state['api'].update(data=data, error=None, lastRefresh=data.get('builtAt') or iso_now())
-            state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': 'Fixture dataset — no SAP connection (test mode)'}
-            print('  FIXTURE MODE — dataset loaded from', FIXTURE_DATASET)
+            load_spreadsheets(_find_default_files())
+            print('  spreadsheet source loaded')
         except Exception as e:
-            state['api']['error'] = redact(str(e))
-            print('  fixture load failed:', state['api']['error'])
-        return
-    try:
-        xml = sap.metadata('journal')
-        state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': f'Connected — {len(xml)} bytes of metadata.'}
-        print('  SAP connection OK — building live dataset…')
-        refresh_api()
-        print(f"  live build FAILED: {state['api']['error']}" if state['api']['error'] else '  live dataset ready')
-    except Exception as e:
-        state['connection'] = {'ok': False, 'checkedAt': iso_now(), 'detail': redact(str(e))}
-        print('  SAP connection failed:', state['connection']['detail'])
+            state['spreadsheet']['error'] = redact(str(e))
+            print('  spreadsheet source failed:', state['spreadsheet']['error'])
+        if FIXTURE_DATASET:
+            try:
+                data = json.loads(Path(FIXTURE_DATASET).read_text(encoding='utf-8'))
+                api.update(data=data, error=None, lastRefresh=data.get('builtAt') or iso_now())
+                state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': 'Fixture dataset — no SAP connection (test mode)'}
+                print('  FIXTURE MODE — dataset loaded from', FIXTURE_DATASET)
+            except Exception as e:
+                api['error'] = redact(str(e))
+                print('  fixture load failed:', api['error'])
+            return
+        cached = datacache.load()
+        if cached:
+            data, meta = cached
+            api.update(data=data, error=None, lastRefresh=meta.get('lastRefresh'), fromCache=True, cachedAt=meta.get('savedAt'),
+                       periodLoadedAt=meta.get('periodLoadedAt') or {}, periodErrors={})
+            print(f"  live dataset opened from cache (saved {meta.get('savedAt')}) — no SAP read until Refresh")
+        try:
+            xml = sap.metadata('journal')
+            state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': f'Connected — {len(xml)} bytes of metadata.'}
+        except Exception as e:
+            state['connection'] = {'ok': False, 'checkedAt': iso_now(), 'detail': redact(str(e))}
+            print('  SAP connection failed:', state['connection']['detail'])
+            return
+        missing = [r['label'] for r in period_statuses('api')['rows'] if r['closeStatus'] == 'Closed' and r['loaded'] == 'No'] if cached else []
+        if cached and not missing:
+            return
+        print('  SAP connection OK — ' + (f"loading newly closed period(s): {', '.join(missing)}" if cached else 'first load, building live dataset…'))
+        refresh_api(reason='startup' if not cached else 'startup: newly closed ' + ', '.join(missing))
+        print(f"  live build FAILED: {api['error']}" if api['error'] else '  live dataset ready (cached for next start)')
+    finally:
+        api['warming'] = False
diff --git a/backend/analytics/urls.py b/backend/analytics/urls.py
index 1c31dae..9088223 100644
--- a/backend/analytics/urls.py
+++ b/backend/analytics/urls.py
@@ -25,6 +25,9 @@ urlpatterns = [
     path('api/batch/<str:batch_id>', views.batch),
     path('api/order/<str:order_id>', views.order),
     path('api/refresh', views.refresh),
+    path('api/periods', views.periods),
+    path('api/periods/<str:period>/reload', views.period_reload),
+    path('api/periods/<str:period>/status', views.period_status_set),
     path('api/spreadsheet/load', views.spreadsheet_load),
     path('api/load-history', views.load_history),
     path('api/chat', views.chat),
diff --git a/backend/analytics/views.py b/backend/analytics/views.py
index a6e09db..f2fbfc0 100644
--- a/backend/analytics/views.py
+++ b/backend/analytics/views.py
@@ -13,10 +13,11 @@ from .config import CFG, FIXTURE_DATASET, FIXTURE_DIR, redact
 from .cost import cache as cost_cache
 from .http import body_json as _body, jres
 from .jsutil import round2
+from .periods import effective_cfg, read_overrides, set_override, window_end
 from .pipeline import chat as chat_mod
 from .pipeline.aggregate import aggregate
 from .pipeline.modetail import link_for, order_cost_detail
-from .state import iso_now, load_spreadsheets, refresh_api, state
+from .state import iso_now, load_spreadsheets, period_statuses, refresh_api, start_refresh, state
 
 
 # ---------------------------------------------------------------- helpers
@@ -63,7 +64,8 @@ def status(request):
         'connection': conn,
         'sources': {
             'api': {'available': bool(api['data']), 'error': api['error'] if dm else None, 'refreshing': api['refreshing'],
-                    'lastRefresh': api['lastRefresh'],
+                    'lastRefresh': api['lastRefresh'], 'warming': api['warming'], 'progress': api['progress'],
+                    'fromCache': api['fromCache'], 'cachedAt': api['cachedAt'], 'loadMode': CFG.get('LOAD_MODE') or 'concurrent',
                     'periodFrom': api['data']['from'] if api['data'] else None, 'periodTo': api['data']['asOf'] if api['data'] else None,
                     'cogmAvailable': True, 'log': api['log'] if dm else []},
             'spreadsheet': {'available': bool(ss['data']), 'error': ss['error'] if dm else None, 'lastRefresh': ss['lastRefresh'],
@@ -201,13 +203,83 @@ def order(request, order_id):
 def refresh(request):
     if request.method != 'POST':
         return jres({'error': 'Method not allowed'}, 405)
+    body = _body(request)
+    mode = body.get('mode')
     if FIXTURE_DATASET:
         a = state['api']
         return jres({'ok': True, 'error': None, 'lastRefresh': a['lastRefresh'], 'log': a['log']})   # fixture mode: nothing to refresh
-    s = refresh_api()
+    if body.get('async'):
+        # returns at once; the UI follows progress through /api/status
+        return jres({'ok': True, 'started': start_refresh(mode, 'refresh'), 'running': state['api']['refreshing']})
+    s = refresh_api(mode)
     return jres({'ok': not s['error'], 'error': s['error'], 'lastRefresh': s['lastRefresh'], 'log': s['log']})
 
 
+@guard(dashboard=perm.SALES)
+def periods(request):
+    """Status of every month in the window (shared helper periods.get_period_statuses). Error text is Data Management detail."""
+    out = period_statuses(_src(request))
+    dm = perm.can_view(request.aif_user, perm.DATA_MANAGEMENT)
+    ov = read_overrides() if dm else {}
+    for r in out['rows']:
+        r['override'] = ov.get(r['period'])      # {status, by, at} when someone set it by hand in the panel
+    if not dm:
+        for r in out['rows']:
+            r['error'] = None
+            if r['badge'] == 'red':
+                r['reason'] = 'Closed but not loaded'
+    return jres({'source': _src(request), **out})
+
+
+@guard(dashboard=perm.DATA_MANAGEMENT, steward=True)
+def period_reload(request, period):
+    """Re-extract one closed month (read-only from SAP). Batch cost is linked across months (a batch sold in Jan was made in Dec), so the
+    live window is re-extracted as a whole and every month's status is re-evaluated; the response reports the requested month."""
+    if request.method != 'POST':
+        return jres({'error': 'Method not allowed'}, 405)
+    row = next((r for r in period_statuses('api')['rows'] if r['period'] == period), None)
+    if not row:
+        return jres({'error': f'{period} is outside the reporting window.'}, 404)
+    if row['closeStatus'] != 'Closed':
+        return jres({'error': f"{row['label']} is not closed — open periods are excluded until month-end close."}, 409)
+    body = _body(request)
+    if body.get('async') and not FIXTURE_DATASET:
+        return jres({'ok': True, 'started': start_refresh(body.get('mode'), f'reload {period}'), 'running': state['api']['refreshing']})
+    if not FIXTURE_DATASET:
+        refresh_api(body.get('mode'), f'reload {period}')
+    out = period_statuses('api')
+    return jres({'ok': not state['api']['error'], 'error': state['api']['error'], 'period': next(r for r in out['rows'] if r['period'] == period),
+                 'summary': out['summary'], 'log': state['api']['log']})
+
+
+@guard(dashboard=perm.DATA_MANAGEMENT, steward=True)
+def period_status_set(request, period):
+    """Mark a month Closed or Open by hand (or back to 'auto'), then re-extract so the window, the cards and the panel follow.
+    SAP is only ever read. The change and who made it are kept in config/period_overrides.json."""
+    if request.method != 'POST':
+        return jres({'error': 'Method not allowed'}, 405)
+    body = _body(request)
+    status = body.get('status')
+    if status not in ('Closed', 'Open', 'auto'):
+        return jres({'error': "status must be 'Closed', 'Open' or 'auto'."}, 400)
+    before = period_statuses('api')
+    if not any(r['period'] == period for r in before['rows']):
+        return jres({'error': f'{period} is outside the reporting window.'}, 404)
+    proposed = {k: v for k, v in read_overrides().items() if k != period}
+    if status != 'auto':
+        proposed[period] = {'status': status}
+    if not window_end(CFG['PERIOD_FROM'], cfg=effective_cfg(CFG, proposed)):
+        return jres({'error': 'That would leave no closed period, so there would be nothing to report. Change refused.'}, 409)
+    set_override(period, status, request.aif_user.username)
+    if body.get('async') and not FIXTURE_DATASET:
+        return jres({'ok': True, 'started': start_refresh(body.get('mode'), f'{period} marked {status}'), 'running': state['api']['refreshing']})
+    if not FIXTURE_DATASET:
+        refresh_api(body.get('mode'), f'{period} marked {status}')
+    out = period_statuses('api')
+    return jres({'ok': not state['api']['error'], 'error': state['api']['error'], 'period': next(r for r in out['rows'] if r['period'] == period),
+                 'summary': out['summary'], 'log': state['api']['log']})
+
+
 @guard(dashboard=perm.DATA_MANAGEMENT, steward=True)
 def spreadsheet_load(request):
     if request.method != 'POST':
diff --git a/backend/config/.env.example b/backend/config/.env.example
index d8490a6..44eb2fa 100644
--- a/backend/config/.env.example
+++ b/backend/config/.env.example
@@ -11,8 +11,15 @@ COMPANY_CODE=2000
 SALES_ORG=2000
 LEDGER=0L
 PERIOD_FROM=2025-07-01
-# Upper bound on BillingDocumentDate. Omit to run through today; set a date to cap the display window.
-REPORT_TO=2026-09-30
+# Reporting window END is derived on every refresh: the last day of the latest CLOSED period. There is no stored end date.
+# A month is closed once the current Africa/Kigali month is past it. Until SAP exposes posting-period status to this user, override
+# per period here (comma-separated YYYY-MM). PERIOD_OPEN wins over PERIOD_CLOSED.
+# PERIOD_CLOSED=2026-10
+# PERIOD_OPEN=
+# Loading: 'concurrent' reads the closed periods in parallel (up to LOAD_WORKERS at a time, all read-only GETs); 'sequential' reads them one by one.
+# The first load is cached on disk (backend/cache/dataset-cache.json) and reused at start-up until Refresh.
+LOAD_MODE=concurrent
+LOAD_WORKERS=4
 OVERHEAD_GL=94301000
 BATCH_CHUNK=50
 
```

# APPENDIX B — new files (verbatim)

### `backend/analytics/periods.py`
```python
"""Reporting-period status: the ONE place that decides which months are closed, which are loaded and which are in the dashboard.

Used by the live build (window end), the refresh, the Periods panel and the "Data through" popover, so they cannot disagree.

Source of truth for "closed" (interim, until SAP exposes posting-period status to the communication user — see README):
  1. config override  PERIOD_CLOSED=YYYY-MM[,YYYY-MM…]   forced Closed
                      PERIOD_OPEN=YYYY-MM[,…]            forced Open (wins over PERIOD_CLOSED)
  2. calendar rule    a month is Closed once the current Africa/Kigali month is past it.
A provider returning None means "unknown" (shown as Unknown, not included). The window END is never stored: it is derived on every
build as the last day of the latest Closed period."""
import calendar
import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

KIGALI = timezone(timedelta(hours=2))        # Africa/Kigali is UTC+2 all year, no daylight saving
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def kigali_now(now=None):
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return n.astimezone(KIGALI)


def kigali_today(now=None):
    return kigali_now(now).strftime('%Y-%m-%d')


def _ym(s):
    """'2026-10', '2026-10-31' or '10.2026' -> '2026-10'."""
    s = str(s).strip()
    if len(s) == 7 and s[2] == '.':
        return f'{s[3:]}-{s[:2]}'
    return s[:7]


def _code(ym):
    return f'{ym[5:7]}.{ym[:4]}'


def label(ym):
    return f'{MONTHS[int(ym[5:7]) - 1]} {ym[:4]}'


def _next(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return f'{y + (m == 12)}-{1 if m == 12 else m + 1:02d}'


def month_range(frm, to):
    """Every month 'YYYY-MM' from frm to to inclusive."""
    out, p, end = [], _ym(frm), _ym(to)
    while p <= end:
        out.append(p)
        p = _next(p)
    return out


def last_day(ym):
    return f'{ym}-{calendar.monthrange(int(ym[:4]), int(ym[5:7]))[1]:02d}'


def _list(v):
    return {_ym(x) for x in str(v or '').replace(';', ',').split(',') if x.strip()}


# ---- manual overrides set from the Periods panel (persisted; the audit trail is kept with each entry) -------------------------------
OVERRIDES_FILE = Path(__file__).resolve().parent.parent / 'config' / 'period_overrides.json'
_ov_lock = threading.Lock()


def read_overrides(path=None):
    """{'YYYY-MM': {'status': 'Closed'|'Open', 'by': user, 'at': iso}} — empty when none (or the file is unreadable)."""
    try:
        d = json.loads(Path(path or OVERRIDES_FILE).read_text(encoding='utf-8'))
        return {k: v for k, v in d.items() if isinstance(v, dict) and v.get('status') in ('Closed', 'Open')}
    except Exception:
        return {}


def set_override(ym, status, by, now=None, path=None):
    """status 'Closed' | 'Open' sets a manual override; 'auto' removes it (back to .env / calendar). Returns the new overrides."""
    if status not in ('Closed', 'Open', 'auto'):
        raise ValueError('status must be Closed, Open or auto')
    with _ov_lock:
        d = read_overrides(path)
        if status == 'auto':
            d.pop(ym, None)
        else:
            d[ym] = {'status': status, 'by': by, 'at': (now or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')}
        p = Path(path or OVERRIDES_FILE)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(d, indent=2, sort_keys=True), encoding='utf-8')
        return d


def effective_cfg(cfg, overrides=None):
    """The scope config with manual overrides merged over the .env lists (manual wins). Every caller that decides closed/open passes this,
    so the build, the refresh, the panel and the pill read the same answer."""
    ov = read_overrides() if overrides is None else overrides
    closed, opened = _list(cfg.get('PERIOD_CLOSED')) - set(ov), _list(cfg.get('PERIOD_OPEN')) - set(ov)
    for ym, v in ov.items():
        (closed if v['status'] == 'Closed' else opened).add(ym)
    return {**cfg, 'PERIOD_CLOSED': ','.join(sorted(closed)), 'PERIOD_OPEN': ','.join(sorted(opened)), 'PERIOD_MANUAL': ','.join(sorted(ov))}


def close_status(ym, now=None, cfg=None):
    """-> ('Closed'|'Open'|'Unknown', source). Manual override (panel), then .env override, then the calendar rule."""
    cfg = cfg or {}
    src = 'manual' if ym in _list(cfg.get('PERIOD_MANUAL')) else 'config'
    if ym in _list(cfg.get('PERIOD_OPEN')):
        return 'Open', src
    if ym in _list(cfg.get('PERIOD_CLOSED')):
        return 'Closed', src
    return ('Closed' if ym < kigali_today(now)[:7] else 'Open'), 'calendar'


def window_end(frm, now=None, cfg=None):
    """Last day of the latest closed period from `frm` to the current month (or None if nothing is closed yet). Derived, never stored."""
    cur = kigali_today(now)[:7]
    closed = [p for p in month_range(frm, max(cur, _ym(frm))) if close_status(p, now, cfg)[0] == 'Closed']
    return last_day(closed[-1]) if closed else None


def _breach_periods(controls, frozen, lines):
    """period -> {'batch': n, 'order': n, 'quantity': n}. A batch breach belongs to every period that sold that batch; an order breach to
    every period that sold a batch the order fed."""
    by_batch = {}
    for l in lines:
        if l.get('batch'):
            by_batch.setdefault(l['batch'], set()).add(_ym(l['period']))
    orders_to_batches = {}
    for f in frozen or []:
        for o in f.get('orders') or []:
            orders_to_batches.setdefault(o, set()).add(f['batch'])
    out = {}

    def add(periods, kind):
        for p in periods:
            out.setdefault(p, {'batch': 0, 'order': 0, 'quantity': 0})[kind] += 1
    c = controls or {}
    for b in (c.get('batchClosure') or {}).get('breaches', []):
        add(by_batch.get(b['batch'], ()), 'batch')
    for b in (c.get('quantityControl') or {}).get('breaches', []):
        add(by_batch.get(b['batch'], ()), 'quantity')
    for o in (c.get('orderClosure') or {}).get('breaches', []):
        ps = set()
        for b in orders_to_batches.get(o['order'], ()):
            ps |= by_batch.get(b, set())
        add(ps, 'order')
    return out


def get_period_statuses(*, lines, frm, now=None, cfg=None, controls=None, frozen=None, loaded_at=None, errors=None, provider=None):
    """Status of every month from `frm` to the current Kigali month.

    lines      the loaded dataset's lines (each has period 'MM.YYYY', revenueUsd, itemResolved, batch)
    loaded_at  {'YYYY-MM': iso timestamp} of the last successful extract of that month
    errors     {'YYYY-MM': message} of the last failed extract
    provider   optional callable ym -> ('Closed'|'Open'|'Unknown', source); default is close_status (config override, then calendar)
    Returns {'rows': [...], 'summary': {...}, 'windowEnd': 'YYYY-MM-DD'|None}."""
    cfg, loaded_at, errors = cfg or {}, loaded_at or {}, errors or {}
    provider = provider or (lambda ym: close_status(ym, now, cfg))
    cur = kigali_today(now)[:7]
    by = {}
    for l in lines or []:
        p = by.setdefault(_ym(l['period']), {'rows': 0, 'revenue': 0.0, 'unresolved': 0})
        p['rows'] += 1
        p['revenue'] += l.get('revenueUsd') or 0
        p['unresolved'] += 0 if l.get('itemResolved', True) else 1
    breaches = _breach_periods(controls, frozen, lines or [])
    rows = []
    for ym in month_range(frm, max(cur, _ym(frm))):
        st, src = provider(ym)
        a = by.get(ym)
        err = errors.get(ym)
        n_br = sum((breaches.get(ym) or {}).values())
        loaded = 'No' if not a else ('Partial' if (err or a['unresolved']) else 'Yes')
        if st == 'Closed':
            if loaded == 'No':
                badge, included, why = 'red', 'No', err or 'Closed but not loaded'
            elif loaded == 'Partial' or n_br:
                badge, included, why = 'amber', 'Yes', ('Included — ' + ('; '.join(x for x in (
                    f'{n_br} closure-control breach(es)' if n_br else '', f"{a['unresolved']} line(s) without a billing-item match" if a['unresolved'] else '',
                    f'last reload failed: {err}' if err else '') if x)))
            else:
                badge, included, why = 'green', 'Yes', 'Closed and loaded'
        elif st == 'Open':
            badge, included, why = 'grey', 'No', 'Open — excluded until month-end close'
        else:
            badge, included, why = 'grey', 'No', 'Close status unknown — excluded'
        rows.append({
            'period': ym, 'code': _code(ym), 'label': label(ym), 'closeStatus': st, 'closeSource': src, 'loaded': loaded,
            'rows': a['rows'] if a else 0, 'revenue': round(a['revenue'], 2) if a else 0.0,
            'breaches': {'batch': 0, 'order': 0, 'quantity': 0, **(breaches.get(ym) or {})}, 'breachCount': n_br,
            'lastLoaded': loaded_at.get(ym), 'error': err, 'badge': badge, 'included': included, 'reason': why,
        })
    inc = [r for r in rows if r['included'] == 'Yes']
    closed = [r for r in rows if r['closeStatus'] == 'Closed']
    openp = [r for r in rows if r['closeStatus'] != 'Closed']
    end = last_day(closed[-1]['period']) if closed else None
    parts = [f"Included: {label(inc[0]['period'])} – {label(inc[-1]['period'])}" if inc else 'Included: none',
             f'{len(closed)} closed period{"" if len(closed) == 1 else "s"}']
    if openp:
        parts.append(f"{len(openp)} open ({', '.join(label(r['period']) for r in openp)})")
    return {'rows': rows, 'windowEnd': end, 'summary': {
        'text': ' · '.join(parts), 'includedFrom': inc[0]['period'] if inc else None, 'includedTo': inc[-1]['period'] if inc else None,
        'closed': len(closed), 'open': len(openp), 'withBreaches': sum(1 for r in rows if r['breachCount']),
        'timezone': 'Africa/Kigali', 'today': kigali_today(now)}}

```

### `backend/analytics/datacache.py`
```python
"""On-disk cache of the last successful live dataset, so the app opens instantly and reads nothing from SAP until someone presses
Refresh. It is replaced by every successful load, and ignored (never trusted) if the scope or the cost rules have changed since it was
written. A month that has closed since the cache was saved is NOT silently missing: the period helper reports it as closed-but-not-loaded
and start-up loads it (see state.warm_up)."""
import json
import os
from datetime import datetime, timezone

from .config import CACHE_DIR, CFG
from .cost.rules import RULE_VERSION

FILE = CACHE_DIR / 'dataset-cache.json'
VERSION = 1


def scope():
    """What the cached data was selected by. A different company, ledger, start date or cost rule makes the cache unusable."""
    return {'from': CFG.get('PERIOD_FROM'), 'companyCode': CFG.get('COMPANY_CODE'), 'salesOrg': CFG.get('SALES_ORG'),
            'ledger': CFG.get('LEDGER'), 'ruleVersion': RULE_VERSION, 'version': VERSION}


def save(data, meta, path=None):
    """Atomic write (temp file, then replace) so a crash mid-write can never leave a half-written cache."""
    p = path or FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    doc = {'meta': {**meta, 'scope': scope(), 'savedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}, 'data': data}
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(doc), encoding='utf-8')
    os.replace(tmp, p)


def load(path=None):
    """-> (data, meta) or None when there is no usable cache."""
    try:
        doc = json.loads((path or FILE).read_text(encoding='utf-8'))
        if doc['meta'].get('scope') != scope() or 'lines' not in doc['data']:
            return None
        return doc['data'], doc['meta']
    except Exception:
        return None

```

### `backend/analytics/tests_periods.py`
```python
"""getPeriodStatuses (periods.get_period_statuses): closed+loaded, closed-not-loaded, open, closed-with-breaches, time-zone boundary,
config override and the derived window end. Run: python backend/manage.py test analytics (AIF_NO_WARMUP=1)."""
import os

os.environ.setdefault('AIF_NO_WARMUP', '1')

from datetime import datetime, timezone  # noqa: E402

from django.test import SimpleTestCase  # noqa: E402

from .periods import close_status, get_period_statuses, kigali_today, window_end  # noqa: E402


def line(period, rev, batch=None, resolved=True):
    return {'period': period, 'revenueUsd': rev, 'batch': batch, 'itemResolved': resolved}


def utc(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


NOW = utc(2026, 11, 6, 8, 0)          # 6 Nov 2026 10:00 Kigali
FROM = '2026-08-01'
LINES = [line('08.2026', 100.0, 'B1'), line('08.2026', 50.0, 'B1'), line('09.2026', 2725630.53, 'B2'), line('10.2026', 728937.90, 'B3')]


def rows(res):
    return {r['period']: r for r in res['rows']}


class PeriodStatuses(SimpleTestCase):
    def test_closed_and_loaded_is_green_and_included(self):
        r = rows(get_period_statuses(lines=LINES, frm=FROM, now=NOW))['2026-09']
        self.assertEqual((r['closeStatus'], r['loaded'], r['badge'], r['included']), ('Closed', 'Yes', 'green', 'Yes'))
        self.assertEqual((r['rows'], r['revenue']), (1, 2725630.53))

    def test_closed_but_not_loaded_is_red_with_the_error(self):
        res = get_period_statuses(lines=[l for l in LINES if l['period'] != '10.2026'], frm=FROM, now=NOW,
                                  errors={'2026-10': 'HTTP 500 — boom'})
        r = rows(res)['2026-10']
        self.assertEqual((r['closeStatus'], r['loaded'], r['badge'], r['included']), ('Closed', 'No', 'red', 'No'))
        self.assertEqual(r['reason'], 'HTTP 500 — boom')
        self.assertEqual(res['windowEnd'], '2026-10-31')       # the window still extends: the period is closed even though loading failed

    def test_current_month_is_open_grey_and_excluded(self):
        res = get_period_statuses(lines=LINES, frm=FROM, now=NOW)
        r = rows(res)['2026-11']
        self.assertEqual((r['closeStatus'], r['badge'], r['included'], r['rows']), ('Open', 'grey', 'No', 0))
        self.assertIn('excluded until month-end close', r['reason'])
        self.assertEqual(res['summary']['text'], 'Included: Aug 2026 – Oct 2026 · 3 closed periods · 1 open (Nov 2026)')
        self.assertEqual(res['windowEnd'], '2026-10-31')

    def test_closed_with_breaches_is_amber_but_still_included(self):
        controls = {'batchClosure': {'breaches': [{'batch': 'B2'}]}, 'quantityControl': {'breaches': [{'batch': 'B1'}]},
                    'orderClosure': {'breaches': [{'order': 'O3'}]}}
        frozen = [{'batch': 'B3', 'orders': ['O3']}]
        res = rows(get_period_statuses(lines=LINES, frm=FROM, now=NOW, controls=controls, frozen=frozen))
        self.assertEqual((res['2026-09']['badge'], res['2026-09']['breaches']['batch'], res['2026-09']['included']), ('amber', 1, 'Yes'))
        self.assertEqual((res['2026-08']['badge'], res['2026-08']['breaches']['quantity']), ('amber', 1))
        self.assertEqual((res['2026-10']['badge'], res['2026-10']['breaches']['order']), ('amber', 1))

    def test_partial_when_lines_lack_a_billing_item_match(self):
        r = rows(get_period_statuses(lines=[line('09.2026', 1.0, resolved=False)], frm='2026-09-01', now=NOW))['2026-09']
        self.assertEqual((r['loaded'], r['badge'], r['included']), ('Partial', 'amber', 'Yes'))

    def test_kigali_boundary_1_nov_0030_is_still_october_in_utc_but_november_in_kigali(self):
        t = utc(2026, 10, 31, 22, 30)                        # 00:30 on 1 Nov in Kigali (UTC+2)
        self.assertEqual(kigali_today(t), '2026-11-01')
        self.assertEqual(close_status('2026-10', t), ('Closed', 'calendar'))     # UTC logic would still call October open
        self.assertEqual(window_end(FROM, t), '2026-10-31')
        self.assertEqual(rows(get_period_statuses(lines=LINES, frm=FROM, now=t))['2026-11']['closeStatus'], 'Open')

    def test_just_before_midnight_kigali_october_is_still_open(self):
        t = utc(2026, 10, 31, 21, 59)                        # 23:59 on 31 Oct in Kigali
        self.assertEqual(close_status('2026-10', t), ('Open', 'calendar'))
        self.assertEqual(window_end(FROM, t), '2026-09-30')

    def test_config_override_closes_or_holds_a_period(self):
        t = utc(2026, 10, 20)
        self.assertEqual(close_status('2026-10', t, {'PERIOD_CLOSED': '2026-10'}), ('Closed', 'config'))
        self.assertEqual(close_status('2026-09', NOW, {'PERIOD_OPEN': '2026-09, 2026-08', 'PERIOD_CLOSED': '2026-09'}), ('Open', 'config'))
        self.assertEqual(window_end(FROM, NOW, {'PERIOD_OPEN': '2026-10'}), '2026-09-30')

    def test_window_end_is_derived_not_stored_and_none_when_nothing_is_closed(self):
        self.assertEqual(window_end('2026-11-01', NOW), None)
        self.assertEqual(window_end('2025-07-01', utc(2027, 1, 5, 12)), '2026-12-31')    # year roll-over

    def test_provider_hook_and_unknown_status(self):
        res = get_period_statuses(lines=LINES, frm='2026-09-01', now=NOW, provider=lambda ym: {'2026-09': ('Closed', 'sap'), '2026-10': ('Unknown', 'sap')}.get(ym, ('Open', 'sap')))
        r = rows(res)
        self.assertEqual((r['2026-10']['closeStatus'], r['2026-10']['included']), ('Unknown', 'No'))
        self.assertEqual(res['windowEnd'], '2026-09-30')


class ManualOverrides(SimpleTestCase):
    def test_manual_override_wins_over_env_and_calendar_and_can_revert(self):
        import tempfile
        from pathlib import Path
        from .periods import effective_cfg, read_overrides, set_override
        path = Path(tempfile.mkdtemp()) / 'ov.json'
        set_override('2026-10', 'Open', 'ann', NOW, path)                     # hold October back although the calendar says closed
        set_override('2026-11', 'Closed', 'ann', NOW, path)                   # close the current month early
        ov = read_overrides(path)
        self.assertEqual((ov['2026-10']['status'], ov['2026-10']['by']), ('Open', 'ann'))
        cfg = effective_cfg({'PERIOD_CLOSED': '2026-10'}, ov)                 # .env says closed, manual says open: manual wins
        self.assertEqual(close_status('2026-10', NOW, cfg), ('Open', 'manual'))
        self.assertEqual(close_status('2026-11', NOW, cfg), ('Closed', 'manual'))
        self.assertEqual(close_status('2026-09', NOW, cfg), ('Closed', 'calendar'))
        self.assertEqual(window_end(FROM, NOW, cfg), '2026-11-30')
        set_override('2026-10', 'auto', 'ann', NOW, path)
        self.assertEqual(list(read_overrides(path)), ['2026-11'])
        with self.assertRaises(ValueError):
            set_override('2026-10', 'bogus', 'ann', NOW, path)

```

### `backend/analytics/tests_loading.py`
```python
"""Loading closed periods concurrently or one by one, progress reporting, and the first-load disk cache. SAP is replaced by a fake that
only answers GETs from memory (these tests never touch the network). Run: python backend/manage.py test analytics."""
import os

os.environ.setdefault('AIF_NO_WARMUP', '1')

import tempfile  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402
from unittest import mock  # noqa: E402

from django.test import SimpleTestCase  # noqa: E402

from . import datacache  # noqa: E402
from .pipeline import build as build_mod  # noqa: E402


class FakeSap:
    """Two documents per month; counts how many calls are in flight at once."""

    def __init__(self, delay=0.03):
        self.delay, self.inflight, self.peak, self.lock = delay, 0, 0, threading.Lock()

    def _enter(self):
        with self.lock:
            self.inflight += 1
            self.peak = max(self.peak, self.inflight)
        time.sleep(self.delay)

    def _leave(self):
        with self.lock:
            self.inflight -= 1

    def get_all(self, service, entity, params, page=5000, max_rows=None):
        self._enter()
        try:
            if service == 'journal':
                return [{'AccountingDocument': 'J1', 'PostingDate': '2026-09-02T00:00:00'}]
            flt = params['$filter']
            month = flt.split("BillingDocumentDate ge datetime'")[1][:7]
            return [{'BillingDocument': f'{month}-A', 'AccountingPostingStatus': 'C'}, {'BillingDocument': f'{month}-B', 'AccountingPostingStatus': 'C'},
                    {'BillingDocument': f'{month}-X', 'AccountingPostingStatus': 'A'}]
        finally:
            self._leave()

    def get_by_keys(self, service, entity, field, keys, chunk=50, params=None):
        self._enter()
        try:
            return [{'BillingDocument': k, 'BillingDocumentItem': '10'} for k in keys]
        finally:
            self._leave()


def extract(mode, workers=4):
    fake, events = FakeSap(), []
    with mock.patch.object(build_mod, 'sap', fake):
        out = build_mod._extract_sales('2026-07-01', '2026-10-31', 50, mode, workers, lambda m: None, lambda *e: events.append(e))
    return out, fake, events


class ExtractModes(SimpleTestCase):
    def test_concurrent_and_one_by_one_return_identical_data(self):
        a, _, _ = extract('sequential')
        b, _, _ = extract('concurrent')
        self.assertEqual(a, b)
        hdrs, items, jrev = a
        self.assertEqual([h['BillingDocument'] for h in hdrs][:3], ['2026-07-A', '2026-07-B', '2026-07-X'])   # month order, always
        self.assertEqual(len(hdrs), 12)                  # 4 months x 3 documents
        self.assertEqual(len(items), 8)                  # only posted documents get items
        self.assertEqual(len(jrev), 1)

    def test_one_by_one_never_overlaps_and_concurrent_does(self):
        _, seq, _ = extract('sequential')
        _, con, _ = extract('concurrent', workers=4)
        self.assertEqual(seq.peak, 1)
        self.assertGreater(con.peak, 1)
        self.assertLessEqual(con.peak, 4)                # bounded by LOAD_WORKERS: SAP is never flooded

    def test_one_by_one_runs_in_calendar_order(self):
        _, _, events = extract('sequential')
        started = [e[1] for e in events if e[0] == 'period' and e[2] == 'loading']
        self.assertEqual(started, ['2026-07', '2026-08', '2026-09', '2026-10'])

    def test_every_task_reports_loading_then_done(self):
        _, _, events = extract('concurrent')
        for ym in ('2026-07', '2026-08', '2026-09', '2026-10'):
            self.assertEqual([e[2] for e in events if e[:2] == ('period', ym)], ['loading', 'done'])
        self.assertEqual([e[2] for e in events if e[0] == 'journal'], ['loading', 'done'])

    def test_a_failing_month_is_reported_and_stops_the_load(self):
        fake = FakeSap()
        orig = fake.get_all

        def boom(service, entity, params, **kw):
            if service == 'billing' and "ge datetime'2026-08-01" in params['$filter']:
                raise RuntimeError('HTTP 500')
            return orig(service, entity, params, **kw)
        fake.get_all, events = boom, []
        for mode in ('sequential', 'concurrent'):
            with mock.patch.object(build_mod, 'sap', fake), self.assertRaises(RuntimeError):
                build_mod._extract_sales('2026-07-01', '2026-10-31', 50, mode, 4, lambda m: None, lambda *e: events.append(e))
        self.assertIn(('period', '2026-08', 'error'), events)


class ProgressTracking(SimpleTestCase):
    def test_progress_counts_done_tasks_and_phase(self):
        from . import state as st
        st.state['api']['progress'] = {'phase': 'extracting', 'total': 3, 'done': 0, 'journal': 'pending', 'periods': {'2026-09': 'pending', '2026-10': 'pending'}}
        st._progress('period', '2026-09', 'done')
        st._progress('journal', '', 'done')
        st._progress('phase', 'costing', 'running')
        p = st.state['api']['progress']
        self.assertEqual((p['done'], p['total'], p['phase']), (2, 3, 'costing'))
        st.state['api']['progress'] = None


class DatasetCache(SimpleTestCase):
    DATA = {'lines': [{'period': '10.2026'}], 'asOf': '2026-10-31', 'from': '2025-07-01'}

    def test_round_trip_and_atomic_file(self):
        path = Path(tempfile.mkdtemp()) / 'c.json'
        datacache.save(self.DATA, {'lastRefresh': 'T', 'periodLoadedAt': {'2026-10': 'T'}}, path)
        data, meta = datacache.load(path)
        self.assertEqual(data, self.DATA)
        self.assertEqual(meta['periodLoadedAt'], {'2026-10': 'T'})
        self.assertFalse(path.with_suffix('.tmp').exists())

    def test_cache_from_another_scope_or_rule_version_is_ignored(self):
        path = Path(tempfile.mkdtemp()) / 'c.json'
        datacache.save(self.DATA, {}, path)
        with mock.patch.object(datacache, 'RULE_VERSION', 'other-rules'):
            self.assertIsNone(datacache.load(path))
        with mock.patch.dict(datacache.CFG, {'LEDGER': 'ZZ'}):
            self.assertIsNone(datacache.load(path))
        self.assertIsNotNone(datacache.load(path))

    def test_missing_or_corrupt_cache_is_just_no_cache(self):
        d = Path(tempfile.mkdtemp())
        self.assertIsNone(datacache.load(d / 'none.json'))
        (d / 'bad.json').write_text('{not json', encoding='utf-8')
        self.assertIsNone(datacache.load(d / 'bad.json'))

```

