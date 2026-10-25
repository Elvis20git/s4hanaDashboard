# AIF Analytics — Sales dashboard calculation specification

Audit of the dashboard **as implemented** in this repository (branch `master`, HEAD `35c7c94`), written so that any implementation can reproduce every number without reading the front-end. The Django backend in [`backend/analytics/`](../backend/analytics/) is the implementation this document describes.
Derived from code only. Nothing was modified. The Administration module was not read except to confirm it computes no business figures.
Live values in §8 were read from the running instance on 2026-10-23 (dataset `builtAt 2026-10-23T10:36:28Z`, scope 2026-01-01 → 2026-09-30). They are for the default **2026 to date** view (01.2026 → 09.2026). The loaded window now starts 2025-07-01 (`PERIOD_FROM`), so dataset-level figures such as the lines or batches loaded differ from the build-log counts quoted in §1.2.

**Source-path shorthand** (backend files are in `backend/analytics/`, front-end files in `frontend/src/`): `build.py` = `pipeline/build.py`, `engine.py` = `cost/engine.py`, `aggregate.py` = `pipeline/aggregate.py`, `controls.py` = `pipeline/controls.py`, `modetail.py` = `pipeline/modetail.py`, `chat.py` = `pipeline/chat.py`, `spreadsheet.py` = `pipeline/spreadsheet.py`, `rules.py` / `cache.py` = `cost/rules.py` / `cost/cache.py`, `sap.py`, `jsutil.py`, `productgroup.py`, `views.py` (HTTP routes), `state.py` (in-memory datasets); `views.js` = `lib/views.js`, `derive.js` = `lib/derive.js`, `format.js` = `lib/format.js`, `copy.js` = `lib/copy.js`, `store.js` = `state/store.js`, `drillViews.js` = `state/drillViews.js`; `sources.json` = `backend/config/sources.json`.

> **Where the code lives.** Citations of the form `name.py:lines` point into the Django backend ([`backend/analytics/`](../backend/analytics/)); citations of the form `name.js:lines` / `Name.jsx:lines` point into the React front end ([`frontend/src/`](../frontend/src/)). All line numbers were recomputed from the code as it stands in this revision.
> `jsutil.py` reproduces JavaScript's number semantics (`Math.round`, `toFixed`, `Intl`) so that the figures the backend computes and formats match what the front end displays (see §6).

## Contents

0. [Headline findings (read first)](#0-headline-findings-read-first)
1. [Data lineage](#1-data-lineage)
2. [Metric dictionary](#2-metric-dictionary)
3. [Periods](#3-periods)
4. [Drill-down hierarchy](#4-drill-down-hierarchy)
5. [Top bar and filters; sort orders](#5-top-bar-and-filters-sort-orders)
6. [Number formatting and rounding](#6-number-formatting-and-rounding)
7. [Reconciliation guide](#7-reconciliation-guide)
8. [Test scenarios (live values)](#8-test-scenarios-live-values)
9. [Open questions / inconsistencies](#9-open-questions--inconsistencies)

---

## 0. Headline findings (read first)

| # | Finding | Why it matters |
|---|---|---|
| F1 | **RESOLVED (owner decision): activities are intentionally in VC.** The code's VC is not "Direct Materials + Utilities" only. VC = G/L `51*` (materials) **+ four activity accounts** (labour/machine: `54400000, 54093000, 54053000, 54200100`) **+ Utilities (`94301000`, source `10101303/Z2` only)** **+ `13200000`** (paired offset, nets to ≈0). Z1 overheads are excluded as stated. See §1.4 and §9-Q1. | In the live data the order-cost mix is ≈93.2% materials, ≈4.5% utilities, ≈2.3% activities, ≈0% paired offset. The owner confirmed activities must stay in VC, even while they are zero, so any future activity cost is captured. `engine.py` includes them, and the user-facing definition text (`VC_DEF`, `MARGIN_DISCLAIMER`, `UTILITIES_TIP` in `copy.js`) now names Activities too. |
| F2 | **CONFIRMED: only Z2 counts.** The Z1/Z2 split is **inferred from a posting pattern** (higher cost-per-kg of the two overhead lines in an accounting document = Z1), not read from a cost-center / activity-type field. | Any divergence in how the two lines are paired changes VC. §1.4. |
| F3 | **Acknowledged.** Batch unit costs are **frozen in an on-disk cache** (`backend/cache/batch-unit-cost.json`) and reused when `final=true`; a build from an empty cache recomputed all 121 frozen costs identically. | A fresh recomputation can differ from the dashboard if SAP postings changed after freezing. §7.3. |
| F4 | **Decision: CM % is shown for Finished Goods only (see Q3).** 359 of 695 lines (revenue $230,620.63) have **no batch or an unresolved batch** and are costed at an **assumed $0**, so their CM = 100% of revenue. They are all in "Other" today, but the same rule would apply to Finished Goods. | Totals CM and CM % (card "Profitability") include these lines; the "Margin — contribution" card is Finished Goods only. §2.7, §9-Q3. |
| F5 | Period assignment uses the **ledger posting date**, not the billing document date (they matched on all 695 lines today). | §3.1. |
| F6 | The hero MoM uses **total** revenue and the previous period **in the selected window**. The Month-by-Month MoM uses **Finished Goods** revenue and the calendar-previous period **in the dataset**. | Two different "MoM" numbers on one page. §2.1, §2.3. |

---

## 1. Data lineage

### 1.1 Scope parameters (config, `backend/config/.env`)

| Parameter | Live value | Used in |
|---|---|---|
| `COMPANY_CODE` | `2000` | billing header filter; journal filters (`build.py:38-39,85,160`) |
| `SALES_ORG` | `2000` | billing header filter (`build.py:38`) |
| `LEDGER` | `0L` | journal filters (`build.py:85,160`) |
| `PERIOD_FROM` | `2025-07-01` (it was `2026-01-01` when the §8 figures were taken) | lower bound on billing date and journal posting date |
| `REPORT_TO` | `2026-09-30` | upper bound on billing date and posting date; also applied again in `cap_to_report_window` (`state.py:32-58`) |
| `OVERHEAD_GL` | `94301000` | only echoed in `/api/status`; the code uses the literal in `sources.json` |
| `BATCH_CHUNK` | `50` | OData `$filter … or …` chunk size (no effect on results) |

`as_of = REPORT_TO` (or today's UTC date if unset) (`build.py:28`). `closure_as_of` = the real current UTC date, used **only** to decide whether a batch is "final" (`build.py:29`, `engine.py:163-175`).

### 1.2 Source entities

| # | Service / entity | Fields used | Filter / selection | Used for |
|---|---|---|---|---|
| S1 | `API_BILLING_DOCUMENT_SRV / A_BillingDocument` | `BillingDocument, BillingDocumentDate, BillingDocumentType, BillingDocumentIsCancelled, CancelledBillingDocument, SoldToParty, AccountingDocument, FiscalYear, CompanyCode, AccountingPostingStatus, TransactionCurrency` | OData: `SalesOrganization eq '2000' and CompanyCode eq '2000' and BillingDocumentDate ge 2026-01-01 and BillingDocumentDate le asOf`. Then in Python (not in the OData query): `AccountingPostingStatus == 'C'` (`build.py:37-45`) | Set of in-scope billing documents. 515 retrieved, 511 kept (live) |
| S2 | `API_BILLING_DOCUMENT_SRV / A_BillingDocumentItem` | `BillingDocument, BillingDocumentItem, Material, Batch, Plant, BillingQuantity, BillingQuantityUnit, BillingQuantityInBaseUnit, BaseUnit, NetAmount, TransactionCurrency, ReferenceSDDocument, ReferenceSDDocumentItem, SalesDocument` | by `BillingDocument` ∈ S1 (chunked). Drop item if `BillingQuantityInBaseUnit == 0 AND NetAmount == 0` ("split parents") (`build.py:55-61`) | Item identity, **batch**, base unit, quantity magnitude. 911 retrieved, 216 dropped (live). `NetAmount` is **not** used for revenue |
| S3 | `API_PRODUCT_SRV / A_ProductUnitsOfMeasure` | `Product, AlternativeUnit, GrossWeight, WeightUnit` | only for materials with a non-`KG` `BaseUnit`; keep rows with `WeightUnit == 'KG'` and `GrossWeight > 0` (`build.py:64-79`) | kg-per-unit factor for non-KG items (live: one material, `61000011`, unit `PC`) |
| S4 | `YY1_AIF_JOURNAL_REV_CDS / YY1_AIF_JOURNAL_REV` (revenue read) | `Ledger, CompanyCode, GLAccount, PostingDate, FiscalYear, AccountingDocument, SoldProduct/Product, Customer, Quantity, BaseUnit, AmountInGlobalCurrency` | `Ledger eq '0L' and CompanyCode eq '2000' and startswith(GLAccount,'41')`; then in Python `PostingDate ∈ [PERIOD_FROM, asOf]` **and** `CompanyCode\|FiscalYear\|AccountingDocument` ∈ S1 (`build.py:84-92`) | **Revenue (USD), quantity sign, customer, product, period.** 1,428 retrieved, 695 kept (live) |
| S5 | `YY1_AIF_ORDER_BATCH_CDS / YY1_AIF_ORDER_BATCH` | `GoodsMovementType, GoodsMovementIsCancelled, Batch, ManufacturingOrder/OrderID, QuantityInBaseUnit, Material, PostingDate, MaterialBaseUnit` | **no server filter, no date filter**; in Python: `GoodsMovementType == '101' AND NOT GoodsMovementIsCancelled AND Batch non-empty` (`build.py:147-151`) | Goods receipts: order ↔ batch ↔ quantity. 2,017 kept, 327 cancelled rows dropped (live) |
| S6 | `YY1_AIF_JOURNAL_REV` (cost read) | `Ledger, CompanyCode, OrderID, GLAccount, PostingDate, AccountingDocument, Quantity, AmountInGlobalCurrency`, optional `OverheadSource` | by `OrderID` ∈ orders behind sold batches; `Ledger eq '0L' and CompanyCode eq '2000'`; **no date filter** (`build.py:159-161`) | Order cost. 13,397 lines (live) |
| S7 | `A_ProductDescription` (`Language eq 'EN'`), `A_BusinessPartner` | `ProductDescription`; `BusinessPartnerFullName ‖ OrganizationBPName1 ‖ BusinessPartner` | by key (`build.py:189-207`) | Display names only, never figures |

All S/4HANA access is read-only OData v2 (`sap.py`: GET only). Numbers arrive as strings; `num(v)` is `0` for `None`/empty, else `float(v)` (NaN if it cannot be parsed) (`jsutil.py:48-59`). Dates arrive as `/Date(ms)/`; `odata_date` converts them with `datetime.fromtimestamp(ms / 1000, tz=timezone.utc)` to the **UTC calendar date** `YYYY-MM-DD` (`jsutil.py:65-79`).

No currency conversion is performed by the code. Revenue and cost use the ledger's `AmountInGlobalCurrency`. Billing documents are in USD (264 lines) or RWF (431 lines) transaction currency (live); the dashboard figure is the ledger's global-currency amount regardless (see §9-Q8).

### 1.3 Order of operations (revenue side)

```
1. hdrs  = billing headers [company 2000, sales org 2000, BillingDocumentDate in [from, as_of]]
           keep AccountingPostingStatus == 'C'                      # IsCancelled is NOT used; see Q6
2. items = billing items of hdrs; drop items with qty_base == 0 and NetAmount == 0
3. jrev  = ledger lines [0L, 2000, GLAccount startswith '41'],
           keep PostingDate in [from, as_of] and (CompanyCode|FiscalYear|AccountingDocument) in hdrs
4. pool  : key = acct_key(header) | Material | to_fixed(abs(BillingQuantityInBaseUnit), 3)  -> list of items (insertion order)
5. for r in jrev (in API return order):
      matl     = r.SoldProduct or r.Product
      item     = first UNUSED pool item with key  acct_key | matl | to_fixed(abs(r.Quantity), 3)     # may be None
      j_qty    = -r.Quantity                                   # ledger sign: a sale posts negative quantity
      qty_base = (-1 if j_qty < 0 else 1) * abs(item.BillingQuantityInBaseUnit) if item else j_qty
                 # NB: j_qty == 0 -> sign +1
      unit     = item.BaseUnit if item else r.BaseUnit
      kg_f     = 1 if unit == 'KG' else kg_per_unit.get(matl|unit)       # None if unknown
      qty_kg   = qty_base * kg_f if kg_f is not None else qty_base       # raw, unconverted if no factor
      qty_mt   = qty_kg / 1000 if kg_f is not None else None
      revenue_usd = -r.AmountInGlobalCurrency                  # credit balance -> positive; NOT rounded
      period   = PostingDate -> 'MM.YYYY'                      # of the LEDGER line (r.PostingDate)
      batch    = (item.Batch or None) if item else None
      customer = r.Customer
   (build.py:94-139)
```

One output "line" = one ledger revenue line. The dataset has 695 lines (live), 511 distinct billing documents. A billing item with no matching ledger line produces no line; a ledger line with no matching item produces a line with `batch = null`, `itemResolved = false` (0 today).

### 1.4 Order of operations (cost side)

```
6.  sold_set = {batch of every line, if any}
7.  receipts = live 101 movements (S5); relevant = receipts whose batch is in sold_set
8.  orders_needed = distinct order of relevant receipts (first-seen order)
9.  jord     = ledger lines for those orders (S6)
10. order_costs (engine.py:75-108), for each ledger line r in jord:
      bucket = in_cost_bucket(r.GLAccount)          # see table below; False -> line ignored
      v      = r.AmountInGlobalCurrency             # SIGNED, not debit-only
      if bucket == 'overhead':
          src = source(r)                           # 'OverheadSource' field if present else rate-pair rule
          if src in INCLUDED ('10101303/Z2'):  keep
          else: drop (excluded 'Z1' or unknown), counted in the log only
      orders[r.OrderID].cost += v ; .buckets[bucket] += v
11. apportion (engine.py:111-141):
      order_qty[o]  = sum of qty over relevant receipts of order o
      pair_qty[o,b] = sum of qty of receipts (o,b)
      for each (o,b) with order_qty[o] > 0:
          share   = pair_qty[o,b] / order_qty[o]
          cost_ob = orders[o].cost * share           # 0 if the order has no journal cost (and batch.costed = False)
          batch[b].cost += cost_ob ; batch[b].qty += pair_qty[o,b]
12. freeze (engine.py:178-188): if the cache has a FINAL entry for batch b -> reuse it unchanged
      else entry = { cost: round2(batch.cost), qty: batch.qty, unitCostPerKg: batch.cost / batch.qty if batch.qty > 0 else None,
                      costed, final: is_final(b) }
      NB: unitCostPerKg uses the UNROUNDED batch.cost (engine.py:155), `cost` is rounded.
13. cost_lines (engine.py:199-228), for each line l:
      no batch                    -> assumed-zero     cogm = 0, cm = revenue_usd, cmPct = None if revenue_usd == 0 else 100
      batch not in frozen         -> assumed-zero     (same values)
      unit cost None or not costed -> assumed-zero
      else  cogmUsd = round2(qty_kg * unitCostPerKg)           # qty_kg is signed: credit notes are negative
            cmUsd   = round2(revenue_usd - cogmUsd)
            cmPct   = None if revenue_usd == 0 else round2(cmUsd / revenue_usd * 100)
            costStatus = 'final' if frozen.final else 'provisional'
```

Cost buckets (`sources.json`, `engine.py:60-72`), evaluated in this order for each GL account string:

| Order | Rule | Bucket | In VC? |
|---|---|---|---|
| 1 | account starts with `52`, `55` or `24` | — (excluded: production variances, GR/IR clearing, settlement) | No |
| 2 | account starts with `51` | `materials` ("Direct materials, 261 net of 262") | **Yes** |
| 3 | account ∈ `54400000, 54093000, 54053000, 54200100` | `activities` ("labour and machine confirmations") | **Yes** (see F1) |
| 4 | account = `94301000` | `overhead` → only source **`10101303/Z2` ("Utilities")** is kept | **Yes** (Z2 only) |
| 5 | account = `13200000` | `pairedOffset` (nets to ≈0 on the 2 orders carrying it) | Yes (≈0) |
| — | anything else | ignored | No |

Overhead source identification (`engine.py:25-52`, `sources.json → overheadSources`): for G/L `94301000` lines, a line carrying an explicit `OverheadSource` uses it. Otherwise lines are grouped by `OrderID|AccountingDocument`; a group of **exactly two** lines is split by `rate = |AmountInGlobalCurrency| / |Quantity|` (or `|Amount|` if quantity is 0): higher rate → `10101303/Z1` (excluded), lower rate → `10101303/Z2` (kept). A group of any other size, or two equal rates (|Δ| < 1e-9), gets source `None` → dropped and logged as "unknown". Live: 242 lines kept ($499,422), 242 lines dropped ($2,886,945), 0 unknown.

`is_final(b, e)` (`engine.py:163-175`): `open_period_from` = first day of the month of `closure_as_of`; a batch is final iff **for every feeding order** `order_last[order]` exists, `order_last[order] < open_period_from`, and the order has journal cost, **and** `batch.costed` is true. `order_last` = max PostingDate over **all** order journal lines (including non-cost accounts) (`build.py:170-175`). Anything else is `provisional`.

### 1.5 Master-data classification (Finished Goods vs Other)

`productgroup.py:9-18`: `normalize_material(code)` = `str(code).strip()` with leading zeros removed; **Finished Good ("B2B/B2C") ⇔ normalized material code starts with `11`**. Everything else is "Other". "Other" sub-categories (donut legend only, `productgroup.py:21-41`): prefix `13` By-products, `21` Raw materials / Maize, `61` Non-stock sellables, any other → "Other items & services". Order: 13, 21, 61, fallback.

### 1.6 Stage between the pipeline and the screen

`aggregate(data, query)` (`aggregate.py:153-220`) is called per request. Query params honoured: `period`, `from`, `to`, `material`, `customer`. Filter order: `period` → `from` → `to` → `material` → `customer`, each as an AND on the line list. Range compare uses `pkey(p) = YYYYMM` string (`aggregate.py:7-8`). `source` selects the dataset (`api` default; `spreadsheet` has no VC, see §9-Q11).

---

## 2. Metric dictionary

Common aggregation (`aggregate.py:11-96`). Let `L` be the set of filtered lines. For every group (total, period, product, customer, section, category):

```python
revenue      = Σ l.revenueUsd                                 # all lines
qtyMt        = Σ l.qtyMt for lines with qtyMt is not None ; None if no line has qtyMt
cogm         = Σ l.cogmUsd for lines with cogmUsd is not None     # includes assumed-zero lines (as 0)
cm           = Σ l.cmUsd   for lines with cogmUsd is not None
costedRev    = Σ l.revenueUsd for lines with cogmUsd is not None
cmPct        = cm / costedRev * 100                           # None if costedRev == 0
# every output is round2() of the accumulated float; sums are accumulated in line order
FG  = lines whose material is Finished Good ; OTH = the rest
fgRev  = Σ revenue(FG) ; fgQty = Σ qtyMt(FG, not null) ; fgCogm, fgCm = Σ over FG lines with cogmUsd is not None
fgCostedRev = Σ revenue(FG lines with cogmUsd is not None)
groups.fg.cogm    = None if fgCostedRev == 0 else round2(fgCogm)
groups.fg.cogmPct = None if fgCostedRev == 0 or fgRev == 0 else round2(fgCogm / fgRev * 100)
groups.fg.cm      = None if fgCostedRev == 0 else round2(fgCm)
groups.fg.cmPct   = None if fgCostedRev == 0 or fgRev == 0 else round2(fgCm / fgRev * 100)
groups.other      = { revenue, qtyMt (0 if none), revenueAssumedZero }  # Other never has CM/VC in `groups`
```

Status split per group: `revenueFinal / revenueProvisional / revenueAssumedZero / revenueNotCosted` = Σ revenue by `costStatus` (`final / provisional / assumed-zero / anything else`). `provisional = revenueProvisional > 0`. `hasAssumedZero = revenueAssumedZero > 0`. `partial = revenue != 0 and abs((final + prov + assumedZero) − revenue) > 0.005`.

**Rounding point:** each line's `cogmUsd`, `cmUsd`, `cmPct` are rounded to 2 dp **at line level** (`engine.py:223-225`); `revenueUsd` is **not** rounded at line level. Group figures are the plain float sums of those, then rounded once with `round2(n) = floor((n + 2.220446049250313e-16) * 100 + 0.5) / 100` (`jsutil.py:17-19`; halves round toward +∞ and the result is never −0). Consequently a group's `cm` is the sum of rounded line CMs, **not** `round2(revenue − cogm)` of the group, and can differ by cents. Display formatting is applied after (§6).

Currency is USD throughout. "MT" = metric tonnes = kg / 1000.

### 2.1 Hero (top of Sales page) — `views.js:141-207`, `Hero.jsx`

Let `ps = data.periods` (sorted ascending, within the selected window), `last = ps[-1]`, `prev = ps[-2]`, `t = data.total`.

| Metric | Location | Formula | Source | Notes |
|---|---|---|---|---|
| Net sales (big number) | Hero headline | `fmtK(t.revenue)` | `views.js:168` | Total revenue of the window, **FG + Other**, after filters. `$14.07M` live |
| Eyebrow / scope | Hero | `"Net sales · " + scopeLabel` | `views.js:152`, `derive.js:31-35` | `Jan–Sep 2026` when same year, else `Mon YYYY – Mon YYYY` |
| Date range text | Hero | `"1 <FromMon> [FromYear] – <d> <ToMon> <ToYear>"`; `d` = `asOf` day if `to` == newest period in the dataset, else last calendar day of `to` month | `views.js:160-167` | Pure label |
| Part-month flag | Hero | `partMonth = asOf in the month of last.period AND day(asOf) < 28` | `views.js:171-173` | Adds "· <Mon YYYY> part month"; label of the latest tile becomes `"<Mon> (part month)"` instead of `"<Mon> period"` |
| MoM delta | Under headline | `chg = (last.revenue − prev.revenue) / prev.revenue × 100` if `last` and `prev` exist and `prev.revenue != 0`, else empty. Text: `▲ +x.x% MoM` / `▼ -x.x% MoM` (1 dp, `toFixed`), sign test `chg >= 0` | `views.js:182-189` | Uses **total** revenue; `prev` is the previous period **present in the window** (not necessarily the calendar previous month). Single-period window → empty |
| Latest-period tile | Hero | `fmtK(last.revenue)` | `views.js:177` | Total revenue of the newest period in the window |
| Latest-period breakdown | Hero | rows `B2B/B2C = fmtK(last.groups.fg.revenue)`, `Other = fmtK(last.groups.other.revenue)` | `views.js:144-148,178` | Sum of the two = tile |
| Quantities (<MON>) | Hero | `last.qtyMt == null ? '—' : fmtMT(last.qtyMt)` (total FG+Other, latest period only) | `views.js:195` | `2,025.9 MT` live |
| Quantities breakdown | Hero | `fmtMT(last.groups.fg.qtyMt)`, `fmtMT(last.groups.other.qtyMt)` | `views.js:196` | |
| Avg price (<MON>) | Hero | `fgAvgKg(last) = last.groups.fg.qtyMt > 0 ? last.groups.fg.revenue / (last.groups.fg.qtyMt × 1000) : null` → `"$" + n.toFixed(3)` + `/kg`; `—` if null | `views.js:202-204`, `derive.js:45`, `format.js:40` | **Finished Goods only**, latest period only. `$/kg` |
| Sparkline | Hero right | y-values = `periods[i].revenue` (total); y-scale `min..max` of those; first/last labels `Mon YY`; hover text `formatMoneyCompact(revenue)` | `spark.js:7-60` | Needs ≥ 2 periods, else empty |

### 2.2 Sales by period chart — `views.js:279-412`, `chartTip.js`

| Metric | Location | Formula | Source | Notes |
|---|---|---|---|---|
| "N months in view" | Card header | `ps.length` (+ plural) | `views.js:292` | |
| Revenue column | Chart | height `= p.revenue / max(all p.revenue, 1) × plotHeight`, min 0; label `fmtK(p.revenue)` (skipped if exactly 0) | `views.js:305-331` | **Total** revenue (FG+Other). Years earlier than the newest year drawn muted |
| Open-period dot | Chart | gold dot if `p.provisional` | `views.js:315` | `provisional = revenueProvisional > 0` |
| CM inner bar | Chart | `fgCm = p.groups.fg.cm`; drawn only if `fgCm > 0`; height `max(1, fgCm / max × plotHeight)` | `views.js:316-322` | **Finished Goods CM**, same scale as revenue |
| QTY line / dots | Chart | per period `q = p.groups.fg.qtyMt` (skip null); y-scale min..max of q mapped to 20%–80% of plot (flat at 50% if min = max); line broken across gaps (non-consecutive indexes) | `views.js:337-356` | FG quantity only |
| QTY pills | Under month label | `q != null && finite && q != 0 ? "1,234.5 MT" : "—"`; if widest text does not fit the slot (`maxChars×5.8+12 > columnWidth+gap`) all switch to `"x.xxK MT"` when `|q| ≥ 1000` | `views.js:357-372` | `toLocaleString('en-US', 1 dp)` |
| Tooltip (hover) | Chart | Revenue (B2B/B2C) `formatMoneyCompact(fg.revenue)`; Variable cost `formatMoneyCompact(fg.cogm) (fmtPct(fg.cogmPct))`; CM `formatMoneyCompact(fg.cm) (fmtPct(fg.cmPct))`; QTY `fg.qtyMt` (1 dp); Avg price `formatAvgPriceKg(fgAvgKg(p))`; "QTY vs prev. month" `(q − prevQ)/|prevQ|×100` only if the previous *array element* has non-zero FG qty | `chartTip.js:11-23` | "prev. month" = previous element of the window array, not necessarily the previous calendar month. Includes "· open period" tag |

### 2.3 Month-by-Month Comparison list — `views.js:383-410`

Rows are the periods **reversed** (newest first).

| Metric | Location | Formula | Source | Notes |
|---|---|---|---|---|
| B2B/B2C revenue | List column 3 | `fmtK(p.groups.fg.revenue)` | `views.js:406` | |
| Other revenue | List column 4 | `p.groups.other.revenue ? fmtK(...) : '$0'` | `views.js:407` | |
| Bar fill | List | `max(0, fgRev) / fgMax × 100 %`, `fgMax = max(1, max FG revenue in window)` | `views.js:386,405` | |
| MoM | List column 5 | `prevFg = i > 0 ? ps[i−1].fg.revenue : priorPeriodData.total.groups.fg.revenue (or null)`; `chg = prevFg ? (fgRev − prevFg)/prevFg×100 : null`; text `▲ x.x%` / `▼ x.x%` (1 dp, `Math.abs`), `—` if null | `views.js:394-408` | **FG revenue only.** `priorPeriodData` = the period immediately before the first displayed one in `allPeriods` (`store.js:90-98`). With the live dataset starting at 01.2026, the Jan row has no predecessor → `—` |
| "Open" badge | List | `p.provisional` | `views.js:397` | |
| Tooltip | List row | text lines: month, FG revenue, Other revenue, total revenue, FG VC (+%), FG CM (+%), FG QTY, MoM | `views.js:398-403` | |

### 2.4 Sales by product table — `views.js:415-467`

Columns: **Qty (MT), Value ($), VC ($), CM ($)**, each as *Month* (= the newest period in the window) and *YTD* (= whole selected window; header literally says "YTD" whatever the window, see §9-Q9). Two groups: **B2B/B2C — Finished Goods**, then **Others**. Groups with no rows are omitted. Group rows collapse (client only).

| Metric | Formula | Source | Notes |
|---|---|---|---|
| Item YTD Qty | `qtyFmt(x.qtyMt ?? 0)` (1 dp, thousands sep.) | `views.js:433` | `x` = product group row from `sections.products[*].rows` |
| Item YTD Value | `fmtBMK(x.revenue)` | `views.js:434,438` | B/M/K, 1 dp |
| Item YTD VC | `x.cogm == null ? (Other ? fmtBMK(0) : "N/A") : fmtBMK(x.cogm)` | `views.js:435` | |
| Item YTD CM | `x.cm == null ? "N/A" : fmtBMK(x.cm)` | `views.js:436` | Other items show CM = revenue (assumed $0 VC) |
| Item Month cells | same fields from `monthData.sections.products[key].rows[code]` where `monthData = /api/data?period=<newest period>`; `—` if the product has no row in the month; `qtyFmt(0)` if row exists but `qtyMt == null`; VC fallback `$0` for Others else `—` | `views.js:432-436`, `store.js:82-89` | Month data is **not** re-filtered by `from/to`; it is the single period. Same product code lookup |
| Group subtotal row | same cells from `sections.products[key].total` using `fmtK` (not B/M/K) | `views.js:439,446` | Sealed from the same lines as the rows, so rows sum to the subtotal (±rounding) |
| Total row | `Total` YTD = `data.total`; Month = `monthData.total` ; Qty `qtyMt ?? 0`, VC/CM `N/A` if `null` | `views.js:457-465` | **Total CM includes Others at 100% CM** (assumed $0 VC) |
| Product colour | FG: ramp index by rank (by revenue desc); Other: hue per category, lightness by rank | `derive.js:62-70` | Cosmetic |

### 2.5 Sales by customer table — `views.js:470-508`

Columns: **Revenue ($), CM ($)**, Month and YTD. Two groups: FG and Other (`sections.customers`). A customer appears in both groups when it bought both types, each with that group's own amounts. Customer rows: `fmtK(revenue)`, `cm == null ? '—' : fmtK(cm)`. Month cells from `monthData.sections.customers[key]`. Total row from `data.total` / `monthData.total`.
Group membership is by **product** (a customer line belongs to FG if its material is a Finished Good): `aggregate.py:133,146-149`.

### 2.6 Margin — contribution card — `views.js:511-554`, `marginBarsHtml` `views.js:51-67`

All values are **Finished Goods only**. `t = fgView(d.total) = { revenue: fg.revenue, cogm: fg.cogm, cm: fg.cm, cmPct: fg.cmPct }` (`derive.js:44`); `last = fgView(periods[-1])`.

| Metric | Formula | Source | Notes |
|---|---|---|---|
| Sub-title | `"<Mon>–<Mon YYYY> & <LastMon> · B2B/B2C"` | `views.js:537-540` | |
| Headline CM % | `fmtPct(t.cmPct)` where `t.cmPct = round2(fgCm / fgRev × 100)` | `views.js:543-544` | Class `pos` if `cmPct >= 0` |
| "<Mon> x.xx%" sub | `last.cmPct != null ? "<LastMon> " + fmtPct(last.cmPct) : ''` | `views.js:545` | latest period |
| CM $ | `fmtK(t.cm)`; side value `"<LastMon> " + fmtK(last.cm)` | `views.js:546` | |
| Waterfall Revenue | `fmtK(t.revenue)`, sub `fmtK(last.revenue)`; bar width `= clamp(|v| / max(t.revenue,1) × 100, 0..100)`, min drawn 2 % | `views.js:55-65` | |
| Waterfall "– VC" | value `−t.cogm` shown with `fmtK` (negative); sub `−last.cogm` | `views.js:57-58` | |
| Waterfall "= CM" | `fmtK(t.cm)`; green if `t.cm >= 0` else clay | `views.js:66` | |
| Unavailable state | if `!d.cogmAvailable` or no FG group | `views.js:516-523` | `cogmAvailable = (source == 'api')` |

CM definition (as coded): `cmUsd(line) = round2(revenueUsd − cogmUsd)`; `cogmUsd = round2(qtyKg × batchUnitCostPerKg)`; unit cost is the batch's apportioned order cost ÷ batch received kg, where order cost is the **signed sum of buckets in §1.4** (Z1 overhead excluded; Z2 included). See F1 for the divergence from the stated definition.

### 2.7 Revenue contribution donut — `views.js:557-639`

`tot = d.total.revenue || 1` (total FG+Other revenue).

| Metric | Formula | Source | Notes |
|---|---|---|---|
| Centre value | `fmtK(tot)` | `views.js:600` | |
| "B2B/B2C x.x%" | `(sections.products[fg].total.revenue / tot × 100).toFixed(1)` | `views.js:599,602` | |
| Segment arc length | `len = max(0, p.revenue) / groupRev × disp[group] × C`; `disp.other = hasFg && hasOth ? min(0.5, max(othTrue, 0.04)) : (hasOth ? 1 : 0)` with `othTrue = max(0, otherRev)/tot`; `disp.fg = 1 − disp.other` | `views.js:582-590` | **Display width of "Other" is floored at 4 %**; legend/tooltips show true figures |
| Legend item % | `(p.revenue / tot × 100).toFixed(1) + '%'` (animated via `pc1`) | `views.js:604` | Share of **total** revenue, not of the group |
| Legend group % | `(group.rev / tot × 100).toFixed(1) + '%'`; "Other" category % = `bl.rev / tot × 100` | `views.js:605-615` | |
| Segment tooltip (FG) | `Revenue fmtUSD · pctOf(total) · CM fmtUSD (fmtPct(cmPct))`; Others: `CM not reported for Others` | `views.js:575-579` | `p.cm/p.cmPct` are the product's own (all-period) figures |

### 2.8 Profitability by product table — `views.js:626-637`

Rows: **all products** in `data.products` (flat, FG and Other together), sorted by revenue desc. Columns: Product, Qty (MT), Revenue, VC, CM, CM %.

| Metric | Formula | Source | Notes |
|---|---|---|---|
| Qty | `qtyMt == null ? '—' : toLocaleString(1 dp)` | `views.js:630` | |
| Revenue / VC / CM | `fmtBMK(...)`; `N/A` badge if `cogm`/`cm` null | `views.js:631-633` | |
| CM % | **Finished Goods rows only** (Other rows show `—`): `cmDetail`: `fmtPct(p.cmPct)`; if `p.hasAssumedZero` adds an "estimated" `?` icon with `fmtUSD(revenueAssumedZero)` | `views.js:38-45` | `p.cmPct = cm / costedRev × 100` — **not** the FG-only formula; Other products show `100%` |
| Footer | `Total — N products`, Qty, `fmtK(total.revenue)`, `fmtK(total.cogm)`, `fmtK(total.cm)`, **`fmtPct(total.groups.fg.cmPct)`** | `views.js:635-637` | CM % is now FG-only (live 28.28 %, same as the Margin card). Total CM $ still includes Others at assumed $0 VC. §9-Q3 |
| "Click a row…" | `· N total` when `N > 10` (scroll indicator only) | `views.js:37,626-627` | `RANKED_VISIBLE_ROWS = 10` is a scroll threshold, not a limit |

### 2.9 Status dots (top bar) — `views.js:210-276`

| Metric | Formula | Source |
|---|---|---|
| Orange dot, "Zero-cost assumption" | shown if `total.hasAssumedZero`; amount `formatMoneyCompact(total.revenueAssumedZero)`; FG part `groups.fg.revenueAssumedZero`; Other part `groups.other.revenueAssumedZero` | `views.js:237-242` |
| Orange: partial coverage | if `total.partial`: costed = `revenueFinal + revenueProvisional + revenueAssumedZero` vs `revenue`, not-costed = `revenueNotCosted` | `views.js:243` |
| Orange: provisional months | months with `p.provisional`, amount `total.revenueProvisional` | `views.js:246-247` |
| Red dot, closure breaches | `n = batchBreaches + orderBreaches + quantityBreaches` where each = number of dataset breaches whose batch/order appears in the **filtered** lines; "outside" = `dataset.batch + order + quantity − n` | `aggregate.py:191-205`, `views.js:248-256` |
| "Data through" pill | `mLabel(allPeriods[-1])` — newest period of the **whole dataset** (ignores the filter) | `views.js:261-262` |

### 2.10 Data Management › Validation page — `views.js:642-717`, `controls.py`

| Metric | Formula | Source |
|---|---|---|
| Batch closure | per batch with `cogmByBatch` and a frozen cost: `breach = Σ line cogm > batchCost + 0.01`; card shows `(total − breaches)/total` | `controls.py:28-46` |
| Order closure | per order: `expected = orderCost × inScopeQty / totalQty`; `diff = distributed − expected`; `breach = |diff| ≥ 0.01` | `controls.py:49-63` |
| Quantity control | per batch: `breach = Σ qtyKg delivered > Σ receipts qty + 0.001` | `controls.py:66-77` |
| Revenue reconciliation | per period vs hard-coded regression table (`controls.py:15-20`), pass iff `|rev − target| < 0.005 AND lines == targetLines`; table filtered to periods ≤ `asOf` period | `controls.py:80-117` |
| Coverage by period | final / provisional / assumed-zero / not-costed revenue, `cogm`, `cm`, `cmPct = cm / (final+prov+assumedZero) × 100` | `controls.py:119-133` |

These cover the **whole dataset** except the "affected products" table, which filters assumed-zero lines to the selected `from/to` (`views.js:688-696`).

---

## 3. Periods

### 3.1 Definition

| Aspect | Implementation | Source |
|---|---|---|
| Period unit | Calendar month, label `MM.YYYY` | `build.py:20-21` |
| Date field that assigns the period | **Ledger `PostingDate`** of the revenue journal line (`r.PostingDate`) | `build.py:109,126` |
| Date field that bounds the load | `BillingDocumentDate` (header) in `[PERIOD_FROM, asOf]` **and** `PostingDate` in `[PERIOD_FROM, asOf]` | `build.py:39-40,90` |
| `billingDate` field | Stored on each line (header date) and used only for sorting/labelling in drill-downs | `build.py:124` |
| Fiscal year / variant | **Not applied.** `FiscalYear` is only part of the join key to match a ledger line to its billing header. No fiscal calendar logic exists | `build.py:48-49` |
| Time zone | SAP `/Date(ms)/` → UTC calendar date (`odata_date`). The spreadsheet source uses the calendar parts of the Excel date. `closure_as_of` and the default `as_of` use today's UTC date (`datetime.now(timezone.utc)`) | `jsutil.py:65-79`, `spreadsheet.py:14-23`, `build.py:28-29` |
| Week definition | None. No weekly view exists | — |
| Daily granularity | Only in drill-down document lists (`billingDate`) | `drillViews.js:126-152` |

Display windows:

| Window | Definition | Source |
|---|---|---|
| Selected window | `from`..`to` (inclusive, `MM.YYYY`), compared via `YYYYMM` | `aggregate.py:160-163` |
| "YTD" / "Month" columns | *YTD* = whole selected window (name is historical); *Month* = newest period **in the window** (`data.periods.at(-1)`) | `store.js:82-89`, `views.js:421-423` |
| Hero "latest" tiles | newest period in the window | `views.js:51` |
| Rolling / MTD / prior-year | **None exist.** No year-over-year comparison anywhere | — |

### 3.2 Comparison periods

| Comparison | Basis | Partial-period behaviour |
|---|---|---|
| Hero MoM | `periods[-1]` vs `periods[-2]` of the filtered window, total revenue | If the newest period is a part month (`asOf` in that month and day < 28) the text says so in tooltip/label but **the number is still computed against the full prior month** (`views.js:171-189`). With `REPORT_TO = 2026-09-30` (day 30) this is not triggered |
| Month-by-Month MoM | previous element in window, else `priorPeriodData` = the period before the first displayed one in `allPeriods`; FG revenue | `—` when no predecessor or `prevFg` is 0/null |
| Chart tooltip "QTY vs prev. month" | previous array element, FG quantity | requires previous FG qty ≠ 0 |

`allPeriods` is built from **all** dataset lines (`aggregate.py:174`) and only contains months that have at least one line; so a month with no sales is absent and "previous period" skips it.

### 3.3 Presets (`derive.js:6-20`)

```python
newest, oldest = periods[-1], periods[0]; year = newest[3:]
ytd   : from = '01.'+year if present in periods else oldest ; to = newest ; label f'{year} to date'
last12: from = periods[-12] if len(periods) > 12 else oldest ; to = newest ; label 'Last 12 months'
all   : from = oldest ; to = newest ; label 'All data'
```

Default on first load = `ytd` (`store.js:73-76`). With the live data (9 periods) all three resolve to `01.2026 → 09.2026`.

---

## 4. Drill-down hierarchy

All levels honour the top-bar `from/to` (passed as `from/to` on every call) except where noted. `q()` builds `source` + optional `from/to` (`drillViews.js:37-41`).

| Level | Opened from | API call | Dimension / key | Numbers shown | Aggregation / ordering | Source |
|---|---|---|---|---|---|---|
| **L1a Product** | table row, donut segment/legend | `/api/data?material=<code>` | product code | Stat cells: Volume (`fmtMT(total.qtyMt)`), Revenue, VC, CM (`N/A` if null). Margin card from `summarisePeriods`. Rows: one per period (latest first): `fmtMT(qtyMt) · N lines · CM fmtK (fmtPct)`, revenue, `VC fmtK` | Periods ascending then **reversed** for display | `drillViews.js:43-57,75-85` |
| **L1b Customer** | table row | `/api/data?customer=<code>` | customer code | same as L1a | same | `drillViews.js:59-73` |
| **L1c Period** | chart bar / month row | `/api/data?period=<MM.YYYY>&from&to` (`from/to` are sent and AND-ed with `period`; no effect because the period lies inside the window) | period | Stat: Revenue, Volume, CM, Lines. Rows: one per product: share `(p.revenue / total.revenue × 100).toFixed(0)%`, `fmtMT`, `CM fmtPct`, revenue | `products` sorted revenue desc | `drillViews.js:87-110` |
| **L2/L3 Product×Period / Customer×Period** | period row | `/api/lines?material\|customer=<code>&period=<p>` (`/api/lines` does not read `from/to` server-side; it filters on `period`/`material`/`customer`/`billingDocument` only) | billing document | Per document: `rev = Σ revenueUsd`, `qty = Σ qtyMt (non-null)`, `cogm = Σ cogmUsd (non-null)`, `costed` count; `CM = costed ? rev − cogm : N/A`; items count. Stat: Revenue, Documents, Lines | Sorted by `billingDate` **desc**; ties keep API line order | `drillViews.js:112-152` |
| **L4 Billing document** | document row | `/api/lines?billingDocument=<n>` (`/api/lines` filters on `billingDocument` only) | billing item × batch (one row per ledger line) | Item, billing date, product, Qty (MT, 3 dp; raw kg + unit if no conversion), revenue, batch, mfg orders, VC, CM, CM %, status. Stat: Revenue, VC (`Σ cogmUsd‖0`), CM (`rev − cogm`), Items | **Unsorted** — API/ledger order. Stat `VC/CM = 'N/A'` only if **no** line has cost | `drillViews.js:154-192` |
| **L5 Batch** | order chip | `/api/batch/<batch>` | manufacturing order | Batch cost `fmtK(b.cost)`, produced `qty/1000` MT (3 dp), unit cost `unitCostPerKg×1000` $/MT (2 dp), State final/provisional. Rows per feeding order: `orderCost`, `buckets.materials`, `buckets.activities`, `buckets.overhead` (labelled **Utilities**). Footer: apportioned batch cost | Order order = `f.orders` insertion order (receipt order). **Unit cost shown is frozen** | `drillViews.js:194-223`, `views.py:126-145` |
| **L6 Order** | order chip | `/api/order/<order>` | cost component | Materials by component (`sum amount`, `sum qty`), Activities (one row), Utilities (one row, Z2 only), total = `round2(materialsTotal + activities + overhead)`, `actualCostPerKg = totalCost / qtyProducedKg` (null if qty ≤ 0), vs the batch's frozen cost/kg (`diff = frozen − actual`) | Materials sorted by `cost` desc; **no date filter** (full actual order cost) | `drillViews.js:225-281`, `modetail.py:90-186` |

### 4.1 Aggregation consistency

| Check | Holds? | Detail |
|---|---|---|
| Σ periods = total | Yes for revenue/qty/cogm/cm/lines (same lines, same `add`); each rounded independently so cents can differ | `aggregate.py:169,172` |
| Σ products = total | Yes (all lines belong to exactly one product) up to rounding | |
| Σ customers = total | Yes **only if every line has a non-null `customer`**. `group()` skips lines whose key is `None` (`aggregate.py:104`). Live: all 695 have a customer | |
| FG subtotal + Other subtotal = total | Yes (same lines) up to rounding | `aggregate.py:133-139` |
| Σ Other categories = Other subtotal | Yes; empty categories dropped | `aggregate.py:136-139` |
| Σ documents = product/customer×period | Yes for revenue; document rows re-derived client-side from `/api/lines` | `drillViews.js:126-135` |
| Drill levels vs card | L1 stat `Revenue/VC/CM` = `total` for that product/customer **including all period rows shown**; the L1 margin card is `summarisePeriods` (see below), computed from the rows with non-null `cogm` and `cm` only | `derive.js:48-58` |
| Top-N truncation | **None.** All rows are returned and rendered; "Other" in the UI is the Finished-Goods vs Other classification, not a residual bucket | |
| Unassigned items | Lines without a batch/order are **not hidden**: they are costed at assumed $0 and shown with status "Assumed $0". Lines without a customer would disappear from customer tables only | `engine.py:209-227` |

`summarisePeriods(periods)` (drawer margin card, `derive.js:48-58`): over periods with `cogm != null && cm != null`: `revenue = Σ revenue`, `cogm = Σ cogm`, `cm = Σ cm`, `cmPct = revenue ? cm / revenue × 100 : null` (**unrounded**, ratio from summed dollars). Note that this card is *not* Finished-Goods-filtered for a product that is "Other": an Other product shows CM % = 100 %.

---

## 5. Top bar and filters; sort orders

### 5.1 Filters

There is **no** product, customer, plant, currency or status filter in the top bar. The only user-facing data filters are:

| Filter | Options (source) | Default | Selection | Applies to | Does not affect | Source |
|---|---|---|---|---|---|---|
| Preset segment (`2026 to date` / `Last 12 months` / `All data`) | computed from `data.allPeriods` (`derive.js:6-20`) | `ytd` | single | sets `from`,`to` | — | `FilterBar.jsx:60`, `store.js:118-123` |
| FROM | every period in `allPeriods` ascending, suffixed ` (open)` for periods with `provisional` | oldest→ per default preset `01.2026` | single | `from` param on every `/api/data`, `/api/lines`, drill call | — | `FilterBar.jsx:42-43,64` |
| TO | same list | newest (`09.2026`) | single | `to` param | — | `FilterBar.jsx:67` |
| Source (Data Management page) | `api` (Live SAP) / `spreadsheet` | `api` | single | selects dataset; clears and reloads | Spreadsheet has no VC (§9-Q11) | `store.js:111-117` |

Interaction: choosing FROM later than TO moves TO to FROM; choosing TO earlier than FROM moves FROM to TO (`store.js:124-133`). A `from/to` taken from the URL query must exist in `allPeriods` and satisfy `from ≤ to`, otherwise they are dropped and the default preset applies (`store.js:70`). The selection is read from the URL but never written back (`syncFilterUrl` is never called).

What every filter touches:

| Panel | Affected by from/to | Notes |
|---|---|---|
| Hero (all tiles) | Yes | latest tile = newest period in window |
| Sales by period chart + Month list | Yes | `data.periods` is the filtered list; MoM first row also uses `priorPeriodData` (unfiltered predecessor) |
| Sales by product / customer (YTD cols) | Yes | |
| Sales by product / customer (Month cols) | **No** — always the single newest period of the window | `monthData` |
| Margin, donut, Profitability | Yes | |
| Status dots | Yes (breaches/zero-cost scoped to filtered lines); "Data through" does **not** | |
| Validation page | **No** (whole dataset) except the assumed-zero affected-product table | |

### 5.2 Sort orders

| List / chart | Sort field | Direction | Tie-breaker | Limit | Source |
|---|---|---|---|---|---|
| `periods` (chart, month list source) | `YYYYMM` string | ascending (month list is displayed reversed = newest first) | none (keys unique) | none | `aggregate.py:169`, `views.js:385` |
| `products` (Profitability table, drawer product mix) | `revenue` | descending | **none** — Python's `sorted` is stable, so ties keep first-appearance order in the line list (API return order of the ledger view) | none (scroll after 10 visible rows) | `aggregate.py:170` |
| `customers` | `revenue` | descending | same | none | `aggregate.py:171` |
| `sections.products[*].rows`, `categories[*].rows`, `sections.customers[*].rows` | `revenue` | descending | same | none | `aggregate.py:127-131` |
| Section order | FG first, then Other | fixed | — | — | `aggregate.py:140-150` |
| Other categories | fixed order 13, 21, 61, fallback; empty ones dropped | fixed | — | — | `productgroup.py:31-33`, `aggregate.py:136-139` |
| Donut segments / legend | FG rows then Other categories, each in descending revenue | — | — | all | `views.js:565-568` |
| Drill: documents | `billingDate` | descending | stable (Map insertion = line order) | none | `drillViews.js:135` |
| Drill: document items (L4) | none | API order | — | none | `drillViews.js:172-183` |
| Drill: order materials (L6) | `cost` | descending | stable | none | `modetail.py:150` |
| Drill: assumed-zero affected products | `rev` | descending | stable | none | `views.js:694` |
| Closure/validation rows | per control, order of `Map` insertion | — | — | 500 rows shown for the two long line lists | `views.js:682,700` |

---

## 6. Number formatting and rounding

The front-end formatters below use JavaScript semantics, and the backend reproduces the same rules wherever it formats or keys on numbers (`jsutil.py`: `js_round`, `round2`, `to_fixed`, `intl_en_us`). `Math.round(x)` rounds half toward **+∞** (`Math.round(-2.5) = -2`); `toFixed` rounds the **exact binary value** (not decimal half-up); `toLocaleString('en-US')` uses `,` thousands separators.

| Formatter | Definition | Used by | Source |
|---|---|---|---|
| `round2(n)` (backend) | `floor((n + 2.220446049250313e-16) * 100 + 0.5) / 100`, never −0 | all server-side rounding | `jsutil.py:17-19` |
| `fmtUSD(n)` | `(n<0?'-$':'$') + Math.abs(Math.round(n)).toLocaleString()` — whole dollars | tooltips, validation | `format.js:8` |
| `fmtK(n)` | `abs ≥ 1e6` → `$` + `(abs/1e6).toFixed(2)` + `M`; `abs ≥ 1e3` → `(abs/1e3).toFixed(1)` + `K`; else `$` + `Math.round(abs)`; `-` prefix when `n<0` | hero, charts, tables, margin | `format.js:10-15` |
| `fmtBMK(n)` | as `fmtK` plus `B` (`≥1e9`, 1 dp), `M` with **1 dp** | Sales by product items, Profitability | `format.js:17-23` |
| `formatMoneyCompact(v)` | units B/M/K; value `= abs/unit`; 2 dp **unless the 2-dp value is whole** (then no decimals); rolls up to the next unit if the rounded value reaches 1000; `<1000`: 2 dp or whole; `-0` → `$0`; `null/NaN` → `—` | tooltips, status dots, sparkline | `format.js:42-64` |
| `fmtPct(n)` | `null` → `N/A`; `r = Math.round(n*100)/100`; integer → no decimals (`100%`), else `toFixed(2)` + `%` | all % displays | `format.js:26-30` |
| `fmtMT(n)` | `null` → `—`; `toLocaleString('en-US', {maximumFractionDigits: 1}) + ' MT'` | hero, drill | `format.js:24` |
| `qtyFmt(v)` | `toLocaleString('en-US', {min 1, max 1})` | product table | `format.js:34` |
| `fmtAvgKg(n)` | `'$' + n.toFixed(3)` | hero | `format.js:40` |
| `formatAvgPriceKg(v)` | 2 dp unless whole, `' /kg'` | chart tooltip | `format.js:67-70` |
| MoM text | `Math.abs(chg).toFixed(1)` with explicit `+`/`-`, arrow by `chg >= 0` | hero, month list | `views.js:185,408` |
| Donut shares | `toFixed(1)` | donut, legend | `views.js:599,605` |
| Product-mix % in period drill | `(share × 100).toFixed(0)` | drawer | `drillViews.js:103` |

Rounding happens: (1) per line for COGM/CM/CM% (server, 2 dp); (2) once per aggregate (server, 2 dp); (3) at display (client). No metric is computed *from* a rounded display value. The only client-side arithmetic on server values is: hero MoM, Month-list MoM, avg price per kg, donut shares, drill document sums, and `summarisePeriods`; all use the server's 2-dp aggregates as inputs.

---

## 7. Reconciliation guide

### 7.1 Tolerances

| Quantity | Recommended tolerance | Reason |
|---|---|---|
| Revenue, COGM, CM (any aggregate) | ±0.01 USD per aggregate; ±0.05 USD on the grand total | Per-line COGM/CM are rounded to 2 dp, aggregates are float sums rounded once |
| Quantity (MT) | ±0.01 MT | `round2` of a float sum; per-line `qtyKg/1000` unrounded |
| CM % | ±0.01 percentage points | `round2(cm / costedRev × 100)` |
| Counts (lines, documents, batches, orders, products, customers) | exact | |
| Frozen unit cost per kg | ±1e-9 USD/kg if recomputed from the same inputs | stored unrounded (`cost/qty`) |

A re-implementation must reproduce: `round2(x) = floor((x + 2.220446049250313e-16) * 100 + 0.5) / 100` (half-up on the float), line-level rounding of `cogm`/`cm`/`cmPct`, summing in the same order, and aggregate-level rounding once. Python's built-in `round()` (banker's) and `Decimal` default rounding will differ on exact-half cases.

### 7.2 Recommended check totals (live, window 01.2026–09.2026)

| Check | Value |
|---|---|
| Grand total revenue | **14,068,865.87** (target in the `controls.py` regression table = same; `diff 0.00`) |
| Lines / billing documents | **695 / 511** |
| Total quantity | **10,879.04 MT** (FG 9,310.63, Other 1,568.41) |
| Total VC (COGM) | **9,924,405.59** (all FG; Other = 0 by assumption) |
| Total CM | **4,144,460.28** (CM % 29.46) |
| FG revenue / VC / CM / CM % | 13,838,245.24 / 9,924,405.59 / 3,913,839.65 / 28.28 % |
| Other revenue (all at assumed $0) | 230,620.63 (359 lines) |
| Distinct batches sold / frozen / orders used | 122 / 121 / 176 |
| Per-period revenue and line count | 01: 816,326.03/31 · 02: 469,566.78/104 · 03: 2,056,492.74/96 · 04: 1,362,331.79/75 · 05: 1,235,940.20/61 · 06: 1,886,271.46/76 · 07: 1,887,630.70/84 · 08: 1,628,675.64/62 · 09: 2,725,630.53/106 |
| Overheads kept / dropped | 242 lines $499,422 / 242 lines $2,886,945 |
| Known control breaches | 1 batch (`WFP260131`: allocated 116,652.23 > cost 115,423.43), 1 quantity (`WFP260131`: delivered 103,950 kg > produced 102,855 kg), 0 order |
| Order-cost bucket mix of the 176 orders (unweighted by apportionment) | materials 10,315,204.28 · activities 254,802.00 · utilities 499,422.37 · paired offset ≈0 |

### 7.3 Likely sources of divergence

| # | Source | Detail |
|---|---|---|
| D1 | **VC composition** | Activities (`54400000, 54093000, 54053000, 54200100`) and `13200000` are in the code's VC. Also `52*`, `55*`, `24*` are excluded and everything not listed is ignored. |
| D2 | **Z1/Z2 inference** | Rate-pair rule on `(OrderID, AccountingDocument)` groups of exactly two G/L `94301000` lines; explicit `OverheadSource` wins if the CDS view ever exposes it. |
| D3 | **Frozen cache** | `final` entries are never recomputed (`cache.get_frozen`), including after later SAP reposting. Cache is keyed **by batch number only** (not material/plant) and invalidated only when the cost-rule fingerprint changes (`rules.py:14-24`). `final` is evaluated against the **real current date**, so a batch becomes final when the current month passes its last order posting. |
| D4 | **Date field** | Period = ledger `PostingDate`; load bounds also use `BillingDocumentDate`. A document billed on the last day and posted next month is excluded from the window and from the period of its billing date. |
| D5 | **Cancellations** | `BillingDocumentIsCancelled` is fetched but not used; cancelled documents and their cancellation documents both survive if `AccountingPostingStatus == 'C'`, and both ledger lines are summed (net zero). Goods receipts: rows flagged `GoodsMovementIsCancelled` are removed; only movement type `101` is read (no `102` reversal rows are added). |
| D6 | **Currency** | Only `AmountInGlobalCurrency` is read (labelled USD in the UI). No FX table is used; 431 of 695 lines are RWF documents. |
| D7 | **Line matching** | Ledger line ↔ billing item by `(accounting doc, material, |qty| to 3 dp)`, first unused item in the API return order of the items. Equal-quantity duplicates within a document get paired in order; batch assignment depends on that order. |
| D8 | **Rounding order** | Line-level `round2` before summing; sum of rounded CM ≠ `round2(Σrev − Σcogm)` in general. |
| D9 | **Credit notes / returns** | Quantity sign comes from the ledger (`-Quantity`), magnitude from the item; COGM = signed kg × frozen unit cost. A credit note therefore gets a negative COGM and a negative revenue. |
| D10 | **Unit of measure** | Non-KG base units are converted only via `A_ProductUnitsOfMeasure.GrossWeight` in `KG`; otherwise `qtyMt = null` and the line contributes revenue but no tonnage (`qtyLinesUnconverted`). Live: one material (`61000011`, `PC`). |
| D11 | **FG classification** | Material prefix `11` after stripping leading zeros and whitespace. |
| D12 | **Sort ties** | No tie-breaker; row order of equal-revenue products/customers follows the first appearance in the ledger API response. |
| D13 | **Unresolved batch** | Line with a batch absent from `frozen` (live: batch `0000000058`, $131.95) is assumed-zero. |

---

## 8. Test scenarios (live values)

All values from `GET /api/data?source=api&…` and the formatter rules of §6, dataset built 2026-10-23T10:36Z. Raw numbers are server values (2 dp). "Displayed" strings are what the front-end renders.

### Scenario 1 — Default view: `from=01.2026&to=09.2026` (preset "2026 to date")

| Item | Raw | Displayed |
|---|---|---|
| Total revenue | 14,068,865.87 | Hero `$14.07M` |
| Total qty | 10,879.04 MT | — |
| Total VC / CM / CM % | 9,924,405.59 / 4,144,460.28 / 29.46 (API `total.cmPct`, no longer displayed) | Profitability footer `$9.92M`, `$4.14M`, CM % `28.28%` (FG only) |
| Counts | lines 695 · documents 511 · batches 122 · orders 176 · products 18 · customers 29 | |
| Latest period 09.2026 | revenue 2,725,630.53 (FG 2,662,998.22, Other 62,632.31) | `$2.73M`; `$2.66M`; `$62.6K` |
| Hero MoM | `(2,725,630.53 − 1,628,675.64)/1,628,675.64 = 67.35 %` | `▲ +67.4% MoM` |
| Hero quantities (Sep) | 2,025.88 MT (FG 1,763.32; Other 262.56) | `2,025.9 MT` |
| Avg price (Sep, FG) | `2,662,998.22 / (1,763.32 × 1000) = 1.5102` | `$1.510` |
| Margin card (FG, window) | revenue 13,838,245.24 · VC 9,924,405.59 · CM 3,913,839.65 · CM % 28.28 | `28.28%`, `$3.91M`; Sep: `27.46%`, `$731.2K` |
| Donut | FG share 13,838,245.24 / 14,068,865.87 | `B2B/B2C 98.4%` |
| Sections | FG: 12 products, 15 customers · Other: 6 products (By-products 3, Raw 1, Non-stock 2), 15 customers | |
| Top products by revenue | 11000033 WFP Infant 15kg 6,321,967.07 (qty 4,281.53, VC 4,755,343.14, CM 1,566,623.93, 24.78 %) · 11000013 MoH Infant 18kg 3,987,767.96 (CM 36.69 %) · 11000018 CRS SC+ TENDER 1,322,872.67 (19.78 %) · 11000012 MoH Mother 18kg 1,192,616.14 (38.25 %) · 11000007 ICRC SC+ 10x1.5kg 698,035.50 (16.42 %) | |
| Top customers | 1000000 WORLD FOOD PROGRAMME 6,321,967.07 (CM 1,566,623.93) · 1000001 NCDA 5,179,954.92 (CM 1,919,160.30) · 1000002 CRS 1,322,872.67 · 1000048 ICRC Mombasa Port 714,835.50 · 1000040 Rwanda Correctional Services 208,956.31 | |
| Status dots | orange: zero-cost assumption `$230.62K`, FG part 0; red: 1 batch + 0 order + 1 quantity = 2 breaches | |
| Month-by-month FG MoM | Jan `—` (no predecessor); Feb vs Jan `(440,367.58 − 814,156.54)/814,156.54 = −45.9 %` | `▼ 45.9%` |

Per-period (revenue / FG revenue / qty MT / FG qty / VC / CM / FG CM % / lines): 01.2026 816,326.03 / 814,156.54 / 615.49 / 571.54 / 633,420.14 / 182,905.89 / 22.20 / 31 · 02.2026 469,566.78 / 440,367.58 / 649.03 / 301.33 / 332,172.51 / 137,394.27 / 24.57 / 104 · 03.2026 2,056,492.74 / 2,040,602.58 / 1,614.46 / 1,337.35 / 1,281,885.78 / 774,606.96 / 37.18 / 96 · 04.2026 1,362,331.79 / 1,322,361.19 / 1,116.38 / 911.71 / 999,797.30 / 362,534.49 / 24.39 / 75 · 05.2026 1,235,940.20 / 1,225,103.71 / 909.66 / 835.12 / 911,219.67 / 324,720.53 / 25.62 / 61 · 06.2026 1,886,271.46 / 1,875,270.54 / 1,360.77 / 1,301.33 / 1,433,707.67 / 452,563.79 / 23.55 / 76 · 07.2026 1,887,630.70 / 1,864,367.65 / 1,407.34 / 1,256.68 / 1,304,475.37 / 583,155.33 / 30.03 / 84 · 08.2026 1,628,675.64 / 1,593,017.23 / 1,180.03 / 1,032.25 / 1,095,905.01 / 532,770.63 / 31.21 / 62 · 09.2026 2,725,630.53 / 2,662,998.22 / 2,025.88 / 1,763.32 / 1,931,822.14 / 793,808.39 / 27.46 / 106.
(The CM column here is total CM, including Other at 100 %; FG CM % is `groups.fg.cmPct`.)

### Scenario 2 — Single month: `from=09.2026&to=09.2026`

| Item | Raw |
|---|---|
| Total | revenue 2,725,630.53 · qty 2,025.88 MT · VC 1,931,822.14 · CM 793,808.39 · CM % 29.12 · lines 106 |
| FG | revenue 2,662,998.22 · qty 1,763.32 · VC 1,931,822.14 (72.54 %) · CM 731,176.08 (27.46 %) |
| Counts | documents 80 · batches 23 · orders 53 · products 12 · customers 15 |
| Hero MoM | empty (only one period in window) |
| Month-list Sep MoM (FG) | prior period from `allPeriods` = 08.2026: `(2,662,998.22 − 1,593,017.23)/1,593,017.23 = +67.2 %` |
| Sections | FG 8 products / 7 customers · Other 4 products / 9 customers |
| Top product | 11000013 907,277.09; then 11000018 638,392.67; 11000033 614,233.80; 11000012 279,876.30 |
| Donut | FG share 97.7 % |

### Scenario 3 — Mid-year range: `from=03.2026&to=05.2026`

| Item | Raw |
|---|---|
| Total | revenue 4,654,764.73 · qty 3,640.50 · VC 3,192,902.75 · CM 1,461,861.98 · CM % 31.41 · lines 232 |
| FG | revenue 4,588,067.48 · qty 3,084.19 · VC 3,192,902.75 (69.59 %) · CM 1,395,164.73 (30.41 %) |
| Other | revenue 66,697.25 · qty 556.31 |
| Counts | documents 169 · batches 46 · orders 46 · products 15 · customers 23 |
| Hero MoM (05 vs 04) | `(1,235,940.20 − 1,362,331.79)/1,362,331.79 = −9.28 %` → `▼ -9.3% MoM` |
| Avg price (May, FG) | `1,225,103.71 / (835.12 × 1000) = 1.467` → `$1.467` |
| Margin card | CM % 30.41 · May 25.62 % |
| Top product | 11000033 2,378,061.46; 11000013 1,334,064.22; 11000012 346,099.20; 11000018 219,589.74 |

### Scenario 4 — Product drill-down: `from=01.2026&to=09.2026&material=11000033`

| Item | Raw |
|---|---|
| Total | revenue 6,321,967.07 · qty 4,281.53 · VC 4,755,343.14 · CM 1,566,623.93 · CM % 24.78 · lines 158 |
| Counts | documents 101 · batches 46 · orders 57 · products 1 · customers 1 |
| Sep | revenue 614,233.80 · qty 401.46 · FG CM 179,526.51 (29.23 %) · MoM +102.7 % (total revenue) |
| Sections | FG 1 row; Other 0 rows (`sections.products[other].total.cm = null`) |

### Scenario 5 — Customer drill-down: `from=07.2026&to=09.2026&customer=1000000`

| Item | Raw |
|---|---|
| Total | revenue 1,639,793.99 · qty 1,096.76 · VC 1,219,335.98 · CM 420,458.01 · CM % 25.64 · lines 51 |
| Counts | documents 39 · batches 12 · orders 22 · products 1 · customers 1 |
| Sep | revenue 614,233.80 · qty 401.46 · CM 29.23 % · MoM +102.7 % |
| Avg price (Sep, FG) | 1.530 |

### Scenario 6 (drill sample) — one document and its batch

`GET /api/lines?billingDocument=90000716`: one item `20`, revenue 43,559.10, qtyKg 28,470 → qtyMt 28.47, batch `WFP260829`, orders `1000774, 1000782, 1000775`, VC 31,649.20, CM 11,909.90, CM % 27.34, status final.
`GET /api/batch/WFP260829`: batch cost 132,716.55, received 119,385 kg, `unitCostPerKg` 1.1116685513… (displayed `$1,111.67/MT`), final. Check: `28,470 × 1.1116685513 = 31,649.20`. Orders: 1000774 cost 37,821.47 (materials 36,579.47, utilities 1,242.00) · 1000782 22,919.91 (21,723.91 / 1,196.00) · 1000775 71,975.17 (68,295.17 / 3,680.00).

---

## 9. Open questions / inconsistencies

| # | Question / inconsistency | Evidence | Impact |
|---|---|---|---|
| Q1 | **RESOLVED.** Stated definition (Materials + Utilities Z2) differed from code (Materials + Activities + Utilities Z2 + paired offset). Owner: activities are intended in VC, even at zero, so future activity cost is captured; only Z2 overhead counts. **Follow-up:** `VC_DEF`, `MARGIN_DISCLAIMER`, `UTILITIES_TIP` in `frontend/src/lib/copy.js` still say "Direct Materials + Utilities" and should mention activities. | `engine.py:60-72`, `sources.json`, `copy.js:7-12` | Spec is now authoritative: Python VC = `51*` + the 4 activity accounts + `94301000` Z2 + `13200000`. |
| Q2 | Z1/Z2 are told apart by the higher/lower cost-per-kg of a pair of lines, not by a key. | `sources.json → overheadSources.identification` ("interim") | Fragile if confirmations post differently; any re-implementation must replicate the same pairing (`engine.py:25-52`) |
| Q3 | **DECISION: CM % is shown for Finished Goods only.** Currently the Margin card is FG-only (28.28 %), but the Profitability footer and the Sales-by-product Total row use all products including Other at 100 % CM (29.46 %). **Implemented** (`views.js` Profitability table, `derive.js:isFinishedGood`): footer CM % = `total.groups.fg.cmPct`; Other product rows show `—` for CM %. CM $ and VC columns are unchanged, and the drill-down drawer and Sales-by-product Total row (CM $ only) were not touched. | `views.js:535-554` vs `views.js:635-637`, `aggregate.py:75-77` | Python should reconcile FG CM % to 28.28 % (YTD live). |
| Q4 | Assumed-$0 treatment would also give 100 % CM to a **Finished Good** with a missing batch/order (not present today). | `engine.py:209-227` | FG CM can be overstated silently; flagged only by the orange dot |
| Q5 | `Hero MoM` uses total revenue vs the previous period *within the window*; `Month list MoM` uses FG revenue vs the calendar-previous period *in the dataset*. Different bases, same label "MoM". | `views.js:182`, `views.js:394` | |
| Q6 | `BillingDocumentIsCancelled` / `CancelledBillingDocument` are selected but never used; cancellation relies on the ledger netting. | `build.py:41-45` | Need confirmation that cancelled pairs always fall inside the same window (a cancellation posted after `REPORT_TO` would leave the original un-reversed) |
| Q7 | Revenue is GL `41*` only (`startswith(GLAccount,'41')`), `NetAmount` from the billing item is ignored. Other revenue-related accounts (discounts, freight, other 4x/5x) are excluded. | `build.py:84-85` | Define which accounts constitute "net sales" |
| Q8 | Currency: UI labels everything USD; `/api/status` hard-codes `'USD (global currency)'`; 431 of 695 documents are RWF. No FX logic exists in the code; correctness depends on the ledger 0L global currency being USD. | `views.py:62`, line data | Verify ledger/company global currency |
| Q9 | Table headings say "YTD" / "contribution-YTD" / "Jan–Sep" while the content is the selected window (can be any range, e.g. Mar–May). The help text `marginCard` hard-codes "Jan–Sep". | `views.js:455`, `copy.js:63` | Labels only |
| Q10 | The Month columns / hero "latest" are the newest period **in the window**, not the newest in the dataset; for a window ending before the dataset end they show an older month. The "Data through" pill shows the dataset's newest month. | `views.js:51,261` | |
| Q11 | **Spreadsheet source** (not the default): revenue = `−Amount in Global Currency` per row, **rounded per line**, no GL filter, no document-status filter; quantity is a revenue-share apportionment of a BW volume extract; no VC/CM. | `spreadsheet.py:41-79,128-146` | If reconciling that source, the logic differs materially. Out of scope here |
| Q12 | Controls regression table is hard-coded for Jan–Oct 2026 (revenue and line count per month). Passing means "ties to a snapshot", not to SAP live. | `controls.py:15-20` | |
| Q13 | `unitCostPerKg` is computed from the **unrounded** batch cost but `cost` in the frozen entry is rounded; `costSharePct` and some drill numbers use the rounded one. | `engine.py:149-160`, `views.py:139-141` | Cent-level only |
| Q14 | Frozen costs are keyed by batch alone; two materials sharing a batch number would be merged. Receipts also ignore `Material`. | `engine.py:111-141`, `cache.py` | Confirm batch numbers are globally unique in this client |
| Q15 | `partMonth` threshold `day < 28` is arbitrary and only changes labels, not numbers. | `views.js:171-172` | |
| Q16 | Period chart `fgCm > 0` guard: a negative FG CM period draws no CM bar. Revenue columns clamp negative revenue to 0 height. | `views.js:317,307` | |
| Q17 | Customer tables silently drop lines with a null customer (`group()` skips null keys). Currently none. | `aggregate.py:104` | |
| Q18 | Fiscal-year variant is not modelled; periods are calendar months from the posting date. Confirm the company code's fiscal variant is calendar-aligned (`FiscalYear` is read but unused for periodisation). | `build.py:48-49` | |
| Q19 | Items in a document drill (L4) and in `/api/lines` have **no defined order**; and equal-revenue products/customers have no tie-breaker. | `views.py:108-110` | Row order may differ between implementations |
| Q20 | The chat answerer (`backend/analytics/pipeline/chat.py`) re-derives answers from the same aggregates, with its own formatters (`fmt_pct` always 2 dp, `fmt_usd`); it was not specified here. | `chat.py:13-18` | Not part of the dashboard numbers |
| Q21 | Dates from SAP that are not `/Date(ms)/` are parsed with `datetime.fromisoformat`; a value without a UTC offset is taken as UTC (only reached for non-`/Date()/` strings). OData v2 `/Date(ms)/` values are treated as UTC. | `jsutil.py:65-79` | Only matters if the SAP service returns ISO strings |
