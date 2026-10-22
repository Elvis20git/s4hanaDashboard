// Local spreadsheet source — sales reporting only.
// COGM and CM are NOT in these extracts, so every line reports
// "Unavailable — COGM data not included". Never mixed with the API dataset.
import xlsx from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

const KG_PER_MT = 1000;
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Excel serial dates come back as local-midnight Date objects. toISOString() would shift
// them into the previous day on any positive UTC offset, which moves rows between periods.
const ymd = d => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** "11000033 (WFP Infant 15kg)" -> { code: '11000033', name: 'WFP Infant 15kg' } */
function splitCoded(v) {
  const s = String(v ?? '').trim();
  const m = /^(\S+)\s*\((.*)\)$/.exec(s);
  return m ? { code: m[1], name: m[2] } : { code: s, name: s };
}

/** Universal Journal "Display Line Items" export — the revenue control. */
export function parseLineItems(buf) {
  const wb = xlsx.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: null });
  const lines = [];
  for (const r of rows) {
    const date = r['Posting Date'];
    if (!date) continue;
    const d = ymd(date);
    const prod = splitCoded(r['Product Sold']);
    const cust = splitCoded(r['Customer']);
    const led = splitCoded(r['Ledger']);
    lines.push({
      billingDocument: String(r['Reference Document'] ?? ''),
      billingItem: null,
      billingDate: d, postingDate: d,
      period: d.slice(5, 7) + '.' + d.slice(0, 4),
      ledger: led.code,
      material: prod.code, materialName: prod.name,
      customer: cust.code, customerName: cust.name,
      glAccount: splitCoded(r['G/L Account']).code,
      batch: null, qtyKg: null, qtyMt: null, baseUnit: null,
      revenueUsd: round2(-Number(r['Amount in Global Currency'] ?? 0)),
      cogmUsd: null, cmUsd: null, cmPct: null,
      costStatus: 'not-costed',
      costReason: 'Unavailable — VC data not included in the spreadsheet source',
      orders: [],
    });
  }
  return lines;
}

/** "Sales Volume Flexible Analysis" BW crosstab — supplies quantity (KG). */
export function parseSalesVolume(buf) {
  const wb = xlsx.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const measRow = grid.findIndex(r => (r || []).includes('Measures'));
  if (measRow < 0) throw new Error('Sales Volume: "Measures" header row not found');
  const meas = grid[measRow], mon = grid[measRow + 1];
  const dataStart = grid.findIndex((r, i) => i > measRow && r && r[0] && /^\d{6,}$/.test(String(r[0])));
  const out = [];
  for (let i = dataStart; i < grid.length; i++) {
    const r = grid[i]; if (!r || !r[0]) continue;
    const code = String(r[0]), name = String(r[1] ?? code);
    const bd = r[2] instanceof Date ? ymd(r[2]) : null;
    for (let j = 3; j < meas.length; j++) {
      const v = r[j]; if (v == null || v === '') continue;
      const period = String(mon[j]);
      const rec = out.find(x => x.material === code && x.period === period && x.billingDate === bd)
        ?? (out.push({ material: code, materialName: name, period, billingDate: bd, netValue: 0, qtyKg: 0 }), out.at(-1));
      if (meas[j] === 'Net Value') rec.netValue += Number(v);
      else if (meas[j] === 'Sales Volume Qty') rec.qtyKg += Number(v);
    }
  }
  return out;
}

/** Build the spreadsheet-source dataset from whatever files are loaded. */
export function buildFromFiles({ lineItemsPath, salesVolumePath }) {
  const loaded = [];
  let lines = [];
  if (lineItemsPath && fs.existsSync(lineItemsPath)) {
    lines = parseLineItems(fs.readFileSync(lineItemsPath));
    loaded.push({ file: path.basename(lineItemsPath), kind: 'Universal Journal Line Items', rows: lines.length });
  }
  let vol = [];
  if (salesVolumePath && fs.existsSync(salesVolumePath)) {
    vol = parseSalesVolume(fs.readFileSync(salesVolumePath));
    loaded.push({ file: path.basename(salesVolumePath), kind: 'SD Sales Volume (BW crosstab)', rows: vol.length });
  }
  // Quantity comes from the volume extract, apportioned to the journal lines of the same
  // material and period by revenue share. Flagged as derived — it is not line-level source.
  const volBy = {};
  for (const v of vol) {
    const k = v.material + '|' + v.period;
    (volBy[k] ??= { qtyKg: 0, netValue: 0 });
    volBy[k].qtyKg += v.qtyKg; volBy[k].netValue += v.netValue;
  }
  const revBy = {};
  for (const l of lines) {
    const k = l.material + '|' + l.period;
    revBy[k] = (revBy[k] || 0) + l.revenueUsd;
  }
  for (const l of lines) {
    const k = l.material + '|' + l.period;
    const v = volBy[k], tot = revBy[k];
    if (v && tot) {
      l.qtyKg = round2(v.qtyKg * (l.revenueUsd / tot));
      l.qtyMt = round2(l.qtyKg / KG_PER_MT);
      l.qtyDerived = true;
    }
  }
  const periods = [...new Set(lines.map(l => l.period))];
  return {
    source: 'spreadsheet',
    builtAt: new Date().toISOString(),
    asOf: lines.reduce((m, l) => (l.postingDate > m ? l.postingDate : m), ''),
    from: lines.reduce((m, l) => (!m || l.postingDate < m ? l.postingDate : m), ''),
    lines,
    loaded,
    periods,
    counts: {
      billingDocuments: new Set(lines.map(l => l.billingDocument)).size,
      lines: lines.length,
      products: new Set(lines.map(l => l.material)).size,
      customers: new Set(lines.map(l => l.customer)).size,
      batchesSold: 0, ordersUsed: 0, billingItems: lines.length,
    },
    cogmAvailable: false,
  };
}
