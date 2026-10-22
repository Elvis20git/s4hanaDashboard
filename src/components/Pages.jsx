import { useEffect, useMemo, useState } from 'react';
import { MODULES } from '../lib/modules.js';
import { esc } from '../lib/format.js';
import { buildValidation } from '../lib/views.js';
import { useAppState, api, loadStatus, loadData, setSource, setUser, flashError } from '../state/store.js';
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
  const [history, setHistory] = useState(null);
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dropMsg, setDropMsg] = useState(false);

  // load history is re-fetched on every render pass of the dashboard, like the source's renderDataPage
  useEffect(() => { fetch('/api/load-history').then(r => r.json()).then(({ history: h }) => setHistory(h)).catch(() => setHistory([])); }, [st.data]);

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
            <button className="btn" id="btnRefresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>

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
          <button className="btn" id="btnValCsv" onClick={() => { window.location = '/api/export/validation.csv'; }}>Export CSV</button>
        </div>
        <div id="valBody" dangerouslySetInnerHTML={{ __html: val.valBody ? val.valBody.innerHTML : '' }} />
      </div>
    </section>
  );
}

/* Administration (of the source dashboard) — signed-in user picker, restricted-action summary and the people list. */
export function Admin() {
  const st = useAppState();
  const [people, setPeople] = useState(undefined);   // undefined = loading, null = not allowed
  useEffect(() => {
    if (!st.status) return;
    api('/api/admin/people').then(({ people: p }) => setPeople(p)).catch(() => setPeople(null));
  }, [st.status]);
  const status = st.status;
  const u = status && status.user;
  return (
    <section className={'page' + (st.page === 'admin' ? ' on' : '')} id="page-admin">
      <div className="vgrid" id="adminStats">
        {status ? (
          <>
            <div className="vcard"><div className="l">Signed in as</div><div className="v num" style={{ fontSize: 18 }}>{u ? u.name : 'not signed in'}</div><div className="d">{u ? u.role : '—'}</div></div>
            <div className="vcard"><div className="l">Restricted actions</div><div className="v num">{status.restrictedActions.length}</div><div className="d">require an authorised account</div></div>
            <div className={'vcard ' + (status.connection.ok ? 'ok' : 'bad')}><div className="l">SAP connection</div><div className="v num" style={{ fontSize: 18 }}>{status.connection.ok ? 'Connected' : 'Not connected'}</div><div className="d">{status.connection.checkedAt ? new Date(status.connection.checkedAt).toLocaleString() : '—'}</div></div>
            <div className="vcard"><div className="l">Frozen batch costs</div><div className="v num">{status.cache.batches ?? 0}</div><div className="d">{status.cache.final ?? 0} final · cached on disk</div></div>
          </>
        ) : null}
      </div>
      <div className="level"><span className="n">1</span><span className="t">Signed in as</span><span className="ln" /></div>
      <div className="cbox" style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="sel" id="userSel" value={st.user} onChange={e => setUser(e.target.value)}>
            {['Derrick-a', 'Elvis-a', 'viewer'].map(n => <option key={n}>{n}</option>)}
          </select>
          <span className="meta" id="userMeta" style={{ fontSize: 12, color: 'var(--color-tx-2)' }}>
            {status ? (u ? `Rights: ${u.rights.includes('*') ? 'every right' : u.rights.join(', ') || 'read only'}` : 'Unknown user — read only.') : ''}
          </span>
        </div>
      </div>
      <div className="level"><span className="n">2</span><span className="t">People</span><span className="ln" /></div>
      <div id="peopleList">
        {people === null ? <div className="qnote">Managing users requires an authorised account.</div>
          : (people || []).map(p => (
            <div className="person" key={p.username}>
              <div><div className="nm">{p.name}</div><div className="un">@{p.username}</div></div>
              <span className="tag">{p.role}</span><span className="rt">{p.rights.includes('*') ? 'every workstream' : (p.rights.join(', ') || 'read only')}</span>
            </div>
          ))}
      </div>
      <div className="qnote" style={{ margin: '14px 6px' }}>Restricted actions: changing the reporting source, importing or replacing spreadsheet data, managing API configuration, triggering an administrative refresh, and managing users and rights.</div>
    </section>
  );
}
