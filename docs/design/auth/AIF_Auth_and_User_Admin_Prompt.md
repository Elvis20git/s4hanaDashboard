# Claude Code Prompt — AIF Analytics: Login, Password Reset & User Administration (RBAC)

## Role
You are a senior full-stack engineer working inside the existing **AIF-VITE** repository (Vite + React + Tailwind CSS frontend with its own backend). You are adding a complete authentication flow and a user administration module with granular, per-dashboard access control.

## Prime directives (read before writing any code)
1. **Do not break existing functionality.** Every dashboard, filter, chart, S/4HANA data feed, calculation (including the contribution-margin logic), palette switcher, and existing route must behave exactly as it does today for a user who has access to it. Do not refactor, rename, or restyle anything outside the scope below unless it is strictly required to wire in auth — and if it is, say so in your plan first.
2. **Use the stack that is already in the repo.** Do not introduce a second backend framework, a second HTTP client, a second state library, or a second styling approach. Reuse existing API service patterns, components, layout shell, icons, and design tokens.
3. **Least privilege, enforced on the server.** A user must not *see* or *be able to fetch* anything they are not permitted to. Hiding UI is required but is never the security boundary — the backend must reject unauthorized requests even if the UI is bypassed.
4. **Work in phases and stop after Phase 0** to present findings and a plan before changing code.

---

## Phase 0 — Discovery (no code changes)
Inspect the repo and report back with:
- Backend framework, entry point, folder structure, DB/ORM (or current persistence — file/JSON/in-memory), and how the frontend calls the backend (base URL, proxy in `vite.config`, service files).
- Whether **any** auth already exists: login route, JWT/session handling, user table/model, seeded users (e.g. `boss`, `Elvis-a`, `Derrick-a`, `Jean-a`), password hashing, middleware.
- The current Login page component and Administration page/component (if any), and how routing works (React Router version, route definitions, sidebar/nav config).
- **A complete inventory of every dashboard route and every backend data endpoint**, mapped to one of the 7 permission keys below. Flag any endpoint or page you can't confidently map — do not guess.
- Every UI action that uploads, modifies, or deletes data (file uploads, S/4HANA dataset edits, etc.) — these will be gated by the Data Steward flag.
- Any existing export/download features (relevant to Viewer vs Analyst).
- Email capability (SMTP/SendGrid/SES config, env vars) — or its absence.

Then propose a short implementation plan, list files you intend to create/modify, and **wait for my confirmation**.

---

## Permission model (single source of truth)

### Dashboard keys (exactly 7)
| Key | Label |
|---|---|
| `sales` | Sales |
| `production` | Production |
| `ar_ap_aging` | AR & AP aging |
| `inventory` | Inventory |
| `goods_in_transit` | Goods in transit |
| `tax` | Tax |
| `data_management` | Data Mgmt |

Define these once in a shared constant (backend) and mirror it in one frontend constant — no string literals scattered across files. Quick-select presets: **Finance** = `sales, ar_ap_aging, tax`; **Operations** = `production, inventory, goods_in_transit`. (Confirm these groupings against the existing app in Phase 0.)

### Roles
Roles are `SUPERUSER`, `ANALYST`, `VIEWER`.
- **Data Steward is a capability flag (`is_data_steward`), not a role.** The original spec listed `DATA_STEWARD` in the role enum *and* as a boolean, which produces the duplicate badge visible in the mockup. Resolve this: if existing data uses `DATA_STEWARD` as a role, migrate it to `role = ANALYST, is_data_steward = true` and report it.

| Role | Dashboard visibility | Data actions |
|---|---|---|
| `SUPERUSER` | All 7 implicitly (ignore `allowed_dashboards`) | Full, plus Administration |
| `ANALYST` | Only `allowed_dashboards` | View + export (if export exists) |
| `VIEWER` | Only `allowed_dashboards` | View only, no export |

- **Upload / modify / delete of S/4HANA datasets** requires `is_data_steward = true` (or SUPERUSER) **and** access to the relevant dashboard. Non-stewards must not see upload buttons at all.
- **Administration** (`/admin`, `/api/admin/*`) is SUPERUSER only and is never listed as a grantable dashboard.
- A user with zero allowed dashboards can log in but sees an empty-state page ("No dashboards assigned — contact your administrator"), not an error.

---

## Backend

### User model
```
id               UUID/string
username         string, unique (case-insensitive), required
email            string, unique (case-insensitive), required
password_hash    string (bcrypt cost ≥ 12, or Argon2id)
display_name     string
job_title        string
department       string
role             enum SUPERUSER | ANALYST | VIEWER
is_data_steward  boolean, default false
allowed_dashboards  string[] (validated against the 7 keys; deduplicated)
status           enum ACTIVE | INACTIVE
last_login       timestamp | null
password_changed_at  timestamp   (used to invalidate older JWTs)
must_change_password boolean, default false (forces a password change at next login)
created_at / updated_at
```
Plus a `password_reset_tokens` store: `user_id, token_hash, code_hash, expires_at, attempts, used_at`.

Migrate existing users without losing them. Provide a **bootstrap superuser** created from env vars (`ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) only if no SUPERUSER exists. Never hardcode credentials in application source.

### Seed users (required)
Create these three users through an **idempotent seed script** (safe to run repeatedly; upsert by case-insensitive username):

| username | initial password | email | display_name | job_title | department | role | is_data_steward | allowed_dashboards |
|---|---|---|---|---|---|---|---|---|
| `derrick-a` | `123` | derrick.sano@africaimprovedfoods.com | Derrick S | IT Director | IT | SUPERUSER | true | all 7 (implicit) |
| `eric-a` | `123` | eric.nkurunziza@africaimprovedfoods.com | Eric N | ERP Lead | IT | SUPERUSER | true | all 7 (implicit) |
| `elvis2-a` | `123` | elvis.murengerantwari@africaimprovedfoods.com | Elvis M | Senior Dev | Dev | SUPERUSER | true | all 7 (implicit) |

Rules for seeding:
- **`derrick-a` already exists** (shown as "Sano, Derrick", `Derrick-a`, `derrick@aif.rw`, Data Steward, AR & AP aging + Sales). Because usernames are case-insensitive, **update that existing record in place** (keep its `id`, `last_login` and history) with the values above — do not create a duplicate. Report the before/after values. `elvis2-a` is a **new** user, separate from the existing `Elvis-a`; `eric-a` is new.
- Store the initial passwords **hashed** like any other password. Put the seed data in a gitignored file (e.g. `server/seed/users.local.json`, add it to `.gitignore`) with a committed `users.example.json` showing the shape without real passwords. Do not echo the passwords in logs or console output.
- The initial password `123` does **not** meet the strength policy. The seed script may bypass the policy for these records only, and must set `must_change_password = true`. The admin API, reset flow and change-password flow still enforce the full policy.
- The seed script refuses to apply weak seed passwords when `NODE_ENV=production` (or the backend's equivalent) unless an explicit `ALLOW_WEAK_SEED=true` override is set, and prints a warning when it does.
- Seeding these superusers must not remove or demote any other existing user.

### Forced password change
When a user with `must_change_password = true` logs in successfully, the login response includes `must_change_password: true` and a token that is **only** valid for `POST /api/auth/change-password` (body `{ current_password, new_password }`, full strength policy, new ≠ current) and `GET /api/auth/me`. Every other endpoint returns 403 `{ success:false, code:"PASSWORD_CHANGE_REQUIRED" }` until the password is changed. On success: clear the flag, set `password_changed_at`, issue a normal token. A password reset by email also clears the flag.

### Auth endpoints
**`POST /api/auth/login`** — body `{ username_or_email, password }`
- Case-insensitive lookup on username or email. INACTIVE users get the same generic 401 as wrong credentials.
- 200: `{ success: true, token, user: { id, username, display_name, email, role, is_data_steward, allowed_dashboards, status } }` — note `allowed_dashboards` for a SUPERUSER is returned as the full list of 7.
- 401: `{ success: false, message: "Invalid username or password" }`
- Update `last_login`. Rate-limit (e.g. 5 failures / 15 min per IP+identifier).
- "Remember this device" → longer token lifetime (e.g. 7 days vs 8 hours). Keep whatever token storage the app already uses; if none, prefer an httpOnly, Secure, SameSite cookie.

**`GET /api/auth/me`** — returns the current user in the same shape. The frontend uses this on load and after any permission change.

**`POST /api/auth/forgot-password`** — body `{ identifier }` (email **or** username, matching the UI)
- Always 200 with `"If an account exists, reset instructions have been sent."` (no enumeration; keep response time similar for both cases).
- If an ACTIVE user exists: generate a 32-byte random token **and** a 6-digit code, store only their SHA-256 hashes, expiry 15 min, invalidate earlier unused tokens. Email a link `${APP_URL}/reset-password?token=…` plus the code.
- Rate limit: 3 requests / 15 min per IP and per identifier.
- If no email provider is configured, log the reset link to the server console **in development only** and say so in the README.

**`POST /api/auth/reset-password`** — body `{ token? , identifier?, code?, new_password }` (token from link, or identifier + 6-digit code)
- Validate not expired, not used; max 5 code attempts then invalidate.
- Enforce strength server-side: ≥ 8 chars, upper, lower, number, special.
- Hash, save, set `password_changed_at`, mark token used, invalidate existing sessions.
- 200 `{ success: true, message: "Password successfully updated." }`; 400 `{ success: false, message: "Invalid or expired token." }`.

### Admin endpoints (all SUPERUSER only)
- **`GET /api/admin/users`** → `{ summary: { total_members, active_members, total_dashboards: 7 }, users: [...] }` (never return `password_hash`).
- **`POST /api/admin/users`** → validate required fields (username, password, email), email format, uniqueness (409 on conflict with field-specific message), password strength, role/dashboard values. 201 with created user.
- **`PUT /api/admin/users/:userId`** → update profile, role, `is_data_steward`, `allowed_dashboards`. Username is read-only after creation unless the existing app already allows renaming.
- **`DELETE /api/admin/users/:userId`** → soft delete: `status = INACTIVE`, invalidate sessions. Add **`POST /api/admin/users/:userId/activate`** to re-enable.
- **`POST /api/admin/users/:userId/reset-password`** → reuses the forgot-password token/email logic.

**Lockout guards:** a superuser cannot deactivate themselves, demote themselves, or remove/deactivate/demote the **last active SUPERUSER** (return 400 with a clear message).

### Middleware (apply to every existing data route)
- `authenticate` — verify token, **load the user from the DB on each request** (so permission changes and deactivation take effect immediately), reject INACTIVE users and tokens issued before `password_changed_at`.
- `requireRole('SUPERUSER')` — for `/api/admin/*`.
- `checkDashboardAccess(key)` — allow if SUPERUSER or `key ∈ allowed_dashboards`, else **403 `{ success:false, message:"You do not have access to this dashboard." }`**. Attach it to **every** endpoint mapped in Phase 0 — including shared/aggregate endpoints (KPI summaries, filter option lists, search, exports) so they don't leak data from dashboards the user can't see. If a shared endpoint serves several dashboards, filter its response to the permitted ones.
- `requireDataSteward` — for upload/modify/delete endpoints.
- `requireExport` — blocks VIEWER from export endpoints (if exports exist).
- Security: strict CORS to the app origin, Helmet (or equivalent) headers, JSON body size limits, no stack traces in production responses. Log admin actions (who changed what for whom) at least to server logs.

---

## Frontend

### Visual consistency
Match the screenshots exactly in spirit: login uses the existing dark glassmorphism (#092217 gradient, glass card, mint glow, green CTA); admin uses the existing dark sidebar + light content (#f8faf9), stat cards, badge chips. Reuse existing components and tokens; keep the palette switcher, the "SAP S/4HANA Connected" pill, the help button, footer links and the Microsoft 365 button **exactly as they currently behave** (do not implement or remove SSO).

### Auth flow (one container, animated transitions between three states)
1. **Login** — username/email, password with show/hide, "Remember this device", "Forgot password?" link, loading spinner on submit, inline error banner on 401, disabled button while submitting.
2. **Forgot password** — email/username input, "Send reset link / code", "Back to sign in", then a confirmation state ("If an account exists, check your email…").
3. **Reset password** — auto-reads `?token=` from the URL (route `/reset-password`); otherwise shows identifier + 6-digit code inputs. New + confirm password with a live strength checklist (8+ chars, uppercase, lowercase, number, special) and match check. On success: toast, redirect to sign-in after 2 s.
4. **Change password (forced)** — shown immediately after login when `must_change_password` is true, in the same glass container: current password, new + confirm with the same strength checklist, "Update password". The user cannot reach any dashboard until it succeeds; a "Sign out" link is available.
- After login, redirect to the originally requested page if permitted, otherwise to the user's **first allowed dashboard**, otherwise to the empty state.

### Access enforcement in the UI (the "users must not see what they can't access" requirement)
Create one `AuthContext` / `usePermissions()` hook exposing `user`, `canView(key)`, `isSuperuser`, `isDataSteward`, `canExport`. Then:
- **Sidebar/nav:** render only permitted dashboards; render Administration only for SUPERUSER. No greyed-out or locked items — they are absent.
- **Routes:** wrap every dashboard route in a `<ProtectedRoute dashboard="sales">` guard; unauthenticated → `/login`; unauthorized → redirect to first allowed dashboard (no flash of protected content — wait for `/me` before rendering).
- **In-page content:** hide any cross-dashboard widgets, links, KPI tiles, global search results, or "go to …" buttons that point to non-permitted dashboards.
- **Actions:** hide upload/modify controls for non-stewards; hide export buttons for VIEWER.
- **API layer:** a global interceptor — on 401 clear session and go to `/login`; on 403 show a toast and redirect to an allowed page.
- Re-fetch `/me` on window focus or after any admin change to the current user, so revoked access disappears without needing logout.

### Administration page (`/admin`, SUPERUSER only)
- **Stat cards:** Signed in as (name, email, status), Role ("All 7 workstreams granted" for superuser), Team members (total + active), Dashboards (7 grantable).
- **Create user form:** Username*, Password* (with strength hint), Email*, Display name, Job title, **Department** (text) and **Role** (Superuser / Analyst / Viewer) as **two separate fields** — the mockup's combined "Department / Role tier" dropdown must be split. Dashboard access checkbox grid (7 tiles) with Select All / Finance / Operations / Clear. "Data steward (can upload files & modify S/4HANA datasets)" checkbox. When Role = Superuser, show the grid as all-checked and disabled with the note "Superusers have access to all dashboards". Clear/Cancel resets the form. Inline validation + success toast.
- **Team members list:** live search (name, username, email) + role filter (All / Superuser / Analyst / Viewer / Data stewards / Inactive). Each card: avatar initial, display name, @username, last login ("Never" if null), **one role badge** plus a separate "Data Steward" badge only if flagged, dashboard pills (Superuser → single "All dashboards" pill, never "no dashboards"), INACTIVE users visibly muted with an "Inactive" badge. Actions: **Access Rights** (opens drawer) and deactivate (trash icon → confirm dialog).
- **Edit drawer (slide-over):** prefilled fields (username read-only), role, steward toggle, full dashboard grid with presets, buttons: Send password reset email, Deactivate / Reactivate, Save changes, Cancel. Disable self-deactivation / self-demotion with an explanatory tooltip. Unsaved-changes warning on close.
- Loading skeletons, empty states, error toasts; success toasts on create, edit, deactivate, reactivate, reset email sent.

---

## Deliverables & acceptance checks
1. Phase 0 report and plan (then wait).
2. Implementation with a migration/seed script, `.env.example` entries (JWT secret, token TTLs, APP_URL, SMTP/provider, bootstrap admin), and a short README section.
3. Automated tests (or a scripted checklist if no test setup exists) proving:
   - An ANALYST with `["sales"]` sees only Sales in the nav, is redirected away from `/production`, and gets **403** from every non-sales data endpoint including shared/aggregate ones.
   - A VIEWER cannot export; a non-steward cannot see or call upload endpoints.
   - A non-superuser gets 403 on all `/api/admin/*` and never sees the Administration link.
   - Revoking a dashboard or deactivating a user takes effect on that user's next request.
   - The last active superuser cannot be deactivated or demoted.
   - Forgot-password returns the same response for existing and non-existing accounts; tokens expire, are single-use, and are stored hashed.
   - A SUPERUSER sees every existing dashboard working **exactly as before** (regression check on each dashboard).
   - Running the seed twice leaves exactly one `derrick-a`, one `eric-a` and one `elvis2-a`; the existing `Elvis-a` and all other users are unchanged; `derrick-a` keeps its original `id`.
   - Each seeded user can sign in with `123`, is forced to the change-password screen, gets `PASSWORD_CHANGE_REQUIRED` from any data endpoint until changing it, and then sees all 7 dashboards and Administration.
4. A final summary listing every file changed and any existing behavior you had to touch.
