import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:5191/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
console.log('hBig:', await p.textContent('#hBig').catch(() => null));
console.log('rows in prodTbl:', await p.locator('#prodTbl tr').count());
await p.screenshot({ path: process.argv[3] || 'parity/out/smoke.png', fullPage: false });
console.log(errs.length ? errs.join('\n') : 'no errors'); await b.close();
