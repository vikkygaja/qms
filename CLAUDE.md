# QMS — Hospital Quality Management System

Pilot: Sri Narayani Hospital & Research Centre (SNHRC), Vellore. Later multi-tenant for other hospitals.
Module 1 = Hand Hygiene. Platform is shared so later modules (NABH Readiness, Audits, CAPA, MRD Deficiency, Incidents, Documents) plug in.
Full docs: `docs/`. UI reference: `prototype/index.html` (match behaviour, wording, fields; styling may improve).

## How to work (always)
- Build in slices (see Delivery slices). For each slice:
  1. propose a short plan and list questions
  2. WAIT for the user's OK
  3. write tests first
  4. implement
  5. run all tests and linters
  6. show a summary of changed files
  7. suggest a git commit message
- Do not write application code before the plan for the slice is approved.
- Never guess a requirement. If it is not in the docs, ask, then record the answer in `docs/decisions.md`.
- Keep changes small and reviewable. Do not refactor unrelated code.

## Agent team (`.claude/agents/`)
`ux-designer`, `dba-backup`, `security-auditor` (read-only), `tester-committer` (feature branch only, never pushes or touches main), `frontend-dev`, `fable-master` for doubts, and `qms-brain` (secondary brain: knows all context, keeps `docs/project-state.md` current). Read `docs/project-state.md` at the start of every session. Agents report doubts under `QUESTIONS FOR MASTER`; the orchestrator consults `fable-master`; NEEDS USER items go to the user. See docs/decisions.md items 29-31.

## Non-negotiable rules
1. NO patient data anywhere (no names, MR/IP numbers). Staff observed are recorded by category only.
2. NO hard delete for users, link nurses, wards, departments, categories, sessions. Use Active/Inactive (reason, date, who). Rejected sessions keep their data.
3. Every create/update/status change/permission change/password reset goes to the append-only `audit_log` (who, when, entity, action, old→new).
4. Permission checks on EVERY API endpoint server-side, not only in the UI.
5. Every table has `tenant_id`. All queries filtered by tenant. PostgreSQL row-level security as a second layer.
6. Passwords hashed with argon2 (or bcrypt). Temporary passwords force change at first login. Never log passwords or tokens.
7. Store dates in UTC, display in Asia/Kolkata. ISO dates in APIs.
8. Configuration (wards, categories, thresholds, form templates) is data, not code.
9. Only dummy data in development and tests.

## Tech stack
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, pytest. Jobs: Redis + RQ (or Celery).
- DB: PostgreSQL 16 (JSONB for template definitions).
- Frontend: React + TypeScript + Vite, React Router, TanStack Query, small component lib or CSS modules; Vitest + Testing Library.
- Reports: python-pptx, openpyxl, WeasyPrint.
- Files: MinIO (S3-compatible).
- Runtime: Docker Compose (db, redis, minio, api, worker, web, nginx). Target: Ubuntu 24.04 VM on Proxmox, LAN only, Nginx HTTPS.

## Repository structure
```
qms/
  CLAUDE.md
  docs/ (requirements/hand-hygiene.md, architecture.md, roles-permissions.md,
         data-model.md, api.md, decisions.md)
  prototype/index.html
  backend/app/{core, auth, users, roles, masters, linknurses, forms,
               handhygiene, kpi, alerts, reports, audit}/
  backend/migrations/  backend/tests/
  frontend/src/{app, api, components, pages/{auth,home,handhygiene,admin,reports}}
  deploy/{docker-compose.yml, nginx/, backup/}
  .env.example  README.md
```

## Quality bar
- Backend coverage ≥ 80% for services and permissions; tests for every permission rule and every KPI formula (hand-calculated fixtures).
- Frontend tests for session entry validation and keyboard shortcuts.
- Lint/format: ruff + black (Python), eslint + prettier (TS).
- Seed script with dummy data: 20 wards, 30 link nurses, 3 months of sessions (~1,000 opportunities/month).
- Accessibility: keyboard usable, visible focus, labels on all inputs.
- API: REST under `/api/v1`, OpenAPI docs in development only, consistent error format, paginated lists.

## Delivery slices (in order)
1. Skeleton: docker-compose, FastAPI health endpoint, React app shell, CI, README.
2. Auth, users, roles & permissions, audit log, first-login password change.
3. Masters (wards, departments, categories, settings).
4. Link nurses with login, ward assignment history, status, password reset.
5. Form engine + hand hygiene template + session entry.
6. Sessions list, review/reject, KPI service, dashboard, home tiles.
7. Ward targets and alerts (worker + email).
8. Reports centre (PPTX, PDF, Excel) and printable sheet.
9. Hardening and pilot release: backups, Nginx HTTPS, Ubuntu 24.04 deployment guide, restore test.
