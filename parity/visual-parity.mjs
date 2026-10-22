// Visual parity: screenshots of the source (SRC) and AIF-VITE (DST) at 1440/1024/390 for each page, the drill-down drawer and key
// hover / scrolled states, then a pixel diff. Reduced motion is emulated and the chat hint pre-dismissed so both sides are static.
//   SRC=http://localhost:5173 DST=http://localhost:5191 node parity/visual-parity.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
const SRC = process.env.SRC || 'http://localhost:5173', DST = process.env.DST || 'http://localhost:5191';
const OUT = 'parity/out'; fs.mkdirSync(OUT, { recursive: true });
const widths = [1440, 1024, 390];
const steps = {
  overview: async () => {},
  'overview-scrolled': async p => { await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(500); },
  'hover-bar': async p => {
    await p.evaluate(() => document.querySelector('#chart').scrollIntoView({ block: 'center' })); await p.waitForTimeout(400);
    const bx = await p.locator('#chart .bar-hit').nth(4).boundingBox();
    await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height - 12); await p.waitForTimeout(400);
  },
  data: async p => { await p.evaluate(() => (location.hash = '#data')); await p.waitForTimeout(600); },
  validation: async p => { await p.evaluate(() => (location.hash = '#validation')); await p.waitForTimeout(600); },
  admin: async p => { await p.evaluate(() => (location.hash = '#admin')); await p.waitForTimeout(800); },
  soon: async p => { await p.evaluate(() => (location.hash = '#production')); await p.waitForTimeout(600); },
  'drill-product': async p => { await p.evaluate(() => document.querySelector('#prodTbl .rowbtn').click());   // scripted click: at 390px the source's invisible #popScrim swallows real taps (see MIGRATION.md)
    await p.waitForTimeout(1200); },
  'drill-period': async p => { await p.evaluate(() => document.querySelector('#mlist .mrow').click());
    await p.waitForTimeout(1200); },
};
const browser = await chromium.launch();
async function shot(base, w, name) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('aif-hint-done', '1'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await steps[name](p);
  const buf = await p.screenshot({ fullPage: false }); await ctx.close(); return buf;
}
let worst = 0; const rows = [];
for (const name of Object.keys(steps)) for (const w of widths) {
  const [a, b] = [await shot(SRC, w, name), await shot(DST, w, name)];
  const A = PNG.sync.read(a), B = PNG.sync.read(b), diff = new PNG({ width: A.width, height: A.height });
  const n = A.width === B.width && A.height === B.height ? pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold: 0.1 }) : -1;
  const pct = n < 0 ? 100 : n / (A.width * A.height) * 100; worst = Math.max(worst, pct);
  const tag = `${name}-${w}`; fs.writeFileSync(`${OUT}/${tag}.src.png`, a); fs.writeFileSync(`${OUT}/${tag}.dst.png`, b);
  if (n > 0) fs.writeFileSync(`${OUT}/${tag}.diff.png`, PNG.sync.write(diff));
  rows.push(`${tag.padEnd(24)} ${n < 0 ? 'SIZE MISMATCH' : n + ' px (' + pct.toFixed(3) + '%)'}`); console.log(rows.at(-1));
}
await browser.close(); fs.writeFileSync(`${OUT}/visual-report.txt`, rows.join(String.fromCharCode(10)));
// Pass rule: every screenshot within 0.05% of pixels (animation phase, GIF frame). The Data and Administration pages print values that
// depend on the server's own state (load-history rows, frozen-batch cache count, connection-check time) and are reported, not gated.
const ENV_DEPENDENT = /^(data|admin)-/; const gated = rows.filter(r => !ENV_DEPENDENT.test(r));
const over = gated.filter(r => { const m = r.match(/[(]([0-9.]+)%[)]/); return !m || +m[1] > 0.05; });
console.log('worst diff % (all)', worst.toFixed(3), '| gated screenshots over 0.05%:', over.length); over.forEach(r => console.log('  OVER', r)); process.exit(over.length ? 1 : 0);
