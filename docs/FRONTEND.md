# Front end — architecture notes

The dashboard UI is a **Vite 8 + React 19 + Tailwind 4** app in [`frontend/`](../frontend/). It talks to the Django API in [`backend/`](../backend/README.md) through `/api`
(proxied to port 5180 in development, see `frontend/vite.config.js`). How to run everything is in the [root README](../README.md).

## Stack

| Concern | Choice |
|---|---|
| Build / dev server | Vite 8 (`strictPort` 5174), `@vitejs/plugin-react`, `@tailwindcss/vite` |
| UI | React 19 (JSX, no StrictMode) |
| Styling | Tailwind 4 theme + utilities only (no Preflight) and the dashboard's own component CSS in `src/styles/components.css` |
| Routing | hash routes (`#production`, `#data`, `#product/<code>` …), hand-written in `src/state/nav.js`; no router library. `/login` and `/reset-password` are real paths handled by `AuthGate` |
| State | small external stores (`useSyncExternalStore`): `state/store.js` (data + period filter), `state/drill.js` (drawer), `auth/auth.js` (session and permissions) |
| HTTP | one wrapper, `src/lib/http.js` (cookie session, `X-AIF-Client` header, global 401/403 handling) used by `store.api` and the auth module |
| Tests | `frontend/tests/*.test.mjs` (money formatter, module registry), run by `npm test` |

## Structure

```text
frontend/src/
├─ auth/         AuthGate, sign-in screens, auth store + usePermissions(), permissions.js (dashboard keys, presets), toasts
├─ lib/          format, copy (all user-facing text), modules registry, derive (periods / presets), anim, popover engine,
│                chart tooltip, sparkline, table fitting, http, views.js (card / table / chart builders)
├─ state/        store (data + filters), drill (drawer), nav (routes), drillViews.js (drill levels 1–6)
├─ components/   Sidebar, FilterBar (sticky, module-aware, status dots + popovers), Hero, SalesByPeriod, Breakdown, MarginAndMix,
│                Overview, DrillDrawer, ChatWidget, Pages (Coming soon / Data Management), AdminUsers, Popover, Icon, HelpIcon
└─ styles/       index.css (Tailwind + @theme tokens), components.css, auth.css, admin.css
```

### What is and is not idiomatic React

The chart, table, donut, waterfall and drill-down builders (`lib/views.js`, `state/drillViews.js`) return **HTML / SVG strings** that the
components mount with `dangerouslySetInnerHTML` (every value passes through `esc()`). They came from the original plain-JS dashboard and were
kept so the numbers and markup stay identical; the count-up and entrance animations write text into those regions, so those regions must not be
React-managed text nodes. The layout shell, filter bar, popovers, drawer, chat, Data Management page, sign-in screens and the Administration
page are ordinary React components with state and effects. A fully componentised rewrite of the builders would be a separate project.

## Design tokens and Tailwind

Preflight is **not** imported (`tailwindcss/theme.css` + `utilities.css` only), so the dashboard's own base styles render as designed and
utilities remain available to new components. Layer order: `theme, base, components, utilities`; the component CSS sits in
`@layer components`, so utilities can override it. The original CSS variables map to Tailwind theme variables as `--color-<same name>`,
`--shadow` → `--shadow-card`, `--shadow-lg` → `--shadow-lift`, and the three font variables unchanged (`@theme static`). The component CSS is kept
as component classes rather than rewritten into utility strings because it carries pixel-tuned values, container / media queries and keyframes.

## Known gaps and findings

1. **The period filter is read from the URL but never written back.** `syncFilterUrl()` in `state/store.js` exists and is never called, so
   `?from=MM.YYYY&to=MM.YYYY` works as a deep link on load but the address bar does not follow the selection.
2. **Phone overlay.** At the mobile breakpoint `.pop-scrim{display:block}` used to override its `hidden` attribute and an invisible full-screen
   layer swallowed taps; `.pop-scrim[hidden]{display:none}` fixes it.
3. **"Local spreadsheets" needs the two Excel extracts** in `backend/data/`; without them that source is empty.
4. **Batch and order drill-downs (levels 4–5 of a path) call live SAP** through the API every time they are opened.
5. **Export buttons are UI-gated for viewers.** The drill drawer's *Export CSV* is built in the browser from rows the user can already see, so
   it is hidden for the VIEWER role rather than blocked by the server; the Validation CSV is enforced by the API.
6. The bundle includes the React runtime (about 30 kB gzip more than the original no-library page); expected for this stack.
