from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core import health
from app.core.config import Settings, get_settings
from app.core.db import make_engine
from app.core.errors import register_exception_handlers

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url.get_secret_value())

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

    register_exception_handlers(app)
    app.include_router(health.router, prefix=API_PREFIX)
    return app


def build() -> FastAPI:
    """Factory entrypoint for uvicorn: `uvicorn app.main:build --factory`."""
    return create_app()
