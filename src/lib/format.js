/* Number, money and label formatters — ported unchanged from the source dashboard (public/app.js primitives +
   public/format.js). Pure functions; nothing here touches the DOM. */

export const MOF = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Series palette — verbatim from the production design system (ten colours, assigned by index).
export const PAL = ['#1B7A54', '#3FA378', '#C9922E', '#B5462F', '#5B8C7B', '#8FB8A3', '#D4A85A', '#7A9E8C', '#A56A52', '#6B9E82'];

export const fmtUSD = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
// moneyShort in the reference: always one decimal in the K range ("$816.3K", never "$816K").
export const fmtK = n => {
  const s = n < 0 ? '-' : '', a = Math.abs(n);
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
  return s + '$' + Math.round(a);
};
// B/M/K, one decimal throughout — scoped to the Sales by product table.
export const fmtBMK = n => {
  const s = n < 0 ? '-' : '', a = Math.abs(n);
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
  return s + '$' + Math.round(a);
};
export const fmtMT = n => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' MT');
// Whole numbers drop the decimals (100.00% -> 100%); anything with a real fractional part keeps 2dp.
export const fmtPct = n => {
  if (n == null) return 'N/A';
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? r : r.toFixed(2)) + '%';
};
export const mLabel = p => MOF[+p.slice(0, 2) - 1] + ' ' + p.slice(3);
export const pkey = p => p.slice(3) + p.slice(0, 2);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const qtyFmt = v => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtKg = kg => (kg == null ? '—' : kg.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' kg');
export const mLabelFromDate = d => { if (!d) return '—'; const [y, m] = d.split('-'); return MOF[+m - 1] + ' ' + y; };
// Derived from a real Date, not a hardcoded lookup.
export const monAbbr = period => new Date(+period.slice(3), +period.slice(0, 2) - 1, 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
export const yr2 = period => period.slice(5);
export const fmtAvgKg = n => '$' + n.toFixed(3);

/* ---- compact money for tooltips (was public/format.js) ---- */
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
// 2 decimals unless the rounded value is whole: 2 -> "2", 1.5 -> "1.50", 230.01 -> "230.01"
const dec = n => { const r = r2(n); return Number.isInteger(r) ? String(r) : r.toFixed(2); };
const UNITS = [['B', 1e9], ['M', 1e6], ['K', 1e3]];

/** 2662998 -> "$2.66M", 230000 -> "$230K", 949.5 -> "$949.50", -15800 -> "-$15.80K", 999996 -> "$1M", 0 -> "$0". */
export function formatMoneyCompact(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let i = UNITS.findIndex(u => abs >= u[1]);       // -1 = below 1,000
  let text;
  if (i === -1) {
    // 999.996 rounds up to 1,000: roll over to K instead of printing "$1000"
    text = r2(abs) >= 1000 ? '$1K' : '$' + dec(abs);
  } else {
    // a value that rounds up to 1,000 of its unit (999,996 -> 1,000K) rolls over to the next unit up
    while (i > 0 && r2(abs / UNITS[i][1]) >= 1000) i--;
    text = '$' + dec(abs / UNITS[i][1]) + UNITS[i][0];
  }
  const zero = r2(abs) === 0 && i === -1;           // -0.001 is "$0", never "-$0"
  return (value < 0 && !zero ? '-' : '') + text;
}

/** Average price per kg with the same decimals rule: 1.51 -> "$1.51 /kg", 2 -> "$2 /kg". */
export function formatAvgPriceKg(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return (value < 0 && r2(Math.abs(value)) !== 0 ? '-' : '') + '$' + dec(Math.abs(value)) + ' /kg';
}
