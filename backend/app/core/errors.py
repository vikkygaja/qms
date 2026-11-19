"""Consistent error format: {"error": {"code", "message", "details": []}}."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("qms.errors")

CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    423: "locked",
    429: "too_many_requests",
}


class ApiError(Exception):
    """Raise anywhere to return the standard error body with a specific code."""

    def __init__(
        self, status_code: int, code: str, message: str, details: list[dict] | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or []


def field_error(field: str, message: str) -> ApiError:
    return ApiError(
        422, "validation_error", "Some fields are invalid", [{"field": field, "message": message}]
    )


def error_body(code: str, message: str, details: list | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or []}}


def _clean(message: str) -> str:
    return message.removeprefix("Value error, ")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_exc(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            error_body(exc.code, exc.message, exc.details), status_code=exc.status_code
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = CODES.get(exc.status_code, "http_error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(error_body(code, message), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": ".".join(str(p) for p in e["loc"][1:]), "message": _clean(e["msg"])}
            for e in exc.errors()
        ]
        return JSONResponse(
            error_body("validation_error", "Some fields are invalid", details),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def unhandled_exc(_: Request, exc: Exception) -> JSONResponse:
        # Log the type only: the message could carry request data.
        logger.error("Unhandled error: %s", type(exc).__name__)
        return JSONResponse(error_body("internal_error", "Something went wrong"), status_code=500)
