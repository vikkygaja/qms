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

_Each endpoint's request/response schema and required permission will be documented here as it is built._
