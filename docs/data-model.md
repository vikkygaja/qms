# Data Model (DRAFT — refined per slice, must be finalised before each migration)

Conventions: every table has `id` (UUID), `tenant_id`, `created_at`, `updated_at` (UTC). No hard deletes for master/user/session data — use `status` (+ `status_history`). RLS policy on `tenant_id` for every table.

## Tables (minimum set from the brief)
| Table | Purpose | Key columns (draft) |
|---|---|---|
| `tenant` | Hospital | name, code, status |
| `user` | Platform users and link nurses | employee_id (unique per tenant), full_name, designation, department_id, mobile, email, password_hash, must_change_password, failed_attempts, locked_until, status, is_link_nurse, link_nurse_from, who5_training_date, last_login_at |
| `role` | Roles (data) | name, is_system |
| `permission` | Permission codes | code, description |
| `role_permission` | Role ↔ permission | role_id, permission_id |
| `user_role` | User ↔ role | user_id, role_id |
| `ward` | Wards | name, department_id, monthly_target, status |
| `department` | Departments | name, status |
| `staff_category` | Staff categories observed | code (D/N/T/H/S/O), name, status |
| `setting` | KPI thresholds etc. | key, value (JSONB) — green 90, amber 80, inactive_days 10 |
| `ward_assignment` | Link nurse ↔ ward history | link_nurse_id, ward_id, from_date, to_date (null = current) |
| `status_history` | Active/Inactive changes | entity_type, entity_id, old_status, new_status, reason, effective_date, changed_by |
| `form_template` | Template identity | code, name, module, status |
| `form_template_version` | Immutable published definition | template_id, version, definition (JSONB), published_at |
| `form_session` | A submitted form | session_no, template_version_id, ward_id, observer_user_id, date, start_time, end_time, status (Submitted/Reviewed/Rejected), remarks, reject_reason, reviewed_by, reviewed_at, attachment_key |
| `form_row` | Rows of a session | session_id, row_no, data (JSONB) |
| `hh_opportunity` | KPI fact table | session_id, ward_id, observer_id, date, category, moments text[], action, gloves bool, technique (Y/N/NA) |
| `ward_target` | Monthly ward target | ward_id, month, target |
| `alert` | In-app alerts | type, subject key (dedupe), recipient_user_id, message, read_at |
| `audit_log` | Append-only | actor_user_id, at, entity, entity_id, action, old_values, new_values |
| `file_attachment` | MinIO file metadata | object_key, filename, content_type, size, uploaded_by |

## Indexes (planned)
- `hh_opportunity (tenant_id, date)`, `(tenant_id, ward_id, date)`
- `form_session (tenant_id, date)`, unique `(tenant_id, session_no)`
- `user (tenant_id, employee_id)` unique
- `ward_assignment (link_nurse_id, to_date)`

## Rules
- `audit_log`: INSERT only; UPDATE/DELETE revoked at DB level.
- `form_template_version`: immutable once published.
- Rejected sessions keep their rows but are excluded from KPI queries.
- Session numbers `HH-YYMM-NNNN` allocated per tenant (sequence/counter table — to be decided in Slice 5).

_Full column types, constraints and RLS policies are written here per slice before migrations._

---

# Slice 2 tables (migration `0002`)

IDs are UUIDs (`gen_random_uuid()`), timestamps are `timestamptz` (UTC). Every table except `tenant` has `tenant_id uuid NOT NULL REFERENCES tenant(id)`.

| Table | Columns | Constraints |
|---|---|---|
| `tenant` | id, code, name, status (`Active`/`Inactive`), created_at | unique(code). No RLS (needed to resolve the tenant at login); runtime role has SELECT only. |
| `permission` | id, tenant_id, code, description | unique(tenant_id, code) |
| `role` | id, tenant_id, key, name, is_system, created_at | unique(tenant_id, key), unique(tenant_id, name) |
| `role_permission` | tenant_id, role_id, permission_id | PK(role_id, permission_id) |
| `user` (`app_user`) | id, tenant_id, employee_id (upper-case), full_name, designation, mobile, email, password_hash, must_change_password, failed_attempts, locked_until, status, last_login_at, created_at, updated_at | unique(tenant_id, employee_id); status in (`Active`,`Inactive`) |
| `user_role` | tenant_id, user_id, role_id | PK(user_id, role_id) |
| `session` (`user_session`) | id, tenant_id, user_id, token_hash (sha256 hex), csrf_token, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent | unique(token_hash); index(user_id) |
| `status_history` | id, tenant_id, entity_type, entity_id, old_status, new_status, reason, effective_date, changed_by, changed_at | index(entity_type, entity_id) |
| `audit_log` | id (bigserial), tenant_id, at, actor_user_id, entity, entity_id, action, summary, old_values jsonb, new_values jsonb, ip | index(tenant_id, at desc), index(entity, entity_id) |

Physical names `app_user` and `user_session` avoid the reserved words `user` and `session`.

## Row-level security
- Every table except `tenant` has `ENABLE` + `FORCE ROW LEVEL SECURITY` and one policy: `USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (same)`. With no tenant set, no rows are visible and none can be written.
- The app sets `app.tenant_id` per transaction (`set_config(..., true)`), re-applied after every commit.
- Runtime role `qms_app` (non-superuser, no BYPASSRLS) is used by the API. Migrations run as the owner. Superusers bypass RLS, which is why the API must not connect as the owner.

## Append-only audit log
- `qms_app` has `SELECT, INSERT` on `audit_log` only (no UPDATE, DELETE, TRUNCATE).
- Trigger `audit_log_no_change` raises on any UPDATE or DELETE, even for the owner.

## Slice 3 tables (migration `0003`)

Same conventions as Slice 2 (UUID ids, `tenant_id`, forced row-level security with the `tenant_isolation` policy, explicit grants to `qms_app`: SELECT/INSERT/UPDATE/DELETE, never TRUNCATE).

| Table | Columns | Constraints |
|---|---|---|
| `department` | id, tenant_id, name, status, created_at, updated_at | unique(tenant_id, lower(name)); status in (`Active`,`Inactive`) |
| `ward` | id, tenant_id, name, department_id (FK), monthly_target (int >= 0), status, created_at, updated_at | unique(tenant_id, lower(name)) |
| `staff_category` | id, tenant_id, name, code (1-3 chars, upper-case), status, created_at, updated_at | unique(tenant_id, lower(name)), unique(tenant_id, code) |
| `setting` | id, tenant_id, key, value (jsonb), updated_at | unique(tenant_id, key); key `kpi` = `{"green":90,"amber":80,"inactive_days":10}` |

Status changes write `status_history` (entity_type `department`/`ward`/`staff_category`) and `audit_log`. Defaults seeded per tenant by `python -m app.cli init`: six staff categories (Doctor D, Nurse N, Technician T, Housekeeping H, Student S, Other HCW O) and the `kpi` setting. Wards and departments are NOT seeded in production; `python -m app.cli seed-demo` loads the prototype's demo data (development only).

## Slice 4 changes (migration `0004`)

- `app_user` gains nullable `department_id` (FK `department`), `link_nurse_from` (date), `who5_training_date` (date). Only users with role `link_nurse` fill them.
- New table `ward_assignment`: id, tenant_id, user_id (FK `app_user`), ward_id (FK `ward`), from_date (date), to_date (date, null = current), created_at, created_by, ended_by. Constraints: `to_date >= from_date`; **partial unique index** `(user_id, ward_id) WHERE to_date IS NULL` so a nurse has at most one current row per ward; indexes on `(ward_id) WHERE to_date IS NULL` (who is in a ward) and `(user_id)`. Row-level security and grants as for every table. History is never deleted.
- Status changes of link nurses write `status_history` (entity_type `link_nurse`) with the effective date.

## Seeded per tenant (by `python -m app.cli init`, idempotent)
- Permissions (in matrix order): `masters`, `users`, `ln`, `record`, `review`, `targets`, `dash`, `alerts`, `reports`.
- Roles: `admin` (Admin), `icn` (ICN), `qm` (Quality Manager), `link_nurse` (Link nurse), all `is_system`, with the default matrix from `docs/roles-permissions.md`.
