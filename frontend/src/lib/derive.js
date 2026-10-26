/* Pure derivations shared by several views — ported unchanged from the source dashboard (public/app.js).
   Where the source read the global state object S, these take the values as arguments. */
import { MOF, mLabel } from './format.js';

/** The three presets, computed fresh from whatever periods the data actually holds — never a hardcoded year. */
export function presetsFor(periods) {
  if (!periods.length) return [];
  const newest = periods.at(-1), oldest = periods[0];
  const year = newest.slice(3);
  const ytdStart = `01.${year}`;
  // 12 calendar months ending at the newest period: first period at or after (newest − 11 months), so a gap in the data cannot shift it
  const [nm, ny] = [+newest.slice(0, 2), +newest.slice(3)];
  const startIdx = ny * 12 + (nm - 1) - 11;
  const last12From = periods.find(p => +p.slice(3) * 12 + (+p.slice(0, 2) - 1) >= startIdx) || oldest;
  return [
    { key: 'ytd', label: `${year} to date`, from: periods.includes(ytdStart) ? ytdStart : oldest, to: newest },
    { key: 'last12', label: 'Last 12 months', from: last12From, to: newest },
    { key: 'all', label: 'All data', from: oldest, to: newest },
  ];
}
/** Which preset (if any) the current from/to exactly matches — null when a hand-picked range lines up with none.
    Presets can resolve to the same range (with fewer than 13 months of data, "Last 12 months" and "All data" equal "<year> to date"),
    so the one the user last clicked (`preferred`) wins while its range still matches; otherwise the first match is used. */
export function activePresetKey(data, from, to, preferred = null) {
  if (!data || !from || !to) return null;
  const hits = presetsFor(data.allPeriods).filter(p => p.from === from && p.to === to);
  return (hits.find(p => p.key === preferred) || hits[0] || {}).key || null;
}
// Matches the production windowLabel exactly: short month + en-dash + full month-with-year when the range sits in one
// year ("Jan–Sep 2026"), full month-with-year on both ends when it spans a year boundary.
export function scopeLabel(data, from, to) {
  if (!data || !from || !to) return '';
  if (from.slice(3) === to.slice(3)) return `${MOF[+from.slice(0, 2) - 1]}–${mLabel(to)}`;
  return `${mLabel(from)} – ${mLabel(to)}`;
}

/** Finished Goods (B2B/B2C) figures of a period row — the basis of the hero Avg price and of everything but the revenue
    columns in the Sales-by-period chart. */
/** Finished Good = material code (leading zeros stripped) starting with 11 — mirrors backend/analytics/productgroup.py. */
export const isFinishedGood = code => String(code ?? '').trim().replace(/^0+/, '').startsWith('11');
export const fgOf = p => (p && p.groups && p.groups.fg) || null;
/** The figures the Margin — contribution card shows: Finished Goods only, in the shape marginBarsHtml takes. The same
    component is used by the product drawer, which passes its own (already FG-only) data instead. */
export const fgView = p => { const g = fgOf(p); return g ? { revenue: g.revenue, cogm: g.cogm, cm: g.cm, cmPct: g.cmPct } : null; };
export const fgAvgMt = p => { const g = fgOf(p); return g && g.qtyMt > 0 ? g.revenue / g.qtyMt : null; };

/** Σ over the periods returned to the drill drawer; ratios come from summed $, never averaged %. */
export function summarisePeriods(periods) {
  const ps = periods.filter(p => p.cogm != null && p.cm != null);
  if (!ps.length) return null;
  const sum = k => ps.reduce((s, p) => s + (p[k] || 0), 0);
  const revenue = sum('revenue'), cogm = sum('cogm'), cm = sum('cm');
  const last = periods.at(-1), first = periods[0];
  const mo = p => MOF[+p.period.slice(0, 2) - 1];
  const rangeLabel = periods.length === 1 ? mLabel(last.period)
    : first.period.slice(3) === last.period.slice(3) ? `${mo(first)}–${mLabel(last.period)}` : `${mLabel(first.period)}–${mLabel(last.period)}`;
  return { revenue, cogm, cm, cmPct: revenue ? cm / revenue * 100 : null, last, lastMo: mo(last), rangeLabel, single: periods.length === 1 };
}

/** One colour per product, shared by the table dots and the donut: Finished Goods in the green family, each Other category in
    its own muted family, lighter shades for smaller items. */
const CAT_HUE = { byproducts: [38, 72], raw: [30, 25], nonstock: [210, 12], misc: [0, 0] };
const FG_RAMP = ['#0B4F34', '#157A4F', '#2E9E69', '#58BA89', '#86D0AB', '#AEE0C6', '#C3E4D2'];
export function productPalette(secs) {
  const map = new Map();
  const shade = (key, rows) => { const [h, sat] = CAT_HUE[key] || CAT_HUE.misc; rows.forEach((r, i) => map.set(r.code, `hsl(${h} ${sat}% ${rows.length < 2 ? 46 : 38 + 26 * i / (rows.length - 1)}%)`)); };
  const fg = secs.find(s => s.key === 'fg'); if (fg) fg.rows.forEach((r, i) => map.set(r.code, FG_RAMP[Math.min(i, FG_RAMP.length - 1)]));
  const oth = secs.find(s => s.key === 'other'); (oth?.categories || []).forEach(c => shade(c.key, c.rows));
  return map;
}
