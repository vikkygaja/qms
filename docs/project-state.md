# QMS — Project state (living document)

Maintained by the `qms-brain` agent and the orchestrator. Update after every meaningful step. Last updated: 2026-11-19.

## What we are building
QMS: a multi-tenant hospital Quality Management System. Pilot: Sri Narayani Hospital & Research Centre (SNHRC), Vellore. Module 1 = Hand Hygiene (WHO 5 Moments observations, KPIs, alerts, monthly HICC reports). Later modules: NABH Readiness, Audits, CAPA, MRD Deficiency, Incidents, Documents.
Users: Admin (IT), ICN, Quality Manager, ~30 link nurses. Authoritative sources: `docs/brief.md` (full brief), `prototype/index.html` (approved UI), `docs/decisions.md` (decisions 1-31+).

## Environment
- Dev machine: Mac (Node 24.14, npm 11, no Docker, no uv). Code and git live here.
- Server: `qms@192.168.11.157`, Ubuntu 26.04.1, 4 CPU, 11 GB RAM, 1 TB disk, Docker 29.1.3 + Compose 2.40.3 installed (2026-11-19), key-based SSH from the Mac works, `ufw` active, sudo needs a password (user runs privileged commands). Plan: sync code with rsync, run Docker stack and backend tests on the server.
- Server firewall: `ufw` enabled by the user on 2026-11-19; allows 22/tcp and 8080/tcp from 192.168.11.0/24 only. Docker-published ports bypass ufw, so Slice 9 must add DOCKER-USER rules; until then publish only nginx and bind Postgres/Redis/MinIO to 127.0.0.1 or the internal Docker network.
- Repo: https://github.com/vikkygaja/qms.git, branch `main`; local folder tracks origin/main.

## Workflow rules
Per slice: plan + questions -> user OK -> tests first -> implement -> run all tests/linters -> summary -> commit message. Never guess requirements; record answers in `docs/decisions.md`. No push, no commits to `main` without the user's instruction.

## Agent team (`.claude/agents/`)
ux-designer, dba-backup, security-auditor (read-only), tester-committer, frontend-dev, fable-master (escalations), qms-brain (this context keeper).

## Progress
- [x] Docs created from the brief (CLAUDE.md, docs/*).
- [x] Slice 1 plan approved by the user ("approved with recommendations") on 2026-11-19.
- [x] Server: Docker installed and verified.
- [x] Branch `slice-1-skeleton` created.
- [x] Slice 1 implementation (2026-11-19): backend (FastAPI health, error format, config, Alembic baseline, RQ worker stub) 17 tests passing on real Postgres, ruff + black clean, 86% coverage; frontend (Vite/React shell, health badge) 10 tests passing, eslint/prettier/tsc build clean; Compose stack (db, redis, api, worker, web, nginx) running on the server at http://192.168.11.157:8080; GitHub Actions CI written (not yet run: nothing pushed). MinIO service defined but disabled (image unavailable, see decisions.md open items).
- [x] Slice 1 merged to main (PR #1, 2026-11-19).
- [~] Slice 2 (branch `slice-2-auth`, in progress): backend done (139 tests pass on real Postgres, 96% coverage, ruff/black clean): auth with server-side sessions + CSRF + lockout, users, roles/permissions, append-only audit log, row-level security with the non-superuser role `qms_app`, CLI (`python -m app.cli migrate|init|create-admin`). Frontend built by a subagent (50 tests pass; login, forced password change, Users, Roles matrix, Audit log pages), not yet verified against the real API. Test instance `qms-dev` on port 8081 (env file `~/qms/.env.dev` on the server, `APP_ENV=development`, `COOKIE_SECURE=false`); test admin login `Admin` (password only in the user's chat/env, not in git).
- [x] Slice 2 committed locally on `slice-2-auth` (backend `2ca3492`, frontend `edd1133`); NOT pushed yet, no PR yet.
- [~] Slice 3 (branch `slice-3-masters`, stacked on slice-2-auth): Masters backend (departments, wards, staff categories, KPI thresholds), Excel/CSV upload + download with dry-run preview, `seed-demo` command, Masters page + Printable sheet page (frontend agent). Verified: backend 235 tests, 94% coverage, ruff/black clean; frontend 69 tests, eslint/tsc/prettier clean; live on the test instance (8081) with demo data (11 departments, 20 wards, targets total 1000). Not yet clicked through in a browser.
- Open for later slices: ward cannot become Inactive while it has current link nurses (Slice 4 plugs into `set_ward_status`).
- Promotion plan: when the user approves the test instance, start the same code as a second instance on a new port with a fresh database (not a copy of test data) unless the user asks for a data copy.
- [ ] Slices 2-9 (see CLAUDE.md).

## How to run things (all on the server, code is rsynced from the Mac)
- Sync: `rsync -az --exclude .git --exclude node_modules --exclude .venv --exclude dist ./ qms@192.168.11.157:~/qms/`
- Backend tests: `docker compose -f deploy/docker-compose.test.yml run --rm --build tests`
- Frontend checks: run in a `node:24` container (see README).
- Stack: `docker compose --env-file .env -f deploy/docker-compose.yml up -d --build` (server `.env` holds random secrets, never committed).

## Open items
See "Open items" in `docs/decisions.md` (draft status on session entry, session-number reset, printable sheet permission). Pending for later: open firewall port 8080 to the LAN subnet; confirm LAN subnet.

## Notes for the next session
- Slice 1 choices: FastAPI + SQLAlchemy 2 + Alembic, RQ worker stub, React/Vite shell with CSS modules, Compose (db, redis, minio, api, worker, web, nginx), GitHub Actions CI, real Postgres for tests, `uv` + npm.
