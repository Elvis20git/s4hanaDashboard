// Generates src/lib/views.js from the source dashboard's public/app.js.
//   node scripts/port-views.mjs <path to AIF/public/app.js>
//
// The source renders each card by writing markup into elements it looks up with $('id'). To keep every number, string and
// piece of markup identical, the render functions are ported *verbatim* (by line range, checked) and run against a small
// "sink" that records what the source would have written to each id. React components then mount that output. Nothing in the
// business logic is re-typed or re-derived. The output is committed and maintained by hand afterwards; this script documents
// (and reproduces) how it was produced.
import fs from 'node:fs';

const srcPath = process.argv[2];
if (!srcPath) { console.error('usage: node scripts/port-views.mjs <app.js>'); process.exit(1); }
const L = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);          // the source is CRLF; normalise to LF
const range = (a, b) => L.slice(a - 1, b).join('\n');          // 1-based, inclusive
const need = (text, what) => { if (!text) throw new Error('empty slice: ' + what); return text; };
function sub(text, from, to, what) {
  if (!text.includes(from)) throw new Error(`pattern not found (${what}): ${from}`);
  return text.split(from).join(to);
}
const fn = (name, args, parts, scopeNote = '', seedExpr = 'seed') => {
  const body = parts.join('\n');
  return `\n/** Ported from the source's render function (${scopeNote}). Returns what it wrote to each element id. */\n`
    + `export function ${name}(${args}) {\n  const { $, out } = makeSink(${seedExpr});\n  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);\n${body}\n  return out;\n}\n`;
};

let out = `/* GENERATED once by scripts/port-views.mjs from the source dashboard (public/app.js); maintained by hand afterwards.
   Pure view builders: each takes the state object S (same shape as the source's) and returns, per element id, the text /
   markup / attributes the source wrote there. No DOM access. The React components in src/components render this output. */
import { MOF, PAL, fmtUSD, fmtK, fmtBMK, fmtMT, fmtPct, mLabel, pkey, esc, qtyFmt, monAbbr, yr2, fmtAvgKg, formatMoneyCompact, formatAvgPriceKg, fmtKg } from './format.js';
import { HELP, TERMS, STATUS_COPY, VC_DEF, canOpenDataManagement } from './copy.js';
import { presetsFor, activePresetKey, scopeLabel as scopeLabelPure, fgOf, fgView, fgAvgKg, productPalette } from './derive.js';
import { NUM_FMT } from './anim.js';

/** Collapse state for the grouped cards (per viewer, local). Keys: 'prod:fg', 'prod:other', 'cust:fg', 'cust:other', 'leg:...' */
export const collapsed = new Set();

/** Records what the source would have written to each element id. */
function makeSink(seed = {}) {
  const out = {};
  const $ = id => (out[id] ??= Object.assign({
    id, innerHTML: '', textContent: '', className: '', title: '', style: {}, dataset: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    querySelectorAll() { return []; }, classList: { add() {}, remove() {}, toggle() {} },
  }, seed[id] || {}));
  return { $, out };
}
`;

// ---- verbatim helpers ----
out += '\n// ---- helpers (verbatim) ----\n';
out += need(range(46, 47), 'naCell/cmNaBadge') + '\n';
out = sub(out, 'const naCell', 'export const naCell', 'naCell');
out = sub(out, 'const cmNaBadge', 'export const cmNaBadge', 'cmNaBadge');
out += need(range(68, 70), 'estimateTag').replace('function estimateTag', 'export function estimateTag') + '\n';
out += need(range(166, 172), 'helpIcon').replace('function helpIcon(', 'export function helpIcon(').replace('function helpIconDynamic(', 'export function helpIconDynamic(') + '\n';
out += need(range(1058, 1058), 'cn').replace('const cn =', 'export const cn =') + '\n';
out += need(range(834, 834), 'RANKED').replace('const RANKED_VISIBLE_ROWS', 'export const RANKED_VISIBLE_ROWS') + '\n';
out += need(range(848, 855), 'cmDetail').replace('function cmDetail(', 'export function cmDetail(') + '\n';
out += need(range(863, 865), 'monthCell').replace('function monthCell(', 'export function monthCell(') + '\n';
out += need(range(929, 930), 'chev/grpBtn') + '\n';
out += need(range(1201, 1217), 'marginBarsHtml').replace('function marginBarsHtml(', 'export function marginBarsHtml(') + '\n';
out += need(range(1821, 1823), 'section') + '\n';
out += need(range(1616, 1683), 'link panel').replace('function linkPanelHtml(', 'export function linkPanelHtml(') + '\n';

// ---- hero ----
out += fn('buildHero', 'S, seed = {}', [
  need(range(537, 541), 'heroBreakdown'),
  sub(range(543, 599), 'if (!d) return;', 'if (!d) return out;', 'hero'),
], 'renderHero, minus the sparkline call');
// ---- status dots ----
out += fn('buildStatus', 'S, seed = {}', [
  need(range(466, 477), 'setStatusDot'),
  sub(sub(range(483, 532), 'canOpenDataManagement()', 'canOpenDataManagement(S.status)', 'status canOpen'), 'const M = formatMoneyCompact', 'const M = formatMoneyCompact', 'status M'),
], 'renderStatus');
// ---- period chart + month list ----
out += fn('buildPeriod', 'S, chartBox', [
  sub(range(690, 690), 'if (!d) return;', 'if (!d) return out;', 'period'),
  sub(sub(range(691, 788), 'if (!ps.length) { $(\'chart\').innerHTML = \'\'; $(\'mlist\').innerHTML = \'\'; return; }', 'if (!ps.length) { $(\'chart\').innerHTML = \'\'; $(\'mlist\').innerHTML = \'\'; return out; }', 'period empty'), '', '', ''),
  '  out.geo = { pts: ps, W, cxs, cw };',
  range(790, 790),
  range(794, 821),
], 'renderPeriod; the chart box is passed in', '{ chart: { parentElement: { getBoundingClientRect: () => chartBox } } }');
// ---- product / customer tables ----
out += fn('buildProducts', 'S, seed = {}', [sub(range(952, 999), 'if (!d) return;', 'if (!d) return out;', 'products')], 'renderProducts');
out += fn('buildCustomers', 'S, seed = {}', [sub(range(1007, 1040), 'if (!d) return;', 'if (!d) return out;', 'customers')], 'renderCustomers');
// ---- margin card ----
out += fn('buildMargin', 'S, seed = {}', [
  sub(sub(range(1246, 1284), 'if (!d) return;', 'if (!d) return out;', 'margin'), '\n    return;\n', '\n    return out;\n', 'margin return'),
], 'renderMargin');
// ---- donut, legend and profitability table ----
out += fn('buildContribution', 'S, seed = {}', [
  sub(range(1289, 1345), 'if (!d) return;', 'if (!d) return out;', 'contribution'),
  range(1362, 1382),
], 'renderContribution, minus the event wiring');
// ---- validation page ----
out += fn('buildValidation', 'S, seed = {}', [
  sub(sub(range(1749, 1819), '; return; }', '; return out; }', 'validation return'), '', '', ''),
], 'renderValidation');

fs.writeFileSync(new URL('../src/lib/views.js', import.meta.url), out);
console.log('wrote src/lib/views.js —', out.split('\n').length, 'lines');
