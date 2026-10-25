import { useEffect, useMemo, useState } from 'react';
import { MODULES } from '../lib/modules.js';
import { esc } from '../lib/format.js';
import { buildValidation } from '../lib/views.js';
import { useAppState, api, loadStatus, loadData, setSource, flashError } from '../state/store.js';
import { usePermissions } from '../auth/auth.js';
import { go, setDataTab } from '../state/nav.js';
import { Icon } from './Icon.jsx';

/* Coming-soon placeholder shared by every "soon" module. */
export function ComingSoon() {
  const st = useAppState();
  const m = MODULES.find(x => x.route === st.page && x.status === 'soon');
  return (
    <section className={'page' + (m ? ' on' : '')} id="page-soon">
      <div className="soon-page">
        <div className="soon-ico" id="soonIco">{m ? <Icon name={m.icon} /> : null}</div>
        <h2 id="soonTitle">{m ? m.label : ''}</h2>
        <span className="badge mid">In development</span>
        <p id="soonDesc">{m ? m.description || '' : ''}</p>
        <button type="button" className="btn" id="soonBack" onClick={() => go('overview')}>Back to Sales</button>
      </div>
    </section>
  );
}

/* Data Management — the reporting source, SAP export loading, load history, and the Validation tab. */
export function DataManagement() {
  const st = useAppState();
  const { isDataSteward, canExport } = usePermissions();      // uploads / refresh: data stewards; exports: not VIEWERs
  const [history, setHistory] = useState(null);
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dropMsg, setDropMsg] = useState(false);

  // load history is re-fetched on every render pass of the dashboard, like the source's renderDataPage
  useEffect(() => { api('/api/load-history').then(({ history: h }) => setHistory(h)).catch(() => setHistory([])); }, [st.data]);

  const c = st.status && st.status.connection;
  const s = st.status && st.status.sources[st.source];
  const metaHtml = s ? (st.source === 'api'
    ? `Live S/4HANA · <b>${s.periodFrom || '—'} → ${s.periodTo || '—'}</b> · last refresh <b>${s.lastRefresh ? new Date(s.lastRefresh).toLocaleString() : '—'}</b>`
    : `Spreadsheets · <b>${s.periodFrom || '—'} → ${s.periodTo || '—'}</b> · ${(s.loaded || []).map(f => esc(f.file)).join(', ') || 'none loaded'}`) : '—';
  const connCls = testing ? 'conn wait' : c ? 'conn ' + (c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'wait') : 'conn wait';
  const connTxt = testing ? 'testing…' : c ? (c.ok === true ? 'Connected' : c.ok === false ? 'Not connected' : 'checking…') : 'checking…';

  const onTest = async () => { setTesting(true); try { await api('/api/connection-test'); } catch { /* shown by the status below */ } await loadStatus(); setTesting(false); };
  const onRefresh = async () => {
    setRefreshing(true);
    try { await api('/api/refresh', { method: 'POST', body: '{}' }); await loadStatus(); await loadData(); }
    catch (e) { flashError(`Refresh refused. ${e.message}`); }
    finally { setRefreshing(false); }
  };
  const val = useMemo(() => buildValidation(st), [st.validation, st.data, st.from, st.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tab = st.dataTab;
  return (
    <section className={'page' + (st.page === 'data' ? ' on' : '')} id="page-data">
      <div className="seg" id="dataTabSeg" style={{ marginBottom: 16 }}>
        <button className={tab === 'source' ? 'on' : ''} data-tab="source" onClick={() => setDataTab('source')}>Source &amp; load</button>
        <button className={tab === 'validation' ? 'on' : ''} data-tab="validation" onClick={() => setDataTab('validation')}>Validation</button>
      </div>

      <div id="dataTabSource" style={{ display: tab === 'source' ? '' : 'none' }}>
        <div className="level"><span className="n">1</span><span className="t">Reporting source</span><span className="ln" /></div>
        <div className="cbox" style={{ marginBottom: 16 }}>
          <div className="hd"><div className="t">Source</div><div className="d">Every card, chart, table and drill-down answers to whichever source is selected here</div></div>
          <div className="srcbar">
            <div className="seg" id="srcSeg">
              <button className={st.source === 'api' ? 'on' : ''} data-src="api" onClick={() => setSource('api')}>Live APIs</button>
              <button className={st.source === 'spreadsheet' ? 'on' : ''} data-src="spreadsheet" onClick={() => setSource('spreadsheet')}>Local spreadsheets</button>
            </div>
            <span className="meta" id="srcMeta" dangerouslySetInnerHTML={{ __html: metaHtml }} />
            <span className="spacer" />
            <span className={connCls} id="connPill" title={(c && c.detail) || ''}><i />{connTxt}</span>
            <button className="btn" id="btnTest" onClick={onTest}>Test connection</button>
            {isDataSteward ? <button className="btn" id="btnRefresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</button> : null}
          </div>
        </div>

        {isDataSteward ? (<>
        <div className="level"><span className="n">2</span><span className="t">Load a SAP export</span><span className="ln" /></div>
        <div className="cbox" style={{ marginBottom: 16 }}>
          <div className="hd"><div className="t">Load a SAP export</div><div className="d">The file type is detected automatically — Excel exports only</div></div>
          <div style={{ padding: 16 }}>
            <div className="drop" id="drop">Drop an export here, or <b id="chooseFile" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setDropMsg(true)}>choose a file</b>
              <div style={{ fontSize: '11.5px', color: 'var(--color-tx-3)', marginTop: 8 }}>Re-uploading a period replaces it. Loading the same file twice leaves the numbers identical.</div>
            </div>
            <div id="dropMsg" style={{ marginTop: 10 }}>
              {dropMsg ? <div className="qnote">Spreadsheet loading runs server-side from the project folder. Place the export beside the server and use <code>POST /api/spreadsheet/load</code>, or restart the server to pick up the files in place. Restricted to accounts carrying the <b>importData</b> right.</div> : null}
            </div>
          </div>
        </div>
        </>) : null}
        <div className="level"><span className="n">3</span><span className="t">Load history</span><span className="src">Audit trail</span><span className="ln" /></div>
        <div className="cbox"><div className="scroll">
          <table className="tbl" id="histTbl">
            <thead><tr><th>File</th><th>Loaded</th><th>Periods</th><th>Rows</th><th>Status</th></tr></thead>
            <tbody>
              {history && history.length ? history.map((h, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'left' }}>{h.file}<div className="sub">{h.kind}</div></td>
                  <td>{new Date(h.loadedAt).toLocaleString()}</td><td>{h.periods}</td><td>{h.rows}</td>
                  <td><span className="statepill final">{h.status}</span></td>
                </tr>
              )) : <tr><td colSpan={5} style={{ textAlign: 'left', color: 'var(--color-tx-3)' }}>Nothing loaded yet.</td></tr>}
            </tbody>
          </table>
        </div></div>
      </div>

      <div id="dataTabValidation" style={{ display: tab === 'validation' ? '' : 'none' }}>
        <div className="qnote" style={{ margin: '0 0 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span>Controls run on every refresh. A breach localises the error to one step.</span>
          {canExport ? <button className="btn" id="btnValCsv" onClick={() => { window.location = '/api/export/validation.csv'; }}>Export CSV</button> : null}
        </div>
        <div id="valBody" dangerouslySetInnerHTML={{ __html: val.valBody ? val.valBody.innerHTML : '' }} />
      </div>
    </section>
  );
}
