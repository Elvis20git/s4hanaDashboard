/* Routing — ported from the source's go() / openFromHash() / status-dot link action. Hash routes (#production, #product/<code>…)
   exactly as before; the period selection is separate global state. */
import { MODULES } from '../lib/modules.js';
import { canOpenDataManagement } from '../lib/copy.js';
import { RM } from '../lib/anim.js';
import { get, set, api, flashError, PAGES } from './store.js';
import { getAuth, canViewKey, canViewRoute, firstAllowedRoute } from '../auth/auth.js';
import * as D from './drillViews.js';

/* A drill view is addressable, so a cost trace can be linked to and reopened:
     #product/11000018              #customer/1000002
     #period/09.2026                #doc/90000733
     #batch/CRS260708                                                        */
export async function openFromHash(h) {
  const [kind, a] = h.split('/');
  if (!canViewKey(getAuth().user, 'sales')) return false;       // every deep link here is a Sales drill-down
  const q = D.q;
  try {
    if (kind === 'product') return await D.openProduct(a), true;
    if (kind === 'customer') return await D.openCustomer(a), true;
    if (kind === 'period') return await D.openPeriod(a), true;
    if (kind === 'doc') {
      const r = await api('/api/lines?' + q({ billingDocument: a }));
      const l = r.rows[0];
      if (!l) return false;
      await D.openDocument(a, { code: l.material, name: l.materialName, period: l.period, kind: 'product' });
      return true;
    }
    if (kind === 'batch') {
      const r = await api('/api/lines?' + q({}));
      const l = r.rows.find(x => x.batch === a);
      if (!l) return false;
      await D.openOrders(a, { code: l.material, name: l.materialName, period: l.period, kind: 'product' }, l.billingDocument);
      return true;
    }
  } catch (e) {
    flashError(`Could not open that link. ${e.message}`);
  }
  return false;
}

export function go(page, push = true) {
  if (page && page.includes('/')) { openFromHash(page); return; }
  // Validation moved under Governance — the old top-level route redirects there rather than 404ing or vanishing.
  if (page === 'validation') { go('data', push); set({ dataTab: 'validation' }); return; }
  const mod = MODULES.find(m => m.route === page && m.status === 'soon');
  if (!mod && !PAGES.includes(page)) page = 'overview';
  // route guard: a page the user may not open is replaced by the first one they may (or the empty state)
  if (!canViewRoute(getAuth().user, page)) page = firstAllowedRoute() || 'noaccess';
  set({ page });
  if (push && location.hash.slice(1) !== page) location.hash = page;
  window.scrollTo(0, 0);
}

export const setDataTab = tab => set({ dataTab: tab });

/** What a popover footer link does. Re-checks the user's authorization at click time, not only when the link was drawn. */
export function statusAction(act) {
  if (!canOpenDataManagement(get().status)) return;
  if (act !== 'validation' && act !== 'validation:assumed-zero') return;
  go('data'); setDataTab('validation');
  if (act === 'validation:assumed-zero') {
    // the Validation tab renders on the next commit; wait for it, then scroll
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById('valAssumedZero');
      if (el) el.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'start' });
    }));
  }
}
