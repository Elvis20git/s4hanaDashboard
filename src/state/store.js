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

export const PAGES = ['overview', 'data', 'admin', 'soon'];

/** The route to show for a URL hash: a module route, else Sales (the source's applyModuleBar / go() rule). */
export function pageFromHash(h) {
  const first = (h || '').split('/')[0];
  return MODULES.some(m => m.route === first) ? first : first === 'validation' ? 'data' : 'overview';
}

let state = {
  source: 'api', from: null, to: null,
  status: null, data: null, monthData: null, priorPeriodData: null, validation: null, error: null,
  user: 'Derrick-a',
  page: pageFromHash(typeof location !== 'undefined' ? location.hash.slice(1) : ''),
  dataTab: typeof location !== 'undefined' && location.hash.slice(1) === 'validation' ? 'validation' : 'source',
  flash: null,            // a transient status-dot message (a failed deep link, a refused action)
  dataLoading: false,     // "Loading…" while a source switch reloads
  tick: 0,                // bumps when UI-only collapse state changes
};
const subs = new Set();
export const get = () => state;
export function set(patch) { state = { ...state, ...patch }; subs.forEach(f => f()); }
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const useAppState = () => useSyncExternalStore(subscribe, get);

/** The period selection lives in the URL query (not the #hash, which is the route). It is READ here on load, exactly as the
    source does. NOTE (parity): the source defines syncFilterUrl() but never calls it, so the selection is never written back
    to the URL; that behaviour is reproduced as is — see MIGRATION.md. */
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

export async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'x-aif-user': state.user, ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function loadStatus() {
  const status = await api('/api/status');
  set({ status, flash: null });   // renderRailFoot / renderAdmin / renderStatus all derive from this
}

export async function loadData() {
  const st = get();
  const q = new URLSearchParams({ source: st.source });
  let from = st.from, to = st.to, data = null, error = null;
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
  if (st.source === 'api') {
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
  set({ from, to, data, error, validation, monthData, priorPeriodData, flash: null, dataLoading: false });
}

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
  set({ from: preset.from, to: preset.to });
  await loadData();
}
export async function setFrom(v) {
  let { to } = get(); const from = v;
  if (pkey(from) > pkey(to)) to = from;
  set({ from, to }); await loadData();
}
export async function setTo(v) {
  let { from } = get(); const to = v;
  if (pkey(to) < pkey(from)) from = to;
  set({ from, to }); await loadData();
}
export async function setUser(user) { set({ user }); await loadStatus(); }
