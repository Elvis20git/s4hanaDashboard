/* The drill-down drawer's state — React counterpart of the source's showPanel()/closeDrill() and the module-level view. */
import { useSyncExternalStore } from 'react';

let state = { open: false, wide: false, view: null, token: 0 };
const subs = new Set();
const notify = () => subs.forEach(f => f());
export const getDrill = () => state;
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const useDrill = () => useSyncExternalStore(subscribe, getDrill);

// Focus management for the drawer, matching the production DrillDrawer: on open, remember whatever had focus and move focus into
// the panel itself; on close, give it back.
let opener = null;
export function commitDrill(view, wide = false) {
  opener = document.activeElement;
  state = { open: true, wide, view, token: state.token + 1 };
  document.body.style.overflow = 'hidden';
  notify();
}
export function closeDrill() {
  if (!state.open) return;
  state = { ...state, open: false };
  document.body.style.overflow = '';
  notify();
  if (opener instanceof HTMLElement) opener.focus();
  opener = null;
}
