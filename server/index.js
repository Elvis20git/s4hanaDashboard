// AIF Sales & Contribution Margin Dashboard — local backend.
// Credentials live server-side only and are redacted from everything surfaced.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { CFG, redact } from './lib/env.js';
import { build } from './pipeline/build.js';
import { buildFromFiles } from './pipeline/spreadsheet.js';
import { metadata, stats as sapStats, getByKeys } from './api/sap.js';
import * as cache from './cost/cache.js';
import { aggregate } from './pipeline/aggregate.js';
import { answer as chatAnswer } from './pipeline/chat.js';
import { linkFor, orderCostDetail } from './pipeline/moDetail.js';
import { round2 } from './cost/engine.js';

// ---- Test-only fixture mode (parity harness; see ../MIGRATION.md). When AIF_FIXTURE_DATASET is set the API loads that dataset
// instead of calling SAP, and when AIF_FIXTURE_DIR is set the batch / order drill-downs are served from snapshots captured from
// the source dashboard (<dir>/batch/<id>.json, <dir>/order/<id>.json). Unset = normal, unchanged behaviour.
const FIXTURE_DATASET = process.env.AIF_FIXTURE_DATASET ? path.resolve(process.env.AIF_FIXTURE_DATASET) : null;
const FIXTURE_DIR = process.env.AIF_FIXTURE_DIR ? path.resolve(process.env.AIF_FIXTURE_DIR) : null;
function fixtureReply(res, kind, id) {
  const f = path.join(FIXTURE_DIR, kind, encodeURIComponent(id) + '.json');
  if (!fs.existsSync(f)) return res.status(404).json({ error: `No captured ${kind} snapshot for ${id} (fixture mode).` });
  return res.type('json').send(fs.readFileSync(f, 'utf8'));
}

const app = express();
app.use(express.json({ limit: '64mb' }));

// ---------------------------------------------------------------- access
// Mirrors the existing Administration model: everyone may read the dashboard;
// the listed actions are restricted to authorised users.
const USERS = JSON.parse(fs.readFileSync(path.resolve('config/users.json'), 'utf8'));
const RESTRICTED = ['changeSource', 'importData', 'manageApiConfig', 'adminRefresh', 'manageUsers'];

function currentUser(req) {
  const name = String(req.header('x-aif-user') || '').trim();
  return USERS.people.find(p => p.username.toLowerCase() === name.toLowerCase()) || null;
}
function requireRight(right) {
  return (req, res, next) => {
    const u = currentUser(req);
    if (!u || !u.active) return res.status(401).json({ error: 'Sign-in required for this action.' });
    if (!(u.rights.includes('*') || u.rights.includes(right)))
      return res.status(403).json({ error: `Your account does not carry the "${right}" right.` });
    req.user = u; next();
  };
}

// ---------------------------------------------------------------- state
// `REPORT_TO` removes a period from the dashboard completely, regardless of which
// source serves it. build() already applies it inside the SAP query for the live API
// source, but buildFromFiles() reads a spreadsheet's full contents as given — this is
// the one place both sources are guaranteed to pass through before being stored, so a
// cutoff set here can never be bypassed by switching source.
function capToReportWindow(data) {
  const cutoff = CFG.REPORT_TO;
  if (!cutoff || !data?.lines) return data;
  const pkey = p => p.slice(3) + p.slice(0, 2);
  const cutoffPeriod = cutoff.slice(5, 7) + '.' + cutoff.slice(0, 4);
  const lines = data.lines.filter(l => pkey(l.period) <= pkey(cutoffPeriod));
  if (lines.length === data.lines.length) return data; // already within the window
  const periods = [...new Set(lines.map(l => l.period))].sort((a, b) => pkey(a).localeCompare(pkey(b)));
  return {
    ...data,
    lines,
    periods,
    asOf: cutoff,
    counts: data.counts ? {
      ...data.counts,
      billingDocuments: new Set(lines.map(l => l.billingDocument)).size,
      billingItems: lines.length,
      lines: lines.length,
      products: new Set(lines.map(l => l.material)).size,
      customers: new Set(lines.map(l => l.customer)).size,
    } : data.counts,
  };
}

const state = {
  api: { data: null, error: null, lastRefresh: null, refreshing: false, log: [] },
  spreadsheet: { data: null, error: null, lastRefresh: null, loadHistory: [] },
  connection: { ok: null, checkedAt: null, detail: null },
};

async function refreshApi() {
  if (state.api.refreshing) return state.api;
  state.api.refreshing = true;
  state.api.log = [];
  try {
    const data = capToReportWindow(await build({ log: m => state.api.log.push(m) }));
    state.api.data = data;
    state.api.error = null;
    state.api.lastRefresh = new Date().toISOString();
    fs.mkdirSync('validation', { recursive: true });
    fs.writeFileSync('validation/dataset.json', JSON.stringify(data));
  } catch (e) {
    state.api.error = redact(e.message || String(e));
  } finally {
    state.api.refreshing = false;
  }
  return state.api;
}

function loadSpreadsheets(entries) {
  // entries: [{ name, path }]
  const li = entries.find(e => /line\s*items/i.test(e.name));
  const sv = entries.find(e => /2CCSDREVNFRMINVCQ|sales\s*volume/i.test(e.name));
  const data = capToReportWindow(buildFromFiles({ lineItemsPath: li?.path, salesVolumePath: sv?.path }));
  state.spreadsheet.data = data;
  state.spreadsheet.lastRefresh = new Date().toISOString();
  state.spreadsheet.error = null;
  for (const l of data.loaded) {
    state.spreadsheet.loadHistory.unshift({
      file: l.file, kind: l.kind, rows: l.rows,
      loadedAt: new Date().toISOString(),
      periods: data.periods.length ? `${data.periods.at(-1)} → ${data.periods[0]}` : '—',
      status: 'LOADED',
    });
  }
  return data;
}

// ---------------------------------------------------------------- routes
app.get('/api/status', (req, res) => {
  const u = currentUser(req);
  res.json({
    user: u ? { username: u.username, name: u.name, role: u.role, rights: u.rights } : null,
    restrictedActions: RESTRICTED,
    scope: { from: CFG.PERIOD_FROM, companyCode: CFG.COMPANY_CODE, salesOrg: CFG.SALES_ORG,
             ledger: CFG.LEDGER, currency: 'USD (global currency)', overheadGl: CFG.OVERHEAD_GL },
    connection: state.connection,
    sources: {
      api: { available: !!state.api.data, error: state.api.error, refreshing: state.api.refreshing,
             lastRefresh: state.api.lastRefresh,
             periodFrom: state.api.data?.from ?? null, periodTo: state.api.data?.asOf ?? null,
             cogmAvailable: true, log: state.api.log },
      spreadsheet: { available: !!state.spreadsheet.data, error: state.spreadsheet.error,
             lastRefresh: state.spreadsheet.lastRefresh,
             periodFrom: state.spreadsheet.data?.from ?? null, periodTo: state.spreadsheet.data?.asOf ?? null,
             cogmAvailable: false, loaded: state.spreadsheet.data?.loaded ?? [] },
    },
    cache: cache.stats(),
    sapCalls: sapStats().calls,
  });
});

app.get('/api/connection-test', async (req, res) => {
  try {
    const xml = await metadata('journal');
    state.connection = { ok: true, checkedAt: new Date().toISOString(),
      detail: `Reached ${Object.keys({}).length ? '' : 'YY1_AIF_JOURNAL_REV'} — ${xml.length} bytes of metadata.` };
  } catch (e) {
    state.connection = { ok: false, checkedAt: new Date().toISOString(), detail: redact(e.message) };
  }
  res.json(state.connection);
});

app.get('/api/data', (req, res) => {
  const src = req.query.source === 'spreadsheet' ? 'spreadsheet' : 'api';
  const s = state[src];
  if (s.error) return res.status(502).json({ error: s.error, source: src });
  if (!s.data) return res.status(503).json({ error: `The ${src} source has not been loaded yet.`, source: src });
  res.json(aggregate(s.data, req.query));
});

app.get('/api/lines', (req, res) => {
  const src = req.query.source === 'spreadsheet' ? 'spreadsheet' : 'api';
  const s = state[src];
  if (!s.data) return res.status(503).json({ error: `The ${src} source has not been loaded yet.` });
  const { period, material, customer, billingDocument } = req.query;
  const rows = s.data.lines.filter(l =>
    (!period || l.period === period) &&
    (!material || l.material === material) &&
    (!customer || l.customer === customer) &&
    (!billingDocument || l.billingDocument === billingDocument));
  res.json({ source: src, asOf: s.data.asOf, count: rows.length, rows });
});

app.get('/api/validation', (req, res) => {
  const src = req.query.source === 'spreadsheet' ? 'spreadsheet' : 'api';
  const s = state[src];
  if (!s.data) return res.status(503).json({ error: `The ${src} source has not been loaded yet.` });
  res.json({
    source: src, asOf: s.data.asOf, builtAt: s.data.builtAt,
    controls: s.data.controls ?? { note: 'Controls apply to the live API source only — the spreadsheet source carries no cost chain.' },
  });
});

app.get('/api/batch/:batch', async (req, res) => {
  if (FIXTURE_DIR) return fixtureReply(res, 'batch', req.params.batch);
  const d = state.api.data;
  if (!d) return res.status(503).json({ error: 'The API source has not been loaded yet.' });
  const f = d.frozen.find(x => x.batch === req.params.batch);
  if (!f) return res.status(404).json({ error: `Batch ${req.params.batch} not found.` });
  try {
    const link = await linkFor({ batch: req.params.batch });
    // Cost share, not just quantity share: this order's own total cost,
    // apportioned by its quantity share into THIS batch, as a fraction of
    // the batch's own total apportioned cost. Differs from the quantity
    // share whenever feeding orders carry different per-unit cost rates.
    for (const p of link.pairs) {
      const oc = d.orderCost[p.order]?.cost;
      p.costSharePct = (oc != null && f.cost) ? round2((oc * (p.pctOfOrder / 100)) / f.cost * 100) : null;
    }
    res.json({ ...f, orderDetail: f.orders.map(o => ({ order: o, ...(d.orderCost[o] || {}) })), link });
  } catch (e) { res.status(502).json({ error: redact(e.message) }); }
});

// Manufacturing-order drill-down (mo-drilldown-prompt.md) — the order's own
// full actual cost by component/bucket, plus how it links to the batch(es)
// it fed, compared against the frozen unit cost those batches actually
// carry in the margin figures.
app.get('/api/order/:orderId', async (req, res) => {
  if (FIXTURE_DIR) return fixtureReply(res, 'order', req.params.orderId);
  const d = state.api.data;
  if (!d) return res.status(503).json({ error: 'The API source has not been loaded yet.' });
  const orderId = req.params.orderId;
  try {
    const [detail, link] = await Promise.all([orderCostDetail(orderId), linkFor({ order: orderId })]);
    if (!detail.lineCount) return res.status(404).json({ error: `No cost postings found for order ${orderId}.` });
    const compareBatches = link.batches.map(({ batch }) => {
      const f = d.frozen.find(x => x.batch === batch);
      const pair = link.pairs.find(p => p.order === orderId && p.batch === batch);
      const costSharePct = f?.cost && pair?.pctOfOrder != null
        ? round2((detail.totalCost * (pair.pctOfOrder / 100)) / f.cost * 100) : null;
      if (!f || f.unitCostPerKg == null || detail.actualCostPerKg == null)
        return { batch, unitCostPerKg: f?.unitCostPerKg ?? null, diffPerKg: null, diffPct: null, reason: null, costSharePct };
      const diffPerKg = round2(f.unitCostPerKg - detail.actualCostPerKg);
      const feedingOrders = link.pairs.filter(p => p.batch === batch).length;
      let reason = null;
      if (Math.abs(diffPerKg) < 0.005) reason = null;
      else if (feedingOrders > 1) reason = `This batch blends ${feedingOrders} orders at different actual cost rates — its frozen cost is a weighted average, not this order's own rate.`;
      else if (!f.final) reason = 'Batch cost is still provisional — the order was open or the period not yet closed when it was frozen.';
      return { batch, unitCostPerKg: f.unitCostPerKg, diffPerKg, diffPct: detail.actualCostPerKg ? round2(diffPerKg / detail.actualCostPerKg * 100) : null, reason, costSharePct };
    });
    let productName = d.productName?.[detail.product] || detail.product;
    const materialCodes = detail.materials.map(m => m.component).filter(c => /^\d/.test(c));
    if (materialCodes.length) {
      try {
        const descRows = await getByKeys('product', 'A_ProductDescription', 'Product', materialCodes,
          { params: { $filter: "Language eq 'EN'", $select: 'Product,ProductDescription' } });
        const names = Object.fromEntries(descRows.map(r => [r.Product, r.ProductDescription]));
        for (const m of detail.materials) m.componentName = names[m.component] || m.component;
      } catch { for (const m of detail.materials) m.componentName = m.component; }
    }
    res.json({ ...detail, productName, link, compareBatches });
  } catch (e) { res.status(502).json({ error: redact(e.message) }); }
});

app.post('/api/refresh', requireRight('adminRefresh'), async (req, res) => {
  if (FIXTURE_DATASET) return res.json({ ok: true, error: null, lastRefresh: state.api.lastRefresh, log: state.api.log });   // fixture mode: nothing to refresh
  const s = await refreshApi();
  res.json({ ok: !s.error, error: s.error, lastRefresh: s.lastRefresh, log: s.log });
});

app.post('/api/spreadsheet/load', requireRight('importData'), (req, res) => {
  try {
    const entries = (req.body.files || []).map(f => ({ name: f.name, path: path.resolve(f.path) }));
    if (!entries.length) return res.status(400).json({ error: 'No files given.' });
    const d = loadSpreadsheets(entries);
    res.json({ ok: true, loaded: d.loaded, counts: d.counts, history: state.spreadsheet.loadHistory });
  } catch (e) { res.status(400).json({ error: redact(e.message) }); }
});

app.get('/api/admin/people', requireRight('manageUsers'), (req, res) =>
  res.json({ people: USERS.people.map(({ username, name, role, rights, active }) => ({ username, name, role, rights, active })) }));

app.get('/api/load-history', (req, res) => res.json({ history: state.spreadsheet.loadHistory }));

// Chat is a local, rule-based lookup over the already-aggregated data — no external
// API call, nothing it says can disagree with the dashboard's own cards, and nothing it
// says is fabricated: a question it can't map to a figure gets a fallback, not a guess.
app.post('/api/chat', (req, res) => {
  const src = req.body?.source === 'spreadsheet' ? 'spreadsheet' : 'api';
  const s = state[src];
  if (!s.data) return res.status(503).json({ reply: `The ${src} source has not been loaded yet.`, kind: 'text' });
  const { message, period, material, customer, from, to } = req.body || {};
  try {
    const result = chatAnswer(s.data, { period, material, customer, from, to }, message);
    res.json(result);
  } catch (e) {
    res.status(500).json({ reply: 'Something went wrong answering that — try rephrasing.', kind: 'text', error: redact(e.message) });
  }
});

app.get('/api/export/validation.csv', (req, res) => {
  const d = state.api.data;
  if (!d) return res.status(503).send('The API source has not been loaded yet.');
  const c = d.controls;
  const out = [];
  out.push('section,key,value1,value2,value3,note');
  for (const r of c.reconciliation.rows)
    out.push(`reconciliation,${r.period},${r.revenue},${r.target},${r.diff},${r.pass ? 'tie' : 'DIFFERENCE'}`);
  out.push(`reconciliation,YTD,${c.reconciliation.total.revenue},${c.reconciliation.total.target},${c.reconciliation.total.diff},${c.reconciliation.pass ? 'tie' : 'DIFFERENCE'}`);
  for (const r of c.coverage)
    out.push(`costing,${r.period},${r.revenueNotCosted},${r.cm},,not-costed revenue and CM`);
  for (const b of c.batchClosure.breaches)
    out.push(`batch-closure-breach,${b.batch},${b.batchCost},${b.allocatedCogm},${b.ratio},allocated COGM exceeds batch cost`);
  for (const b of c.orderClosure.breaches)
    out.push(`order-closure-breach,${b.order},${b.expected},${b.distributed},${b.diff},order cost not fully distributed`);
  for (const b of c.quantityControl.breaches)
    out.push(`quantity-breach,${b.batch},${b.deliveredKg},${b.producedKg},${b.excessKg},delivered exceeds net produced`);
  for (const m of c.missingCost)
    out.push(`missing-cost,${m.billingDocument}-${m.billingItem},${m.material},${m.revenueUsd},${m.batch ?? ''},"${m.reason}"`);
  for (const m of c.conversionIssues)
    out.push(`conversion,${m.billingDocument}-${m.billingItem},${m.material},${m.qty},${m.unit},"${m.reason}"`);
  for (const m of c.unmatchedRecords)
    out.push(`unmatched,${m.billingDocument},${m.material},${m.revenueUsd},,"${m.reason}"`);
  res.type('text/csv').attachment('aif-validation.csv').send(out.join('\n'));
});

app.use(express.static(path.resolve('public')));

const port = Number(CFG.PORT || process.env.PORT || 5173);
app.listen(port, async () => {
  console.log(`AIF dashboard on http://localhost:${port}`);
  // Warm both sources so the dashboard opens with data.
  try {
    loadSpreadsheets([
      { name: 'Line Items 01.01.2026 - 15.10.2026.xlsx', path: path.resolve('Line Items 01.01.2026 - 15.10.2026.xlsx') },
      { name: '20261015-175119_2CCSDREVNFRMINVCQ.xlsx', path: path.resolve('20261015-175119_2CCSDREVNFRMINVCQ.xlsx') },
    ]);
    console.log('  spreadsheet source loaded');
  } catch (e) { state.spreadsheet.error = redact(e.message); console.log('  spreadsheet source failed:', state.spreadsheet.error); }
  if (FIXTURE_DATASET) {
    try {
      const data = JSON.parse(fs.readFileSync(FIXTURE_DATASET, 'utf8'));
      state.api.data = data; state.api.error = null; state.api.lastRefresh = data.builtAt || new Date().toISOString();
      state.connection = { ok: true, checkedAt: new Date().toISOString(), detail: 'Fixture dataset — no SAP connection (test mode)' };
      console.log('  FIXTURE MODE — dataset loaded from', FIXTURE_DATASET);
    } catch (e) { state.api.error = redact(e.message); console.log('  fixture load failed:', state.api.error); }
    return;
  }
  try {
    const xml = await metadata('journal');
    state.connection = { ok: true, checkedAt: new Date().toISOString(), detail: `Connected — ${xml.length} bytes of metadata.` };
    console.log('  SAP connection OK — building live dataset…');
    await refreshApi();
    console.log(state.api.error ? `  live build FAILED: ${state.api.error}` : '  live dataset ready');
  } catch (e) {
    state.connection = { ok: false, checkedAt: new Date().toISOString(), detail: redact(e.message) };
    console.log('  SAP connection failed:', state.connection.detail);
  }
});
