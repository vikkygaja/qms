# QMS – Hospital Quality Management System

Quality Management System for hospitals, piloted at SNHRC. The first module is **Hand Hygiene** (WHO 5 Moments observations, KPIs and monthly reports).

## What's here now

| Path | Purpose |
|---|---|
| `docs/brief.md` | Full project brief and build instructions for Claude Code |
| `prototype/index.html` | Approved clickable prototype (UI and workflow reference); open it in a browser |

## How to start building (VS Code + Claude Code)

1. Clone this repo and open the folder in VS Code.
2. Start Claude Code in the folder.
3. First prompt:

   > Read docs/brief.md and prototype/index.html. Follow section 0 of the brief: create the documentation in section 12 first, then propose your plan for Slice 1 and list your questions. Do not write application code yet.

4. For each later session:

   > Read CLAUDE.md and docs/. Continue with Slice N. Plan first.

## Rules (summary)

- No patient data, ever. Dummy data only in development.
- No hard delete: Active/Inactive with a reason.
- Every change goes to the audit log; permissions are checked on every API call.
