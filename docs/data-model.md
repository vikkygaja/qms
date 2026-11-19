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

_Full column types, constraints and RLS policies to be written here per slice before migrations._
