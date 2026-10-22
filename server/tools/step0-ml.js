// Step 0 — is Material Ledger actual costing active for company code 2000?
import { getJson, getAll, num } from '../api/sap.js';

const MATS = ['11000018', '11000033', '11000013']; // CRS SC+ TENDER, WFP Infant 15kg, MoH Infant 18kg

console.log('--- A_ProductMLAccount (ML activation per material/valuation area) ---');
for (const mat of MATS) {
  try {
    const d = await getJson('product', 'A_ProductMLAccount', { $filter: `Product eq '${mat}'`, $top: 10 });
    const rows = d.results ?? [];
    if (!rows.length) { console.log(`  ${mat}: no ML account rows`); continue; }
    for (const r of rows) {
      const keep = Object.fromEntries(Object.entries(r).filter(([k, v]) =>
        k !== '__metadata' && v !== '' && v != null && v !== false));
      console.log(`  ${mat}:`, JSON.stringify(keep).slice(0, 420));
    }
  } catch (e) { console.log(`  ${mat}: ERROR ${e.message.slice(0, 160)}`); }
}

console.log('\n--- A_ProductMLPrices (periodic unit price / actual cost) ---');
for (const mat of MATS) {
  try {
    const d = await getJson('product', 'A_ProductMLPrices', { $filter: `Product eq '${mat}'`, $top: 6 });
    const rows = d.results ?? [];
    if (!rows.length) { console.log(`  ${mat}: no ML price rows`); continue; }
    for (const r of rows) {
      const keep = Object.fromEntries(Object.entries(r).filter(([k, v]) =>
        k !== '__metadata' && v !== '' && v != null && v !== '0.000' && v !== false));
      console.log(`  ${mat}:`, JSON.stringify(keep).slice(0, 480));
    }
  } catch (e) { console.log(`  ${mat}: ERROR ${e.message.slice(0, 160)}`); }
}
