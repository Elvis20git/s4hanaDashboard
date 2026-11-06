/* Application state — a small external store (useSyncExternalStore), the React counterpart of the source dashboard's global
   state object S plus its load functions (public/app.js: state, api, loadStatus, loadData). The logic is the source's;
   only "write into the DOM, then renderAll()" became "set(patch), React re-renders".
   One selected source, one selected period range, shared by every panel on the page. */
import { useSyncExternalStore } from 'react';
import { presetsFor } from '../lib/derive.js';
import { pkey } from '../lib/format.js';
import { MODULES } from '../lib/modules.js';
import { collapsed } from '../lib/views.js';
import { closeDrill } from './drill.js';
import { request } from '../lib/http.js';
import { getAuth, canViewKey } from '../auth/auth.js';

export const PAGES = ['overview', 'data', 'admin', 'soon'];

/** The route to show for a URL hash: a module route, else Sales (the source's applyModuleBar / go() rule). */
export function pageFromHash(h) {
  const first = (h || '').split('/')[0];
  return MODULES.some(m => m.route === first) ? first : first === 'validation' ? 'data' : 'overview';
}

function readLoadMode() {
  try { const v = localStorage.getItem('aif.loadMode'); if (v === 'sequential' || v === 'concurrent') return v; } catch { /* storage blocked: default */ }
  return 'concurrent';
}

let state = {
  source: 'api', from: null, to: null, preset: null,   // preset = the preset button the user last clicked (see activePresetKey)
  status: null, periods: null, loadMode: readLoadMode(), data: null, monthData: null, priorPeriodData: null, validation: null, error: null,
  page: pageFromHash(typeof location !== 'undefined' ? location.hash.slice(1) : ''),
  dataTab: typeof location !== 'undefined' && location.hash.slice(1) === 'validation' ? 'validation' : 'source',
  flash: null,            // a transient status-dot message (a failed deep link, a refused action)
  dataLoading: false,     // "Loading…" while a source switch reloads
  navOpen: false,         // the sidebar drawer on narrow screens
  tick: 0,                // bumps when UI-only collapse state changes
};
const subs = new Set();
export const get = () => state;
export function set(patch) { state = { ...state, ...patch }; subs.forEach(f => f()); }
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const useAppState = () => useSyncExternalStore(subscribe, get);

/** The period selection lives in the URL query (not the #hash, which is the route). It is READ here on load, exactly as the
    source does. NOTE (parity): the source defines syncFilterUrl() but never calls it, so the selection is never written back
    to the URL; that behaviour is kept as is — see docs/FRONTEND.md. */
export function syncFilterUrl() {
  try {
    const u = new URL(location.href);
    if (state.from && state.to) { u.searchParams.set('from', state.from); u.searchParams.set('to', state.to); }
    else { u.searchParams.delete('from'); u.searchParams.delete('to'); }
    history.replaceState(null, '', u);
  } catch { /* ignore */ }
}
(function readFilterUrl() {
  try {
    const p = new URLSearchParams(location.search), ok = v => /^\d{2}\.\d{4}$/.test(v || '');
    if (ok(p.get('from')) && ok(p.get('to'))) { state = { ...state, from: p.get('from'), to: p.get('to') }; }
  } catch { /* ignore */ }
})();

/** Every API call goes through the shared wrapper (cookie session, X-AIF-Client header, global 401/403 handling; see lib/http.js). */
export const api = (path, opts = {}) => request(path, opts);

export async function loadStatus() {
  const status = await api('/api/status');
  set({ status, flash: null });   // renderRailFoot / renderAdmin / renderStatus all derive from this
}

export async function loadData() {
  const st = get();
  const q = new URLSearchParams({ source: st.source });
  let from = st.from, to = st.to, data, error;
  if (from && to) { q.set('from', from); q.set('to', to); }
  try { data = await api('/api/data?' + q); error = null; } catch (e) { error = e.message; data = null; }
  // A period from the URL that this dataset does not have (or is back to front) is dropped, falling back to the default below
  if (data && from && !(data.allPeriods.includes(from) && data.allPeriods.includes(to) && pkey(from) <= pkey(to))) { from = to = null; }
  // First load: from/to start null, so the fetch above comes back unscoped (every period). Default to "{year} to date" once
  // we actually know what periods exist, then refetch scoped to it.
  if (data && !from && !to) {
    const def = presetsFor(data.allPeriods).find(p => p.key === 'ytd');
    if (def) { set({ from: def.from, to: def.to }); return loadData(); }
  }
  let validation = null;
  // validation counts belong to Data Management: only users who can open it fetch them (others would get a 403)
  if (st.source === 'api' && canViewKey(getAuth().user, 'data_management')) {
    try { validation = await api('/api/validation?source=api'); } catch { validation = null; }
  }
  // Month-scoped product/customer breakdown, alongside the YTD-in-window one (feeds the Month|YTD columns).
  let monthData = null;
  if (data) {
    const latest = data.periods.at(-1);
    if (latest) {
      try { monthData = await api('/api/data?' + new URLSearchParams({ source: st.source, period: latest.period })); } catch { monthData = null; }
    }
  }
  // The month list's EARLIEST row needs its own predecessor, which can fall outside the current filter (Jan 2026's is Dec 2025).
  let priorPeriodData = null;
  if (data && data.periods.length) {
    const idx = data.allPeriods.indexOf(data.periods[0].period);
    const priorCode = idx > 0 ? data.allPeriods[idx - 1] : null;
    if (priorCode) {
      try { priorPeriodData = await api('/api/data?' + new URLSearchParams({ source: st.source, period: priorCode })); } catch { priorPeriodData = null; }
    }
  }
  // Period statuses come from the ONE backend helper (periods.get_period_statuses); the panel and the "Data through" popover only render them.
  const periods = await api('/api/periods?source=' + st.source).catch(() => null);
  set({ from, to, data, error, validation, monthData, priorPeriodData, periods, flash: null, dataLoading: false });
}

/** How closed periods are read from SAP: all at once ('concurrent', faster) or 'sequential' (one by one). Remembered on this device. */
export function setLoadMode(m) {
  if (m !== 'concurrent' && m !== 'sequential') return;
  set({ loadMode: m });
  try { localStorage.setItem('aif.loadMode', m); } catch { /* per-device convenience only */ }
}

/** True while the live source is being loaded — at start-up (first load or newly closed months) or after Refresh / Load / Mark. */
export const isLoading = st => {
  const a = st.status && st.status.sources && st.status.sources.api;
  return st.source === 'api' && !!a && !!(a.refreshing || a.warming);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Poll the status (which carries per-period progress) until the live load has finished. */
export async function waitWhileLoading() {
  while (isLoading(get())) { await sleep(1200); await loadStatus(); }
}

/** Start a load on the server (it runs in the background, so the page stays responsive and shows progress), wait for it, then reload
    status + data so every card, the pill and the Periods panel agree. Throws the server's error if the load failed. */
export async function runLoad(path, body = {}) {
  const r = await api(path, { method: 'POST', body: JSON.stringify({ ...body, async: true, mode: get().loadMode }) });
  await loadStatus();
  await waitWhileLoading();
  await loadData();
  const err = get().status.sources.api.error;
  if (err) throw new Error(err);
  return r;
}

/** Mark a month 'Closed' / 'Open' by hand, or back to 'auto' (.env / calendar). The server then re-extracts so the window follows. */
export const setPeriodStatus = (ym, status) => runLoad(`/api/periods/${ym}/status`, { status });

/** Re-extract the live window for a closed month (read-only from SAP). */
export const reloadPeriod = ym => runLoad(`/api/periods/${ym}/reload`);

/** Refresh, or load every closed period, in the chosen mode. */
export const refreshAll = () => runLoad('/api/refresh');

/** A transient dot message outside the normal render cycle — shown until the next load recomputes the real state. */
export function flashError(msg) { set({ flash: msg }); }

export function toggleCollapsed(key) {
  collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
  set({ tick: get().tick + 1 });
}

// ---- actions that were event handlers in the source ----
export async function setSource(src) {
  if (src === get().source) return;
  // Never mix the two datasets — clear, then reload from the chosen source alone.
  set({ source: src, data: null, validation: null, dataLoading: true });
  closeDrill();
  await loadStatus(); await loadData();
}
export async function setPreset(key) {
  const st = get(); if (!st.data) return;
  const preset = presetsFor(st.data.allPeriods).find(p => p.key === key); if (!preset) return;
  set({ from: preset.from, to: preset.to, preset: key });
  await loadData();
}
export async function setFrom(v) {
  let { to } = get(); const from = v;
  if (pkey(from) > pkey(to)) to = from;
  set({ from, to, preset: null }); await loadData();
}
export async function setTo(v) {
  let { from } = get(); const to = v;
  if (pkey(to) < pkey(from)) from = to;
  set({ from, to, preset: null }); await loadData();
}
