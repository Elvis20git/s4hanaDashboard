// Captures the reference-pack screenshots from the RUNNING reference instance and writes INDEX data.
// Read-only: it only drives the browser (clicks, hovers, selects); it changes no application code or data.
// Usage (from frontend/):  npm run capture:reference-pack  [-- baseUrl]      (default http://localhost:5174)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:5174/';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../docs/reference-pack');      // images are written here
const VIEW = { width: 1440, height: 900 };
const rows = [];   // INDEX records

const browser = await chromium.launch();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the assistant's "Ask me about…" hint bubble overlaps content; dismiss it with its own × button (a normal user action)
const dismissHint = async page => { try { await page.waitForSelector('#chatHintX', { state: 'visible', timeout: 8000 }); await page.click('#chatHintX'); await sleep(400); } catch { /* not shown */ } };

async function newPage(viewport = VIEW) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#prodTbl tr.it', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#prodSub')?.textContent.includes('Loading'), null, { timeout: 30000 });
  await dismissHint(page);
  await sleep(300);
  return page;
}
const filters = page => page.evaluate(() => `${document.getElementById('fromSel')?.value} → ${document.getElementById('toSel')?.value}`);
const clean = s => (s || '').replace(/\s+/g, ' ').trim();

async function shot(page, folder, file, rec) {
  const dir = path.join(ROOT, folder); fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, file) });
  const stats = await page.evaluate(() => {
    const d = document.getElementById('drill');
    if (d && d.classList.contains('show')) {
      const t = document.getElementById('dTitle').innerText;
      const st = [...document.querySelectorAll('#dStats .s')].map(s => s.innerText.replace(/\n/g, ' ')).join(' | ');
      const card = document.getElementById('dCard');
      const cm = card && !card.hidden ? ' | card: ' + card.innerText.replace(/\s+/g, ' ').slice(0, 90) : '';
      return `${t} — ${st}${cm}`;
    }
    return `Hero ${document.getElementById('hBig')?.innerText} (${document.getElementById('hScope')?.innerText})`;
  });
  rows.push({ path: `${folder}/${file}`, filters: await filters(page), totals: clean(stats), ...rec });
  console.log('  ', `${folder}/${file}`);
}

/** Wait for the drawer title to change after an action, then let it settle. */
async function drawerSettle(page, prev) {
  await page.waitForFunction(p => {
    const d = document.getElementById('drill'); return d && d.classList.contains('show') && document.getElementById('dTitle').innerText !== p;
  }, prev, { timeout: 20000 });
  await sleep(1700);   // count-up animations run ~0.9 s; capture only the settled numbers
}
const title = page => page.evaluate(() => document.getElementById('dTitle')?.innerText || '');
const crumb = page => page.evaluate(() => document.getElementById('dCrumb')?.innerText.replace(/\s+/g, ' ') || '');
async function mark(page, sel) {   // dashed outline added by this script on the landing image only
  await page.evaluate(s => { const e = document.querySelector(s); if (e) { e.style.outline = '2px dashed #E4572E'; e.style.outlineOffset = '2px'; } }, sel);
}
async function unmark(page, sel) { await page.evaluate(s => { const e = document.querySelector(s); if (e) { e.style.outline = ''; e.style.outlineOffset = ''; } }, sel); }

/** A point on the arc of a donut segment, in page coordinates (the ring is hollow, so a bbox-centre click would miss). */
async function segPoint(page, code) {
  return page.evaluate(c => {
    const s = document.querySelector(`#donut .seg[data-code="${c}"]`), svg = document.getElementById('donut');
    const C = +s.dataset.c, off = +s.dataset.off, len = +s.dataset.len, r = 70;
    const a = ((off + len / 2) / C) * 2 * Math.PI - Math.PI / 2;
    const pt = svg.createSVGPoint(); pt.x = 100 + r * Math.cos(a); pt.y = 100 + r * Math.sin(a);
    const m = pt.matrixTransform(svg.getScreenCTM()); return { x: m.x, y: m.y };
  }, code);
}

/** Drill chain shared by all entry points. `afterL1` describes the click that leaves the first drawer view. */
async function walkDocs(page, folder, startNo, prefix, opts) {
  let n = startNo;
  const { l1Label, toDocs, l1Dim, docsLabel, docsDim } = opts;
  // --- first drawer view already open: capture with the next click target hovered
  await page.hover(toDocs.sel);
  await shot(page, folder, `${String(n).padStart(2, '0')}_level-1_${l1Dim}.png`, { level: `L1 — ${l1Label}`, click: opts.clickToL1, state: 'Drawer open; next click target hovered' }); n++;
  let prev = await title(page);
  await page.click(toDocs.sel); await drawerSettle(page, prev);
  // docs list
  const firstDoc = '#dBody .doc[data-doc]';
  await page.hover(firstDoc);
  await shot(page, folder, `${String(n).padStart(2, '0')}_level-2_${docsDim}.png`, { level: `L2 — ${docsLabel}`, click: toDocs.what, state: 'Documents list; first document hovered' }); n++;
  // search box state
  const docNo = await page.$eval(firstDoc, e => e.dataset.doc);
  await page.fill('#dSearch', docNo.slice(0, 6));
  await sleep(200);
  await shot(page, folder, `${String(n).padStart(2, '0')}_level-2_${docsDim}_filter-box.png`, { level: `L2 — ${docsLabel}`, click: `Typed "${docNo.slice(0, 6)}" in the drawer Filter… box`, state: 'Client-side text filter hides non-matching rows' }); n++;
  await page.fill('#dSearch', ''); await sleep(150);
  prev = await title(page);
  await page.click(`#dBody .doc[data-doc="${docNo}"]`); await drawerSettle(page, prev);
  // document items
  const hasOrders = await page.$('#dBody [data-order]');
  if (hasOrders) await page.hover('#dBody [data-order]');
  await shot(page, folder, `${String(n).padStart(2, '0')}_level-3_document-items.png`, { level: 'L3 — Billing document items and sold batches', click: `Clicked billing document ${docNo}`, state: hasOrders ? 'Items table (wide drawer); first manufacturing-order chip hovered' : 'Items table (wide drawer); no manufacturing orders — the path ends here' }); n++;
  if (!hasOrders) { return { n, docNo, deepest: 3 }; }
  prev = await title(page);
  await page.click('#dBody [data-order]'); await drawerSettle(page, prev);
  const batchTitle = await title(page);
  await page.hover('#dBody [data-order]');
  await shot(page, folder, `${String(n).padStart(2, '0')}_level-4_batch-orders.png`, { level: 'L4 — Batch: manufacturing orders behind the VC', click: 'Clicked a manufacturing-order chip on the item row', state: `${batchTitle}; first order button hovered` }); n++;
  prev = await title(page);
  await page.click('#dBody [data-order]'); await drawerSettle(page, prev);
  await page.evaluate(() => { document.getElementById('dBody').scrollTop = 0; });
  await shot(page, folder, `${String(n).padStart(2, '0')}_level-5_order-cost.png`, { level: 'L5 — Manufacturing order: materials, activities, utilities', click: 'Clicked an order in the batch table', state: 'Order cost detail (top of drawer)' }); n++;
  await page.evaluate(() => { const b = document.getElementById('dBody'); b.scrollTop = b.scrollHeight; });
  await sleep(600);
  await shot(page, folder, `${String(n).padStart(2, '0')}_level-5_order-cost_scrolled.png`, { level: 'L5 — Manufacturing order (scrolled)', click: 'Scrolled the drawer body', state: 'Lower part: cost-per-unit comparison and "Produced into" link panel' }); n++;
  // back navigation via breadcrumb
  const steps = await page.$$('#dCrumb .step');
  const cr = await crumb(page);
  prev = await title(page);
  await steps[Math.min(2, steps.length - 1)].click(); await drawerSettle(page, prev);
  await shot(page, folder, `${String(n).padStart(2, '0')}_back-via-breadcrumb.png`, { level: 'Back — breadcrumb step', click: `Clicked breadcrumb step 3 of "${cr}"`, state: 'Returns to that level; deeper crumbs are dropped' }); n++;
  // close
  await page.click('#dClose'); await sleep(1200);
  await shot(page, folder, `${String(n).padStart(2, '0')}_closed-back-on-dashboard.png`, { level: 'L0 — drawer closed', click: 'Clicked ✕ (Esc and clicking the dimmed area also close)', state: 'Dashboard unchanged; period filters persist' }); n++;
  return { n, docNo, deepest: 5 };
}

async function landing(page, folder, sel, scrollSel, what) {
  await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), scrollSel || sel);
  await sleep(500);
  await page.hover(sel); await sleep(1800);   // lets scroll-triggered count-ups finish
  await mark(page, sel);
  await shot(page, folder, '01_landing.png', { level: 'L0 — dashboard', click: '(start)', state: `${what}; target hovered, dashed outline = click target (added by the capture script)` });
  await unmark(page, sel);
}

// ====================================================================================================== drill paths
const PRODUCT = '11000033', PRODUCT2 = '11000013', OTHER = '13000000', CUSTOMER = '1000001', PERIOD = '09.2026';

async function pathPeriodBar() {
  const f = '01_from-period-chart-bar', page = await newPage(); console.log(f);
  await landing(page, f, `#chart .bar-hit[data-p="${PERIOD}"]`, '#chart', 'Sales by period chart; Sep 2026 column');
  let prev = await title(page);
  await page.click(`#chart .bar-hit[data-p="${PERIOD}"]`); await drawerSettle(page, prev);
  await walkDocs(page, f, 2, 'p', { l1Label: 'Period — product mix', l1Dim: 'period-product-mix', clickToL1: `Clicked the ${PERIOD} column in the chart`, toDocs: { sel: `#dBody .doc[data-code="${PRODUCT2}"]`, what: `Clicked product ${PRODUCT2} in the product mix` }, docsLabel: 'Product × period — billing documents', docsDim: 'product-period-documents' });
  await page.context().close();
}
async function pathMonthList() {
  const f = '02_from-month-by-month-list', page = await newPage(); console.log(f);
  await landing(page, f, `#mlist .mrow[data-p="${PERIOD}"]`, '#mlist', 'Month-by-Month Comparison list; Sep 2026 row');
  let prev = await title(page);
  await page.click(`#mlist .mrow[data-p="${PERIOD}"]`); await drawerSettle(page, prev);
  await walkDocs(page, f, 2, 'm', { l1Label: 'Period — product mix', l1Dim: 'period-product-mix', clickToL1: `Clicked the ${PERIOD} row in the list`, toDocs: { sel: `#dBody .doc[data-code="${PRODUCT}"]`, what: `Clicked product ${PRODUCT} in the product mix` }, docsLabel: 'Product × period — billing documents', docsDim: 'product-period-documents' });
  await page.context().close();
}
async function pathProductRow(folder, code, label, rowSel, scrollSel, withWalk = true) {
  const page = await newPage(); console.log(folder);
  await landing(page, folder, rowSel, scrollSel, label);
  let prev = await title(page);
  await page.click(rowSel); await drawerSettle(page, prev);
  return page;
}
async function productLike(folder, rowSel, scrollSel, landingLabel, code, clickToL1, kind = 'product') {
  const page = await pathProductRow(folder, code, landingLabel, rowSel, scrollSel);
  await walkDocs(page, folder, 2, 'x', { l1Label: `${kind === 'customer' ? 'Customer' : 'Product'} — by period`, l1Dim: `${kind}-by-period`, clickToL1, toDocs: { sel: `#dBody .monthrow[data-p="${PERIOD}"]`, what: `Clicked the ${PERIOD} period row` }, docsLabel: `${kind === 'customer' ? 'Customer' : 'Product'} × period — billing documents`, docsDim: `${kind}-period-documents` });
  await page.context().close();
}

async function pathOther() {
  const f = '04_from-sales-by-product-other-row', page = await pathProductRow(f, OTHER, 'Sales by product, Others group row (Maize By-Products)', `#prodTbl tr.it[data-g="other"] .rowbtn[data-code="${OTHER}"]`, '#prodTbl');
  // find a period row to open
  const p = await page.$eval('#dBody .monthrow', e => e.dataset.p);
  await page.hover(`#dBody .monthrow[data-p="${p}"]`);
  await shot(page, f, '02_level-1_product-by-period.png', { level: 'L1 — Product by period (Other product)', click: `Clicked the product row`, state: 'Drawer open; CM shown as 100% (assumed $0 VC); next target hovered' });
  let prev = await title(page); await page.click(`#dBody .monthrow[data-p="${p}"]`); await drawerSettle(page, prev);
  await page.hover('#dBody .doc[data-doc]');
  await shot(page, f, '03_level-2_product-period-documents.png', { level: 'L2 — Product × period — billing documents', click: `Clicked the ${p} period row`, state: 'Documents list; CM N/A or computed per document' });
  const doc = await page.$eval('#dBody .doc[data-doc]', e => e.dataset.doc);
  prev = await title(page); await page.click(`#dBody .doc[data-doc="${doc}"]`); await drawerSettle(page, prev);
  await shot(page, f, '04_level-3_document-items.png', { level: 'L3 — Billing document items (no batch, no orders)', click: `Clicked billing document ${doc}`, state: 'Batch cell = N/A badge, "Assumed $0" status pill, no order chips: the path ends here' });
  await page.click('#dClose'); await sleep(500);
  await shot(page, f, '05_closed-back-on-dashboard.png', { level: 'L0 — drawer closed', click: 'Clicked ✕', state: 'Dashboard unchanged' });
  await page.context().close();
}

async function pathDonutSeg() {
  const f = '06_from-donut-segment', page = await newPage(); console.log(f);
  await page.evaluate(() => document.getElementById('donut').scrollIntoView({ block: 'center' })); await sleep(500);
  const pt = await segPoint(page, PRODUCT);
  await page.mouse.move(pt.x, pt.y); await sleep(1800);
  await shot(page, f, '01_landing.png', { level: 'L0 — dashboard', click: '(start)', state: 'Donut; hovered segment is highlighted (the native <title> tooltip is not captured by screenshots: "name · group / Revenue … / CM …")' });
  let prev = await title(page);
  await page.mouse.click(pt.x, pt.y); await drawerSettle(page, prev);
  await walkDocs(page, f, 2, 'd', { l1Label: 'Product — by period', l1Dim: 'product-by-period', clickToL1: 'Clicked the product segment of the donut', toDocs: { sel: `#dBody .monthrow[data-p="${PERIOD}"]`, what: `Clicked the ${PERIOD} period row` }, docsLabel: 'Product × period — billing documents', docsDim: 'product-period-documents' });
  await page.context().close();
}

await productLike('03_from-sales-by-product-fg-row', `#prodTbl tr.it[data-g="fg"] .rowbtn[data-code="${PRODUCT}"]`, '#prodTbl', 'Sales by product, Finished Goods group row', PRODUCT, 'Clicked the product name in Sales by product');
await productLike('05_from-sales-by-customer-row', `#custTbl tr.it[data-g="fg"] .rowbtn[data-code="${CUSTOMER}"]`, '#custTbl', 'Sales by customer, Finished Goods group row', CUSTOMER, 'Clicked the customer name in Sales by customer', 'customer');
await pathPeriodBar();
await pathMonthList();
await pathOther();
await pathDonutSeg();
{
  const f = '07_from-donut-legend', page = await newPage(); console.log(f);
  await landing(page, f, `#dlegend .dl[data-code="${PRODUCT}"]`, '#dlegend', 'Donut legend item');
  let prev = await title(page); await page.click(`#dlegend .dl[data-code="${PRODUCT}"]`); await drawerSettle(page, prev);
  await walkDocs(page, f, 2, 'l', { l1Label: 'Product — by period', l1Dim: 'product-by-period', clickToL1: 'Clicked a legend item', toDocs: { sel: `#dBody .monthrow[data-p="${PERIOD}"]`, what: `Clicked the ${PERIOD} period row` }, docsLabel: 'Product × period — billing documents', docsDim: 'product-period-documents' });
  await page.context().close();
}
{
  const f = '08_from-profitability-row', page = await newPage(); console.log(f);
  await landing(page, f, `#profTbl .rowbtn[data-code="${PRODUCT}"]`, '#profTbl', 'Profitability by product table');
  let prev = await title(page); await page.click(`#profTbl .rowbtn[data-code="${PRODUCT}"]`); await drawerSettle(page, prev);
  await walkDocs(page, f, 2, 'r', { l1Label: 'Product — by period', l1Dim: 'product-by-period', clickToL1: 'Clicked a product in Profitability by product', toDocs: { sel: `#dBody .monthrow[data-p="${PERIOD}"]`, what: `Clicked the ${PERIOD} period row` }, docsLabel: 'Product × period — billing documents', docsDim: 'product-period-documents' });
  await page.context().close();
}
{
  // customer-path variant: deep customer drill uses openCustomer breadcrumbs; also a drill under a non-default range
  const f = '09_from-sales-by-product-fg-row_range-mar-jun', page = await newPage(); console.log(f);
  await page.selectOption('#fromSel', '03.2026'); await page.waitForFunction(() => document.getElementById('toSel').value); await sleep(800);
  await page.selectOption('#toSel', '06.2026'); await sleep(1800);
  await landing(page, f, `#prodTbl tr.it[data-g="fg"] .rowbtn[data-code="${PRODUCT}"]`, '#prodTbl', 'Sales by product with the range set to Mar 2026 → Jun 2026');
  let prev = await title(page); await page.click(`#prodTbl tr.it[data-g="fg"] .rowbtn[data-code="${PRODUCT}"]`); await drawerSettle(page, prev);
  await page.hover('#dBody .monthrow');
  await shot(page, f, '02_level-1_product-by-period.png', { level: 'L1 — Product by period (range Mar–Jun)', click: 'Clicked the product name', state: 'Only the 4 periods inside the range are listed; margin card range label follows the range' });
  const p = await page.$eval('#dBody .monthrow', e => e.dataset.p);
  prev = await title(page); await page.click(`#dBody .monthrow[data-p="${p}"]`); await drawerSettle(page, prev);
  await shot(page, f, '03_level-2_product-period-documents.png', { level: 'L2 — Product × period — billing documents', click: `Clicked the ${p} row`, state: 'Documents of that period' });
  await page.context().close();
}

// ====================================================================================================== title bar
async function simulateOpen(page, selId) {   // native <select> popups are not rendered in headless screenshots: draw the same option list
  await page.evaluate(id => {
    const s = document.getElementById(id), r = s.getBoundingClientRect();
    const d = document.createElement('div'); d.id = '__sim';
    d.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 2}px;min-width:${r.width}px;background:#fff;border:1px solid #9aa;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:99999;font:13px Inter,system-ui,sans-serif;padding:2px 0`;
    d.innerHTML = [...s.options].map(o => `<div style="padding:3px 28px 3px 8px;${o.selected ? 'background:#1a73e8;color:#fff' : 'color:#111'}">${o.textContent}</div>`).join('');
    document.body.appendChild(d);
  }, selId);
}
const removeSim = page => page.evaluate(() => document.getElementById('__sim')?.remove());
{
  const f = 'title-bar'; console.log(f);
  let page = await newPage();
  await shot(page, f, '01_default.png', { level: 'Title bar', click: '(page load)', state: 'Default: preset "2026 to date" active, FROM 01.2026 → TO 09.2026, "Data through Sep 2026" pill, orange (zero-cost) and red (closure) status dots' });
  await page.hover('#scopeSeg button[data-key="last12"]'); await sleep(150);
  await shot(page, f, '02_preset-hover.png', { level: 'Title bar', click: 'Hovered the "Last 12 months" preset', state: 'Preset segmented control hover state' });
  await simulateOpen(page, 'fromSel'); await shot(page, f, '03_from-dropdown-open_simulated.png', { level: 'Title bar', click: 'Opened FROM', state: 'SIMULATED: the native <select> list (headless Chromium cannot render it); options = every month in the dataset, "(open)" suffix on provisional months' }); await removeSim(page);
  await simulateOpen(page, 'toSel'); await shot(page, f, '04_to-dropdown-open_simulated.png', { level: 'Title bar', click: 'Opened TO', state: 'SIMULATED native list; same options as FROM' }); await removeSim(page);
  await page.click('#scopeSeg button[data-key="last12"]'); await sleep(1500);
  await shot(page, f, '05_preset-last-12-months.png', { level: 'Title bar', click: 'Clicked "Last 12 months"', state: 'With 9 months of data the preset resolves to the same range as the default (01.2026 → 09.2026); label changes to "Last 12 months · Jan–Sep 2026"' });
  await page.click('#scopeSeg button[data-key="all"]'); await sleep(1500);
  await shot(page, f, '06_preset-all-data.png', { level: 'Title bar', click: 'Clicked "All data"', state: 'Same range again with the current dataset' });
  await page.selectOption('#fromSel', '03.2026'); await sleep(1500); await page.selectOption('#toSel', '06.2026'); await sleep(1800);
  await shot(page, f, '07_active-filter_custom-range-mar-jun.png', { level: 'Title bar', click: 'Selected FROM 03.2026, then TO 06.2026', state: 'No preset active ("Custom range"); hero, chart, tables and margin all recomputed for Mar–Jun' });
  await page.selectOption('#toSel', '02.2026'); await sleep(1800);
  await shot(page, f, '08_from-to-auto-correct.png', { level: 'Title bar', click: 'With FROM 03.2026, selected TO 02.2026 (earlier than FROM)', state: 'The other end is moved: FROM becomes 02.2026 so FROM ≤ TO always holds' });
  await page.context().close();

  page = await newPage();
  await page.click('#warnDot'); await sleep(500);
  await shot(page, f, '09_status-dot-orange-open.png', { level: 'Title bar', click: 'Clicked the orange dot', state: 'Popover: zero-cost assumption (revenue costed at assumed $0), with "View affected products" link' });
  await page.keyboard.press('Escape'); await sleep(300); await page.mouse.click(700, 500); await sleep(300);
  await page.click('#errDot'); await sleep(500);
  await shot(page, f, '10_status-dot-red-open.png', { level: 'Title bar', click: 'Clicked the red dot', state: 'Popover: closure-control breaches in the selected period, with "Open Validation" link' });
  await page.keyboard.press('Escape'); await sleep(300); await page.mouse.click(700, 500); await sleep(300);
  await page.evaluate(() => window.scrollTo(0, 1100)); await sleep(2200);
  await shot(page, f, '11_sticky-compact-bar.png', { level: 'Title bar', click: 'Scrolled down the page', state: 'Bar sticks to the top and compacts (subtitle hidden)' });
  await page.context().close();

  page = await newPage({ width: 390, height: 844 });
  await shot(page, f, '12_mobile-390x844_collapsed.png', { level: 'Title bar', click: '(page load at 390×844)', state: 'Phone width — different viewport from the rest of the pack' });
  await page.evaluate(() => window.scrollTo(0, 700)); await sleep(800);
  const fb = await page.$('#barFilters'); if (fb && await fb.isVisible()) { await fb.click(); await sleep(600); }
  await shot(page, f, '13_mobile-390x844_sticky-filters-expanded.png', { level: 'Title bar', click: 'Scrolled, then tapped "Filters"', state: 'Compact bar with the Filters toggle expanded (phone width)' });
  await page.context().close();
}

// ====================================================================================================== loading states
{
  const f = 'states'; console.log(f);
  const ctx = await browser.newContext({ viewport: VIEW, reducedMotion: 'reduce' }); const page = await ctx.newPage();
  await page.route(/\/api\/data\?.*period=/, async r => { await sleep(4000); r.continue(); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#prodTbl tr.it', { timeout: 30000 }); await dismissHint(page); await sleep(300);
  await page.evaluate(() => document.getElementById('prodTbl').scrollIntoView({ block: 'center' })); await sleep(300);
  await shot(page, f, '01_loading-month-columns.png', { level: 'L0 — dashboard', click: '(page load; /api/data?period= delayed 4 s by the capture script)', state: 'Sales by product/customer: Month columns muted and subtitle "· Loading month figures…" while the YTD columns are already filled' });
  await ctx.close();
  const c2 = await browser.newContext({ viewport: VIEW, reducedMotion: 'reduce' }); const p2 = await c2.newPage();
  await p2.goto(BASE, { waitUntil: 'networkidle' }); await p2.waitForSelector('#prodTbl tr.it'); await sleep(2500); await dismissHint(p2);
  await p2.route(/\/api\/lines\?/, async r => { await sleep(4000); r.continue(); });
  await p2.evaluate(() => document.getElementById('prodTbl').scrollIntoView({ block: 'center' })); await sleep(300);
  await p2.click(`#prodTbl tr.it[data-g="fg"] .rowbtn[data-code="${PRODUCT}"]`); await sleep(1200);
  const pr = await title(p2);
  await p2.click(`#dBody .monthrow[data-p="${PERIOD}"]`); await sleep(1200);
  await shot(p2, f, '02_drawer-while-next-level-loads.png', { level: 'L1 → L2 (pending)', click: `Clicked the ${PERIOD} period row; /api/lines delayed 4 s by the capture script`, state: `No spinner: the previous view (${pr}) stays on screen until the response arrives, then the whole drawer view is replaced` });
  await c2.close();
}

await browser.close();
fs.writeFileSync(path.join(HERE, 'index-rows.json'), JSON.stringify(rows, null, 1));   // input for docs/reference-pack/INDEX.md
console.log('captured', rows.length, 'images');
