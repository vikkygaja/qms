# PROJECT BRIEF FOR CLAUDE CODE — "QMS" (Hospital Quality Management System)

## 0. How you must work
- You are building a production-quality web application, one slice at a time.
- FIRST TASK: read this brief and prototype/index.html, then create the project
  documentation files listed in section 12 from this brief. Do not write
  application code until I approve your plan for Slice 1.
- For every slice: (1) propose a short plan and list questions, (2) wait for my OK,
  (3) write tests first, (4) implement, (5) run all tests and linters,
  (6) show a summary of changed files, (7) suggest a git commit message.
- Never guess a requirement. If something is not in the docs, ask me, then record
  the answer in docs/decisions.md.
- Keep changes small and reviewable. Do not refactor unrelated code.
- prototype/index.html is the approved UI/UX reference (screens, fields, flows,
  wording). Match its behaviour; you may improve styling.

## 1. Product context
- QMS = hospital Quality Management System, first pilot at Sri Narayani Hospital
  & Research Centre (SNHRC), Vellore. Later sold to other hospitals (multi-tenant).
- The platform will hold many modules (NABH Readiness, Audits, CAPA, MRD
  Deficiency, Incidents, Documents). Module 1 = HAND HYGIENE. Build the shared
  platform properly so later modules plug in.
- Users: Admin (IT), ICN (Infection Control Nurse), Quality Manager, ~30 Link
  nurses. Used on hospital PCs (LAN) first; must be responsive for tablets later.

## 2. Non-negotiable rules
1. NO patient data anywhere (no names, MR/IP numbers). Staff observed are recorded
   by category only, never by name.
2. NO hard delete for users, link nurses, wards, departments, categories, sessions.
   Use status Active/Inactive (with reason, date, who). Rejected sessions keep data.
3. Every create/update/status change/permission change/password reset is written to
   an append-only audit_log (who, when, entity, action, old→new values).
4. Permission checks on EVERY API endpoint (server side), not only in the UI.
5. Every table has tenant_id (hospital). All queries filtered by tenant.
   Use PostgreSQL row-level security as a second safety layer.
6. Passwords: hashed with argon2 (or bcrypt). Temporary passwords force a change at
   first login. Never log passwords or tokens.
7. Dates stored in UTC, displayed in Asia/Kolkata. Use ISO dates in APIs.
8. All configuration (wards, categories, thresholds, form templates) is data, not code.
9. Only dummy data in development and tests.

## 3. Tech stack
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic migrations, Pydantic v2,
  pytest. Background jobs: Redis + RQ (or Celery) for alerts and report generation.
- Database: PostgreSQL 16 (use JSONB for template definitions).
- Frontend: React + TypeScript + Vite, React Router, TanStack Query, a small
  component library or plain CSS modules; Vitest + Testing Library.
- Reports: python-pptx (meeting deck), openpyxl (Excel), WeasyPrint (PDF).
- Files (evidence uploads): MinIO (S3-compatible).
- Runtime: Docker Compose (services: db, redis, minio, api, worker, web, nginx).
- Target server: Ubuntu 24.04 VM on Proxmox, LAN only, Nginx with HTTPS.

## 4. Repository structure
```
qms/
  CLAUDE.md
  docs/ (brief.md, requirements/hand-hygiene.md, architecture.md,
         roles-permissions.md, data-model.md, api.md, decisions.md)
  prototype/index.html
  backend/app/{core, auth, users, roles, masters, linknurses, forms,
               handhygiene, kpi, alerts, reports, audit}/
  backend/migrations/  backend/tests/
  frontend/src/{app, api, components, pages/{auth,home,handhygiene,admin,reports}}
  deploy/{docker-compose.yml, nginx/, backup/}
  .env.example  README.md
```

## 5. Platform features (shared by all modules)
### 5.1 Authentication
- Login with Employee ID + password. Session via secure HTTP-only cookie (or JWT
  with refresh). Lock out after 5 failed attempts for 15 minutes.
- First login with a temporary password → forced "set new password" screen
  (min 8 chars, letters + numbers).
- Inactive users cannot log in ("This account is inactive. Contact the ICN or IT.").

### 5.2 Roles & permissions (RBAC)
- Roles are data. Default roles: Admin, ICN, Quality Manager, Link nurse.
  Admin can create new roles (e.g. Nursing Superintendent).
- Permissions (codes): masters, users, ln (manage link nurses), record (record
  hand hygiene sessions), review (review/reject sessions), targets, dash (view
  dashboards), alerts (receive low-compliance alerts), reports.
- Default matrix:
  - Admin: masters, users, ln, targets, dash, reports
  - ICN: ln, record, review, targets, dash, alerts, reports
  - Quality Manager: dash, alerts, reports
  - Link nurse: record, dash (own wards only)
- Admin always keeps "users" (cannot lock themselves out). Last active admin
  cannot be deactivated.
- Admin page "Roles & permissions": matrix of checkboxes, add role.

### 5.3 Users (Admin)
- Admin creates platform users (ICN, QM, Admin, custom roles) — NOT link nurses.
- Fields: employee ID (unique, = username), full name, designation, role,
  mobile (10 digits), email (optional), status.
- Create → system generates a temporary password shown ONCE.
- Actions: edit, reset password (new temporary password), active/inactive with reason.

### 5.4 Link nurses (ICN, or any role with permission "ln")
- Creating a link nurse ALSO creates their login (role Link nurse) in one step.
- Fields: employee ID*, full name*, designation*, department*, mobile*, email,
  link nurse from date*, WHO 5 Moments training date, assigned ward(s)* (one or more).
- Ward assignment is many-to-many WITH HISTORY: table ward_assignment
  (link_nurse_id, ward_id, from_date, to_date null = current). Removing a ward
  sets to_date; adding creates a new row. Show assignment history.
- Active/Inactive with mandatory reason + effective date; inactivation ends all
  current ward assignments and blocks login; reactivation does not restore wards.
- Reset password. No delete.
- List with search (name/ID), filter by ward and status, sessions this month,
  last entry date, "no entry in X days" flag, "first login pending" flag.

### 5.5 Masters (Admin)
- Wards (name, department, monthly hand hygiene opportunity target, status).
  A ward with current link nurses cannot be made inactive until they are moved.
- Departments, staff categories observed (Doctor, Nurse, Technician, Housekeeping,
  Student, Other HCW), KPI thresholds (green ≥90, amber ≥80, inactive after 10 days).
- All Active/Inactive; inactive items disappear from entry screens but remain in history.

### 5.6 Audit log
- Append-only table; Admin can view and filter it. Recent changes shown on the
  Users and Link nurses pages.

### 5.7 App shell
- Left menu: Home; Hand Hygiene (New session, Sessions, Dashboard, Ward targets,
  Link nurses, Printable sheet); other modules shown as "Coming soon";
  Platform (Reports centre, Users, Roles & permissions, Masters).
- Menu items appear only if the user has the permission.
- Home: KPI tiles, module cards, compliance trend; alerts bell for users with "alerts".

## 6. Form engine (foundation for all modules)
- form_template (id, tenant_id, code, name, module, version, status,
  definition JSONB: header fields, row fields, field types, options, required
  rules, scoring rules). form_template_version is immutable once published.
- form_session (id, tenant_id, template_version_id, ward_id, observer_user_id,
  date, start_time, end_time, status Submitted/Reviewed/Rejected, remarks,
  reject_reason, reviewed_by, reviewed_at, attachment_key).
- form_row (id, session_id, row_no, data JSONB) plus extracted columns needed for
  fast KPIs (see 7.2).
- Hand hygiene is template #1. Do not hard-code its fields in the UI; render from
  the template definition, but optimise the hand hygiene grid UX.

## 7. Module 1 — Hand Hygiene
### 7.1 Session entry (permission "record")
- Header: ward (link nurse: only CURRENT assigned wards; ICN: any active ward),
  date, start time, end time, duration auto-calculated, observer from login,
  remarks, optional attachment of the signed paper sheet (image/PDF to MinIO).
- Rows (one per opportunity): staff category (active categories), moment(s)
  multi-select 1–5 (1 Before patient contact, 2 Before aseptic procedure,
  3 After body fluid exposure risk, 4 After patient contact, 5 After touching
  patient surroundings), action (Hand rub / Hand wash / Missed), gloves worn
  (Yes/No), technique correct (Yes/No; disabled and stored as "not applicable"
  when action = Missed).
- Keyboard: on a focused row, R/W/M set action, 1–5 toggle moments, D duplicates.
  Buttons: add row, copy row, remove row. Live session summary (opportunities,
  compliance %, missed).
- Validation: ≥1 row; each row has ≥1 moment and an action; end > start.
- Session number auto: HH-YYMM-NNNN per tenant.
- Link nurse submissions → status Submitted. ICN's own sessions → Reviewed.

### 7.2 Data for KPIs
- hh_opportunity (session_id, ward_id, observer_id, date, category, moments
  text[], action, gloves bool, technique enum Y/N/NA) — populated on submit.
- Expected volume ~1,000 opportunities/month; index by tenant, date, ward.

### 7.3 Sessions list
- Filter by month and ward (link nurse sees only own sessions).
- View details, audit trail. ICN (permission "review"): Mark reviewed / Reject
  (reason required). Rejected sessions are excluded from KPIs but kept.
- Export to Excel.

### 7.4 KPIs and dashboard (permission "dash")
- Compliance % = (hand rub + hand wash) ÷ total opportunities × 100 (1 decimal).
- Breakdowns: by ward, staff category, moment (an opportunity counts in each of
  its moments), month, observer. Trend over last 12 months. Target line.
- Missed with gloves on % = missed with gloves ÷ missed.
- Technique correct % = technique Yes ÷ (rub + wash with technique recorded).
- Colour bands from thresholds. Link nurse sees only own wards ("My wards").

### 7.5 Ward targets (permission "targets")
- Monthly target per ward (sum shown; hospital total ≈ 1,000). Target shared by
  the ward's link nurses; show each nurse's contribution. Progress vs expected-to-date.

### 7.6 Alerts (in-app + email; WhatsApp later)
- Ward compliance below amber threshold month-to-date (min 15 opportunities)
  → all users with permission "alerts" (ICN + QM by default).
- Ward behind target pace (< 60% of expected by today) → ICN.
- Active link nurse with no entry in N days → ICN.
- Daily job computes alerts; avoid duplicates; alert list with read/unread.

### 7.7 Reports centre (permission "reports")
- Monthly HICC meeting deck (PPTX): title slide with overall %, ward-wise chart
  (lowest first), by category, by moment, 12-month trend, key findings
  (lowest wards, weakest moment, weakest group, gloves/technique %).
- Same data as PDF and Excel. Generated in the background worker; download when ready.
- Phase 2 (not now): AI-written findings narrative.

### 7.8 Printable observation sheet
- PDF of a blank sheet matching the entry grid (header + 12 rows, category codes
  D N T H S O, moments 1–5, R/W/M, gloves Y/N, technique Y/N, signature).

## 8. Data model (minimum tables)
tenant, user (incl. link nurse fields), role, permission, role_permission,
user_role, ward, department, staff_category, setting, ward_assignment,
status_history, form_template, form_template_version, form_session, form_row,
hh_opportunity, ward_target (ward, month, target), alert, audit_log, file_attachment.
Document every table in docs/data-model.md before migrating.

## 9. API
REST under /api/v1, OpenAPI docs enabled in development only. Consistent error
format. Pagination for lists. Document endpoints in docs/api.md.

## 10. Quality bar
- Backend test coverage ≥ 80% for services and permissions; tests for every
  permission rule and every KPI formula (compare to hand-calculated fixtures).
- Frontend: tests for session entry validation and keyboard shortcuts.
- Linters/formatters: ruff + black (Python), eslint + prettier (TS).
- Seed script with dummy data: 20 wards, 30 link nurses, 3 months of sessions
  (~1,000 opportunities/month), like the prototype.
- Accessibility: keyboard usable, visible focus, labels on all inputs.

## 11. Delivery slices (do them in order)
1. Skeleton: docker-compose, FastAPI health endpoint, React app shell, CI, README.
2. Auth, users, roles & permissions, audit log, first-login password change.
3. Masters (wards, departments, categories, settings).
4. Link nurses with login, ward assignment history, status, password reset.
5. Form engine + hand hygiene template + session entry.
6. Sessions list, review/reject, KPI service, dashboard, home tiles.
7. Ward targets and alerts (worker + email).
8. Reports centre (PPTX, PDF, Excel) and printable sheet.
9. Hardening and pilot release: backups (nightly pg_dump + MinIO copy),
   Nginx HTTPS config, deployment guide for Ubuntu 24.04, restore test.

## 12. Documentation to create first
- CLAUDE.md: short summary of sections 0, 2, 3, 4 and 10 (rules you must always follow).
- docs/requirements/hand-hygiene.md: sections 5 and 7.
- docs/roles-permissions.md: section 5.2 with the matrix.
- docs/architecture.md: modular monolith, modules, form engine, events/jobs,
  deployment.
- docs/data-model.md and docs/api.md: draft, refined per slice.
- docs/decisions.md: start with the decisions in this brief, dated today.

Start now with section 12, then give me your plan for Slice 1 and any questions.
