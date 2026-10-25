# AIF Analytics

Sales, volume and contribution-margin dashboard for Africa Improved Foods, fed live from S/4HANA.
**`frontend/`** is a Vite + React + Tailwind app; **`backend/`** is the Django API behind it (SAP OData, cost engine, sign-in and user administration).

## Repository layout

```text
AIF-VITE/
├─ frontend/                 Vite + React 19 + Tailwind 4 app
│  ├─ src/                   components, state (stores), lib (formatters, derivations), auth/, styles
│  ├─ public/  index.html    static assets and the HTML entry
│  ├─ tests/                 front-end unit tests (npm test)
│  ├─ tools/reference-pack/  screenshot tool that regenerates docs/reference-pack
│  └─ vite.config.js · eslint.config.js · .prettierrc · package.json
├─ backend/                  Django API (see backend/README.md)
│  ├─ aif_backend/           project settings, urls, wsgi
│  ├─ analytics/             the app: sap.py, pipeline/ (build, aggregate, controls, chat…), cost/ (engine, cache), auth/ (sign-in, RBAC, admin API)
│  ├─ config/                sources.json (cost rules), users.json (legacy import), .env (git-ignored)
│  ├─ seed/                  users.example.json (+ users.local.json, git-ignored)
│  └─ data/                  the two spreadsheet extracts for the "Local spreadsheets" source (git-ignored)
├─ docs/
│  ├─ DASHBOARD_CALCULATION_SPEC.md   every formula and rule behind every number (for reconciliation)
│  ├─ FRONTEND.md                     front-end architecture notes, design tokens, known gaps
│  ├─ reference-pack/                 screenshots of every drill-down path + title bar, and IMPLEMENTATION_GUIDE.md (+ .zip)
│  ├─ design/auth/                    login / administration design references and the auth build prompt
│  └─ reference-data/                 analysis spreadsheets kept for upcoming dashboards
└─ package.json              thin launcher: every script delegates to frontend/ or backend/
```

## Run it

```bash
npm run setup      # once: installs the front end, the Python packages, and creates the database
npm run seed       # once: creates the first users (needs backend/seed/users.local.json — see backend/README.md)
npm run dev        # Django API on :5180 + Vite on :5174  ->  http://localhost:5174
```

The SAP credentials and scope go in `backend/config/.env` (copy `backend/config/.env.example`). The first start builds the dataset from SAP (about a minute);
the API answers 503 for data until it finishes.

| Command | What it does |
|---|---|
| `npm run dev` / `dev:web` / `dev:api` | both servers / Vite only / Django only |
| `npm test` | front-end tests **and** the 58 backend tests (`test:web`, `test:api` run one side) |
| `npm run lint` · `npm run build` | ESLint · production build into `frontend/dist` |

From inside `frontend/` the same scripts exist (`npm run dev` etc.), plus `npm run capture:reference-pack` to retake the documentation screenshots.

## Where to read more

- Sign-in, roles, administration, endpoints, seeding: [`backend/README.md`](backend/README.md)
- Front-end architecture: [`docs/FRONTEND.md`](docs/FRONTEND.md)
- How every number is calculated: [`docs/DASHBOARD_CALCULATION_SPEC.md`](docs/DASHBOARD_CALCULATION_SPEC.md)
- Rebuilding the drill-downs and title bar elsewhere: [`docs/reference-pack/IMPLEMENTATION_GUIDE.md`](docs/reference-pack/IMPLEMENTATION_GUIDE.md)
