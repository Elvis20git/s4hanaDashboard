// Independent check: on a settled production order the goods receipt credits
// account 55100000 by exactly the cost accumulated in the buckets. If the bucket
// sum equals -(55100000) the order cost is right, whatever any other report says.
import { getByKeys, num } from '../api/sap.js';
import { inCostBucket } from '../cost/engine.js';
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('validation/dataset.json', 'utf8'));
const orders = Object.keys(d.orderCost);
const rows = await getByKeys('journal', 'YY1_AIF_JOURNAL_REV', 'OrderID', orders,
  { chunk: 50, params: { $filter: `Ledger eq '0L' and CompanyCode eq '2000'` } });
const per = {};
for (const r of rows) {
  const o = per[r.OrderID] ??= { bucket: 0, gr: 0 };
  const v = num(r.AmountInGlobalCurrency);
  if (inCostBucket(r.GLAccount)) o.bucket += v;
  if (r.GLAccount.startsWith('55')) o.gr += v;
}
let agree = 0, close = 0, off = 0, offList = [];
for (const [o, v] of Object.entries(per)) {
  const diff = v.bucket + v.gr;               // bucket cost should equal -(GR credit)
  const rel = v.bucket === 0 ? 0 : Math.abs(diff / v.bucket);
  if (Math.abs(diff) < 0.01) agree++;
  else if (rel < 0.005) close++;
  else { off++; if (offList.length < 10) offList.push([o, v.bucket.toFixed(2), v.gr.toFixed(2), diff.toFixed(2), (rel*100).toFixed(2)+'%']); }
}
console.log(`orders checked: ${Object.keys(per).length}`);
console.log(`  bucket cost == -(GR credit) exactly : ${agree}`);
console.log(`  within 0.5%                         : ${close}`);
console.log(`  differs by more than 0.5%           : ${off}`);
if (offList.length) {
  console.log('\n  order        bucket cost      GR credit         diff      rel');
  for (const r of offList) console.log(`  ${r[0].padEnd(10)} ${r[1].padStart(14)} ${r[2].padStart(14)} ${r[3].padStart(12)} ${r[4].padStart(8)}`);
}
const tb = Object.values(per).reduce((s,v)=>s+v.bucket,0), tg = Object.values(per).reduce((s,v)=>s+v.gr,0);
console.log(`\n  TOTAL bucket cost ${tb.toFixed(2)}   TOTAL GR credit ${tg.toFixed(2)}   net ${(tb+tg).toFixed(2)}  (${(Math.abs(tb+tg)/tb*100).toFixed(3)}% of cost)`);
