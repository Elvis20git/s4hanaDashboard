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
