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
