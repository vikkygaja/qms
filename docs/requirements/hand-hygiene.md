# Requirements — Platform features and Hand Hygiene module

Source: project brief sections 5 and 7. Status of each item is tracked per slice.

## 5. Platform features (shared by all modules)

### 5.1 Authentication
- Login with Employee ID + password. Session via secure HTTP-only cookie (or JWT with refresh — see decisions.md). Lock out after 5 failed attempts for 15 minutes.
- First login with a temporary password forces a "set new password" screen (min 8 chars, letters + numbers).
- Inactive users cannot log in: "This account is inactive. Contact the ICN or IT."

### 5.2 Roles & permissions (RBAC)
See `docs/roles-permissions.md`.

### 5.3 Users (Admin)
- Admin creates platform users (ICN, QM, Admin, custom roles) — NOT link nurses.
- Fields: employee ID (unique, = username), full name, designation, role, mobile (10 digits), email (optional), status.
- Create generates a temporary password shown ONCE.
- Actions: edit, reset password (new temporary password), active/inactive with reason.

### 5.4 Link nurses (ICN, or any role with permission `ln`)
- Creating a link nurse ALSO creates their login (role Link nurse) in one step.
- Fields: employee ID*, full name*, designation*, department*, mobile*, email, link nurse from date*, WHO 5 Moments training date, assigned ward(s)* (one or more).
- Ward assignment is many-to-many WITH HISTORY: `ward_assignment(link_nurse_id, ward_id, from_date, to_date null = current)`. Removing a ward sets `to_date`; adding creates a new row. Show assignment history.
- Active/Inactive with mandatory reason + effective date. Inactivation ends all current ward assignments and blocks login. Reactivation does not restore wards.
- Reset password. No delete.
- List: search (name/ID), filter by ward and status, sessions this month, last entry date, "no entry in X days" flag, "first login pending" flag.

### 5.5 Masters (Admin)
- Wards (name, department, monthly hand hygiene opportunity target, status). A ward with current link nurses cannot be made inactive until they are moved.
- Departments; staff categories observed (Doctor, Nurse, Technician, Housekeeping, Student, Other HCW); KPI thresholds (green ≥ 90, amber ≥ 80, inactive after 10 days).
- All Active/Inactive; inactive items disappear from entry screens but remain in history.

### 5.6 Audit log
- Append-only table; Admin can view and filter it. Recent changes shown on the Users and Link nurses pages.

### 5.7 App shell
- Left menu: Home; Hand Hygiene (New session, Sessions, Dashboard, Ward targets, Link nurses, Printable sheet); other modules "Coming soon"; Platform (Reports centre, Users, Roles & permissions, Masters).
- Menu items appear only if the user has the permission.
- Home: KPI tiles, module cards, compliance trend; alerts bell for users with `alerts`.

## 7. Module 1 — Hand Hygiene

### 7.1 Session entry (permission `record`)
- Header: ward (link nurse: only CURRENT assigned wards; ICN: any active ward), date, start time, end time, duration auto-calculated, observer from login, remarks, optional attachment of the signed paper sheet (image/PDF to MinIO).
- Rows (one per opportunity):
  - staff category (active categories)
  - moment(s), multi-select 1–5: 1 Before patient contact, 2 Before aseptic procedure, 3 After body fluid exposure risk, 4 After patient contact, 5 After touching patient surroundings
  - action: Hand rub / Hand wash / Missed
  - gloves worn: Yes/No
  - technique correct: Yes/No (disabled and stored as "not applicable" when action = Missed)
- Keyboard on a focused row: R/W/M set action, 1–5 toggle moments, D duplicates. Buttons: add row, copy row, remove row. Live session summary (opportunities, compliance %, missed).
- Validation: ≥ 1 row; each row has ≥ 1 moment and an action; end > start.
- Session number auto: `HH-YYMM-NNNN` per tenant.
- Link nurse submissions → status Submitted. ICN's own sessions → Reviewed.

### 7.2 Data for KPIs
- `hh_opportunity(session_id, ward_id, observer_id, date, category, moments text[], action, gloves bool, technique enum Y/N/NA)` populated on submit.
- Volume ~1,000 opportunities/month; index by tenant, date, ward.

### 7.3 Sessions list
- Filter by month and ward (link nurse sees only own sessions).
- View details, audit trail. ICN (permission `review`): Mark reviewed / Reject (reason required). Rejected sessions are excluded from KPIs but kept.
- Export to Excel.

### 7.4 KPIs and dashboard (permission `dash`)
- Compliance % = (hand rub + hand wash) ÷ total opportunities × 100 (1 decimal).
- Breakdowns: ward, staff category, moment (an opportunity counts in each of its moments), month, observer. 12-month trend. Target line.
- Missed with gloves on % = missed with gloves ÷ missed.
- Technique correct % = technique Yes ÷ (rub + wash with technique recorded).
- Colour bands from thresholds. Link nurse sees only own wards ("My wards").

### 7.5 Ward targets (permission `targets`)
- Monthly target per ward (sum shown; hospital total ≈ 1,000). Target shared by the ward's link nurses; show each nurse's contribution. Progress vs expected-to-date.

### 7.6 Alerts (in-app + email; WhatsApp later)
- Ward compliance below amber threshold month-to-date (min 15 opportunities) → all users with `alerts` (ICN + QM by default).
- Ward behind target pace (< 60% of expected by today) → ICN.
- Active link nurse with no entry in N days → ICN.
- Daily job computes alerts; avoid duplicates; alert list with read/unread.

### 7.7 Reports centre (permission `reports`)
- Monthly HICC meeting deck (PPTX): title slide with overall %, ward-wise chart (lowest first), by category, by moment, 12-month trend, key findings (lowest wards, weakest moment, weakest group, gloves/technique %).
- Same data as PDF and Excel. Generated in the background worker; download when ready.
- Phase 2 (not now): AI-written findings narrative.

### 7.8 Printable observation sheet
- PDF of a blank sheet matching the entry grid: header + 12 rows, category codes D N T H S O, moments 1–5, R/W/M, gloves Y/N, technique Y/N, signature.
