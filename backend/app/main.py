from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI

from app.audit.router import router as audit_router
from app.auth.router import router as auth_router
from app.core import health
from app.core.config import Settings, get_settings
from app.core.db import make_engine, make_sessionmaker
from app.core.errors import register_exception_handlers
from app.linknurses.router import router as link_nurses_router
from app.masters.files_router import router as masters_files_router
from app.masters.router import router as masters_router
from app.roles.router import router as roles_router
from app.users.router import router as users_router

API_PREFIX = "/api/v1"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def create_app(
    settings: Settings | None = None, clock: Callable[[], datetime] | None = None
) -> FastAPI:
    settings = settings or get_settings()
    # The API runs as the non-superuser role so row-level security applies.
    engine = make_engine(settings.runtime_database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        engine.dispose()

    docs = settings.docs_enabled  # OpenAPI docs: development only
    app = FastAPI(
        title="QMS API",
        version=settings.app_version,
        docs_url=f"{API_PREFIX}/docs" if docs else None,
        redoc_url=f"{API_PREFIX}/redoc" if docs else None,
        openapi_url=f"{API_PREFIX}/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.clock = clock or _utcnow

    register_exception_handlers(app)
    app.include_router(health.router, prefix=API_PREFIX)
    routers = (
        auth_router,
        users_router,
        roles_router,
        audit_router,
        masters_router,
        masters_files_router,
        link_nurses_router,
    )
    for router in routers:
        app.include_router(router, prefix=API_PREFIX)
    return app


def build() -> FastAPI:
    """Factory entrypoint for uvicorn: `uvicorn app.main:build --factory`."""
    return create_app()
