// Behaviour parity: drill-down drawer CSV exports (client-side) are byte-identical, and the drawer's levels/crumbs/filter behave alike.
//   SRC=http://localhost:5173 DST=http://localhost:5191 node parity/behaviour-parity.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const SRC = process.env.SRC || 'http://localhost:5173', DST = process.env.DST || 'http://localhost:5191';
const b = await chromium.launch(); let bad = 0;
async function run(base) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.waitForSelector('#prodTbl .rowbtn', { timeout: 60000 }); const r = { csv: {}, ui: {} };
  const exp = async tag => { const [d] = await Promise.all([p.waitForEvent('download'), p.click('#dExport')]); const f = `parity/out/${tag}.csv`; await d.saveAs(f); return fs.readFileSync(f); };
  // level 1 — product, level 2 — period within the product, then back through the crumb
  await p.evaluate(() => document.querySelector('#prodTbl .rowbtn').click()); await p.waitForTimeout(900);
  r.ui.title1 = await p.textContent('#dTitle'); r.ui.crumb1 = await p.textContent('#dCrumb'); r.ui.count1 = await p.textContent('#dCount');
  r.csv.product = await exp('p-' + (base === SRC ? 'src' : 'dst'));
  const m = p.locator('#dBody .monthrow').first();
  if (await m.count()) { await m.click(); await p.waitForTimeout(900); r.ui.crumb2 = await p.textContent('#dCrumb'); r.ui.count2 = await p.textContent('#dCount'); r.csv.level2 = await exp('l2-' + (base === SRC ? 'src' : 'dst')); await p.click('#dCrumb .step'); await p.waitForTimeout(600); r.ui.backTitle = await p.textContent('#dTitle'); }
  await p.fill('#dSearch', '2026'); r.ui.filtered = await p.evaluate(() => [...document.querySelectorAll('#dBody .monthrow, #dBody tbody tr, #dBody .doc')].filter(e => e.style.display !== 'none').length);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); r.ui.closed = await p.evaluate(() => !document.getElementById('drill').classList.contains('show'));
  // customer and period drill + sticky bar behaviour
  await p.evaluate(() => document.querySelector('#custTbl .rowbtn').click()); await p.waitForTimeout(900); r.csv.customer = await exp('c-' + (base === SRC ? 'src' : 'dst')); await p.keyboard.press('Escape');
  await p.evaluate(() => window.scrollTo(0, 900)); await p.waitForTimeout(500); r.ui.stuck = await p.evaluate(() => document.getElementById('topBar').className);
  await ctx.close(); return r;
}
const [s, d] = [await run(SRC), await run(DST)];
for (const k of Object.keys(s.csv)) { const same = s.csv[k] && d.csv[k] && Buffer.compare(s.csv[k], d.csv[k]) === 0; if (!same) bad++; console.log('csv', k.padEnd(10), same ? 'IDENTICAL (' + s.csv[k].length + ' bytes)' : 'DIFFERENT'); }
for (const k of Object.keys(s.ui)) { const same = JSON.stringify(s.ui[k]) === JSON.stringify(d.ui[k]); if (!same) { bad++; console.log('ui DIFF', k, JSON.stringify(s.ui[k]), '|', JSON.stringify(d.ui[k])); } }
console.log(`ui checks: ${Object.keys(s.ui).length}, csv checks: ${Object.keys(s.csv).length}, differences: ${bad}`); await b.close(); process.exit(bad ? 1 : 0);
