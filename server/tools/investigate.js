import { getAll, getByKeys, num, odataDate } from '../api/sap.js';
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('validation/dataset.json','utf8'));

console.log('=== WFP260131 — remaining closure breach ===');
const mv = await getAll('orderBatch','YY1_AIF_ORDER_BATCH',{ $filter: `Batch eq 'WFP260131'` },{page:5000});
console.log('  all movement rows for the batch:');
for (const m of mv) console.log(`    mvt ${m.GoodsMovementType} canc=${String(m.GoodsMovementIsCancelled).padEnd(5)} order ${m.ManufacturingOrder||m.OrderID||'∅'} qty ${num(m.QuantityInBaseUnit).toLocaleString().padStart(10)} ${m.MaterialBaseUnit} plant ${m.Plant} ${odataDate(m.PostingDate)} matdoc ${m.MaterialDocument}`);
const live = mv.filter(m=>!m.GoodsMovementIsCancelled).reduce((s,m)=>s+num(m.QuantityInBaseUnit),0);
console.log(`  net produced (101 not cancelled): ${live.toLocaleString()} KG`);
console.log('  billing lines selling this batch:');
let sold=0;
for (const l of d.lines.filter(x=>x.batch==='WFP260131').sort((a,b)=>a.postingDate.localeCompare(b.postingDate))) {
  sold += l.qtyKg;
  console.log(`    ${l.postingDate} doc ${l.billingDocument} it ${l.billingItem} qty ${l.qtyKg.toLocaleString().padStart(10)} KG rev ${l.revenueUsd.toFixed(2).padStart(11)}`);
}
console.log(`  total sold: ${sold.toLocaleString()} KG   excess over produced: ${(sold-live).toLocaleString()} KG (${(sold/live*100-100).toFixed(2)}%)`);

console.log('\n=== CRS260708 cost reconciliation vs prompt figure 224,105.00 ===');
const jl = await getByKeys('journal','YY1_AIF_JOURNAL_REV','OrderID',['1000664','1000681','1000682'],
  { chunk:50, params:{ $filter:`Ledger eq '0L' and CompanyCode eq '2000'` }});
const acc={};
for (const r of jl){ const a=acc[r.GLAccount]??={s:0,dr:0,cr:0,n:0}; const v=num(r.AmountInGlobalCurrency);
  a.s+=v; a.n++; if(v>=0)a.dr+=v; else a.cr+=v; }
console.log('  account    signed          debits        credits   lines  inBucket');
const { inCostBucket } = await import('../cost/engine.js');
let sB=0,dB=0;
for (const [a,v] of Object.entries(acc).sort((x,y)=>y[1].s-x[1].s)) {
  const b=inCostBucket(a);
  if(b){sB+=v.s; dB+=v.dr;}
  console.log(`  ${a} ${v.s.toFixed(2).padStart(13)} ${v.dr.toFixed(2).padStart(14)} ${v.cr.toFixed(2).padStart(14)} ${String(v.n).padStart(6)}  ${b||'-'}`);
}
console.log(`\n  bucket SIGNED total  : ${sB.toFixed(2)}   <- method (rule 4)`);
console.log(`  bucket DEBITS only   : ${dB.toFixed(2)}`);
console.log(`  prompt figure        : 224105.00   diff vs signed ${(sB-224105).toFixed(2)}`);
console.log(`  PDF figure           : 224488.28   diff vs signed ${(sB-224488.28).toFixed(2)}`);
