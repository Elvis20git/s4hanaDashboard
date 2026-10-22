import { SERVICES, metadata } from '../api/sap.js';
const t0 = Date.now();
for (const name of Object.keys(SERVICES)) {
  process.stdout.write(`${name.padEnd(11)} `);
  try {
    const xml = await metadata(name);
    const sets = [...xml.matchAll(/<EntitySet\s+Name="([^"]+)"/g)].map(m => m[1]);
    console.log(`OK  ${String(xml.length).padStart(7)} bytes  ${sets.length} entity sets`);
    console.log(`            ${sets.slice(0, 14).join(', ')}${sets.length > 14 ? ' …' : ''}`);
  } catch (e) {
    console.log(`FAIL  ${e.status ?? ''} ${e.message.slice(0, 150)}`);
  }
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
