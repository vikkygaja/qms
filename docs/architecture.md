# Architecture

## Style: modular monolith
One FastAPI application, one PostgreSQL database, strictly separated internal modules. Modules talk through service-layer functions and domain events, never by reaching into each other's tables/routers. This keeps deployment simple (single Docker Compose stack on one VM) while letting later modules plug in.

## Backend modules (`backend/app/`)
| Module | Responsibility |
|---|---|
| `core` | config, DB session, tenant context, security helpers, error format, pagination, time utils |
| `auth` | login, lockout, sessions/cookies, first-login password change |
| `users` | platform users, status, password reset |
| `roles` | roles, permissions, RBAC dependency (`require_permission`) |
| `masters` | wards, departments, staff categories, settings |
| `linknurses` | link nurse profile + login creation, ward assignment history, status |
| `forms` | form engine: templates, immutable versions, sessions, rows |
| `handhygiene` | HH template, session rules, `hh_opportunity` extraction |
| `kpi` | KPI formulas and breakdowns (pure, tested against hand-calculated fixtures) |
| `alerts` | alert rules, daily job, notifications (in-app + email) |
| `reports` | PPTX / PDF / Excel generation, printable sheet |
| `audit` | append-only audit log writer + query |

Each module: `router.py` (HTTP, permission checks), `service.py` (business rules), `models.py`, `schemas.py`, `repository` as needed.

## Multi-tenancy
- Every table has `tenant_id`.
- Tenant resolved from the authenticated user, set per request on the DB connection (`SET LOCAL app.tenant_id`).
- Service queries filter by tenant explicitly; PostgreSQL row-level security policies on `tenant_id` are the second layer.

## Form engine
- `form_template` → `form_template_version` (immutable once published; `definition` JSONB: header fields, row fields, types, options, required rules, scoring rules).
- `form_session` references a template version; `form_row.data` JSONB holds row values.
- Modules extract typed, indexed rows needed for fast analytics (Hand hygiene → `hh_opportunity`) on submit.
- Hand hygiene is template #1: the UI renders from the definition (no hard-coded fields) with an optimised grid UX.

## Events and background jobs
- Redis + RQ worker (`worker` service).
- Jobs: daily alert computation, report generation (PPTX/PDF/Excel), email sending.
- Domain events (e.g. `session_submitted`, `user_status_changed`) are in-process; heavy work is enqueued.
- Alerts are de-duplicated by a deterministic key (rule + subject + period).

## Frontend
React + TypeScript + Vite. React Router, TanStack Query for server state. Pages under `pages/{auth,home,handhygiene,admin,reports}`. Menu and route guards driven by the permissions returned by the API.

## Files
Evidence uploads (signed paper sheets) stored in MinIO; `file_attachment` table holds metadata; sessions reference the key.

## Time
Stored in UTC, displayed in Asia/Kolkata, ISO 8601 in APIs.

## Deployment
Docker Compose services: `db` (PostgreSQL 16), `redis`, `minio`, `api`, `worker`, `web` (static React build), `nginx` (HTTPS termination, reverse proxy). Target: Ubuntu 24.04 VM on Proxmox, LAN only. Nightly `pg_dump` + MinIO copy (Slice 9). OpenAPI docs enabled in development only.
