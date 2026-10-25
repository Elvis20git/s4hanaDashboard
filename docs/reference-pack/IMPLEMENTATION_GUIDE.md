# Implementation guide — drill-down and title bar

For the Dev environment (Vite + React + Tailwind CSS, Django back end). Images are in this folder; the full list with clicks, filters and totals is in [`INDEX.md`](INDEX.md). Every number and formula is defined in [`../DASHBOARD_CALCULATION_SPEC.md`](../DASHBOARD_CALCULATION_SPEC.md) ("the Spec"); this guide only says **where** a number appears and **how it is carried**, and cites Spec sections instead of repeating formulas.

> **The images are visual references only.** Build the screens as real React components bound to real data. Do not embed, overlay or screenshot-test against them in the product, and do not ship the pack inside the app bundle.

## Contents

1. [What this guide is based on, and what could not be verified](#1-what-this-guide-is-based-on-and-what-could-not-be-verified)
2. [Reference architecture (what the images are built from)](#2-reference-architecture)
3. [Title bar](#3-title-bar)
4. [Drill-down: shared screen specifications (S1–S6)](#4-drill-down-shared-screen-specifications)
5. [Drill paths (entry points 1–8)](#5-drill-paths)
6. [Context carry-over, URL and state](#6-context-carry-over-url-and-state)
7. [Back end contract for Django](#7-back-end-contract-for-django)
8. [Gap analysis per path](#8-gap-analysis-per-path)
9. [Suggested build order](#9-suggested-build-order)
10. [Acceptance checklists](#10-acceptance-checklists)
11. [Open questions](#11-open-questions)

---

## 1. What this guide is based on, and what could not be verified

| Basis | Detail |
|---|---|
| Reference instance | Vite + React front end in this repository (`frontend/src/…`) and its Django API (`../../backend/analytics/…`), live data, window Jan–Sep 2026. Everything below is read from that code and from screenshots taken from it (1440 × 900; conditions in `INDEX.md`). |
| Dev environment | **Not accessible from here.** No Django code, Dev URL or Dev screenshots were provided. So §8 (gap analysis) states what the reference does and what Dev must therefore provide; it does **not** claim to know what Dev currently renders beyond the brief ("full drill-down experience" and "title bar with its filter options" are missing). Please annotate §8 with Dev's actual state. |
| Django endpoints | Unknown for the Dev team's Django. This repository has its own Django implementation of the contract in `../../backend/` (`analytics/urls.py`, `analytics/views.py`). §7 defines the contract the reference front end calls: `/api/data`, `/api/lines`, `/api/batch/{id}`, `/api/order/{id}`, `/api/status`, `/api/validation` (plus `/api/auth/*` and `/api/admin/*` since sign-in was added). The Dev Django must return the same shapes, or the front end needs an adapter. |

The front-end code to port is small and mostly pure functions (`frontend/src/lib/views.js`, `frontend/src/state/drillViews.js`, `frontend/src/state/store.js`, `frontend/src/lib/derive.js`, `frontend/src/lib/format.js`). The reference builds the drawer markup as HTML strings; Dev should render the same content as JSX components (see §4).

---

## 2. Reference architecture

### 2.1 Pieces

| Piece | Reference file | Role |
|---|---|---|
| App store | `frontend/src/state/store.js` | `source`, `from`, `to` (period range, `MM.YYYY`), `data` (aggregate for the range), `monthData` (aggregate for the newest period in range), `priorPeriodData` (the period before the first displayed one), `validation`, `status`. `loadData()` refetches all of these whenever the range or source changes. |
| Title bar | `frontend/src/components/FilterBar.jsx`, `frontend/src/hooks/useStickyBar.js` | Presets, FROM/TO, "Data through" pill, status dots. |
| Drill drawer | `frontend/src/components/DrillDrawer.jsx`, `frontend/src/state/drill.js` | One right-hand drawer, one **view model** at a time: `{ title, eyebrow, stats[], card, grain, crumb[], body, count, on[], exportRows }`. |
| Drill levels | `frontend/src/state/drillViews.js` | `openProduct`, `openCustomer`, `openPeriod`, `openProductPeriod`, `openCustomerPeriod`, `openDocument`, `openOrders` (batch), `openOrder`. Each fetches, builds a view model, commits it to the drawer. |
| Deep links | `frontend/src/state/nav.js` `openFromHash` | `#product/<code>`, `#customer/<code>`, `#period/<MM.YYYY>`, `#doc/<n>`, `#batch/<id>` open a drawer view on load. |
| Formatting | `frontend/src/lib/format.js` | See Spec §6; reproduce exactly. |

### 2.2 Behaviours common to every drawer screen

| Behaviour | Detail | Where visible |
|---|---|---|
| Open / close | Opens by replacing the view model; closes with ✕, **Esc**, or clicking the dimmed area. Page scroll is locked while open; focus moves into the drawer and returns to the opener on close. | [`03/10_closed-back-on-dashboard`](03_from-sales-by-product-fg-row/10_closed-back-on-dashboard.png) |
| Width | 600 px (`min(600px,96vw)`) for L1–L2; **wide** `min(1180px,97vw)` for document items, batch and order (tables). | compare [`03/02`](03_from-sales-by-product-fg-row/02_level-1_product-by-period.png) with [`03/05`](03_from-sales-by-product-fg-row/05_level-3_document-items.png) |
| Header | Eyebrow (small caps), title, stat cells, optional margin card, optional "grain" note (gold pill, e.g. "Level 3 of 5 — …"). | all drawer images |
| Breadcrumb | One crumb per level entered, last one bold (not clickable), earlier ones clickable. Clicking step *i* **drops every crumb from *i* on, then re-opens step *i*** (re-fetches it). Deep levels carry `{ code, name, period, kind }` so the chain can be rebuilt. | [`03/09_back-via-breadcrumb`](03_from-sales-by-product-fg-row/09_back-via-breadcrumb.png) |
| Drawer search | "Filter…" box does a **client-side text filter** over rows (`.doc`, `.monthrow`, table rows); no API call. | [`03/04_…_filter-box`](03_from-sales-by-product-fg-row/04_level-2_product-period-documents_filter-box.png) |
| Export CSV | Exports the **rows behind the current view** (the same data the table shows), `N/A` for nulls, file name from the view. | present on every drawer image |
| Count line | "N periods", "N billing documents", "N manufacturing orders", …, under the tools row. | every drawer image |
| Loading | **No spinner.** The previous drawer view stays until the response arrives, then the whole view is replaced. | [`states/02`](states/02_drawer-while-next-level-loads.png) |
| Hover | Rows lift/tint on hover; chips highlight. Native `title` tooltips exist on some rows (text not in screenshots). | landing and level images (next click target is hovered) |

---

## 3. Title bar

Images: [`title-bar/01_default`](title-bar/01_default.png) · [`02_preset-hover`](title-bar/02_preset-hover.png) · [`03_from-dropdown-open_simulated`](title-bar/03_from-dropdown-open_simulated.png) · [`04_to-dropdown-open_simulated`](title-bar/04_to-dropdown-open_simulated.png) · [`05_preset-last-12-months`](title-bar/05_preset-last-12-months.png) · [`06_preset-all-data`](title-bar/06_preset-all-data.png) · [`07_active-filter_custom-range-mar-jun`](title-bar/07_active-filter_custom-range-mar-jun.png) · [`08_from-to-auto-correct`](title-bar/08_from-to-auto-correct.png) · [`09_status-dot-orange-open`](title-bar/09_status-dot-orange-open.png) · [`10_status-dot-red-open`](title-bar/10_status-dot-red-open.png) · [`11_sticky-compact-bar`](title-bar/11_sticky-compact-bar.png) · [`12_mobile-390x844_collapsed`](title-bar/12_mobile-390x844_collapsed.png) · [`13_mobile-390x844_sticky-filters-expanded`](title-bar/13_mobile-390x844_sticky-filters-expanded.png)

### 3.1 What the title bar actually contains

The brief mentioned a multi-select, an active-filters strip and a sort control. **The reference has none of these** (see §11-Q1). The title bar is:

| Element | Behaviour | Source of options | Default | Selection | Image |
|---|---|---|---|---|---|
| Title + subtitle | Module title ("Sales") and subtitle; the subtitle collapses when the bar is stuck. Comes from the module registry. | `frontend/src/lib/modules.js` | — | — | 01 |
| Preset segmented control | **`<year> to date`**, **`Last 12 months`**, **`All data`**. Clicking one sets FROM and TO together. The active one is highlighted only if FROM/TO equal that preset exactly; otherwise none is highlighted ("Custom range"). | Computed from the dataset's period list (Spec §3.3). | `<year> to date` (year of the newest period) | single | 01, 02, 05, 06 |
| FROM select | Native `<select>`; every period in the dataset ascending as `Mon YYYY`, suffix ` (open)` for provisional periods. | `data.allPeriods` (+ `periods[].provisional`) | first period of the default preset (Jan 2026) | single | 03 |
| TO select | Same options. | same | newest period (Sep 2026) | single | 04 |
| Auto-correction | Choosing FROM later than TO moves TO to FROM; choosing TO earlier than FROM moves FROM to TO. So FROM ≤ TO always. | — | — | — | 08 |
| "Data through <Mon YYYY>" pill | Read-only. Newest period of the **whole dataset**, not of the selection. Dot turns red if the live connection check failed. | `allPeriods.at(-1)`, `status.connection.ok` | — | — | 01 |
| Orange dot | Shown only when there is a cost note (zero-cost assumption, partial coverage, provisional months). Opens a popover with the text and an optional link. | `data.total`, `data.periods` (Spec §2.9) | hidden if nothing to say | click / Enter | 09 |
| Red dot | Shown only when closure-control breaches exist in the **selected** range (or on a load error). Popover text + "Open Validation" link (only for users with a Data-Management right). | `data.controls` (Spec §2.9) | hidden | click / Enter | 10 |
| Sticky compact state | Bar sticks to the top on scroll; padding shrinks, subtitle hides. At narrow widths the controls fold behind a **Filters** button. | IntersectionObserver on a 1 px sentinel | — | — | 11, 12, 13 |

There is **no sort control** anywhere on the page. The default sort of every list/table/chart is in Spec §5.2.

### 3.2 Component structure

```text
<FilterBar>                       // reads store {data, from, to, page, status}
  <BarTitle title subtitle/>
  <BarSummary/>                   // "<preset or Custom range> · Jan–Sep 2026", visible only when stuck/narrow
  <FiltersToggle/>                // narrow viewports only
  <Controls>
    <PresetSegment presets activeKey onPick/>
    <PeriodSelect id="fromSel" value options onChange/>   // FROM
    <PeriodSelect id="toSel"   value options onChange/>   // TO
    <DataThroughPill/>
    <StatusDot kind="warn"/> <StatusDot kind="err"/>      // open the shared <Popover>
  </Controls>
</FilterBar>
```

Preset derivation (`presetsFor`) and "active preset" (`activePresetKey`) are pure functions in `frontend/src/lib/derive.js`; port them unchanged.

### 3.3 Behaviour and persistence

| Rule | Detail |
|---|---|
| Single source of truth | `from`/`to` live in the app store, shared by every panel. Changing either triggers one reload of `data`, `monthData`, `priorPeriodData` (and validation). |
| Default on first load | No URL params → `ytd` preset (`from` = `01.<year>` if present else oldest; `to` = newest). |
| URL | `?from=MM.YYYY&to=MM.YYYY` is **read** on load; if either is not in `allPeriods` or `from > to` they are dropped and the default applies. The reference **never writes** them back (§11-Q3). Dev should write them (`replaceState`) so a reload or shared link keeps the range. |
| Module switch | The range is global; moving Sales → Data Management → Sales keeps it. |
| Drilling | Every drill call carries `source`, `from`, `to` (see §6). The drawer never edits the range; the range stays visible, dimmed, behind the drawer. Closing the drawer leaves it unchanged ([`03/10`](03_from-sales-by-product-fg-row/10_closed-back-on-dashboard.png)). |
| Changing the range while a drawer is open | The drawer is modal, so this cannot happen by pointer; Esc/✕/scrim closes it first. (Source switch calls `closeDrill()` explicitly.) |
| Filter effect per panel | Table in Spec §5.1 ("What every filter touches"). Notably the Month columns of Sales by product/customer always use the newest period **in the range**. |
| Loading states | While `monthData` loads, Month columns are muted and the subtitle says "· Loading month figures…" ([`states/01`](states/01_loading-month-columns.png)). |

---

## 4. Drill-down: shared screen specifications

The eight entry points reuse six drawer screens. Each is specified once; §5 lists, per entry point, which screen follows which click. Numbers: formulas are in the Spec section cited; "stats" are the four small header cells.

### S1 — Product / customer by period (first view after a product, customer, donut, legend or profitability click)

| Item | Spec |
|---|---|
| Images | Product: [`03/02`](03_from-sales-by-product-fg-row/02_level-1_product-by-period.png) · Customer: [`05/02`](05_from-sales-by-customer-row/02_level-1_customer-by-period.png) · Other product: [`04/02`](04_from-sales-by-product-other-row/02_level-1_product-by-period.png) · range variant: [`09/02`](09_from-sales-by-product-fg-row_range-mar-jun/02_level-1_product-by-period.png) |
| Eyebrow / title | `Product · summarized-YTD` (customer: `Customer · summarised-YTD`, §11-Q6) / the product or customer name. |
| Stats | Volume (`fmtMT(total.qtyMt)`), Revenue (`fmtK`), VC (`fmtK` or `N/A`), CM (`fmtK` or `N/A`) — all `total` of the filtered aggregate (Spec §2, §6). |
| Margin card (header, right) | "Margin — contribution-YTD", range label from the periods returned, CM %, CM $, waterfall Revenue / – VC / = CM with the latest month beside each. Computed by `summarisePeriods` (Spec §4.1): sums over periods that have VC; CM % from summed dollars. Same markup component as the dashboard Margin card. |
| Grain pill | "Level 1 of 5 — pick a period to reach its billing documents". |
| Body | One row per period **with activity**, newest first (ascending API order reversed): month tag, `Mon YYYY`, `qty MT · N lines · CM $x (y%)` or a "CM N/A" badge, revenue (right) with `VC $x` beneath. Header line "By period — N with activity · latest first". |
| Click target | A whole period row (`.monthrow`). |
| Next | S3 (docs list), carrying product/customer + period. |
| Data | `GET /api/data?source&from&to&material=<code>` or `&customer=<code>` → uses `total`, `periods[]`, `products[0].name` / `customers[0].name`. |
| Count line | `N periods`. |

### S2 — Period → product mix (after a chart bar or month-list row)

| Item | Spec |
|---|---|
| Images | [`01/02`](01_from-period-chart-bar/02_level-1_period-product-mix.png) · [`02/02`](02_from-month-by-month-list/02_level-1_period-product-mix.png) |
| Eyebrow / title | `Period · product mix` / `Sep 2026`. |
| Stats | Revenue, Volume, CM, Lines (`d.total.lines`). No margin card. Grain pill: "Material × billing date. Billing documents are one level down." plus "**Open period** — overhead not yet settled at period close." when `total.provisional`. |
| Body | Header "Product mix — N product(s) · click to isolate". One card per product, revenue-descending (Spec §5.2): share chip `(product revenue ÷ period revenue × 100)` rounded to 0 dp, name, `qty MT · CM y%` (or "CM N/A" badge), revenue on the right. **Other products show `CM 100%`** (assumed-$0 VC; §11-Q4). |
| Click target | A product card (`.doc[data-code]`). |
| Next | S3 for that product **and** that period (no S1 in between). |
| Data | `GET /api/data?source&period=<MM.YYYY>&from&to` (`from/to` are AND-ed with `period`; harmless). |
| Count line | `12 products · 106 lines in Sep 2026`. |

### S3 — Billing documents (product × period or customer × period)

| Item | Spec |
|---|---|
| Images | Product: [`03/03`](03_from-sales-by-product-fg-row/03_level-2_product-period-documents.png) · Customer: [`05/03`](05_from-sales-by-customer-row/03_level-2_customer-period-documents.png) · from period: [`01/03`](01_from-period-chart-bar/03_level-2_product-period-documents.png) |
| Eyebrow / title | `Billing documents` / `<name> · Mon YYYY`. |
| Stats | Revenue (`Σ revenueUsd` of the lines), Documents (distinct), Lines. |
| Grain pill | "Level 3 of 5 — pick a document to reach its items and sold batches" (§11-Q5). |
| Body | One row per billing document, **newest billing date first** (ties: API line order): day/month tag, document number (mono), `party or product · N items · CM $x` or "CM N/A" badge, revenue, MT (blank if 0). Per-document `CM = costed lines ? Σ revenue − Σ cogm : N/A`. |
| Click target | A document row (`.doc[data-doc]`). |
| Next | S4 with context `{ code, name, period, kind }` kept for the breadcrumb. |
| Data | `GET /api/lines?source&material=<code>|customer=<code>&period=<MM.YYYY>` → `rows[]` (Spec §1 line fields). The grouping into documents is client-side. |
| Search | Typing in "Filter…" hides non-matching rows ([`03/04`](03_from-sales-by-product-fg-row/04_level-2_product-period-documents_filter-box.png)). |

### S4 — Billing document: items and sold batches (wide drawer)

| Item | Spec |
|---|---|
| Images | [`03/05`](03_from-sales-by-product-fg-row/05_level-3_document-items.png) (with orders) · [`04/04`](04_from-sales-by-product-other-row/04_level-3_document-items.png) (no batch, no orders) |
| Eyebrow / title | `Items and sold batches` / `Billing document <n>`. |
| Stats | Revenue (Σ), VC (`Σ cogmUsd` or `N/A` if **no** line has cost), CM (`revenue − VC`), Items. |
| Grain pill | "Level 4 of 5 — one row per billing item and batch. Click a manufacturing order for its cost." |
| Table | Item, billing date, product (+ code), Qty (MT, 3 dp; raw `kg unit` with a tooltip if no conversion), net revenue (`fmtK`), **batch** (mono; "N/A" badge if none), **mfg orders** (chips), VC, CM, CM %, **Status** pill: `final`, `provisional`, `Assumed $0` or `Not costed`. Rows in API order (no sort). |
| Footnote | When no row has cost: "No VC on this document — <reason>. Revenue, quantity, product and customer are reported in full." |
| Click target | An order chip (`[data-order]`) — opens the **batch** the chip belongs to (not the order directly). |
| Next | S5 (batch). If the item has no batch / orders, the path **ends here** (images `04/04`). |
| Data | `GET /api/lines?source&billingDocument=<n>` (all periods; filters on the document only). |

### S5 — Batch: the manufacturing orders behind the VC (wide)

| Item | Spec |
|---|---|
| Image | [`03/06`](03_from-sales-by-product-fg-row/06_level-4_batch-orders.png) |
| Eyebrow / title | `Level 5 of 6 — the manufacturing orders behind this VC` / `Batch <id>`. |
| Stats | Batch cost (`fmtK(cost)`), Produced (`qty ÷ 1000` MT, 3 dp), Unit cost (`unitCostPerKg × 1000` as `$x/MT`, 2 dp), State (Final / Provisional). |
| Table | One row per feeding order: order id (chip button), order cost, Materials, Activities, **Utilities** (the Z2 overhead; Z1 never shown) — `fmtK` of the order's bucket totals. Footer row "Batch total (apportioned)": batch cost and `N KG received · frozen at $x/MT`. |
| Notes | Frozen-cost explanation box; "Produced by" link panel (sentences; a flow diagram only when several orders ↔ several batches). Each pair carries `pctOfBatch`, `pctOfOrder`, `costSharePct`. |
| Click target | An order chip/button (`[data-order]`). |
| Next | S6 with context `{ batch, ctx, billingDocument }` for the breadcrumb. |
| Data | `GET /api/batch/<id>` (→ cost, qty, unitCostPerKg, final, `orderDetail[{order, cost, buckets}]`, `link{pairs,batches,orders}`). |

### S6 — Manufacturing order: materials, activities, utilities (wide, deepest level)

| Item | Spec |
|---|---|
| Images | [`03/07`](03_from-sales-by-product-fg-row/07_level-5_order-cost.png) · scrolled [`03/08`](03_from-sales-by-product-fg-row/08_level-5_order-cost_scrolled.png) |
| Eyebrow / title | `Level 6 of 6 — materials, activities and utilities actually posted` / `Order <id>`. |
| Stats | Total actual cost, Cost per kg produced (`$x.xxx`, `—` if none), Produced (kg), Lines posted. |
| Grain pill | "Costs posted <Mon YYYY[–Mon YYYY]> · full actual cost, independent of the dashboard's own date range". |
| Body | Three bars (Materials / Activities / Utilities, each `fmtK` and `% of total`); a note that order-header fields (start, finish, status) are not available; Materials table (component name + code, signed qty + unit, cost, "net" badge when a reversal netted out) with total; Activities row (one combined row); Utilities row with source `10101303/Z2`; comparison table "Cost per unit vs. the batch(es) it fed" (order cost/kg, batch frozen cost/kg, difference with reason); "Produced into" link panel. |
| Click target | A batch button in the comparison table goes back to S5. |
| Data | `GET /api/order/<id>` (→ materials[], activities, overhead, totalCost, actualCostPerKg, qtyProducedKg, `compareBatches[]`, `link`). Always full history, never date-bounded. |

---

## 5. Drill paths

Reading guide for the tables: *Click target* is the element that triggers the transition; *Carried* is what the next view receives. Everything also carries `source`, `from`, `to` (§6). Image folders contain the whole sequence in view order.

### Path 1 — From the Sales-by-period chart (`01_from-period-chart-bar/`)

| Step | Image | Screen | Trigger → | Carried | API call |
|---|---|---|---|---|---|
| 0 | [01_landing](01_from-period-chart-bar/01_landing.png) | Dashboard, chart column hovered | click the **column** (an invisible full-height button over the bar; keyboard-focusable, aria-label "Sep 2026, $…") | period `09.2026` | — |
| 1 | [02_level-1_period-product-mix](01_from-period-chart-bar/02_level-1_period-product-mix.png) | S2 | click a **product card** | period, product code | `/api/data?period` |
| 2 | [03_level-2_product-period-documents](01_from-period-chart-bar/03_level-2_product-period-documents.png) · [04 …filter-box](01_from-period-chart-bar/04_level-2_product-period-documents_filter-box.png) | S3 | click a **document row** | product, period, document | `/api/lines?material&period` |
| 3 | [05_level-3_document-items](01_from-period-chart-bar/05_level-3_document-items.png) | S4 | click an **order chip** | batch, document ctx | `/api/lines?billingDocument` |
| 4 | [06_level-4_batch-orders](01_from-period-chart-bar/06_level-4_batch-orders.png) | S5 | click an **order** | order, batch ctx | `/api/batch/<id>` |
| 5 | [07_level-5_order-cost](01_from-period-chart-bar/07_level-5_order-cost.png) · [08 scrolled](01_from-period-chart-bar/08_level-5_order-cost_scrolled.png) | S6 | breadcrumb step or ✕ | — | `/api/order/<id>` |
| back | [09_back-via-breadcrumb](01_from-period-chart-bar/09_back-via-breadcrumb.png) | S3/S4 re-opened | — | — | re-fetch of that level |
| end | [10_closed-back-on-dashboard](01_from-period-chart-bar/10_closed-back-on-dashboard.png) | Dashboard | — | filters unchanged | — |

Breadcrumb at depth (verified in [`09`](01_from-period-chart-bar/09_back-via-breadcrumb.png)): `<product> › Sep 2026 › <document> › <batch> › <order>`. S2 itself (the period mix) has a one-item crumb `Sep 2026`, but it is **not** part of the crumb from S3 downward; the product crumb is first, and clicking it opens S1 (product by period), a screen this path never showed (§11-Q8).
Also note the chart tooltip on hover (not in the images): Spec §2.2 lists its rows.

### Path 2 — From the Month-by-Month list (`02_from-month-by-month-list/`)

Identical screens and API calls to Path 1 from S2 onward (compare [`02/02`](02_from-month-by-month-list/02_level-1_period-product-mix.png) with [`01/02`](01_from-period-chart-bar/02_level-1_period-product-mix.png)). Only the landing differs: [`02/01`](02_from-month-by-month-list/01_landing.png), click a **row** (`.mrow`, a real `<button>`; tooltip lists month, FG revenue, Other revenue, total, FG VC/CM/QTY, MoM — Spec §2.3). The product used in the capture differs (first product clicked is a different one), so numbers differ.

### Path 3 — From Sales by product, Finished Goods row (`03_from-sales-by-product-fg-row/`)

| Step | Image | Screen | Trigger → | Carried | API call |
|---|---|---|---|---|---|
| 0 | [01_landing](03_from-sales-by-product-fg-row/01_landing.png) | Sales-by-product table | click the **product name button** (`rowbtn`; the group header rows only collapse/expand, they do not drill) | product code | — |
| 1 | [02_level-1_product-by-period](03_from-sales-by-product-fg-row/02_level-1_product-by-period.png) | S1 | click a **period row** | product, period | `/api/data?material` |
| 2 | [03_level-2](03_from-sales-by-product-fg-row/03_level-2_product-period-documents.png) · [04 filter](03_from-sales-by-product-fg-row/04_level-2_product-period-documents_filter-box.png) | S3 | document row | document | `/api/lines?material&period` |
| 3 | [05_level-3_document-items](03_from-sales-by-product-fg-row/05_level-3_document-items.png) | S4 | order chip | batch | `/api/lines?billingDocument` |
| 4 | [06_level-4_batch-orders](03_from-sales-by-product-fg-row/06_level-4_batch-orders.png) | S5 | order | order | `/api/batch/<id>` |
| 5 | [07](03_from-sales-by-product-fg-row/07_level-5_order-cost.png) · [08](03_from-sales-by-product-fg-row/08_level-5_order-cost_scrolled.png) | S6 | — | — | `/api/order/<id>` |
| back / end | [09](03_from-sales-by-product-fg-row/09_back-via-breadcrumb.png) · [10](03_from-sales-by-product-fg-row/10_closed-back-on-dashboard.png) | | | | |

Breadcrumb: `<product> › Sep 2026 › <document> › <batch> › <order>`.
Variant with a custom range: [`09_…range-mar-jun`](09_from-sales-by-product-fg-row_range-mar-jun/01_landing.png) → S1 lists only the four periods in range ([02](09_from-sales-by-product-fg-row_range-mar-jun/02_level-1_product-by-period.png)) → documents of the chosen period ([03](09_from-sales-by-product-fg-row_range-mar-jun/03_level-2_product-period-documents.png)). Proves `from`/`to` are carried into the first level; below that level the calls are filtered by period/document.

### Path 4 — From Sales by product, Others row (`04_from-sales-by-product-other-row/`)

| Step | Image | Screen | Notes |
|---|---|---|---|
| 0 | [01_landing](04_from-sales-by-product-other-row/01_landing.png) | table, Others group | Same click target as path 3 (the product name button) |
| 1 | [02_level-1](04_from-sales-by-product-other-row/02_level-1_product-by-period.png) | S1 | CM shown as **100 %** (assumed-$0 VC, Spec F4) |
| 2 | [03_level-2](04_from-sales-by-product-other-row/03_level-2_product-period-documents.png) | S3 | |
| 3 | [04_level-3_document-items](04_from-sales-by-product-other-row/04_level-3_document-items.png) | S4 | Batch cell "N/A", no order chips, status "Assumed $0" → **path ends** |
| end | [05_closed](04_from-sales-by-product-other-row/05_closed-back-on-dashboard.png) | Dashboard | |

### Path 5 — From Sales by customer (`05_from-sales-by-customer-row/`)

Same as Path 3 with the customer dimension: landing [`01`](05_from-sales-by-customer-row/01_landing.png) → S1 customer ([`02`](05_from-sales-by-customer-row/02_level-1_customer-by-period.png), `/api/data?customer`) → S3 customer × period ([`03`](05_from-sales-by-customer-row/03_level-2_customer-period-documents.png), `/api/lines?customer&period`; each row's sub-line shows the customer, so all rows read identically) → S4 [`05`](05_from-sales-by-customer-row/05_level-3_document-items.png) → S5 [`06`](05_from-sales-by-customer-row/06_level-4_batch-orders.png) → S6 [`07`](05_from-sales-by-customer-row/07_level-5_order-cost.png), [`08`](05_from-sales-by-customer-row/08_level-5_order-cost_scrolled.png); back [`09`](05_from-sales-by-customer-row/09_back-via-breadcrumb.png); closed [`10`](05_from-sales-by-customer-row/10_closed-back-on-dashboard.png). Breadcrumb root is the customer name and the `kind` carried is `customer` (back actions re-open the customer views).

### Path 6 — From the donut segment (`06_from-donut-segment/`)

Landing [`01`](06_from-donut-segment/01_landing.png): hovering a segment highlights it (others dim); a native tooltip lists `name · group`, `Revenue $x · y% of total revenue`, and `CM $x (z%)` for Finished Goods or "CM not reported for Others" (Spec §2.7). Click the **segment arc** (not the hollow centre). From S1 the path is identical to Path 3: [`02`](06_from-donut-segment/02_level-1_product-by-period.png) → [`03`](06_from-donut-segment/03_level-2_product-period-documents.png) → [`05`](06_from-donut-segment/05_level-3_document-items.png) → [`06`](06_from-donut-segment/06_level-4_batch-orders.png) → [`07`](06_from-donut-segment/07_level-5_order-cost.png) → back [`09`](06_from-donut-segment/09_back-via-breadcrumb.png) → closed [`10`](06_from-donut-segment/10_closed-back-on-dashboard.png).

### Path 7 — From the donut legend (`07_from-donut-legend/`)

Landing [`01`](07_from-donut-legend/01_landing.png): click a **legend item** (`.dl`, a button). Group and category headers in the legend collapse/expand and dim-highlight segments on hover; they do not drill. Then identical to Path 3: [`02`](07_from-donut-legend/02_level-1_product-by-period.png) … [`10`](07_from-donut-legend/10_closed-back-on-dashboard.png).

### Path 8 — From Profitability by product (`08_from-profitability-row/`)

Landing [`01`](08_from-profitability-row/01_landing.png): click the product **name button** in a row (header says "Click a row for the waterfall"; only the name cell is a button). Then identical to Path 3: [`02`](08_from-profitability-row/02_level-1_product-by-period.png) … [`10`](08_from-profitability-row/10_closed-back-on-dashboard.png). The table's CM % column is Finished Goods only (Other rows show "—"; footer is the FG CM %, Spec §2.8, §11-Q4).

### Not drill entry points (checked)

Hero tiles and sparkline (hover only; the sparkline shows `Mon YYYY · $x`), Margin card (info popovers only), status dots (popovers; their links navigate to Data Management › Validation, not to a drill), chat assistant. No other element opens the drawer.

---

## 6. Context carry-over, URL and state

| Context item | Carried by | Notes |
|---|---|---|
| `source` | every API call (`source=api` default) | |
| `from`, `to` | `q()` helper adds them to **every** `/api/data` call (S1, S2) | `/api/lines` ignores them server-side (filters on period / material / customer / document only) |
| Entity key | the click target's data attribute (`data-code`, `data-p`, `data-doc`, `data-order`) | |
| Drill context | `ctx = { code, name, period, kind: 'product'|'customer' }` captured at S3/S4 and passed to S4/S5/S6 | needed to rebuild the breadcrumb and to know which "back" function to call |
| Breadcrumb | array of `{ label, mono?, go }`; `gotoCrumb(i)` → `crumb = crumb.slice(0,i); crumb[i].go()` | re-fetches; deeper crumbs vanish |
| Drawer view model | module-level object committed to the drill store on each open | only one view lives at a time; there is no history stack beyond the breadcrumb |

**URL.** The reference reads deep links but **does not write** the drill state to the URL (`openFromHash`: `#product/<code>`, `#customer/<code>`, `#period/<MM.YYYY>`, `#doc/<n>`, `#batch/<id>`; the page hash is only written for module routes). For Dev, a better target:

```text
/sales?from=01.2026&to=09.2026                                   dashboard
/sales/period/09.2026?from=…&to=…                                S2
/sales/product/11000033?from=…&to=…                              S1
/sales/product/11000033/period/09.2026                           S3
/sales/customer/1000001/period/09.2026                           S3 (customer)
/sales/doc/90000761                                              S4   (context re-derived from the first line, as #doc/ does today)
/sales/batch/WFP260831  ·  /sales/order/1000786                  S5 · S6
```

State recommendation: keep `from`, `to`, `source` in a store (or URL search params as the single source) and treat the drawer view as **derived from the route + the data**, not as a free-standing object — then browser Back and reload work, and the breadcrumb can be computed from the route segments. This departs from the reference deliberately (§11-Q3) and does not change what is displayed.

---

## 7. Back end contract for Django

Same JSON shapes as the reference API. Calculation rules: Spec §1–§2 (do not re-derive here).

| Endpoint | Query | Used by | Response fields the UI reads |
|---|---|---|---|
| `GET /api/status` | — | sidebar user, status dots, Data pill | `user`, `connection.ok`, `sources.*` |
| `GET /api/data` | `source`, `from`, `to`, `period`, `material`, `customer` (all optional, AND-ed; range compare on `YYYYMM`) | dashboard, S1, S2 | `allPeriods[]`, `asOf`, `total{revenue,qtyMt,cogm,cm,cmPct,lines,groups{fg{revenue,qtyMt,cogm,cogmPct,cm,cmPct,revenueAssumedZero},other{revenue,qtyMt,revenueAssumedZero}},revenueFinal,revenueProvisional,revenueAssumedZero,revenueNotCosted,partial,provisional,hasAssumedZero}`, `periods[]` (same shape + `period`), `products[]`/`customers[]` (same shape + `code`,`name`), `sections{products[],customers[]}` (each section `{key,title,total,rows[],categories?[]}`), `counts`, `controls` |
| `GET /api/lines` | `source`, any of `period`, `material`, `customer`, `billingDocument` | S3, S4 | `rows[]`: `billingDocument, billingItem, billingDate, period, material, materialName, customer, customerName, batch, qtyKg, baseUnit, qtyMt, revenueUsd, cogmUsd, cmUsd, cmPct, costStatus, costReason, orders[]` |
| `GET /api/batch/{id}` | — | S5 | `batch, cost, qty, unitCostPerKg, final, orders[], orderDetail[{order,cost,buckets{materials,activities,overhead}}], link{pairs[{order,batch,qty,pctOfBatch,pctOfOrder,costSharePct}],batches[],orders[],simple}` |
| `GET /api/order/{id}` | — | S6 | `order, product, productName, qtyProducedKg, postingDateFrom/To, materials[{component,componentName,qty,unit,cost,hadReversal}], materialsTotal, activities{cost,qty,unit,hadReversal}, overhead{label,source,cost,qty,unit,hadReversal}, totalCost, actualCostPerKg, lineCount, headerGaps[], compareBatches[], link` |
| `GET /api/validation` | `source` | status dot counts (dataset-level) | `controls` |

Rules the back end must honour for the screens to match: all rounding at the points described in Spec §2 (line-level `round2` of COGM/CM; one aggregate `round2`), sort orders in Spec §5.2, FG/Other classification in Spec §1.5, VC buckets in Spec §1.4 (activities **are** in VC; Z1 excluded).

---

## 8. Gap analysis per path

**Dev's current state is not visible from here** (§1). The right-hand column is therefore the brief's statement ("drill-down and title bar are missing") plus what must exist. Please replace "Not verified" with Dev's real status when you review.

| Path | What the reference shows | What Dev needs (components / data) | Dev today |
|---|---|---|---|
| Title bar | Presets, FROM/TO, data-through pill, two status dots, sticky compact state, responsive Filters toggle | `FilterBar`, preset + period derivations, popover with status text, sticky observer; `allPeriods` + `provisional` flag from the API | Missing per brief; details not verified |
| 1 Chart bar | Clickable columns (accessible buttons), hover tooltip, S2→S3→S4→S5→S6 | Bar hit-targets, `Drawer` with view model, S2–S6, 4 endpoints | Not verified |
| 2 Month list | Clickable rows → same as 1 | Row buttons + shared S2… | Not verified |
| 3 Product row | S1 with margin card → S3… | S1 incl. `summarisePeriods` margin card, `/api/data?material`, shared S3–S6 | Not verified |
| 4 Others row | S1 shows CM 100 %; S4 ends at "Assumed $0" with no orders | Same screens; render N/A batch, empty order chips, assumed-$0 pill and footnote | Not verified |
| 5 Customer row | Customer variants of S1/S3 | `/api/data?customer`, `/api/lines?customer&period` | Not verified |
| 6 Donut segment | Arc hit-testing (ring is hollow), highlight, tooltip text | SVG ring with click on the arc; share and CM text rules (Spec §2.7) | Not verified |
| 7 Legend | Legend items clickable, group headers collapse | Legend component | Not verified |
| 8 Profitability | Name cell is the button; FG-only CM % | Table + footer rule | Not verified |
| All | Breadcrumb with back-by-step, Esc/✕/scrim close, drawer filter box, CSV export, wide drawer for tables, no spinner | Drawer shell and tools row | Not verified |

---

## 9. Suggested build order

1. **Formatting and derivations** — port `format.js`, `derive.js` (presets, period labels) with the Spec §6 tests (`frontend/tests/format.test.mjs` is reusable).
2. **Store + API client** — `from`, `to`, `source`; `loadData` fan-out (`data`, `monthData`, `priorPeriodData`); URL read/write.
3. **Title bar** (§3) — presets, selects, pill; then sticky/responsive; then status dots/popover.
4. **Dashboard panels needed as drill origins** — chart, month list, product/customer tables, donut + legend, profitability table (their numbers: Spec §2).
5. **Drawer shell** — view model, breadcrumb, tools row, count line, close/Esc/scrim, focus, wide variant.
6. **S2 + S1 + S3** (periods, products, documents) — covers Paths 1–3, 5–8 up to documents.
7. **S4** (items; incl. the no-batch case → Path 4 complete).
8. **S5 and S6** (batch, order) and the link panel.
9. **URL routes** for each screen (§6) and deep links.
10. **Acceptance pass** (§10) against the images and the Spec check totals (Spec §7.2, §8).

---

## 10. Acceptance checklists

General, for every path: the drawer opens at the stated width, the breadcrumb matches the "Breadcrumb" line, the active filter range is unchanged after ✕, Esc, scrim click and after using any breadcrumb step, and no screen shows a number that differs from the Spec's formulas (compare with the totals in the `Totals / state` column of [`INDEX.md`](INDEX.md); live values change with data, so for fixed checks use Spec §8 scenarios).

| Path | "Done" means |
|---|---|
| Title bar | Matches 01 (default: "2026 to date" active, Jan 2026 → Sep 2026, pill "Data through Sep 2026", both dots) · 05/06 (presets resolve to the same range when only nine months exist; label text changes) · 07 (no preset highlighted for a custom range; hero `$4.65M`-type totals recomputed per Spec §8 Scenario 3) · 08 (FROM ≤ TO auto-correction) · 09/10 popovers with correct text and conditional links · 11 sticky compaction · narrow-width Filters toggle. Options in FROM/TO equal `allPeriods`; `(open)` appears only on provisional periods. |
| 1 Chart bar | Column click opens S2 [`01/02`](01_from-period-chart-bar/02_level-1_period-product-mix.png): stats Revenue/Volume/CM/Lines for the month equal the chart column and Spec §8 Scenario 2 (month = Sep: 2,725,630.53 / 2,025.88 MT / 793,808.39 / 106); product-mix shares add to 100 % (±rounding). Then S3, S4, S5, S6 as images 03–08; breadcrumb `Sep 2026 › … › order`. |
| 2 Month list | Same as 1 from `02/02` onward; row tooltip content per Spec §2.3. |
| 3 Product row | S1 [`03/02`](03_from-sales-by-product-fg-row/02_level-1_product-by-period.png): stats equal Spec §8 Scenario 4 (6,321,967.07 / 4,281.53 MT / 4,755,343.14 / 1,566,623.93; card CM % 24.78); **period rows sum to the stats** (revenue, VC, CM); S3 stats equal that period row; S4 stats = Σ items; S5 batch cost = Σ order costs shown (apportioned) and `unit cost × kg` reproduces the line VC (Spec §8 Scenario 6); S6 total = materials + activities + utilities. |
| 4 Others row | S1 CM % 100; S4 shows "N/A" batch, no chips, "Assumed $0" pill, `$0` VC, CM = revenue, and the footnote; no further navigation. |
| 5 Customer row | S1/S3 numbers equal `/api/data?customer` and `/api/lines?customer&period`; customer total equals Spec §8 Scenario 5 for the matching range; deeper screens identical to path 3. |
| 6 Donut segment | Arc click (not the centre) opens S1 of that product; hover highlight; tooltip text per Spec §2.7; legend share and segment share equal. |
| 7 Legend | Item click opens S1; group header toggles collapse without opening the drawer. |
| 8 Profitability | Name click opens S1; CM % shown only on Finished Goods rows and in the footer (28.28 % live, Spec §8 Scenario 1). |

---

## 11. Open questions

| # | Question | Evidence |
|---|---|---|
| Q1 | The brief asks for a **multi-select example**, an **active-filters state** and a **sort control** in the title bar. None exists in the reference: FROM/TO and presets are single-select, there is no filter chip strip, no sort control. The images show the closest real states (custom range, preset hover, auto-correction). Were these meant to be new requirements for Dev? | `frontend/src/components/FilterBar.jsx`, `frontend/src/lib/modules.js` |
| Q2 | Dev (Django) code, endpoints and current screens were not provided, so the gap analysis (§8) cannot state Dev's actual status. | — |
| Q3 | The reference **does not write** filter or drill state to the URL (a `syncFilterUrl` exists but is never called; drill views are not addressable except by reading `#product/…` links). Dev likely wants the opposite (§6). Confirm the desired deep-link scheme. | `frontend/src/state/store.js:39-46`, `frontend/src/state/nav.js` |
| Q4 | Product-mix cards and S1 show **CM 100 %** for Other products (assumed-$0 VC), which contradicts the decision to report CM % for Finished Goods only. The dashboard tables were changed; the drawer was not. | `frontend/src/state/drillViews.js` (`openPeriod`, `paintPeriodRows`), `frontend/src/lib/derive.js:summarisePeriods` |
| Q5 | The drawer's own captions are inconsistent: S1 says "Level 1 of 5", S3 "Level 3 of 5" (no level 2), S4 "Level 4 of 5", S5 "Level 5 of 6", S6 "Level 6 of 6"; S2 has none. The pack uses its own L1–L5 numbering. Which numbering should Dev show? | `drillViews.js` grain strings |
| Q6 | Eyebrow spelling differs: product "summarized-YTD", customer "summarised-YTD". Both say "YTD" whatever the range. | `drillViews.js:48,63` |
| Q7 | With a **single period** selected the hero shows an empty green pill where the MoM badge normally is ([`title-bar/08`](title-bar/08_from-to-auto-correct.png)). Intended? | `frontend/src/lib/views.js` `hDelta` |
| Q8 | Entering S3 from the period mix (paths 1, 2) builds the crumb `<product> › <period>` — the period crumb of S2 disappears and the first crumb is the **product**, so "back" to the first crumb opens S1 (product by period), a screen that path never visited; there is no step back to S2 (period mix) except ✕ and re-clicking the bar. Intended? | `openPeriod` → `openProductPeriod(code, null, period)`; crumb built in `openProductPeriod` |
| Q9 | In customer × period documents every row's sub-line repeats the customer name, so rows are only distinguishable by document number, date and amount. Intended? | `paintDocs` (`party: l.customerName`) |
| Q10 | Not captured because they do not exist or cannot be triggered: empty states (the chart and month list clear when the range has no periods, which the selectors never allow), a drawer spinner, and the native `<select>` popup (shown simulated). Image captures of the two mobile states show the layout at 390 px; whether that layout is final is not known. | `states/`, `title-bar/12–13` |
| Q11 | The images contain real customer/product names and live values from this instance. Confirm they may be shared with the Dev team. | `INDEX.md` |
