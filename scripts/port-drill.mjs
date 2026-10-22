// Generates src/state/drillViews.js from the source dashboard's public/app.js (the drill-down levels 1-6).
//   node scripts/port-drill.mjs <path to AIF/public/app.js>
// Same approach as port-views.mjs: the source functions are ported verbatim by line range, with the DOM writes redirected to a
// view object (V) that the React drawer renders, and the per-element click wiring turned into a list of {selector, handler}.
import fs from 'node:fs';
const srcPath = process.argv[2];
if (!srcPath) { console.error('usage: node scripts/port-drill.mjs <app.js>'); process.exit(1); }
const L = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
const range = (a, b) => L.slice(a - 1, b).join('\n');

let body = [
  range(1429, 1433),            // q()
  range(1435, 1448),            // openProduct
  range(1450, 1463),            // openCustomer
  range(1465, 1475),            // paintPeriodRows
  range(1477, 1499),            // openPeriod
  range(1501, 1511),            // openProductPeriod / openCustomerPeriod
  range(1513, 1539),            // paintDocs
  range(1541, 1578),            // openDocument
  range(1580, 1608),            // openOrders
  range(1689, 1744),            // openOrder
].join('\n\n');

const count = (re) => (body.match(re) || []).length;
function swap(re, to, label, expectMin = 1) {
  const n = count(re);
  if (n < expectMin) throw new Error(`no match for ${label}`);
  body = body.replace(re, to);
}
swap(/\$\('dTitle'\)\.textContent = /g, 'V.title = ', 'title');
swap(/\$\('dEyebrow'\)\.textContent = /g, 'V.eyebrow = ', 'eyebrow');
swap(/\$\('dCount'\)\.textContent = /g, 'V.count = ', 'count');
swap(/\$\('dBody'\)\.innerHTML = /g, 'V.body = ', 'body');
// click wiring on the body: $('dBody').querySelectorAll('SEL').forEach(el => el.onclick = RHS);  ->  V.on.push({ sel, fn: el => (RHS)() })
swap(/\$\('dBody'\)\.querySelectorAll\('([^']+)'\)\.forEach\(el => el\.onclick = (.*)\);/g, "V.on.push({ sel: '$1', fn: el => ($2)() });", 'click wiring');
// each open*/paint* entry point starts from a fresh view
swap(/^(async )?function (open\w+)\(([^)]*)\) \{$/gm, '$1function $2($3) {\n  V = fresh();', 'fresh view');
swap(/^function q\(/m, 'export function q(', 'q export');
if (/\$\('d[A-Z]\w*'\)/.test(body)) throw new Error('unported $(...) left in drill code: ' + body.match(/\$\('d[A-Z]\w*'\)/)[0]);
if (/\$\('/.test(body)) throw new Error('unported $() left: ' + body.match(/\$\('[^']*'\)/)[0]);

const header = `/* GENERATED once by scripts/port-drill.mjs from the source dashboard (public/app.js, drill-down levels 1-6); maintained by hand
   afterwards. The source's functions are ported verbatim; the DOM writes go to the view object V (committed to the drill store by
   showPanel) and the click wiring becomes V.on = [{ sel, fn }] which the React drawer applies by event delegation. */
import { api, get } from './store.js';
import { commitDrill } from './drill.js';
import { MOF, fmtUSD, fmtK, fmtMT, fmtPct, mLabel, esc, fmtKg, mLabelFromDate } from '../lib/format.js';
import { TERMS } from '../lib/copy.js';
import { summarisePeriods } from '../lib/derive.js';
import { helpIcon, naCell, cmNaBadge, linkPanelHtml, marginBarsHtml, cn } from '../lib/views.js';

// The source read its global state object S; these are live getters over the same fields.
const S = { get source() { return get().source; }, get from() { return get().from; }, get to() { return get().to; } };

let crumb = [], exportRows = [], exportName = 'export';
const fresh = () => ({ title: '', eyebrow: '', grain: '', stats: [], card: null, crumb: [], body: '', count: '', on: [] });
let V = fresh();

// ---- the view-object stand-ins for the source's DOM helpers ----
function setGrain(html) { V.grain = html || ''; }
function paintCrumb() { V.crumb = crumb.map(c => ({ label: c.label, mono: !!c.mono })); }
/** Called by the drawer when a breadcrumb step is clicked: the same behaviour as the source's click handler. */
export function gotoCrumb(i) { const c = crumb[i]; if (!c) return; crumb = crumb.slice(0, i); c.go(); }
function statCells(cells) { V.card = null; V.stats = cells; }
function paintDrillCard(s) { V.card = s; }
function showPanel(wide = false) { commitDrill({ ...V, crumb: V.crumb, exportRows, exportName }, wide); }
/** The margin card shown in the drawer header — the markup the source built in paintDrillCard. */
export function drillCardHtml(s) {
${range(1236, 1241).replace('el.innerHTML = ', 'return ').replace(/^/gm, '  ')}
}
`;
fs.writeFileSync(new URL('../src/state/drillViews.js', import.meta.url), header + '\n// ---- ported drill-down functions ----\n' + body.replace(/^(async )?function (open\w+)\(/gm, 'export $1function $2(') + '\n');
console.log('wrote src/state/drillViews.js —', (header + body).split('\n').length, 'lines');
