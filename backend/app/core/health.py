import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

logger = logging.getLogger("qms.health")

router = APIRouter()


@router.get("/health", summary="Liveness and database check (no authentication)")
def health(request: Request) -> JSONResponse:
    version = request.app.state.settings.app_version
    try:
        with request.app.state.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - any DB failure means "down"
        logger.warning("Health: database unreachable (%s)", type(exc).__name__)
        return JSONResponse(
            {"status": "degraded", "version": version, "db": "down"}, status_code=503
        )
    return JSONResponse({"status": "ok", "version": version, "db": "up"})
