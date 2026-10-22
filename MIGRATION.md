# AIF Analytics — migration to Vite + React + Tailwind

Source (read-only, never modified): `AIF/` — Express API + a no-build plain-JS single-page app.
Target: this folder — the **same API** (copied, one test-only patch) behind a Vite + React + Tailwind front end.
The migration is like-for-like: same layouts, colours, fonts, spacing, charts, tooltips, animations, interactions and every number.

## Stack

| | Source | Target |
|---|---|---|
| Front end | `public/app.js` + `app.css` + `index.html`, no libraries | Vite 8, React 19 (JSX, no StrictMode), Tailwind 4 (`@tailwindcss/vite`) |
| Routing | hash routes, hand-written | same hash routes, `src/state/nav.js` (no router library) |
| State | one global object + `renderAll()` | external store (`useSyncExternalStore`) in `src/state/store.js` |
| API | `server/` (Express 4, ESM) | `server/` — copied unchanged, see "Server changes" |
| Dev | `node server/index.js` | `npm run dev` (API + Vite, `/api` proxied) |

## Run it

```
npm install            # also installs server/ (postinstall)
npm run dev            # API on :5180 (server/), web on :5174
npm run build && npm run preview
npm test               # unit tests
npm run lint
npm run parity         # data + behaviour + visual parity against the running source (see below)
```

Ports are fixed (`strictPort`). If 5174 or 5180 are taken: `PORT=<n>` for the API and `AIF_API_URL=http://localhost:<n> npx vite --port <m>` for the web.
Server code reads `config/`, `cache/`, `validation/` relative to the working directory, so it must run from `server/` (the npm scripts do).

## Environment variables

The real `.env` is **not** in this repo and is git-ignored. Create `server/config/.env` from `server/config/.env.example` (placeholders only):

| Variable | Purpose |
|---|---|
| `SAP_HOST`, `SAP_USER`, `SAP_PASS` | SAP S/4HANA OData (read-only). Secrets: server-side only, redacted from logs/exports/browser |
| `COMPANY_CODE`, `SALES_ORG`, `LEDGER` | reporting scope |
| `PERIOD_FROM`, `REPORT_TO` | data window (omit `REPORT_TO` to run through today) |
| `OVERHEAD_GL`, `BATCH_CHUNK` | overhead G/L account; OData batch size |
| `PORT` | API port (default 5180 here; the source defaults to 5173) |
| `AIF_FIXTURE_DATASET`, `AIF_FIXTURE_DIR` | **test-only**, see below. Leave unset in normal use |

The front end needs no environment variables (`/api` is proxied; `AIF_API_URL` only changes the proxy target of dev/preview).
The source's `.env.example` contained a real-looking `SAP_USER`; it was **not** copied — the placeholder version is new.

## Structure

```
src/lib/        format, copy (all user-facing text), modules registry, derive (period/preset logic), anim, popover engine,
                chart tooltip, sparkline, table fitting, views.js (generated — the source's card/table/chart builders)
src/state/      store (data + filters), drill (drawer), nav (routes), drillViews.js (generated — drill levels 1–6)
src/components/ Sidebar, FilterBar (sticky, module-aware, status dots + popovers), Hero, SalesByPeriod, Breakdown, MarginAndMix,
                Overview, DrillDrawer, ChatWidget, Pages (Coming soon / Data Management / Administration), Popover, Icon, HelpIcon
src/styles/     index.css (Tailwind + @theme tokens), components.css (generated from the source's app.css)
server/         the API, unchanged except the fixture mode below
tests/ parity/ scripts/
```

### How the logic was ported (and what is not idiomatic React)

To guarantee identical numbers and markup, the source's builder functions were **extracted verbatim by script** rather than retyped
(`scripts/port-views.mjs`, `scripts/port-drill.mjs`, `scripts/port-css.mjs`): each builder writes into a recording sink instead of the DOM
and returns the result for React to mount. Consequences, by design:

* Charts, tables, the donut, waterfall and drill-down levels are mounted from the source's HTML/SVG strings (`dangerouslySetInnerHTML`;
  all values pass through the source's `esc()`). Animations (hold/play/update, count-ups) write text into those regions, so they must
  not be React-managed text nodes.
* Layout shell, filter bar, popovers, drawer, chat, Data/Admin pages are real React components with state and effects.
* This is the approach agreed in the Phase 1 report; a fully componentised rewrite of the chart/table internals would be a separate,
  riskier project.

## Token and Tailwind mapping

Tailwind's preflight is **not** imported (`tailwindcss/theme.css` + `utilities.css` only): the source's own base styles render identically,
and utilities remain available to new work. Layer order: `theme, base, components, utilities`; the source's component CSS lives in
`@layer components`, so utilities can still override it.

| Source CSS variable | Tailwind theme variable |
|---|---|
| `--green`, `--mint`, `--ink`, `--gold`, `--clay`, `--tx`, `--canvas`, `--card`, `--line`, … | `--color-<same name>` |
| `--shadow`, `--shadow-lg` | `--shadow-card`, `--shadow-lift` |
| `--font-display`, `--font-body`, `--font-mono` | same (`@theme static`) |

368 references renamed in CSS plus 19 in the generated JS.

**Tailwind exceptions:** the source's ~790 lines of component CSS are kept as component classes rather than rewritten into utility
strings, because they carry pixel-tuned values, container/media queries and animation keyframes; rewriting them would risk visual drift
for no user benefit. Utilities are available for any new component.

## Server changes (all gated, normal behaviour unchanged)

`server/index.js` and `server/lib/env.js` carry one patch for the parity harness: with `AIF_FIXTURE_DATASET=<path>` the API loads that
dataset (the source's `validation/dataset.json`) instead of calling SAP and tolerates a missing `.env`; with `AIF_FIXTURE_DIR` it serves
batch/order drill-downs from captured snapshots. `PORT` may also come from the process environment. Without those variables nothing differs.

`server/tools/test-format.js` and `test-modules.js` moved to `tests/*.test.mjs` (assertions unchanged; they import ES modules instead of
evaluating browser scripts).

## Verification results

Run against the live source (`:5173`, SAP-backed) and this app in fixture mode on the same dataset.

| Check | Result |
|---|---|
| Unit tests (`npm test`): cost conversions, product grouping, overhead rule, money formatter, module registry | all pass; the same suite passes in the source |
| Data parity: `/api/data`, `/api/validation`, validation CSV for **2026 to date**, **Last 12 months**, **All data**, **custom 10.2025–07.2026**, per-period payloads, chat replies | 18 comparisons, **0 differences** (see note) |
| Behaviour: drill-down drawer CSV exports (product, month level, customer) | **byte-identical**; titles, crumbs, counts, filter, Esc-to-close, sticky-bar state all equal |
| Visual: 9 states × 3 widths (1440/1024/390): Sales, scrolled, chart hover, Data, Validation, Administration, Coming soon, product drawer, period drawer | 21 of 27 pixel-identical; the rest ≤ 0.017% except Data/Admin (below) |
| `vite build` | succeeds; JS 340 kB (105 kB gzip) incl. React, CSS 62 kB (13 kB gzip) |
| Source for comparison (unminified, no deps) | 249 kB raw / 74 kB gzip |
| Lint | clean |

Notes:

* *Data parity* normalises one field, `builtAt`: the live source rebuilds from SAP on its own schedule so its timestamp moves while every
  figure is unchanged. `STRICT=1` compares it too (right after copying a fresh `validation/dataset.json`; it passed at 0 differences that way).
* *Visual residuals:* `overview-scrolled-1440` and `drill-product-1440` (under 0.02%) are a count-up caught at a different tween moment and
  the animated chat GIF frame; the settled values were compared separately (margin 28.28%, CM $3.91M, hero $14.07M — identical).
  **Data Management and Administration** differ by 0.07–0.42% only in server-state values (load-history rows, frozen-batch cache count,
  connection-check time): the test server has no spreadsheets or batch cache. Their layout is identical (diff images in `parity/out/`).
  They are reported, not gated.
* The parity harness never touches the source except to GET its pages and API.

### Running the parity checks

1. Source dashboard running on `:5173` (unchanged).
2. Copy the source's `validation/dataset.json` to `server/validation/` (git-ignored) and start the API in fixture mode:
   `cd server && AIF_FIXTURE_DATASET=validation/dataset.json PORT=5181 node index.js`
3. `AIF_API_URL=http://localhost:5181 npx vite --port 5191 --strictPort`
4. `npm run parity` (override with `SRC`, `DST_API`, `DST`). Screenshots, diffs and CSVs land in `parity/out/` (git-ignored).
   Run `npx playwright install chromium` once if the browser is missing.

## Known gaps and findings (for your decision)

1. **Source bug, reproduced faithfully — taps blocked on phones.** At the mobile breakpoint, `.pop-scrim{display:block}` overrides its
   `hidden` attribute, so an invisible full-screen layer covers the page and swallows real taps (verified in the source and here:
   `elementFromPoint` returns `#popScrim`). Not changed, because the brief is like-for-like. One-line fix when you want it:
   `.pop-scrim[hidden]{display:none}`. The visual tests use scripted clicks for the drawer at 390 px for this reason.
2. **Source bug, reproduced faithfully — period filter never written to the URL.** `syncFilterUrl()` exists but is never called; the URL is
   read on load only. Earlier I said the period was "stored in the URL": that was incorrect. The function is ported and exported, uncalled.
3. The bundle is larger than the source (React runtime, about +30 kB gzip); expected for this stack.
4. **Spreadsheet source:** this server has no `.xlsx` files, so "Local spreadsheets" is empty here. Place the two exports beside the
   server to enable it.
5. **Batch/order drill-downs (levels 5–6)** call live SAP; in fixture mode they need captured snapshots in `AIF_FIXTURE_DIR`. None were
   captured, so those two levels were verified by code identity (generated from the source's functions), not by screenshot.
6. **Not verified:** runs of the target against real SAP (no credentials were supplied, by design). The API code is a verbatim copy.
