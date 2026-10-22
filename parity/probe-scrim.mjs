import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [n, u] of [['source', 'http://localhost:5173/'], ['vite', 'http://localhost:5191/']]) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 900 } })).newPage();
  await p.goto(u, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  console.log(n, await p.evaluate(() => { const s = document.getElementById('popScrim'); const cs = getComputedStyle(s); return { hiddenAttr: s.hidden, display: cs.display, topAt100_400: document.elementFromPoint(100, 400)?.id || document.elementFromPoint(100, 400)?.className }; }));
}
await b.close();
