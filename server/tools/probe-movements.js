import { getAll, num, odataDate } from '../api/sap.js';
const t0 = Date.now();
console.log('Pulling YY1_AIF_ORDER_BATCH (no date filter — rule 2)…');
const rows = await getAll('orderBatch', 'YY1_AIF_ORDER_BATCH', {}, { page: 5000 });
console.log(`rows: ${rows.length}  in ${((Date.now()-t0)/1000).toFixed(1)}s`);

const by = (f) => rows.reduce((m, r) => (m[r[f] ?? '∅'] = (m[r[f] ?? '∅'] || 0) + 1, m), {});
console.log('\nGoodsMovementType:', JSON.stringify(by('GoodsMovementType')));
console.log('IsCancelled      :', JSON.stringify(by('GoodsMovementIsCancelled')));
console.log('Plant            :', JSON.stringify(by('Plant')));
console.log('MaterialBaseUnit :', JSON.stringify(by('MaterialBaseUnit')));
const dates = rows.map(r => odataDate(r.PostingDate)).filter(Boolean).sort();
console.log('PostingDate range:', dates[0], '→', dates.at(-1));
console.log('distinct batches :', new Set(rows.map(r => r.Batch).filter(Boolean)).size);
console.log('distinct orders  :', new Set(rows.map(r => r.ManufacturingOrder || r.OrderID).filter(Boolean)).size);
console.log('blank batch rows :', rows.filter(r => !r.Batch).length);
console.log('blank order rows :', rows.filter(r => !(r.ManufacturingOrder || r.OrderID)).length);
console.log('\nsample:');
for (const r of rows.slice(0, 3)) console.log(' ', JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== '__metadata'))));

// Is CRS260708 present, and which orders fed it?
const crs = rows.filter(r => r.Batch === 'CRS260708');
console.log(`\nCRS260708 rows: ${crs.length}`);
for (const r of crs) console.log(`   mvt ${r.GoodsMovementType} canc=${r.GoodsMovementIsCancelled} order ${r.ManufacturingOrder||r.OrderID} qty ${r.QuantityInBaseUnit} ${r.MaterialBaseUnit} ${odataDate(r.PostingDate)} mat ${r.Material}`);
