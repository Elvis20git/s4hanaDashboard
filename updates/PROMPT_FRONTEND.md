# PROMPT — FRONT END (React + Vite) · bring production to the reference version of 2026-11-06

You are a senior engineer updating the **production front end** of "AIF Analytics" (`frontend/`, React 19 + Vite + Tailwind, state in a small external store `src/state/store.js`) so it matches our reference version exactly. **Do the backend prompt first** — this UI depends on its API (`/api/periods`, the `progress` fields in `/api/status`, the async load endpoints). Do not re-implement any status logic in the browser: every status, badge and reason comes from the backend helper; the UI only formats and filters it.

## 1. What changed (implement all of it)

### 1.1 "Data through" pill → period popover
- `FilterBar.jsx`: the pill is now a `<button class="pill pill-btn" id="dataThroughPill">` that opens the shared popover (the popover engine reads `data-help-title / data-help-body / data-help-wide / data-help-links`). Body = backend `summary.text` + the **last 6 months**, one line each: `Oct 2026 — Closed · loaded · $2.01M · 1 control breach`. Link "Open the full Periods panel" (`act: 'periods'`) only for users who can open Data Management (`canOpenDataManagement` from `lib/copy.js`). Disabled until period data has loaded. `nav.js statusAction('periods')` goes to Data Management → Source tab and scrolls to `#periodsPanel`.
- The pill text itself ("Data through Oct 2026") still derives from the last period in the loaded data, so FROM/TO pickers and the 2026-to-date / Last 12 months / All data presets offer October automatically — no change needed there.

### 1.2 Periods panel — Data Management → "2 · Periods" (new `components/PeriodsPanel.jsx`, `lib/periodsView.js`)
- Renumber the Data Management levels: 1 Reporting source, **2 Periods**, 3 Load a SAP export, 4 Load history.
- Header: title "Periods" + ⓘ (`HelpIcon`) with exactly: **"A period is included once it is closed in SAP and loaded. Open periods are excluded until month-end close."** Summary line above the table = `summary.text`. A note appears when any status comes from a manual/config override (not SAP).
- Table columns: Period · SAP close status · Loaded (Yes/No/Partial) · Rows loaded · Revenue loaded (`formatMoneyCompact`, e.g. $2.73M) · Closure controls (OK / "n breaches →" linking to the Validation tab) · Last loaded (local date-time) · Included in dashboard (Yes/No + reason). Badge colours: green = closed & loaded; amber = closed with breaches or partial; grey = open; red = closed but not loaded (error text in the cell `title` on hover). Add `.statepill.bad` (red).
- **Filters & search** (presentation only, `filterPeriods`/`EMPTY_FILTERS` in `periodsView.js`): free-text search (period label, `MM.YYYY` code, status words, reason, "manual"), Year, SAP close status, Loaded, Closure controls (OK / with breaches), Included, Badge colour, "Newest first", "Clear filters", and a "Showing x of y" counter. Filters never change a status.
- **Row actions** (only for data stewards on the Live source), all behind a `window.confirm` that states SAP is only read and it takes ~1 minute:
  - **Load period** (closed & not loaded) / **Reload period** (closed & loaded) — re-extracts the live window (limitation: whole window, not one month — batch cost links across months).
  - **Mark open** / **Mark closed** — manual per-period override via `POST /api/periods/<ym>/status`. States clearly it changes the app, not SAP.
  - **Revert to auto** (only on rows set by hand) — `{status:'auto'}`.
  - Rows set by hand show "set by hand (username)".
- **Load controls** at the top of the panel (stewards, live source): segmented switch **Concurrently | One by one** (`store.loadMode`, persisted in `localStorage['aif.loadMode']` inside try/catch, default `concurrent`) and a **Load all closed periods** button. Both modes give identical figures; Refresh uses the same mode. While a load runs every row shows its own task state from `status.sources.api.progress.periods[ym]`: *Queued / Loading… (spinner) / Read ✓*, and all load buttons are disabled.

### 1.3 Animated "Loading data…" indicator (new `components/LoadingIndicator.jsx`, mounted in `App.jsx` under `<FilterBar/>`)
- Visible whenever `isLoading(state)` = live source selected and `sources.api.refreshing || sources.api.warming`. Before any data exists it fills the page (centered, with the line "The first load is saved, so next time this opens at once."); with data on screen it is a slim banner. Content: three pulsing dots, bold **"Loading data…"**, a sub-line from the server's own progress ("Connecting to SAP…" → "Reading closed periods concurrently — 7 of 17 done, 4 in progress" / "one by one" → "Calculating costs and margins…") and a progress bar with a moving sheen (determinate: done/total, capped at 88 %, 92 % while costing). `role="status" aria-live="polite"`; honour `prefers-reduced-motion`.
- `App.jsx` start-up order becomes: `loadStatus()` → **`waitWhileLoading()`** → `loadData()` → route. This is what makes the app open with all closed periods loaded.

### 1.4 Store (`state/store.js`)
- New state: `periods`, `loadMode`. `loadData()` additionally fetches `GET /api/periods?source=<source>` into `state.periods` (`.catch(() => null)`).
- New exports: `setLoadMode(m)`, `isLoading(st)`, `waitWhileLoading()` (polls `loadStatus()` every 1.2 s while loading), `runLoad(path, body)` (POST with `{...body, async:true, mode}` → `loadStatus()` → `waitWhileLoading()` → `loadData()` → throws the server error if `sources.api.error`), and thin wrappers `setPeriodStatus(ym,status)`, `reloadPeriod(ym)`, `refreshAll()`. `Pages.jsx` Refresh now uses `refreshAll()` and shows "Loading…" while any load runs (replaces the old blocking `/api/refresh` + reload).

### 1.5 Title change
- `MarginAndMix.jsx`: "Profitability by product-YTD" → **"Gross Profit by product-YTD"** in both places (section heading level 4 and card header) and the file comment. Docs: spec heading 2.8 renamed likewise. Figures unchanged.

### 1.6 Styles and tests
- `styles/components.css`: `.pill-btn`, `.statepill.bad`, `#periodsTbl` helpers, `.per-tools/.per-load/.per-count/.per-acts/.per-ld/.per-q`, `.loadind*` (+ keyframes `loadind-dot`, `loadind-sheen`, `per-spin`, reduced-motion rules) — included in the patch.
- `tests/periods.test.mjs` (new) covers the filter/search logic; `tests/run-all.mjs` registers it.

## 2. Files
Modified: `src/App.jsx`, `src/components/FilterBar.jsx`, `src/components/Pages.jsx`, `src/state/nav.js`, `src/state/store.js`, `src/styles/components.css`, `tests/run-all.mjs`, plus the two title strings in `src/components/MarginAndMix.jsx`.
New: `src/components/PeriodsPanel.jsx`, `src/components/LoadingIndicator.jsx`, `src/lib/periodsView.js`, `tests/periods.test.mjs`.

**Not part of this prompt (but present in our working tree, from earlier work by us):** `src/lib/derive.js`, `src/lib/views.js` and the other `MarginAndMix.jsx` hunks (donut title that follows the selected range via `isYtdRange`/`rangeLabel`, donut centre caption, Avg price per MT in whole dollars). Take those from our repository/commits rather than from this prompt; the patch below deliberately excludes them.

## 3. Apply the change
Apply the patch in Appendix A (`git apply --whitespace=nowarn frontend.patch`), add the new files in Appendix B verbatim, then make the two title replacements in `MarginAndMix.jsx` by hand (Appendix A omits that file because our copy contains unrelated earlier edits). If the production tree has diverged, port by hand following section 1.

## 4. Verification checklist
1. `cd frontend && npx eslint src tests && node tests/run-all.mjs && npx vite build` → clean, "ALL UNIT TESTS PASSED".
2. Fresh start with no backend cache: the page shows the full-page **"Loading data…"** with moving progress, then opens with data. Second start (cache present): opens almost immediately, no long indicator.
3. Pill reads "Data through Oct 2026" (or the latest closed month); clicking it opens the popover with the summary and last 6 months; FROM/TO and presets include October.
4. Data Management → Periods: summary line, ⓘ text exactly as above, badges (Oct green; Nov grey/excluded; months with closure-control breaches amber), filters/search work, "Showing x of y" updates.
5. As a data steward: "Mark open" on a month → confirm → indicator → month turns grey/excluded and the pill moves back; "Revert to auto" restores it. "Load all closed periods" in both modes shows per-row Queued/Loading…/Read ✓; concurrent shows several rows loading at once, one-by-one shows one at a time. A non-steward sees no action buttons.
6. Check on a phone width: toolbar wraps, table scrolls horizontally, no horizontal page scroll.
7. Title reads "Gross Profit by product-YTD" in both places.

---
# APPENDIX A — patch for modified files
```diff
diff --git a/frontend/src/App.jsx b/frontend/src/App.jsx
index 8badd5d..d37a410 100644
--- a/frontend/src/App.jsx
+++ b/frontend/src/App.jsx
@@ -1,5 +1,5 @@
 import { useEffect } from 'react';
-import { loadStatus, loadData, useAppState } from './state/store.js';
+import { loadStatus, loadData, waitWhileLoading, useAppState } from './state/store.js';
 import { go, openFromHash } from './state/nav.js';
 import { usePermissions } from './auth/auth.js';
 import { NoAccess } from './auth/NoAccess.jsx';
@@ -11,6 +11,7 @@ import { Admin } from './components/AdminUsers.jsx';
 import { Popover } from './components/Popover.jsx';
 import { DrillDrawer } from './components/DrillDrawer.jsx';
 import { ChatWidget } from './components/ChatWidget.jsx';
+import { LoadingIndicator } from './components/LoadingIndicator.jsx';
 
 /** The application shell: sidebar, the module-aware sticky filter bar, the pages, and the shared overlays (popover, drill-down
     drawer, assistant). It only mounts once the user is signed in (AuthGate). Start-up order is the source's: status, then data, then
@@ -27,6 +28,7 @@ export default function App() {
     window.addEventListener('hashchange', onHash);
     (async function init() {
       await loadStatus();
+      await waitWhileLoading();      // first load / newly closed months: the indicator below shows progress, then the data opens
       if (canSales) await loadData();
       const h = location.hash.slice(1);
       if (h.includes('/')) await openFromHash(h); else go(h || 'overview', false);
@@ -49,6 +51,7 @@ export default function App() {
             {noDashboards ? <NoAccess /> : (
               <>
                 <FilterBar />
+                <LoadingIndicator />
                 {canSales ? <Overview /> : null}
                 {perms.canViewRoute(st.page) ? <ComingSoon /> : null}
                 {perms.canView('data_management') ? <DataManagement /> : null}
diff --git a/frontend/src/components/FilterBar.jsx b/frontend/src/components/FilterBar.jsx
index 7f9781b..d86adf6 100644
--- a/frontend/src/components/FilterBar.jsx
+++ b/frontend/src/components/FilterBar.jsx
@@ -1,10 +1,11 @@
 import { MenuButton } from './MenuButton.jsx';
 import { useEffect, useRef } from 'react';
 import { MODULES, APP_NAME } from '../lib/modules.js';
-import { STATUS_COPY } from '../lib/copy.js';
+import { STATUS_COPY, canOpenDataManagement } from '../lib/copy.js';
 import { mLabel } from '../lib/format.js';
 import { presetsFor, activePresetKey, scopeLabel } from '../lib/derive.js';
 import { buildStatus } from '../lib/views.js';
+import { periodsPopover } from '../lib/periodsView.js';
 import { useAppState, setPreset, setFrom, setTo } from '../state/store.js';
 import { useStickyBar } from '../hooks/useStickyBar.js';
 
@@ -23,6 +24,7 @@ export function FilterBar() {
 
   const d = st.data;
   const status = buildStatus(st);
+  const pp = periodsPopover(st.periods), canLinkPeriods = canOpenDataManagement(st.status);
   const dotProps = key => {
     const o = status[key];
     // a transient message (a failed deep link, a refused action) takes over the red dot until the next load
@@ -67,10 +69,12 @@ export function FilterBar() {
             <span className="lbl">TO</span>
             <select className="sel" id="toSel" value={st.to || (d ? d.allPeriods.at(-1) : '')} onChange={e => setTo(e.target.value)}>{opts}</select>
           </div>
-          <span className="pill" id="dataThroughPill">
+          <button type="button" className="pill pill-btn" id="dataThroughPill" aria-haspopup="dialog" aria-expanded="false"
+            {...(pp ? { 'data-help-title': pp.title, 'data-help-body': pp.body, 'data-help-wide': '1',
+              ...(canLinkPeriods ? { 'data-help-links': JSON.stringify([{ label: 'Open the full Periods panel', act: 'periods' }]) } : {}) } : { disabled: true })}>
             <span className="live" id="dataThroughDot" style={{ background: status.dataThroughDot?.style.background || '' }} />
             Data through <b id="dataThroughVal">{status.dataThroughVal.textContent}</b>
-          </span>
+          </button>
           <button type="button" className="dotwrap warn" id="warnDot" aria-haspopup="dialog" aria-expanded="false" {...dotProps('warnDot')}><i className="sdot" /></button>
           <button type="button" className="dotwrap bad" id="errDot" aria-haspopup="dialog" aria-expanded="false" {...dotProps('errDot')}><i className="sdot" /></button>
         </div>
diff --git a/frontend/src/components/Pages.jsx b/frontend/src/components/Pages.jsx
index 46beb81..ded30e4 100644
--- a/frontend/src/components/Pages.jsx
+++ b/frontend/src/components/Pages.jsx
@@ -2,10 +2,11 @@ import { useEffect, useMemo, useState } from 'react';
 import { MODULES } from '../lib/modules.js';
 import { esc } from '../lib/format.js';
 import { buildValidation } from '../lib/views.js';
-import { useAppState, api, loadStatus, loadData, setSource, flashError } from '../state/store.js';
+import { useAppState, api, loadStatus, setSource, flashError, refreshAll, isLoading } from '../state/store.js';
 import { usePermissions } from '../auth/auth.js';
 import { go, setDataTab } from '../state/nav.js';
 import { Icon } from './Icon.jsx';
+import { PeriodsPanel } from './PeriodsPanel.jsx';
 
 /* Coming-soon placeholder shared by every "soon" module. */
 export function ComingSoon() {
@@ -47,10 +48,11 @@ export function DataManagement() {
   const onTest = async () => { setTesting(true); try { await api('/api/connection-test'); } catch { /* shown by the status below */ } await loadStatus(); setTesting(false); };
   const onRefresh = async () => {
     setRefreshing(true);
-    try { await api('/api/refresh', { method: 'POST', body: '{}' }); await loadStatus(); await loadData(); }
-    catch (e) { flashError(`Refresh refused. ${e.message}`); }
+    try { await refreshAll(); }
+    catch (e) { flashError(`Refresh failed. ${e.message}`); }
     finally { setRefreshing(false); }
   };
+  const loading = isLoading(st);
   const val = useMemo(() => buildValidation(st), [st.validation, st.data, st.from, st.to]);   // eslint-disable-line react-hooks/exhaustive-deps
   const tab = st.dataTab;
   return (
@@ -73,12 +75,15 @@ export function DataManagement() {
             <span className="spacer" />
             <span className={connCls} id="connPill" title={(c && c.detail) || ''}><i />{connTxt}</span>
             <button className="btn" id="btnTest" onClick={onTest}>Test connection</button>
-            {isDataSteward ? <button className="btn" id="btnRefresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</button> : null}
+            {isDataSteward ? <button className="btn" id="btnRefresh" disabled={refreshing || loading} onClick={onRefresh}>{refreshing || loading ? 'Loading…' : 'Refresh'}</button> : null}
           </div>
         </div>
 
+        <div className="level"><span className="n">2</span><span className="t">Periods</span><span className="ln" /></div>
+        <PeriodsPanel />
+
         {isDataSteward ? (<>
-        <div className="level"><span className="n">2</span><span className="t">Load a SAP export</span><span className="ln" /></div>
+        <div className="level"><span className="n">3</span><span className="t">Load a SAP export</span><span className="ln" /></div>
         <div className="cbox" style={{ marginBottom: 16 }}>
           <div className="hd"><div className="t">Load a SAP export</div><div className="d">The file type is detected automatically — Excel exports only</div></div>
           <div style={{ padding: 16 }}>
@@ -91,7 +96,7 @@ export function DataManagement() {
           </div>
         </div>
         </>) : null}
-        <div className="level"><span className="n">3</span><span className="t">Load history</span><span className="src">Audit trail</span><span className="ln" /></div>
+        <div className="level"><span className="n">4</span><span className="t">Load history</span><span className="src">Audit trail</span><span className="ln" /></div>
         <div className="cbox"><div className="scroll">
           <table className="tbl" id="histTbl">
             <thead><tr><th>File</th><th>Loaded</th><th>Periods</th><th>Rows</th><th>Status</th></tr></thead>
diff --git a/frontend/src/state/nav.js b/frontend/src/state/nav.js
index d70150a..1ccc636 100644
--- a/frontend/src/state/nav.js
+++ b/frontend/src/state/nav.js
@@ -57,6 +57,14 @@ export const setDataTab = tab => set({ dataTab: tab });
 /** What a popover footer link does. Re-checks the user's authorization at click time, not only when the link was drawn. */
 export function statusAction(act) {
   if (!canOpenDataManagement(get().status)) return;
+  if (act === 'periods') {
+    go('data'); setDataTab('source');
+    requestAnimationFrame(() => requestAnimationFrame(() => {
+      const el = document.getElementById('periodsPanel');
+      if (el) el.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'start' });
+    }));
+    return;
+  }
   if (act !== 'validation' && act !== 'validation:assumed-zero') return;
   go('data'); setDataTab('validation');
   if (act === 'validation:assumed-zero') {
diff --git a/frontend/src/state/store.js b/frontend/src/state/store.js
index 78847b4..f4035f7 100644
--- a/frontend/src/state/store.js
+++ b/frontend/src/state/store.js
@@ -19,9 +19,14 @@ export function pageFromHash(h) {
   return MODULES.some(m => m.route === first) ? first : first === 'validation' ? 'data' : 'overview';
 }
 
+function readLoadMode() {
+  try { const v = localStorage.getItem('aif.loadMode'); if (v === 'sequential' || v === 'concurrent') return v; } catch { /* storage blocked: default */ }
+  return 'concurrent';
+}
+
 let state = {
   source: 'api', from: null, to: null, preset: null,   // preset = the preset button the user last clicked (see activePresetKey)
-  status: null, data: null, monthData: null, priorPeriodData: null, validation: null, error: null,
+  status: null, periods: null, loadMode: readLoadMode(), data: null, monthData: null, priorPeriodData: null, validation: null, error: null,
   page: pageFromHash(typeof location !== 'undefined' ? location.hash.slice(1) : ''),
   dataTab: typeof location !== 'undefined' && location.hash.slice(1) === 'validation' ? 'validation' : 'source',
   flash: null,            // a transient status-dot message (a failed deep link, a refused action)
@@ -97,9 +102,52 @@ export async function loadData() {
       try { priorPeriodData = await api('/api/data?' + new URLSearchParams({ source: st.source, period: priorCode })); } catch { priorPeriodData = null; }
     }
   }
-  set({ from, to, data, error, validation, monthData, priorPeriodData, flash: null, dataLoading: false });
+  // Period statuses come from the ONE backend helper (periods.get_period_statuses); the panel and the "Data through" popover only render them.
+  const periods = await api('/api/periods?source=' + st.source).catch(() => null);
+  set({ from, to, data, error, validation, monthData, priorPeriodData, periods, flash: null, dataLoading: false });
+}
+
+/** How closed periods are read from SAP: all at once ('concurrent', faster) or 'sequential' (one by one). Remembered on this device. */
+export function setLoadMode(m) {
+  if (m !== 'concurrent' && m !== 'sequential') return;
+  set({ loadMode: m });
+  try { localStorage.setItem('aif.loadMode', m); } catch { /* per-device convenience only */ }
 }
 
+/** True while the live source is being loaded — at start-up (first load or newly closed months) or after Refresh / Load / Mark. */
+export const isLoading = st => {
+  const a = st.status && st.status.sources && st.status.sources.api;
+  return st.source === 'api' && !!a && !!(a.refreshing || a.warming);
+};
+
+const sleep = ms => new Promise(r => setTimeout(r, ms));
+
+/** Poll the status (which carries per-period progress) until the live load has finished. */
+export async function waitWhileLoading() {
+  while (isLoading(get())) { await sleep(1200); await loadStatus(); }
+}
+
+/** Start a load on the server (it runs in the background, so the page stays responsive and shows progress), wait for it, then reload
+    status + data so every card, the pill and the Periods panel agree. Throws the server's error if the load failed. */
+export async function runLoad(path, body = {}) {
+  const r = await api(path, { method: 'POST', body: JSON.stringify({ ...body, async: true, mode: get().loadMode }) });
+  await loadStatus();
+  await waitWhileLoading();
+  await loadData();
+  const err = get().status.sources.api.error;
+  if (err) throw new Error(err);
+  return r;
+}
+
+/** Mark a month 'Closed' / 'Open' by hand, or back to 'auto' (.env / calendar). The server then re-extracts so the window follows. */
+export const setPeriodStatus = (ym, status) => runLoad(`/api/periods/${ym}/status`, { status });
+
+/** Re-extract the live window for a closed month (read-only from SAP). */
+export const reloadPeriod = ym => runLoad(`/api/periods/${ym}/reload`);
+
+/** Refresh, or load every closed period, in the chosen mode. */
+export const refreshAll = () => runLoad('/api/refresh');
+
 /** A transient dot message outside the normal render cycle — shown until the next load recomputes the real state. */
 export function flashError(msg) { set({ flash: msg }); }
 
diff --git a/frontend/src/styles/components.css b/frontend/src/styles/components.css
index 60cb4f0..a7d729c 100644
--- a/frontend/src/styles/components.css
+++ b/frontend/src/styles/components.css
@@ -917,3 +917,40 @@ svg .cn{display:inline}
 
 /* Data Management's source line wraps instead of being cut off on narrow screens (placed last: the nowrap/ellipsis rule above it has the same specificity) */
 @media(max-width:1080px){.srcbar .meta{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;flex:0 1 auto}}
+/* "Data through" pill is a button (opens the period-status popover); Periods panel */
+.pill-btn{font:inherit;font-size:12px;cursor:pointer}.pill-btn:disabled{cursor:default}.pill-btn:not(:disabled):hover{border-color:#CBD8D1}
+.statepill.bad{background:#F8E3DE;color:#A2402E}
+#periodsTbl .sub{font-size:11px;color:var(--color-tx-3);font-weight:400;text-transform:none;letter-spacing:0;white-space:normal;max-width:260px}
+#periodsTbl td,#periodsTbl th{text-align:left}
+.per-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 16px 12px}
+.per-search{flex:1 1 220px;min-width:180px;cursor:text}
+.per-chk{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--color-tx-2);cursor:pointer}
+.per-count{margin-left:auto;font-size:12px;color:var(--color-tx-3)}
+.per-clear{padding:6px 11px}
+.per-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.per-acts .btn{padding:5px 10px;font-size:12px;white-space:nowrap}
+.per-prog{width:16px;height:16px;display:inline-block}.per-prog i{display:block;width:14px;height:14px;border:2px solid var(--color-line);border-top-color:var(--color-green-d);border-radius:50%;animation:per-spin .8s linear infinite}
+@keyframes per-spin{to{transform:rotate(360deg)}}
+@media (prefers-reduced-motion:reduce){.per-prog i{animation-duration:2.4s}}
+/* "Loading data…" indicator (start-up / refresh) and the Periods load controls */
+.loadind{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid var(--color-line);border-radius:12px;padding:12px 16px;margin:0 0 14px;box-shadow:var(--shadow-card)}
+.loadind.first{flex-direction:column;justify-content:center;text-align:center;padding:56px 24px;margin:24px 0;gap:18px;min-height:240px}
+.loadind-txt{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1;width:100%;max-width:520px}
+.loadind.first .loadind-txt{align-items:center}
+.loadind-txt b{font-size:15px;color:var(--color-tx)}.loadind.first .loadind-txt b{font-size:18px}
+.loadind-sub{font-size:12.5px;color:var(--color-tx-2)}
+.loadind-bar{display:block;height:6px;border-radius:99px;background:#E9EFEC;overflow:hidden;position:relative;width:100%}
+.loadind-bar i{display:block;height:100%;border-radius:99px;background:var(--color-green-d);transition:width .6s ease;position:relative;overflow:hidden}
+.loadind-bar i::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-100%);animation:loadind-sheen 1.3s ease-in-out infinite}
+.loadind-spin{display:inline-flex;gap:5px;align-items:center}
+.loadind.first .loadind-spin i{width:11px;height:11px}
+.loadind-spin i{width:9px;height:9px;border-radius:50%;background:var(--color-green-d);animation:loadind-dot 1.1s ease-in-out infinite}
+.loadind-spin i:nth-child(2){animation-delay:.15s}.loadind-spin i:nth-child(3){animation-delay:.3s}
+@keyframes loadind-dot{0%,80%,100%{transform:scale(.55);opacity:.35}40%{transform:scale(1);opacity:1}}
+@keyframes loadind-sheen{to{transform:translateX(100%)}}
+@media (prefers-reduced-motion:reduce){.loadind-spin i,.loadind-bar i::after,.per-ld i{animation:none}}
+.per-load{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:0 16px 12px}
+.per-load-l{font-size:12.5px;font-weight:600;color:var(--color-tx-2)}
+.per-hint{font-size:11.5px;color:var(--color-tx-3)}
+.per-ld{display:inline-flex;align-items:center;gap:6px;color:var(--color-green-d);font-weight:600}
+.per-ld i{width:11px;height:11px;border:2px solid var(--color-line);border-top-color:var(--color-green-d);border-radius:50%;animation:per-spin .8s linear infinite}
+.per-q{color:var(--color-tx-3);font-size:12px}
diff --git a/frontend/tests/run-all.mjs b/frontend/tests/run-all.mjs
index 8c8e4d5..90e731c 100644
--- a/frontend/tests/run-all.mjs
+++ b/frontend/tests/run-all.mjs
@@ -1,7 +1,7 @@
 // Runs the front-end unit tests (money formatter, module registry). The backend rules (cost conversions, product grouping, overhead
 // rule, aggregation, auth) are tested in Python: npm run test:api. Cross-platform: no shell syntax.
 import { spawnSync } from 'node:child_process';
-const steps = ['tests/format.test.mjs', 'tests/modules.test.mjs', 'tests/teamstats.test.mjs'];
+const steps = ['tests/format.test.mjs', 'tests/modules.test.mjs', 'tests/teamstats.test.mjs', 'tests/periods.test.mjs'];
 let failed = 0;
 for (const f of steps) {
   const r = spawnSync(process.execPath, [f], { stdio: 'inherit' });
```

# APPENDIX B — new files (verbatim)

### `frontend/src/components/PeriodsPanel.jsx`
```jsx
import { useMemo, useState } from 'react';
import { useAppState, reloadPeriod, setPeriodStatus, refreshAll, setLoadMode, isLoading, loadStatus, flashError } from '../state/store.js';
import { usePermissions } from '../auth/auth.js';
import { setDataTab } from '../state/nav.js';
import { formatMoneyCompact } from '../lib/format.js';
import { BADGE_LABEL, filterPeriods, EMPTY_FILTERS } from '../lib/periodsView.js';
import { HelpIcon } from './HelpIcon.jsx';

const TIP = 'A period is included once it is closed in SAP and loaded. Open periods are excluded until month-end close.';
const PILL = { green: 'final', amber: 'provisional', grey: 'none', red: 'bad' };
const SOURCE_NOTE = { manual: ' · set by hand', config: ' · config override' };

/* Data Management → Periods: every month from the window start to the current month. Statuses come from /api/periods (one backend
   helper); the filters and search below only narrow which rows are shown. */
export function PeriodsPanel() {
  const st = useAppState();
  const { isDataSteward } = usePermissions();
  const [busy, setBusy] = useState(null);                  // 'YYYY-MM:action' while a row action runs
  const [f, setF] = useState(EMPTY_FILTERS);
  const p = st.periods;
  const live = st.source === 'api';
  const loading = isLoading(st);
  const canAct = isDataSteward && live;
  const prog = live && st.status && st.status.sources.api.progress;
  const taskOf = r => (loading && prog && prog.phase !== 'done' ? prog.periods[r.period] : null);    // pending | loading | done | error
  const closedCount = p ? p.rows.filter(r => r.closeStatus === 'Closed').length : 0;
  const set = patch => setF(x => ({ ...x, ...patch }));

  const years = useMemo(() => (p ? [...new Set(p.rows.map(r => r.period.slice(0, 4)))] : []), [p]);
  const shown = useMemo(() => (p ? filterPeriods(p.rows, f) : []), [p, f]);
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

  const run = async (r, action, confirmText, fn) => {
    if (!window.confirm(confirmText)) return;
    setBusy(`${r.period}:${action}`);
    try { await fn(); }
    catch (e) { flashError(`${r.label}: ${e.message}`); await loadStatus(); }
    finally { setBusy(null); }
  };
  const READ_ONLY = "SAP is only read, never written to. This re-extracts the live window, which can take about a minute.";
  const onLoad = r => run(r, 'load', `${r.loaded === 'No' ? 'Load' : 'Reload'} ${r.label} from SAP?\n\n${READ_ONLY}`, () => reloadPeriod(r.period));
  const onToggle = r => {
    const to = r.closeStatus === 'Closed' ? 'Open' : 'Closed';
    const effect = to === 'Open'
      ? `${r.label} will be excluded from the dashboard until it is closed again.`
      : `${r.label} will be loaded and included in the dashboard.`;
    return run(r, 'toggle', `Mark ${r.label} as ${to}?\n\nThis is a manual setting in this app. It does not change anything in SAP. ${effect}\n\n${READ_ONLY}`, () => setPeriodStatus(r.period, to));
  };
  const onAuto = r => run(r, 'auto', `Remove the manual setting for ${r.label}?\n\nIt goes back to the configured value or the calendar rule. ${READ_ONLY}`, () => setPeriodStatus(r.period, 'auto'));

  const onLoadAll = async () => {
    const how = st.loadMode === 'concurrent' ? 'concurrently (several at a time)' : 'one by one, in order';
    if (!window.confirm(`Load all ${closedCount} closed periods from SAP ${how}?

${READ_ONLY}`)) return;
    setBusy('all:load');
    try { await refreshAll(); }
    catch (e) { flashError(`Load failed. ${e.message}`); await loadStatus(); }
    finally { setBusy(null); }
  };
  const isBusy = r => busy && busy.startsWith(r.period + ':');
  const off = busy !== null || loading;
  const label = (r, action, idle, working) => (busy === `${r.period}:${action}` ? working : idle);

  return (
    <div className="cbox" id="periodsPanel" style={{ marginBottom: 16 }}>
      <div className="hd">
        <div className="t">Periods <HelpIcon title="Reporting periods" body={TIP} label="ⓘ" ariaLabel="About reporting periods" /></div>
        <div className="d" id="periodsSummary">{p ? p.summary.text : 'Loading…'}</div>
      </div>
      {p && p.rows.some(r => r.closeSource !== 'calendar') ? <div className="qnote" style={{ margin: '0 16px 10px' }}>Close status for some periods is set by hand or by a config override; the rest follow the Africa/Kigali calendar. It is not read from SAP.</div> : null}

      {canAct ? (
        <div className="per-load" id="periodsLoad">
          <span className="per-load-l">Load closed periods</span>
          <div className="seg" role="group" aria-label="How to load">
            <button type="button" className={st.loadMode === 'concurrent' ? 'on' : ''} aria-pressed={st.loadMode === 'concurrent'} disabled={off}
              title="Read several months from SAP at the same time (faster)" onClick={() => setLoadMode('concurrent')}>Concurrently</button>
            <button type="button" className={st.loadMode === 'sequential' ? 'on' : ''} aria-pressed={st.loadMode === 'sequential'} disabled={off}
              title="Read the months one after another, in order (gentler on SAP)" onClick={() => setLoadMode('sequential')}>One by one</button>
          </div>
          <button type="button" className="btn" id="btnLoadAll" disabled={off || !closedCount} onClick={onLoadAll}>{busy === 'all:load' || loading ? 'Loading…' : 'Load all closed periods'}</button>
          <span className="per-hint">Both modes give identical figures. The first load is cached until you refresh.</span>
        </div>
      ) : null}

      <div className="per-tools" id="periodsTools" role="search">
        <input type="search" className="sel per-search" id="periodsSearch" placeholder="Search period, status, reason…" aria-label="Search periods"
          value={f.q} onChange={e => set({ q: e.target.value })} />
        <select className="sel" aria-label="Year" value={f.year} onChange={e => set({ year: e.target.value })}>
          <option value="">All years</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="sel" aria-label="SAP close status" value={f.close} onChange={e => set({ close: e.target.value })}>
          <option value="">Any close status</option><option>Closed</option><option>Open</option><option>Unknown</option>
        </select>
        <select className="sel" aria-label="Loaded" value={f.loaded} onChange={e => set({ loaded: e.target.value })}>
          <option value="">Loaded: any</option><option>Yes</option><option>Partial</option><option>No</option>
        </select>
        <select className="sel" aria-label="Closure controls" value={f.controls} onChange={e => set({ controls: e.target.value })}>
          <option value="">Controls: any</option><option value="ok">OK</option><option value="breach">With breaches</option>
        </select>
        <select className="sel" aria-label="Included in dashboard" value={f.included} onChange={e => set({ included: e.target.value })}>
          <option value="">Included: any</option><option>Yes</option><option>No</option>
        </select>
        <select className="sel" aria-label="Needs attention" value={f.badge} onChange={e => set({ badge: e.target.value })}>
          <option value="">Any badge</option><option value="red">Red — not loaded</option><option value="amber">Amber — attention</option><option value="green">Green — loaded</option><option value="grey">Grey — open</option>
        </select>
        <label className="per-chk"><input type="checkbox" checked={f.newest} onChange={e => set({ newest: e.target.checked })} /> Newest first</label>
        {filtered ? <button type="button" className="btn per-clear" onClick={() => setF(EMPTY_FILTERS)}>Clear filters</button> : null}
        <span className="per-count" id="periodsCount" aria-live="polite">{p ? `Showing ${shown.length} of ${p.rows.length}` : ''}</span>
      </div>

      <div className="scroll">
        <table className="tbl" id="periodsTbl">
          <thead><tr><th>Period</th><th>SAP close status</th><th>Loaded</th><th>Rows loaded</th><th>Revenue loaded</th><th>Closure controls</th><th>Last loaded</th><th>Included in dashboard</th>{canAct ? <th>Actions</th> : null}</tr></thead>
          <tbody>
            {p && shown.length ? shown.map(r => (
              <tr key={r.period} data-period={r.period}>
                <td><b>{r.label}</b></td>
                <td title={r.error || r.reason}><span className={'statepill ' + PILL[r.badge]} data-badge={r.badge}>{r.closeStatus}</span>
                  <div className="sub">{BADGE_LABEL[r.badge]}{SOURCE_NOTE[r.closeSource] || ''}{r.override ? ` (${r.override.by})` : ''}</div></td>
                <td>{taskOf(r) === 'loading' ? <span className="per-ld"><i />Loading…</span>
                  : taskOf(r) === 'pending' ? <span className="per-q">Queued</span>
                  : taskOf(r) === 'done' ? <span className="per-q">Read ✓</span>
                  : r.closeStatus === 'Open' && !r.rows ? '—' : r.loaded}</td>
                <td>{r.rows || '—'}</td>
                <td>{r.rows ? formatMoneyCompact(r.revenue) : '—'}</td>
                <td>{r.closeStatus !== 'Closed' ? '—' : r.breachCount
                  ? <button type="button" className="pop-link" onClick={() => setDataTab('validation')}>{r.breachCount} breach{r.breachCount === 1 ? '' : 'es'} →</button> : 'OK'}</td>
                <td>{r.lastLoaded ? new Date(r.lastLoaded).toLocaleString() : '—'}</td>
                <td title={r.error || r.reason}>{r.included}<div className="sub">{r.reason}</div></td>
                {canAct ? <td><div className="per-acts">
                  {r.closeStatus === 'Closed'
                    ? <button type="button" className="btn" disabled={off} onClick={() => onLoad(r)}>{label(r, 'load', r.loaded === 'No' ? 'Load period' : 'Reload period', r.loaded === 'No' ? 'Loading…' : 'Reloading…')}</button> : null}
                  <button type="button" className="btn" disabled={off} onClick={() => onToggle(r)}>
                    {label(r, 'toggle', r.closeStatus === 'Closed' ? 'Mark open' : 'Mark closed', 'Updating…')}</button>
                  {r.override ? <button type="button" className="btn" disabled={off} title="Remove the manual setting" onClick={() => onAuto(r)}>{label(r, 'auto', 'Revert to auto', 'Updating…')}</button> : null}
                  {isBusy(r) ? <span className="per-prog" role="status" aria-label="Working"><i /></span> : null}
                </div></td> : null}
              </tr>
            )) : <tr><td colSpan={canAct ? 9 : 8} style={{ color: 'var(--color-tx-3)' }}>{!p ? (st.dataLoading ? 'Loading…' : 'Period status unavailable.') : 'No periods match these filters.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

```

### `frontend/src/components/LoadingIndicator.jsx`
```jsx
import { useAppState, isLoading } from '../state/store.js';

/** The animated "Loading data…" indicator. Shown at start-up while the closed periods are loaded for the first time, and again on every
    Refresh / Load. Before any data exists it fills the page; when data is already on screen it is a slim banner above it. Progress is
    the server's own (per-period tasks done of total), so it never guesses. */
export function LoadingIndicator() {
  const st = useAppState();
  if (!isLoading(st)) return null;
  const a = st.status.sources.api, p = a.progress;
  const running = p && p.phase !== 'done' && p.phase !== 'error';
  const costing = running && p.phase === 'costing';
  const inFlight = running ? Object.values(p.periods).filter(v => v === 'loading').length : 0;
  const pct = !running ? 0 : costing ? 92 : Math.min(88, Math.round((p.done / Math.max(1, p.total)) * 88));
  const how = running && p.mode === 'sequential' ? 'one by one' : 'concurrently';
  const sub = !running ? 'Connecting to SAP…'
    : costing ? 'Calculating costs and margins…'
      : `Reading closed periods ${how} — ${p.done} of ${p.total} done${inFlight ? `, ${inFlight} in progress` : ''}`;
  const first = !st.data;
  return (
    <div className={'loadind' + (first ? ' first' : '')} id="loadingIndicator" role="status" aria-live="polite">
      <span className="loadind-spin" aria-hidden="true"><i /><i /><i /></span>
      <div className="loadind-txt">
        <b>Loading data…</b>
        <span className="loadind-sub">{sub}{first ? ' The first load is saved, so next time this opens at once.' : ''}</span>
        <span className="loadind-bar" aria-hidden="true"><i style={{ width: pct + '%' }} /></span>
      </div>
    </div>
  );
}

```

### `frontend/src/lib/periodsView.js`
```js
/* Presentation of period statuses. NO status logic lives here: every status, badge and reason is decided by the backend helper
   (backend/analytics/periods.py get_period_statuses) and only formatted for display. */
import { formatMoneyCompact } from './format.js';

export const BADGE_LABEL = { green: 'Closed · loaded', amber: 'Needs attention', grey: 'Open', red: 'Not loaded' };

/** The popover on the "Data through" pill: the summary line plus the last six months. */
export function periodsPopover(periods) {
  if (!periods || !periods.rows) return null;
  const last = periods.rows.slice(-6);
  const lines = last.map(r => {
    const bits = [r.closeStatus, r.closeStatus === 'Open' ? 'excluded' : r.loaded === 'Yes' ? 'loaded' : r.loaded === 'Partial' ? 'partly loaded' : 'not loaded'];
    if (r.rows) bits.push(formatMoneyCompact(r.revenue));
    if (r.breachCount) bits.push(`${r.breachCount} control breach${r.breachCount === 1 ? '' : 'es'}`);
    return `${r.label} — ${bits.join(' · ')}`;
  });
  return { title: 'Reporting periods', body: [periods.summary.text, lines.join('\n')].join('\n\n') };
}

export const EMPTY_FILTERS = { q: '', year: '', close: '', loaded: '', controls: '', included: '', badge: '', newest: false };

/** Narrow the rows for display (search + filters + order). Pure presentation: it never changes a row's status. */
export function filterPeriods(rows, f) {
  const q = f.q.trim().toLowerCase();
  const hay = r => [r.label, r.code, r.period, r.closeStatus, r.loaded, r.included, r.reason, r.error, BADGE_LABEL[r.badge], r.closeSource === 'calendar' ? '' : 'override manual']
    .filter(Boolean).join(' ').toLowerCase();
  const out = rows.filter(r =>
    (!q || hay(r).includes(q)) &&
    (!f.year || r.period.startsWith(f.year)) &&
    (!f.close || r.closeStatus === f.close) &&
    (!f.loaded || r.loaded === f.loaded) &&
    (!f.included || r.included === f.included) &&
    (!f.badge || r.badge === f.badge) &&
    (!f.controls || (f.controls === 'breach' ? r.breachCount > 0 : r.closeStatus === 'Closed' && r.breachCount === 0)));
  return f.newest ? [...out].reverse() : out;
}

```

### `frontend/tests/periods.test.mjs`
```js
// Period panel filters/search: they only narrow rows; they never alter a status.
import assert from 'node:assert/strict';
import { filterPeriods, EMPTY_FILTERS } from '../src/lib/periodsView.js';

const R = (period, o) => ({ period, code: period.slice(5) + '.' + period.slice(0, 4), label: period, closeStatus: 'Closed', closeSource: 'calendar', loaded: 'Yes', included: 'Yes',
  breachCount: 0, badge: 'green', reason: 'Closed and loaded', error: null, ...o });
const rows = [R('2025-12', { breachCount: 2, badge: 'amber', reason: 'Included — 2 closure-control breach(es)' }), R('2026-09'), R('2026-10', { closeSource: 'manual' }),
  R('2026-11', { closeStatus: 'Open', loaded: 'No', included: 'No', badge: 'grey', reason: 'Open — excluded until month-end close' })];
const ids = f => filterPeriods(rows, { ...EMPTY_FILTERS, ...f }).map(r => r.period);

assert.deepEqual(ids({}), ['2025-12', '2026-09', '2026-10', '2026-11']);
assert.deepEqual(ids({ year: '2026' }), ['2026-09', '2026-10', '2026-11']);
assert.deepEqual(ids({ close: 'Open' }), ['2026-11']);
assert.deepEqual(ids({ included: 'No' }), ['2026-11']);
assert.deepEqual(ids({ controls: 'breach' }), ['2025-12']);
assert.deepEqual(ids({ controls: 'ok' }), ['2026-09', '2026-10']);       // open periods have no controls to be "OK"
assert.deepEqual(ids({ badge: 'grey' }), ['2026-11']);
assert.deepEqual(ids({ q: 'breach' }), ['2025-12']);
assert.deepEqual(ids({ q: '  EXCLUDED ' }), ['2026-11']);
assert.deepEqual(ids({ q: '10.2026' }), ['2026-10']);                   // the app's MM.YYYY code
assert.deepEqual(ids({ q: 'manual' }), ['2026-10']);
assert.deepEqual(ids({ year: '2026', newest: true }), ['2026-11', '2026-10', '2026-09']);
assert.deepEqual(ids({ year: '2025', close: 'Open' }), []);
assert.equal(rows[0].breachCount, 2);                                    // input untouched
console.log('periods filters: ALL CHECKS PASSED');

```

