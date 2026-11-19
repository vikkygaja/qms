# API (DRAFT — refined per slice)

Base path: `/api/v1`. OpenAPI/Swagger enabled in development only.

## Conventions
- JSON, ISO 8601 dates/times (UTC in API).
- Auth: server-side session in a secure HTTP-only cookie (`SameSite=Lax`); state-changing requests (POST/PUT/PATCH/DELETE) require a CSRF token header. Deactivating a user or resetting their password ends all their sessions. Every endpoint declares its required permission server-side.
- Pagination: `?page=1&page_size=25` → `{ "items": [...], "total": n, "page": 1, "page_size": 25 }`.
- Error format:
  ```json
  { "error": { "code": "validation_error", "message": "Human readable", "details": [ { "field": "mobile", "message": "Must be 10 digits" } ] } }
  ```
  Codes: `validation_error`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `locked`, `inactive_account`.

## Endpoints planned by slice
| Slice | Endpoints |
|---|---|
| 1 | `GET /health` |
| 2 | `POST /auth/login`, `POST /auth/logout`, `POST /auth/change-password`, `GET /auth/me`; `/users` CRUD-ish (no delete), `POST /users/{id}/reset-password`, `POST /users/{id}/status`; `/roles`, `/permissions`, `PUT /roles/{id}/permissions`; `GET /audit-log` |
| 3 | `/wards`, `/departments`, `/staff-categories`, `/settings` |
| 4 | `/link-nurses`, `/link-nurses/{id}/wards`, `/link-nurses/{id}/status`, `/link-nurses/{id}/reset-password` |
| 5 | `/form-templates`, `/hh/sessions` (create), attachments upload |
| 6 | `/hh/sessions` (list/detail/review/reject/export), `/hh/kpi/*` |
| 7 | `/hh/ward-targets`, `/alerts`, `POST /alerts/{id}/read` |
| 8 | `/reports` (create job, status, download), `/hh/printable-sheet` |

_Each endpoint's request/response schema and required permission is documented below as it is built._

---

# Slice 2 contract: auth, users, roles, audit

All paths below are under `/api/v1`. Errors use the standard format. State-changing requests (POST/PUT/PATCH) need header `X-CSRF-Token: <csrf_token>` (the value from login or `GET /auth/me`); missing or wrong → `403 forbidden` "CSRF token missing or invalid". Login is exempt (no session yet).

Session cookie: `qms_session` (HTTP-only, SameSite=Lax, `Secure` per `COOKIE_SECURE`). The browser sends it automatically; the frontend must use `credentials: 'same-origin'` and never read it.

Extra error codes: `password_change_required` (403, user must change their temporary password first; only `/auth/me`, `/auth/logout`, `/auth/change-password` work), `session_expired` (401, idle/absolute timeout).

## Shared shapes
```jsonc
// Me
{ "id": "uuid", "employee_id": "ICN001", "full_name": "Sr. Mary J.", "designation": "Infection Control Nurse",
  "role": { "id": "uuid", "key": "icn", "name": "ICN" },
  "permissions": ["ln", "record", "review", "targets", "dash", "alerts", "reports"],
  "must_change_password": false }

// User (list/detail)
{ "id": "uuid", "employee_id": "ICN001", "full_name": "...", "designation": "...", "mobile": "9840000002",
  "email": "" , "role": { "id": "uuid", "key": "icn", "name": "ICN" }, "status": "Active" | "Inactive",
  "must_change_password": false, "last_login_at": "2026-11-19T10:00:00Z" | null, "created_at": "..." }

// Role
{ "id": "uuid", "key": "admin", "name": "Admin", "is_system": true,
  "permissions": ["masters", "users", ...], "active_user_count": 1 }

// Page
{ "items": [...], "total": 42, "page": 1, "page_size": 25 }
```

## Auth
| Method + path | Permission | Request | Success | Errors |
|---|---|---|---|---|
| `POST /auth/login` | public | `{employee_id, password}` | `200 {user: Me, csrf_token}` + cookie | `401 unauthenticated` "Employee ID or password is incorrect."; `403 inactive_account` "This account is inactive. Contact the ICN or IT."; `423 locked` "Too many failed attempts. Try again in 15 minutes." |
| `GET /auth/me` | logged in | | `200 {user: Me, csrf_token}` | `401 unauthenticated` / `session_expired` |
| `POST /auth/logout` | logged in | | `204` (cookie cleared) | |
| `POST /auth/change-password` | logged in (works while `must_change_password`) | `{current_password, new_password}` | `200 {user: Me, csrf_token}` | `422 validation_error` (field `current_password` wrong, or `new_password` fails policy: min 8 chars, letters + numbers, must differ from current) |

Login rules: employee ID is case-insensitive. 5 failed attempts lock the account for 15 minutes. Inactive accounts get the inactive message only after the correct password.

## Users (permission `users`)
| Method + path | Request | Success | Notes |
|---|---|---|---|
| `GET /users` | query: `q` (name or ID), `status`, `role_id`, `page`, `page_size` | `200 Page<User>` | |
| `POST /users` | `{employee_id, full_name, designation, role_id, mobile, email?}` | `201 {user: User, temporary_password}` | Password shown once only. `employee_id` 3–20 chars `[A-Za-z0-9_-]`, stored upper-case, unique. `mobile` exactly 10 digits. Role `link_nurse` is rejected (422). |
| `GET /users/{id}` | | `200 User` | |
| `PATCH /users/{id}` | any of `{full_name, designation, role_id, mobile, email}` | `200 User` | Employee ID cannot change. `409 conflict` if the change would remove the last active admin. |
| `POST /users/{id}/status` | `{status: "Active"\|"Inactive", reason}` | `200 User` | `reason` required (422). Inactive ends all the user's sessions. `409 conflict` for the last active admin. |
| `POST /users/{id}/reset-password` | | `200 {user: User, temporary_password}` | New temporary password, forces change, ends all the user's sessions. `409` if the user is Inactive. |

## Roles and permissions (permission `users`)
| Method + path | Request | Success | Notes |
|---|---|---|---|
| `GET /permissions` | | `200 [{code, description}]` | The 9 codes, in matrix order |
| `GET /roles` | | `200 [Role]` | |
| `POST /roles` | `{name}` | `201 Role` | New role starts with `["dash"]`. `409 conflict` for a duplicate name. |
| `PUT /roles/{id}/permissions` | `{permissions: [codes]}` | `200 Role` | `409 conflict` if the `admin` role would lose `users`. Unknown code → 422. Applies immediately to everyone in the role. |

## Audit log (permission `users`)
`GET /audit-log` — query: `entity`, `action`, `actor_id`, `date_from`, `date_to` (ISO dates), `q` (text in summary), `page`, `page_size`. Newest first.
```jsonc
{ "id": 123, "at": "2026-11-19T10:00:00Z",
  "actor": { "id": "uuid", "employee_id": "ADMIN", "full_name": "IT Admin" } | null,
  "entity": "user", "entity_id": "uuid", "action": "status_change",
  "summary": "Set Dr. Arun K. (QM001) Inactive: Left the hospital",
  "old_values": { "status": "Active" }, "new_values": { "status": "Inactive" } }
```
Audited actions: `create`, `update`, `status_change`, `password_reset`, `password_change`, `permission_change`, `role_create`, `account_locked`. Passwords and tokens are never stored in audit values.
