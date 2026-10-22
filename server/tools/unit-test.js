import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('validation/dataset.json', 'utf8'));
const f = d.frozen.find(x => x.batch === 'CRS260708');
console.log('=== CRS260708 frozen unit cost ===');
console.log('  batch cost (apportioned USD):', f.cost.toFixed(2));
console.log('  batch qty (KG)             :', f.qty.toLocaleString());
console.log('  unit cost USD/MT           :', (f.unitCostPerKg * 1000).toFixed(2));
console.log('  orders                     :', f.orders.join(', '));
console.log('  final                      :', f.final);
console.log('\n  per-order cost:');
for (const o of f.orders) console.log(`    ${o}  ${d.orderCost[o].cost.toFixed(2).padStart(12)}   buckets ${JSON.stringify(Object.fromEntries(Object.entries(d.orderCost[o].buckets).map(([k,v])=>[k,Math.round(v)])))}`);

console.log('\n=== billing document 90000733 ===');
for (const l of d.lines.filter(x => x.billingDocument === '90000733'))
  console.log(`  item ${l.billingItem}  batch ${l.batch}  ${l.qtyMt} MT  rev ${l.revenueUsd.toFixed(2)}  COGM ${l.cogmUsd==null?'N/A':l.cogmUsd.toFixed(2)}  CM ${l.cmUsd==null?'N/A':l.cmUsd.toFixed(2)}  ${l.costStatus}`);
console.log('\n  prompt expects: 24.990 MT CRS260708, unit 1,627.84/MT, COGM 40,679.77');
console.log('  PDF (page 3)  : unit 1,630.63/MT, batch cost 224,488.28');

console.log('\n=== credit note 90000732 (must reverse at the frozen rate) ===');
for (const l of d.lines.filter(x => x.billingDocument === '90000732'))
  console.log(`  item ${l.billingItem}  batch ${l.batch}  ${l.qtyMt} MT  rev ${l.revenueUsd.toFixed(2)}  COGM ${l.cogmUsd==null?'N/A':l.cogmUsd.toFixed(2)}  unitMT ${l.batchUnitCostPerMt}  ${l.costStatus}`);

console.log('\n=== the five credit / reversal lines ===');
const neg = d.lines.filter(l => l.revenueUsd < 0).sort((a,b)=>a.postingDate.localeCompare(b.postingDate));
let s = 0;
for (const l of neg) { s += l.revenueUsd;
  console.log(`  ${l.postingDate}  ${l.billingDocument}  ${l.material}  ${l.revenueUsd.toFixed(2).padStart(12)}  COGM ${l.cogmUsd==null?'N/A':l.cogmUsd.toFixed(2)}`); }
console.log(`  total ${s.toFixed(2)}   (prompt expects -53,307.31 over 5 lines; found ${neg.length})`);
