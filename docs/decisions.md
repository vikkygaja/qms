# Decisions log

Format: date — decision — reason. Never guess a requirement: ask, then record here.

## 2026-11-19 — Initial decisions from the project brief
1. **Product**: QMS platform, multi-tenant; first pilot SNHRC Vellore; Module 1 = Hand Hygiene; shared platform built so later modules plug in.
2. **Users**: Admin (IT), ICN, Quality Manager, ~30 Link nurses. Hospital PCs on LAN first; responsive for tablets later.
3. **No patient data**; staff observed recorded by category only.
4. **No hard delete** for users, link nurses, wards, departments, categories, sessions — Active/Inactive with reason/date/who. Rejected sessions keep data.
5. **Append-only `audit_log`** for every create/update/status/permission/password-reset action.
6. **Server-side permission checks** on every endpoint.
7. **Multi-tenancy**: `tenant_id` on every table, filtered in queries, plus PostgreSQL RLS.
8. **Passwords**: argon2 (or bcrypt); temp passwords force change at first login; never log secrets.
9. **Time**: UTC storage, Asia/Kolkata display, ISO in APIs.
10. **Config is data**: wards, categories, thresholds, form templates.
11. **Dummy data only** in dev/tests.
12. **Stack**: Python 3.12 / FastAPI / SQLAlchemy 2 / Alembic / Pydantic v2 / pytest; PostgreSQL 16; Redis + RQ (or Celery); React + TS + Vite + React Router + TanStack Query; python-pptx, openpyxl, WeasyPrint; MinIO; Docker Compose (db, redis, minio, api, worker, web, nginx); Ubuntu 24.04 on Proxmox, LAN, Nginx HTTPS.
13. **Architecture**: modular monolith; form engine as foundation; hand hygiene is form template #1.
14. **Auth**: Employee ID + password; lockout after 5 failed attempts for 15 minutes; min password 8 chars with letters + numbers.
15. **RBAC**: roles are data; default roles Admin, ICN, Quality Manager, Link nurse; Admin always keeps `users`; last active admin cannot be deactivated.
16. **KPI thresholds default**: green ≥ 90, amber ≥ 80, link nurse inactive after 10 days.
17. **Compliance formula**: (rub + wash) ÷ total opportunities × 100, 1 decimal; moment breakdown counts an opportunity in each of its moments.
18. **Session number format**: `HH-YYMM-NNNN` per tenant.
19. **Delivery**: 9 slices in order; per slice: plan + questions → OK → tests first → implement → run tests/linters → summary → commit message.
20. **Phase 2 (deferred)**: AI-written findings narrative; WhatsApp alerts.

## 2026-11-19 — Answers to Slice 1 questions
21. **Prototype location**: `prototype/index.html` in the GitHub repo (with `docs/brief.md`, `README.md`, `.gitignore`) is the approved reference. Always use the repo version.
22. **Auth sessions**: server-side session stored in a secure, HTTP-only cookie, `SameSite=Lax`, with a CSRF token required on all state-changing requests. Deactivating a user or resetting their password MUST end all their active sessions. (Supersedes the "cookie or JWT" option in the brief.)
23. **Background jobs**: RQ (Redis Queue), not Celery.
24. **CI**: GitHub Actions, lint + tests on every push and pull request.
25. **Git**: do not create a fresh repo. Remote is `https://github.com/vikkygaja/qms.git`, branch `main`. The local folder is connected to it and tracks `origin/main`; never overwrite remote content. Commit only when asked.
26. **Local tooling** (checked 2026-11-19): Node v24.14.0, npm 11.12.1, system Python 3.9.6. **Docker and uv are NOT installed** on the dev Mac. Python 3.12 runs in the container; `uv` is the intended local runner for backend tests (needs installing). See open items.
27. **Frontend styling**: CSS modules, using the prototype's look as the base (palette, Manrope/Public Sans, light + dark themes via CSS variables). Radix primitives only if accessible dialogs/menus are needed later.
28. **Ports**: web/nginx 8080, API 8000, Postgres 5432, DB name `qms`. Postgres bound to `127.0.0.1` only. All ports configurable via `.env`.

## 2026-11-19 — Agent team and server
29. **Agent team** defined in `.claude/agents/`: `ux-designer`, `dba-backup`, `security-auditor` (read-only), `tester-committer`, `frontend-dev`, and `fable-master` (model: fable) as the escalation point. Subagents cannot call each other, so each ends its report with `QUESTIONS FOR MASTER`; the orchestrator (main session) takes those to `fable-master`, and anything marked NEEDS USER goes to the user. Agents only work on slices the user has approved.
30. **Commits delegated to `tester-committer`**: only on a feature branch, only after tests and linters pass, never to `main`, never `git push` without the user's explicit instruction. (Refines decision 25.)
31. **Server** `qms@192.168.11.157` (key-based SSH from the dev Mac): Ubuntu 26.04.1 LTS (brief assumed 24.04), 4 CPU, 11 GB RAM, 1 TB disk; Docker and Nginx not installed; `qms` has sudo but needs a password, so privileged steps are given to the user to run. Inspection is read-only unless the user approves a change.

## 2026-11-19 — Slice 2 (auth, users, roles, audit) decisions
32. **Slice 1 merged** to `main` (PR #1, merge `b6b2d58`). Slice 2 on branch `slice-2-auth`; backend commit first, frontend commit second, one PR.
33. **Cookie `Secure` flag** is controlled by `COOKIE_SECURE` (default true). The server runs plain HTTP until Slice 9, so it is false there until HTTPS exists.
34. **Session timeouts**: 30 minutes idle, 12 hours absolute (`SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`).
35. **Tenant at login**: a configured default tenant (`DEFAULT_TENANT_CODE`, SNHRC) for the pilot; hostname-based resolution later for other hospitals. Session cookie value is `<tenant_id>.<token>` so the tenant is known before the DB lookup (needed for RLS).
36. **One role per user** in the UI and API; `user_role` allows more later.
37. **First admin** is created by a CLI command (`python -m app.cli create-admin`) reading the password from the `QMS_ADMIN_PASSWORD` environment variable (never argv). Without it a temporary password is generated, printed once, and a change is forced.
38. **Audit log viewer** requires permission `users`.
39. **Runtime DB role**: the app connects as a non-superuser role `qms_app` (the Postgres image's `qms` user is a superuser and would bypass row-level security). Migrations and provisioning use the owner role. `audit_log` is append-only by trigger and by grants (`qms_app` has INSERT and SELECT only).
40. **Every table has `tenant_id`**, including `permission` (seeded per tenant); `tenant` itself is the exception.
41. **Last active admin** = the last active user holding the `users` permission. The `Admin` role cannot lose `users`. A new custom role starts with `dash` only (as in the prototype). Link nurses cannot be created or assigned through the Users API (Slice 4).
42. **Test instance**: a separate Compose project (`-p qms-test`) on port 8081 with its own database and `APP_ENV=development` (API docs on). Promotion to a new port = same code, fresh database from migrations, not a copy of test data, unless the user asks for a data copy. The test admin's password lives only in the server's env file, never in git.

## 2026-11-19 — Slice 3 (masters) decisions
43. **Build order**: page + backend together per slice (user chose this). Slice 3 = Masters, on branch `slice-3-masters`, stacked on `slice-2-auth` because Slice 2 is not yet pushed/merged.
44. **Assumed recommendations** (user answered only the demo-data and import/export points; revisit if wrong): a reason is required on every Masters status change (rule 2); a category has a short code (1-3 letters/digits, upper-case, unique) entered by the admin, the six defaults get D N T H S O; any signed-in user may READ master lists, only `masters` may change them; Masters get an Edit action (the prototype only had add and toggle).
45. **Demo data**: `python -m app.cli seed-demo` loads the prototype's departments and 20 wards (monthly targets total 1000). Dummy data only; it refuses to run unless `ENV=development` (the test instance) or `--force`. Idempotent. Later slices extend it (link nurses, sessions).
46. **Masters upload/download (new requirement, user, 2026-11-19)**: Export as Excel (.xlsx; one sheet per master, plus KPI thresholds read-only) and as CSV per master; a blank import template. Import accepts .xlsx or CSV. Rows match existing items by name (case-insensitive): new names are created, existing ones get their department/target/code updated. Import NEVER changes status (status changes need a reason, so they stay in the UI) and never deletes. Wards must reference an existing department. A dry run returns a row-by-row report; applying is all-or-nothing (any error row blocks the whole file). Limits: 2 MB, 5,000 rows. KPI thresholds are exported but not imported. Exports neutralise spreadsheet formulas (cells starting `=`, `+`, `-`, `@` are prefixed with `'`). Needs permission `masters`. Every created or updated row is audited, plus one `import` audit entry per upload.

## 2026-11-19 — Prototype findings (behaviour to match; items needing confirmation are under Open items)
- Observed behaviours already consistent with the brief: temporary password shown once with Copy; first-login "Set your new password" screen (8+ chars, letters + numbers, confirm field); inactive message "This account is inactive. Contact the ICN or IT."; rejected sessions excluded from KPIs; Missed disables technique ("NS" = not applicable); moments multi-select; last-admin protection; "Roles & permissions" and "Users" pages both gated by `users`; Admin's `users` checkbox is locked on.
- Link nurse nav labels differ: "Sessions" → "My sessions", "Dashboard" → "My wards".
- Link nurse ward edit must keep at least one ward ("make inactive instead").
- Link nurse list shows per-nurse "Sessions (Nov)", "Last entry", "No entry N+ days" and "First login pending" flags; Users page lists link nurses read-only ("Managed by ICN").
- Wards page: a ward with current link nurses cannot be made inactive ("Move this ward's link nurses first").
- Reports preview: ward chart shows lowest 8; key findings = lowest 2 wards, weakest moment, weakest group, gloves %, technique %.

## Open items
- **Object storage image (needed by Slice 5).** `minio/minio` is gone from Docker Hub and `quay.io/minio/minio` returns 401 (checked 2026-11-19), so MinIO community images are no longer pullable. The brief names MinIO. Options: build MinIO from source at a pinned version, or switch to another S3-compatible store (Garage, SeaweedFS, RustFS). The `minio` service is kept in `deploy/docker-compose.yml` behind the `storage` profile (not started). Awaiting user decision.
- **Docker Desktop and `uv` are not installed on the Mac** (tests run on the server instead; no local install needed). Needed to run the Compose stack and backend tests locally. Awaiting user decision (install, or run everything via CI only).
- **Prototype has "Save draft" on session entry**; the brief defines no draft status (only Submitted/Reviewed/Rejected). Decide in Slice 5.
- **Session number sequence**: prototype uses a global counter across months (`HH-2609-0001…`); brief says `HH-YYMM-NNNN` per tenant. Does NNNN reset each month? Decide in Slice 5.
- **Printable sheet permission**: shown to all roles in the prototype; brief gives it no permission. Decide in Slice 8.
- **Admin has no `record`/`review`/`alerts`** in the default matrix (as in prototype); confirmed as intended unless told otherwise.
