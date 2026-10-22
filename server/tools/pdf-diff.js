import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('validation/dataset.json','utf8'));
const PDF = { '06.2026':1775810.53, '07.2026':2266113.95, '08.2026':1405741.14, '09.2026':2811489.78 };
const mine = {};
for (const l of d.lines) if (l.cogmUsd != null) mine[l.period] = (mine[l.period]||0) + l.cogmUsd;
console.log('period     mine COGM        PDF COGM        difference');
let td=0;
for (const p of Object.keys(PDF)) { const df = mine[p]-PDF[p]; td+=df;
  console.log(`  ${p} ${mine[p].toFixed(2).padStart(14)} ${PDF[p].toFixed(2).padStart(15)} ${df.toFixed(2).padStart(15)}`); }
console.log(`  Jun-Sep total difference ${td.toFixed(2)}`);

// Would charging a whole order (no apportionment) to each batch explain it?
const byBatch = {};
for (const f of d.frozen) byBatch[f.batch] = f;
for (const p of ['07.2026','09.2026']) {
  console.log(`\n--- ${p}: batches sold, and whether their orders also fed other batches ---`);
  const rows = d.lines.filter(l => l.period===p && l.batch && l.cogmUsd!=null);
  const seen = new Set(); let whole = 0, apportioned = 0;
  for (const l of rows) {
    apportioned += l.cogmUsd;
    if (seen.has(l.batch)) continue; seen.add(l.batch);
    const f = byBatch[l.batch]; if (!f) continue;
    const ordersWhole = f.orders.reduce((s,o)=>s + (d.orderCost[o]?.cost||0), 0);
    if (Math.abs(ordersWhole - f.cost) > 1)
      console.log(`   ${l.batch}  apportioned cost ${f.cost.toFixed(2).padStart(12)}  whole-order cost ${ordersWhole.toFixed(2).padStart(12)}  over-charge if not apportioned ${(ordersWhole-f.cost).toFixed(2)}`);
  }
  console.log(`   COGM allocated in ${p}: ${apportioned.toFixed(2)}`);
}
