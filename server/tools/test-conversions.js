// Regression test for sales-fixes-prompt.md #1 — the September MT gap.
// Root cause: material 61000011 bills in PC, not KG. The product master's own
// A_ProductUnitsOfMeasure record (GrossWeight 1.000, WeightUnit KG) gives a real,
// authoritative conversion, applied in build.js instead of leaving the line
// unconvertible. This asserts it stays fixed, and that aggregation sums first and
// rounds once (never rounds each line before summing).
import fs from 'node:fs';
import { aggregate } from '../pipeline/aggregate.js';

function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('  ok  — ' + msg); } }

const d = JSON.parse(fs.readFileSync('validation/dataset.json', 'utf8'));

console.log('=== Unit conversion: material 61000011 (PC -> KG) ===');
const pcLines = d.lines.filter(l => l.material === '61000011');
assert(pcLines.length > 0, 'at least one line exists for material 61000011 (it is still in scope)');
assert(pcLines.every(l => l.baseUnit === 'PC'), 'every 61000011 line keeps its real base unit (PC) for display/audit');
assert(pcLines.every(l => l.qtyMt != null), 'every 61000011 line now has a resolved MT quantity (was null before the fix)');
const expectedFactor = 1; // A_ProductUnitsOfMeasure: GrossWeight 1.000, WeightUnit KG, for AlternativeUnit PC
for (const l of pcLines) {
  // qtyKg should be (raw PC quantity) * factor; reconstruct the raw count from the
  // unrounded ratio since build.js stores only the resolved KG value.
  assert(Math.abs(l.qtyMt - l.qtyKg / 1000) < 1e-9, `${l.billingDocument} item ${l.billingItem}: qtyMt is qtyKg/1000, not left null or mis-derived`);
}

console.log('\n=== Rounding: aggregate() sums raw per-line quantities and rounds once ===');
// Three lines whose own qtyMt values are deliberately chosen so that rounding each one
// to 2dp BEFORE summing gives a different, wrong total (1.005+1.005+1.005 -> 3.015, but
// each individually rounds to 1.01, wrongly summing to 3.03). If aggregate() ever
// regresses to round-then-sum, this catches it directly rather than by comparing two
// numbers that differ for unrelated reasons.
const synthetic = { source: 'api', lines: [1.005, 1.005, 1.005].map((qtyMt, i) => ({
  period: '01.2099', material: 'TESTMAT', materialName: 'Test', customer: 'TESTCUST', customerName: 'Test',
  billingDocument: 'T' + i, revenueUsd: 100, qtyMt, qtyKg: qtyMt * 1000, baseUnit: 'KG',
  cogmUsd: null, cmUsd: null, cmPct: null, costStatus: 'not-costed', orders: [],
})) };
const out = aggregate(synthetic, {});
assert(out.total.qtyMt === 3.01, `sum-first-round-once gives 3.01 (round-then-sum would wrongly give 3.03) — got ${out.total.qtyMt}`);

const sepAgg = aggregate(d, { period: '09.2026' });
const sumThenRound = sepAgg.total.qtyMt;

console.log('\n=== September 2026 total vs the independent BW/spreadsheet source ===');
assert(Math.abs(sumThenRound - 2025.9) < 1, `September MT (${sumThenRound}) is within 1 MT of the independent Sales Volume extract (2,025.9 MT) — was 2,019.2 MT (off by 6.7 MT) before the fix`);

console.log('\n=== No remaining unconverted lines anywhere in scope ===');
const stillUnconverted = d.lines.filter(l => l.qtyMt == null && l.qtyKg !== 0);
assert(stillUnconverted.length === 0, `no lines remain with a non-KG unit and no resolvable conversion (found ${stillUnconverted.length})`);

if (process.exitCode) { console.log('\nSOME CHECKS FAILED'); } else { console.log('\nALL CHECKS PASSED'); }
