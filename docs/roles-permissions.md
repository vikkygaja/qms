# Roles & Permissions

Roles are **data** (tables `role`, `permission`, `role_permission`, `user_role`). Admin can create new roles (e.g. Nursing Superintendent) from the "Roles & permissions" page (matrix of checkboxes + add role).

## Permission codes
| Code | Meaning |
|---|---|
| `masters` | Manage wards, departments, staff categories, settings/thresholds |
| `users` | Manage platform users and roles |
| `ln` | Manage link nurses |
| `record` | Record hand hygiene sessions |
| `review` | Review / reject sessions |
| `targets` | Set ward targets |
| `dash` | View dashboards |
| `alerts` | Receive low-compliance alerts |
| `reports` | Reports centre |

## Default matrix
| Role | masters | users | ln | record | review | targets | dash | alerts | reports |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Admin | ✔ | ✔ | ✔ | | | ✔ | ✔ | | ✔ |
| ICN | | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Quality Manager | | | | | | | ✔ | ✔ | ✔ |
| Link nurse | | | | ✔ | | | ✔ (own wards only) | | |

## Rules
- Permissions are checked server-side on EVERY API endpoint; the UI hides menu items only as a convenience.
- Admin always keeps `users` (cannot lock themselves out).
- The last active Admin cannot be deactivated.
- Link nurse `dash` is scoped to the nurse's current assigned wards ("My wards"); link nurse `record` is limited to current assigned wards. ICN may use any active ward.
- Every permission change (role matrix edit, role created, user role changed) is written to `audit_log`.
- Menu items appear only when the user holds the relevant permission.
