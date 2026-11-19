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

## Run it (development / pilot server)

Requires Docker with Compose. Nothing else is installed on the host.

```bash
cp .env.example .env            # then edit every CHANGE-ME value
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
curl http://localhost:8080/api/v1/health      # {"status":"ok","version":"0.1.0","db":"up"}
```

Open `http://<server>:8080`. Only nginx (`WEB_PORT`) listens on the LAN; Postgres, the API and MinIO bind to `127.0.0.1`. All ports are configurable in `.env`.

## Tests and linters

Backend (real PostgreSQL in a throwaway container):

```bash
docker compose -f deploy/docker-compose.test.yml run --rm --build tests              # pytest
docker compose -f deploy/docker-compose.test.yml run --rm tests ruff check .
docker compose -f deploy/docker-compose.test.yml run --rm tests black --check .
```

Frontend (Node 24):

```bash
cd frontend && npm ci && npm run lint && npm run format:check && npm test && npm run build
```

CI (GitHub Actions) runs the same checks on every push and pull request.

## Layout

`backend/` FastAPI app · `frontend/` React + Vite · `deploy/` Compose, nginx, backups · `docs/` requirements, decisions, project state · `prototype/` approved UI reference · `.claude/agents/` agent team.
