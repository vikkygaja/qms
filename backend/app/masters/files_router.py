from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.deps import AuthContext, get_db, get_now, require_masters
from app.core.errors import ApiError, field_error
from app.masters import files

Kind = Literal["all", "wards", "departments", "staff-categories"]
Format = Literal["xlsx", "csv"]
IST = ZoneInfo("Asia/Kolkata")

router = APIRouter(prefix="/masters", tags=["masters"], dependencies=[Depends(require_masters)])


def _download(content: bytes, fmt: str, stem: str, now: datetime) -> Response:
    day = now.astimezone(IST).strftime("%Y%m%d")
    media = files.XLSX_TYPE if fmt == "xlsx" else "text/csv; charset=utf-8"
    return Response(
        content,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="{stem}-{day}.{fmt}"',
            "Cache-Control": "no-store",
        },
    )


def _check(kind: str, fmt: str) -> None:
    if kind == "all" and fmt == "csv":
        raise field_error("format", "CSV holds one master only. Choose Excel for all masters.")


@router.get("/export")
def export(
    kind: Kind = "all",
    format: Format = "xlsx",
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    _check(kind, format)
    body = files.export_xlsx(db, kind) if format == "xlsx" else files.export_csv(db, kind)
    stem = "qms-masters" if kind == "all" else f"qms-{kind}"
    return _download(body, format, stem, now)


@router.get("/template")
def template(kind: Kind = "all", format: Format = "xlsx", now: datetime = Depends(get_now)):
    _check(kind, format)
    body = files.template_xlsx(kind) if format == "xlsx" else files.template_csv(kind)
    stem = "qms-masters-template" if kind == "all" else f"qms-{kind}-template"
    return _download(body, format, stem, now)


@router.post("/import")
def import_masters(
    kind: Kind = "all",
    dry_run: bool = True,
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_masters),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    """Dry run by default. Apply with dry_run=false; any error row blocks the whole file."""
    data = file.file.read(files.MAX_BYTES + 1)
    if len(data) > files.MAX_BYTES:
        raise ApiError(413, "payload_too_large", "The file is larger than 2 MB.")
    filename = file.filename or "upload"
    sheets = files.parse_upload(filename, data, kind)
    return files.run_import(db, ctx, sheets, apply=not dry_run, filename=filename, now=now)
