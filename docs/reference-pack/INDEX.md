# Reference pack — image index

Screenshots of the **running reference instance** (Vite + React front end on `http://localhost:5174`, API on `:5180`, live S/4HANA-backed dataset built 2026-10-23, window Jan–Sep 2026). Numbers are explained in [`../DASHBOARD_CALCULATION_SPEC.md`](../DASHBOARD_CALCULATION_SPEC.md); the build guide is [`IMPLEMENTATION_GUIDE.md`](IMPLEMENTATION_GUIDE.md).

**Capture conditions:** Chromium (Playwright), viewport **1440 × 900** at device-pixel-ratio 1 (the two `12_/13_mobile` images use **390 × 844**), reduced-motion emulation on, every image captured after count-up animations settled (~1.7 s). Regenerate with `npm run capture:reference-pack` from `frontend/` (the tool is `frontend/tools/reference-pack/capture.mjs`; read-only, it only clicks and hovers).

**What is added or not shown by the capture, so nobody copies it as UI:**
- The dashed orange outline on `01_landing.png` images marks the click target; it is drawn by the capture script, not part of the product.
- Native browser tooltips (`title="…"` on donut segments, month rows, status icons) are **not** captured by screenshots; their text is in the guide.
- `title-bar/03_…` and `04_…` show the FROM/TO option list **simulated** (headless Chromium cannot paint a native `<select>` popup). The options are read from the real select.
- The assistant's "Ask me about…" hint bubble was dismissed (its × button) so it does not cover content. The round assistant button at bottom-right remains.
- The signed-in user in the sidebar foot is the instance's default user (`Derrick-a`).
- `states/` images use a 4 s artificial network delay set by the capture script.
- The pack contains real customer and product names from the live dataset; treat it as internal.

**Level numbering used in this pack** (the product's own "Level x of y" captions are inconsistent, see Open questions in the guide): `L0` dashboard · `L1` first drawer view · `L2` second · … The drawer stays open for all levels; the dashboard is dimmed behind it, so the top bar and its filters stay partly visible.

**Not present in the product, therefore not captured:** a multi-select filter, any sort control, product/customer/status filters in the title bar, and a user-visible empty state (see guide §Open questions).


## Entry point 3 — Sales by product table, Finished Goods row

Folder `03_from-sales-by-product-fg-row/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](03_from-sales-by-product-fg-row/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Sales by product, Finished Goods group row; target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_product-by-period.png](03_from-sales-by-product-fg-row/02_level-1_product-by-period.png) | L1 — Product — by period | Clicked the product name in Sales by product | 01.2026 → 09.2026 | WFP Infant 15kg — VOLUME 4,281.5 MT / REVENUE $6.32M / VC $4.76M / CM $1.57M / card: Margin — contribution-YTD ⓘ Jan–Sep 2026 & Sep 24.78% Sep 29.23% CM $1.57M Sep $179.5K Rev<br>*Drawer open; next click target hovered* |
| [03_level-2_product-period-documents.png](03_from-sales-by-product-fg-row/03_level-2_product-period-documents.png) | L2 — Product × period — billing documents | Clicked the 09.2026 period row | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Documents list; first document hovered* |
| [04_level-2_product-period-documents_filter-box.png](03_from-sales-by-product-fg-row/04_level-2_product-period-documents_filter-box.png) | L2 — Product × period — billing documents | Typed "900007" in the drawer Filter… box | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Client-side text filter hides non-matching rows* |
| [05_level-3_document-items.png](03_from-sales-by-product-fg-row/05_level-3_document-items.png) | L3 — Billing document items and sold batches | Clicked billing document 90000761 | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Items table (wide drawer); first manufacturing-order chip hovered* |
| [06_level-4_batch-orders.png](03_from-sales-by-product-fg-row/06_level-4_batch-orders.png) | L4 — Batch: manufacturing orders behind the VC | Clicked a manufacturing-order chip on the item row | 01.2026 → 09.2026 | Batch WFP260831 — BATCH COST $173.8K / PRODUCED 165.24 MT / UNIT COST $1,051.62/MT / STATE Final<br>*Batch WFP260831; first order button hovered* |
| [07_level-5_order-cost.png](03_from-sales-by-product-fg-row/07_level-5_order-cost.png) | L5 — Manufacturing order: materials, activities, utilities | Clicked an order in the batch table | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Order cost detail (top of drawer)* |
| [08_level-5_order-cost_scrolled.png](03_from-sales-by-product-fg-row/08_level-5_order-cost_scrolled.png) | L5 — Manufacturing order (scrolled) | Scrolled the drawer body | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Lower part: cost-per-unit comparison and "Produced into" link panel* |
| [09_back-via-breadcrumb.png](03_from-sales-by-product-fg-row/09_back-via-breadcrumb.png) | Back — breadcrumb step | Clicked breadcrumb step 3 of "WFP Infant 15kg › Sep 2026 › 90000761 › WFP260831 › 1000786" | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Returns to that level; deeper crumbs are dropped* |
| [10_closed-back-on-dashboard.png](03_from-sales-by-product-fg-row/10_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ (Esc and clicking the dimmed area also close) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged; period filters persist* |

## Entry point 5 — Sales by customer table row

Folder `05_from-sales-by-customer-row/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](05_from-sales-by-customer-row/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Sales by customer, Finished Goods group row; target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_customer-by-period.png](05_from-sales-by-customer-row/02_level-1_customer-by-period.png) | L1 — Customer — by period | Clicked the customer name in Sales by customer | 01.2026 → 09.2026 | NATIONAL CHILD DEVELOPMENT AGENCY(NCDA) — VOLUME 3,353.6 MT / REVENUE $5.18M / VC $3.26M / CM $1.92M / card: Margin — contribution-YTD ⓘ Feb–Sep 2026 & Sep 37.05% Sep 34.87% CM $1.92M Sep $413.9K Rev<br>*Drawer open; next click target hovered* |
| [03_level-2_customer-period-documents.png](05_from-sales-by-customer-row/03_level-2_customer-period-documents.png) | L2 — Customer × period — billing documents | Clicked the 09.2026 period row | 01.2026 → 09.2026 | NATIONAL CHILD DEVELOPMENT AGENCY(NCDA) · Sep 2026 — REVENUE $1.19M / DOCUMENTS 2 / LINES 8<br>*Documents list; first document hovered* |
| [04_level-2_customer-period-documents_filter-box.png](05_from-sales-by-customer-row/04_level-2_customer-period-documents_filter-box.png) | L2 — Customer × period — billing documents | Typed "900007" in the drawer Filter… box | 01.2026 → 09.2026 | NATIONAL CHILD DEVELOPMENT AGENCY(NCDA) · Sep 2026 — REVENUE $1.19M / DOCUMENTS 2 / LINES 8<br>*Client-side text filter hides non-matching rows* |
| [05_level-3_document-items.png](05_from-sales-by-customer-row/05_level-3_document-items.png) | L3 — Billing document items and sold batches | Clicked billing document 90000771 | 01.2026 → 09.2026 | Billing document 90000771 — REVENUE $279.7K / VC $179.9K / CM $99.9K / ITEMS 3<br>*Items table (wide drawer); first manufacturing-order chip hovered* |
| [06_level-4_batch-orders.png](05_from-sales-by-customer-row/06_level-4_batch-orders.png) | L4 — Batch: manufacturing orders behind the VC | Clicked a manufacturing-order chip on the item row | 01.2026 → 09.2026 | Batch GOM260918 — BATCH COST $36.1K / PRODUCED 42.75 MT / UNIT COST $843.6/MT / STATE Final<br>*Batch GOM260918; first order button hovered* |
| [07_level-5_order-cost.png](05_from-sales-by-customer-row/07_level-5_order-cost.png) | L5 — Manufacturing order: materials, activities, utilities | Clicked an order in the batch table | 01.2026 → 09.2026 | Order 1000821 — TOTAL ACTUAL COST $19.6K / COST PER KG PRODUCED $0.810 / PRODUCED 24,318 kg / LINES POSTED 42<br>*Order cost detail (top of drawer)* |
| [08_level-5_order-cost_scrolled.png](05_from-sales-by-customer-row/08_level-5_order-cost_scrolled.png) | L5 — Manufacturing order (scrolled) | Scrolled the drawer body | 01.2026 → 09.2026 | Order 1000821 — TOTAL ACTUAL COST $19.6K / COST PER KG PRODUCED $0.810 / PRODUCED 24,318 kg / LINES POSTED 42<br>*Lower part: cost-per-unit comparison and "Produced into" link panel* |
| [09_back-via-breadcrumb.png](05_from-sales-by-customer-row/09_back-via-breadcrumb.png) | Back — breadcrumb step | Clicked breadcrumb step 3 of "NATIONAL CHILD DEVELOPMENT AGENCY(NCDA) › Sep 2026 › 90000771 › GOM260918 › 1000821" | 01.2026 → 09.2026 | Billing document 90000771 — REVENUE $279.7K / VC $179.9K / CM $99.9K / ITEMS 3<br>*Returns to that level; deeper crumbs are dropped* |
| [10_closed-back-on-dashboard.png](05_from-sales-by-customer-row/10_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ (Esc and clicking the dimmed area also close) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged; period filters persist* |

## Entry point 1 — Sales by period chart (click a month column)

Folder `01_from-period-chart-bar/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](01_from-period-chart-bar/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Sales by period chart; Sep 2026 column; target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_period-product-mix.png](01_from-period-chart-bar/02_level-1_period-product-mix.png) | L1 — Period — product mix | Clicked the 09.2026 column in the chart | 01.2026 → 09.2026 | Sep 2026 — REVENUE $2.73M / VOLUME 2,025.9 MT / CM $793.8K / LINES 106<br>*Drawer open; next click target hovered* |
| [03_level-2_customer-period-documents.png](01_from-period-chart-bar/03_level-2_customer-period-documents.png) | L2 — Customer × period — billing documents | Clicked product 11000013 in the product mix | 01.2026 → 09.2026 | MoH Infant 18kg · Sep 2026 — REVENUE $907.3K / DOCUMENTS 1 / LINES 5<br>*Documents list; first document hovered* |
| [04_level-2_customer-period-documents_filter-box.png](01_from-period-chart-bar/04_level-2_customer-period-documents_filter-box.png) | L2 — Customer × period — billing documents | Typed "900007" in the drawer Filter… box | 01.2026 → 09.2026 | MoH Infant 18kg · Sep 2026 — REVENUE $907.3K / DOCUMENTS 1 / LINES 5<br>*Client-side text filter hides non-matching rows* |
| [05_level-3_document-items.png](01_from-period-chart-bar/05_level-3_document-items.png) | L3 — Billing document items and sold batches | Clicked billing document 90000772 | 01.2026 → 09.2026 | Billing document 90000772 — REVENUE $907.3K / VC $593.2K / CM $314.0K / ITEMS 5<br>*Items table (wide drawer); first manufacturing-order chip hovered* |
| [06_level-4_batch-orders.png](01_from-period-chart-bar/06_level-4_batch-orders.png) | L4 — Batch: manufacturing orders behind the VC | Clicked a manufacturing-order chip on the item row | 01.2026 → 09.2026 | Batch GOI260905 — BATCH COST $80.3K / PRODUCED 71.946 MT / UNIT COST $1,116.41/MT / STATE Final<br>*Batch GOI260905; first order button hovered* |
| [07_level-5_order-cost.png](01_from-period-chart-bar/07_level-5_order-cost.png) | L5 — Manufacturing order: materials, activities, utilities | Clicked an order in the batch table | 01.2026 → 09.2026 | Order 1000804 — TOTAL ACTUAL COST $52.8K / COST PER KG PRODUCED $1.070 / PRODUCED 49,536 kg / LINES POSTED 50<br>*Order cost detail (top of drawer)* |
| [08_level-5_order-cost_scrolled.png](01_from-period-chart-bar/08_level-5_order-cost_scrolled.png) | L5 — Manufacturing order (scrolled) | Scrolled the drawer body | 01.2026 → 09.2026 | Order 1000804 — TOTAL ACTUAL COST $52.8K / COST PER KG PRODUCED $1.070 / PRODUCED 49,536 kg / LINES POSTED 50<br>*Lower part: cost-per-unit comparison and "Produced into" link panel* |
| [09_back-via-breadcrumb.png](01_from-period-chart-bar/09_back-via-breadcrumb.png) | Back — breadcrumb step | Clicked breadcrumb step 3 of "MoH Infant 18kg › Sep 2026 › 90000772 › GOI260905 › 1000804" | 01.2026 → 09.2026 | Billing document 90000772 — REVENUE $907.3K / VC $593.2K / CM $314.0K / ITEMS 5<br>*Returns to that level; deeper crumbs are dropped* |
| [10_closed-back-on-dashboard.png](01_from-period-chart-bar/10_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ (Esc and clicking the dimmed area also close) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged; period filters persist* |

## Entry point 2 — Month-by-Month Comparison list (click a month row)

Folder `02_from-month-by-month-list/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](02_from-month-by-month-list/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Month-by-Month Comparison list; Sep 2026 row; target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_period-product-mix.png](02_from-month-by-month-list/02_level-1_period-product-mix.png) | L1 — Period — product mix | Clicked the 09.2026 row in the list | 01.2026 → 09.2026 | Sep 2026 — REVENUE $2.73M / VOLUME 2,025.9 MT / CM $793.8K / LINES 106<br>*Drawer open; next click target hovered* |
| [03_level-2_customer-period-documents.png](02_from-month-by-month-list/03_level-2_customer-period-documents.png) | L2 — Customer × period — billing documents | Clicked product 11000033 in the product mix | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Documents list; first document hovered* |
| [04_level-2_customer-period-documents_filter-box.png](02_from-month-by-month-list/04_level-2_customer-period-documents_filter-box.png) | L2 — Customer × period — billing documents | Typed "900007" in the drawer Filter… box | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Client-side text filter hides non-matching rows* |
| [05_level-3_document-items.png](02_from-month-by-month-list/05_level-3_document-items.png) | L3 — Billing document items and sold batches | Clicked billing document 90000761 | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Items table (wide drawer); first manufacturing-order chip hovered* |
| [06_level-4_batch-orders.png](02_from-month-by-month-list/06_level-4_batch-orders.png) | L4 — Batch: manufacturing orders behind the VC | Clicked a manufacturing-order chip on the item row | 01.2026 → 09.2026 | Batch WFP260831 — BATCH COST $173.8K / PRODUCED 165.24 MT / UNIT COST $1,051.62/MT / STATE Final<br>*Batch WFP260831; first order button hovered* |
| [07_level-5_order-cost.png](02_from-month-by-month-list/07_level-5_order-cost.png) | L5 — Manufacturing order: materials, activities, utilities | Clicked an order in the batch table | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Order cost detail (top of drawer)* |
| [08_level-5_order-cost_scrolled.png](02_from-month-by-month-list/08_level-5_order-cost_scrolled.png) | L5 — Manufacturing order (scrolled) | Scrolled the drawer body | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Lower part: cost-per-unit comparison and "Produced into" link panel* |
| [09_back-via-breadcrumb.png](02_from-month-by-month-list/09_back-via-breadcrumb.png) | Back — breadcrumb step | Clicked breadcrumb step 3 of "WFP Infant 15kg › Sep 2026 › 90000761 › WFP260831 › 1000786" | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Returns to that level; deeper crumbs are dropped* |
| [10_closed-back-on-dashboard.png](02_from-month-by-month-list/10_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ (Esc and clicking the dimmed area also close) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged; period filters persist* |

## Entry point 4 — Sales by product table, Others row (product without manufacturing order)

Folder `04_from-sales-by-product-other-row/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](04_from-sales-by-product-other-row/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Sales by product, Others group row (Maize By-Products); target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_customer-by-period.png](04_from-sales-by-product-other-row/02_level-1_customer-by-period.png) | L1 — Product by period (Other product) | Clicked the product row | 01.2026 → 09.2026 | Maize By-Products — VOLUME 569.9 MT / REVENUE $122.8K / VC $0 / CM $122.8K / card: Margin — contribution-YTD ⓘ Jan–Sep 2026 & Sep 100% Sep 100% CM $122.8K Sep $36.3K Revenue<br>*Drawer open; CM shown as 100% (assumed $0 VC); next target hovered* |
| [03_level-2_customer-period-documents.png](04_from-sales-by-product-other-row/03_level-2_customer-period-documents.png) | L2 — Customer × period — billing documents | Clicked the 09.2026 period row | 01.2026 → 09.2026 | Maize By-Products · Sep 2026 — REVENUE $36.3K / DOCUMENTS 23 / LINES 25<br>*Documents list; CM N/A or computed per document* |
| [04_level-3_document-items.png](04_from-sales-by-product-other-row/04_level-3_document-items.png) | L3 — Billing document items (no batch, no orders) | Clicked billing document 90000767 | 01.2026 → 09.2026 | Billing document 90000767 — REVENUE $1.1K / VC $0 / CM $1.1K / ITEMS 1<br>*Batch cell = N/A badge, "Assumed $0" status pill, no order chips: the path ends here* |
| [05_closed-back-on-dashboard.png](04_from-sales-by-product-other-row/05_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged* |

## Entry point 6 — Revenue contribution donut, segment

Folder `06_from-donut-segment/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](06_from-donut-segment/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Donut; hovered segment is highlighted (the native <title> tooltip is not captured by screenshots: "name · group / Revenue … / CM …")* |
| [02_level-1_product-by-period.png](06_from-donut-segment/02_level-1_product-by-period.png) | L1 — Product — by period | Clicked the product segment of the donut | 01.2026 → 09.2026 | WFP Infant 15kg — VOLUME 4,281.5 MT / REVENUE $6.32M / VC $4.76M / CM $1.57M / card: Margin — contribution-YTD ⓘ Jan–Sep 2026 & Sep 24.78% Sep 29.23% CM $1.57M Sep $179.5K Rev<br>*Drawer open; next click target hovered* |
| [03_level-2_product-period-documents.png](06_from-donut-segment/03_level-2_product-period-documents.png) | L2 — Product × period — billing documents | Clicked the 09.2026 period row | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Documents list; first document hovered* |
| [04_level-2_product-period-documents_filter-box.png](06_from-donut-segment/04_level-2_product-period-documents_filter-box.png) | L2 — Product × period — billing documents | Typed "900007" in the drawer Filter… box | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Client-side text filter hides non-matching rows* |
| [05_level-3_document-items.png](06_from-donut-segment/05_level-3_document-items.png) | L3 — Billing document items and sold batches | Clicked billing document 90000761 | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Items table (wide drawer); first manufacturing-order chip hovered* |
| [06_level-4_batch-orders.png](06_from-donut-segment/06_level-4_batch-orders.png) | L4 — Batch: manufacturing orders behind the VC | Clicked a manufacturing-order chip on the item row | 01.2026 → 09.2026 | Batch WFP260831 — BATCH COST $173.8K / PRODUCED 165.24 MT / UNIT COST $1,051.62/MT / STATE Final<br>*Batch WFP260831; first order button hovered* |
| [07_level-5_order-cost.png](06_from-donut-segment/07_level-5_order-cost.png) | L5 — Manufacturing order: materials, activities, utilities | Clicked an order in the batch table | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Order cost detail (top of drawer)* |
| [08_level-5_order-cost_scrolled.png](06_from-donut-segment/08_level-5_order-cost_scrolled.png) | L5 — Manufacturing order (scrolled) | Scrolled the drawer body | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Lower part: cost-per-unit comparison and "Produced into" link panel* |
| [09_back-via-breadcrumb.png](06_from-donut-segment/09_back-via-breadcrumb.png) | Back — breadcrumb step | Clicked breadcrumb step 3 of "WFP Infant 15kg › Sep 2026 › 90000761 › WFP260831 › 1000786" | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Returns to that level; deeper crumbs are dropped* |
| [10_closed-back-on-dashboard.png](06_from-donut-segment/10_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ (Esc and clicking the dimmed area also close) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged; period filters persist* |

## Entry point 7 — Revenue contribution donut, legend item

Folder `07_from-donut-legend/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](07_from-donut-legend/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Donut legend item; target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_product-by-period.png](07_from-donut-legend/02_level-1_product-by-period.png) | L1 — Product — by period | Clicked a legend item | 01.2026 → 09.2026 | WFP Infant 15kg — VOLUME 4,281.5 MT / REVENUE $6.32M / VC $4.76M / CM $1.57M / card: Margin — contribution-YTD ⓘ Jan–Sep 2026 & Sep 24.78% Sep 29.23% CM $1.57M Sep $179.5K Rev<br>*Drawer open; next click target hovered* |
| [03_level-2_product-period-documents.png](07_from-donut-legend/03_level-2_product-period-documents.png) | L2 — Product × period — billing documents | Clicked the 09.2026 period row | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Documents list; first document hovered* |
| [04_level-2_product-period-documents_filter-box.png](07_from-donut-legend/04_level-2_product-period-documents_filter-box.png) | L2 — Product × period — billing documents | Typed "900007" in the drawer Filter… box | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Client-side text filter hides non-matching rows* |
| [05_level-3_document-items.png](07_from-donut-legend/05_level-3_document-items.png) | L3 — Billing document items and sold batches | Clicked billing document 90000761 | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Items table (wide drawer); first manufacturing-order chip hovered* |
| [06_level-4_batch-orders.png](07_from-donut-legend/06_level-4_batch-orders.png) | L4 — Batch: manufacturing orders behind the VC | Clicked a manufacturing-order chip on the item row | 01.2026 → 09.2026 | Batch WFP260831 — BATCH COST $173.8K / PRODUCED 165.24 MT / UNIT COST $1,051.62/MT / STATE Final<br>*Batch WFP260831; first order button hovered* |
| [07_level-5_order-cost.png](07_from-donut-legend/07_level-5_order-cost.png) | L5 — Manufacturing order: materials, activities, utilities | Clicked an order in the batch table | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Order cost detail (top of drawer)* |
| [08_level-5_order-cost_scrolled.png](07_from-donut-legend/08_level-5_order-cost_scrolled.png) | L5 — Manufacturing order (scrolled) | Scrolled the drawer body | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Lower part: cost-per-unit comparison and "Produced into" link panel* |
| [09_back-via-breadcrumb.png](07_from-donut-legend/09_back-via-breadcrumb.png) | Back — breadcrumb step | Clicked breadcrumb step 3 of "WFP Infant 15kg › Sep 2026 › 90000761 › WFP260831 › 1000786" | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Returns to that level; deeper crumbs are dropped* |
| [10_closed-back-on-dashboard.png](07_from-donut-legend/10_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ (Esc and clicking the dimmed area also close) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged; period filters persist* |

## Entry point 8 — Profitability by product table row

Folder `08_from-profitability-row/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](08_from-profitability-row/01_landing.png) | L0 — dashboard | (start) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Profitability by product table; target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_product-by-period.png](08_from-profitability-row/02_level-1_product-by-period.png) | L1 — Product — by period | Clicked a product in Profitability by product | 01.2026 → 09.2026 | WFP Infant 15kg — VOLUME 4,281.5 MT / REVENUE $6.32M / VC $4.76M / CM $1.57M / card: Margin — contribution-YTD ⓘ Jan–Sep 2026 & Sep 24.78% Sep 29.23% CM $1.57M Sep $179.5K Rev<br>*Drawer open; next click target hovered* |
| [03_level-2_product-period-documents.png](08_from-profitability-row/03_level-2_product-period-documents.png) | L2 — Product × period — billing documents | Clicked the 09.2026 period row | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Documents list; first document hovered* |
| [04_level-2_product-period-documents_filter-box.png](08_from-profitability-row/04_level-2_product-period-documents_filter-box.png) | L2 — Product × period — billing documents | Typed "900007" in the drawer Filter… box | 01.2026 → 09.2026 | WFP Infant 15kg · Sep 2026 — REVENUE $614.2K / DOCUMENTS 16 / LINES 20<br>*Client-side text filter hides non-matching rows* |
| [05_level-3_document-items.png](08_from-profitability-row/05_level-3_document-items.png) | L3 — Billing document items and sold batches | Clicked billing document 90000761 | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Items table (wide drawer); first manufacturing-order chip hovered* |
| [06_level-4_batch-orders.png](08_from-profitability-row/06_level-4_batch-orders.png) | L4 — Batch: manufacturing orders behind the VC | Clicked a manufacturing-order chip on the item row | 01.2026 → 09.2026 | Batch WFP260831 — BATCH COST $173.8K / PRODUCED 165.24 MT / UNIT COST $1,051.62/MT / STATE Final<br>*Batch WFP260831; first order button hovered* |
| [07_level-5_order-cost.png](08_from-profitability-row/07_level-5_order-cost.png) | L5 — Manufacturing order: materials, activities, utilities | Clicked an order in the batch table | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Order cost detail (top of drawer)* |
| [08_level-5_order-cost_scrolled.png](08_from-profitability-row/08_level-5_order-cost_scrolled.png) | L5 — Manufacturing order (scrolled) | Scrolled the drawer body | 01.2026 → 09.2026 | Order 1000786 — TOTAL ACTUAL COST $55.2K / COST PER KG PRODUCED $1.110 / PRODUCED 49,680 kg / LINES POSTED 57<br>*Lower part: cost-per-unit comparison and "Produced into" link panel* |
| [09_back-via-breadcrumb.png](08_from-profitability-row/09_back-via-breadcrumb.png) | Back — breadcrumb step | Clicked breadcrumb step 3 of "WFP Infant 15kg › Sep 2026 › 90000761 › WFP260831 › 1000786" | 01.2026 → 09.2026 | Billing document 90000761 — REVENUE $40.7K / VC $28.0K / CM $12.7K / ITEMS 1<br>*Returns to that level; deeper crumbs are dropped* |
| [10_closed-back-on-dashboard.png](08_from-profitability-row/10_closed-back-on-dashboard.png) | L0 — drawer closed | Clicked ✕ (Esc and clicking the dimmed area also close) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Dashboard unchanged; period filters persist* |

## Variant of entry point 3 with a non-default period range (Mar → Jun 2026)

Folder `09_from-sales-by-product-fg-row_range-mar-jun/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_landing.png](09_from-sales-by-product-fg-row_range-mar-jun/01_landing.png) | L0 — dashboard | (start) | 03.2026 → 06.2026 | Hero $6.54M (1 Mar – 30 Jun 2026)<br>*Sales by product with the range set to Mar 2026 → Jun 2026; target hovered, dashed outline = click target (added by the capture script)* |
| [02_level-1_product-by-period.png](09_from-sales-by-product-fg-row_range-mar-jun/02_level-1_product-by-period.png) | L1 — Product by period (range Mar–Jun) | Clicked the product name | 03.2026 → 06.2026 | WFP Infant 15kg — VOLUME 2,437.1 MT / REVENUE $3.59M / VC $2.70M / CM $899.3K / card: Margin — contribution-YTD ⓘ Mar–Jun 2026 & Jun 25.02% Jun 25.15% CM $899.3K Jun $306.0K Re<br>*Only the 4 periods inside the range are listed; margin card range label follows the range* |
| [03_level-2_product-period-documents.png](09_from-sales-by-product-fg-row_range-mar-jun/03_level-2_product-period-documents.png) | L2 — Product × period — billing documents | Clicked the 06.2026 row | 03.2026 → 06.2026 | WFP Infant 15kg · Jun 2026 — REVENUE $1.22M / DOCUMENTS 24 / LINES 38<br>*Documents of that period* |

## Title bar set

Folder `title-bar/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_default.png](title-bar/01_default.png) | Title bar | (page load) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Default: preset "2026 to date" active, FROM 01.2026 → TO 09.2026, "Data through Sep 2026" pill, orange (zero-cost) and red (closure) status dots* |
| [02_preset-hover.png](title-bar/02_preset-hover.png) | Title bar | Hovered the "Last 12 months" preset | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Preset segmented control hover state* |
| [03_from-dropdown-open_simulated.png](title-bar/03_from-dropdown-open_simulated.png) | Title bar | Opened FROM | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*SIMULATED: the native <select> list (headless Chromium cannot render it); options = every month in the dataset, "(open)" suffix on provisional months* |
| [04_to-dropdown-open_simulated.png](title-bar/04_to-dropdown-open_simulated.png) | Title bar | Opened TO | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*SIMULATED native list; same options as FROM* |
| [05_preset-last-12-months.png](title-bar/05_preset-last-12-months.png) | Title bar | Clicked "Last 12 months" | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*With 9 months of data the preset resolves to the same range as the default (01.2026 → 09.2026); label changes to "Last 12 months · Jan–Sep 2026"* |
| [06_preset-all-data.png](title-bar/06_preset-all-data.png) | Title bar | Clicked "All data" | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Same range again with the current dataset* |
| [07_active-filter_custom-range-mar-jun.png](title-bar/07_active-filter_custom-range-mar-jun.png) | Title bar | Selected FROM 03.2026, then TO 06.2026 | 03.2026 → 06.2026 | Hero $6.54M (1 Mar – 30 Jun 2026)<br>*No preset active ("Custom range"); hero, chart, tables and margin all recomputed for Mar–Jun* |
| [08_from-to-auto-correct.png](title-bar/08_from-to-auto-correct.png) | Title bar | With FROM 03.2026, selected TO 02.2026 (earlier than FROM) | 02.2026 → 02.2026 | Hero $469.6K (1 Feb – 28 Feb 2026)<br>*The other end is moved: FROM becomes 02.2026 so FROM ≤ TO always holds* |
| [09_status-dot-orange-open.png](title-bar/09_status-dot-orange-open.png) | Title bar | Clicked the orange dot | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Popover: zero-cost assumption (revenue costed at assumed $0), with "View affected products" link* |
| [10_status-dot-red-open.png](title-bar/10_status-dot-red-open.png) | Title bar | Clicked the red dot | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Popover: closure-control breaches in the selected period, with "Open Validation" link* |
| [11_sticky-compact-bar.png](title-bar/11_sticky-compact-bar.png) | Title bar | Scrolled down the page | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Bar sticks to the top and compacts (subtitle hidden)* |
| [12_mobile-390x844_collapsed.png](title-bar/12_mobile-390x844_collapsed.png) | Title bar | (page load at 390×844) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Phone width — different viewport from the rest of the pack* |
| [13_mobile-390x844_sticky-filters-expanded.png](title-bar/13_mobile-390x844_sticky-filters-expanded.png) | Title bar | Scrolled, then tapped "Filters" | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Compact bar with the Filters toggle expanded (phone width)* |

## Loading states

Folder `states/`

| Image | Drill level | User clicked / did | Filters active (FROM → TO) | Totals / state shown |
|---|---|---|---|---|
| [01_loading-month-columns.png](states/01_loading-month-columns.png) | L0 — dashboard | (page load; /api/data?period= delayed 4 s by the capture script) | 01.2026 → 09.2026 | Hero $14.07M (1 Jan – 30 Sep 2026)<br>*Sales by product/customer: Month columns muted and subtitle "· Loading month figures…" while the YTD columns are already filled* |
| [02_drawer-while-next-level-loads.png](states/02_drawer-while-next-level-loads.png) | L1 → L2 (pending) | Clicked the 09.2026 period row; /api/lines delayed 4 s by the capture script | 01.2026 → 09.2026 | WFP Infant 15kg — VOLUME 4,281.5 MT / REVENUE $6.32M / VC $4.76M / CM $1.57M / card: Margin — contribution-YTD ⓘ Jan–Sep 2026 & Sep 24.78% Sep 29.23% CM $1.57M Sep $179.5K Rev<br>*No spinner: the previous view (WFP Infant 15kg) stays on screen until the response arrives, then the whole drawer view is replaced* |
