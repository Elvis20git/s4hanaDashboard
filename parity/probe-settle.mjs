// Probe: do count-up numbers settle to identical text in source and target?
import { chromium } from 'playwright';
const b = await chromium.launch(); const out = {};
for (const [n, u] of [['source', 'http://localhost:5173/'], ['vite', 'http://localhost:5191/']]) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(u, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('marginTile').scrollIntoView({ block: 'center' })); await p.waitForTimeout(4000);
  out[n] = await p.evaluate(() => ['mgPct', 'mgCm', 'hBig'].map(id => id + '=' + document.getElementById(id).textContent.trim()));
  console.log(n, JSON.stringify(out[n]));
}
console.log(JSON.stringify(out.source) === JSON.stringify(out.vite) ? 'SETTLED VALUES IDENTICAL' : 'DIFFERENT');
await b.close();
