"""Whole-database export / import for organization admins (the same as
`python -m app.dbtool`, from the browser)."""

import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_user
from app.models.user import User
from app.services import dbdump
from app.services.permissions import is_org_admin

router = APIRouter(prefix="/admin/database", tags=["database"])

BACKUP_DIR = dbdump.BACKEND_DIR / "backups"


def _require_admin(user: User) -> None:
    if not is_org_admin(user):
        raise HTTPException(403, "Only an organization admin can export or import the database.")


@router.get("/export")
def export_database(
    background: BackgroundTasks, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    """The whole database and uploaded files as one .zip."""
    _require_admin(user)
    engine = db.get_bind()
    db.close()
    tmp = Path(tempfile.mkdtemp(prefix="rmt-export-"))
    name = f"rmt-{datetime.now():%Y-%m-%d-%H%M}.zip"
    dbdump.export_database(engine, tmp / name, dbdump.default_files_dir(), dbdump.app_version())
    background.add_task(shutil.rmtree, tmp, ignore_errors=True)
    return FileResponse(tmp / name, media_type="application/zip", filename=name)


@router.post("/inspect")
def inspect_export(file: UploadFile = File(...), user: User = Depends(require_user)):
    """What an export contains — shown before importing it."""
    _require_admin(user)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "upload.zip"
        with open(path, "wb") as out:
            shutil.copyfileobj(file.file, out)
        try:
            manifest = dbdump.read_manifest(path)
        except dbdump.DumpError as e:
            raise HTTPException(422, str(e)) from e
    return {**manifest, "current_revision": dbdump.head_revision()}


@router.post("/import")
def import_database(
    file: UploadFile = File(...),
    confirm: str = Form(""),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Replace everything with an export. Requires `confirm=REPLACE`. A
    backup of the current database is written to backend/backups first."""
    _require_admin(user)
    if confirm != "REPLACE":
        raise HTTPException(422, "Type REPLACE to confirm that everything will be overwritten.")
    engine = db.get_bind()
    # Our own session must not hold any table open while they're dropped.
    db.close()
    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"rmt-before-import-{datetime.now():%Y-%m-%d-%H%M%S}.zip"
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "upload.zip"
        with open(path, "wb") as out:
            shutil.copyfileobj(file.file, out)
        try:
            dbdump.read_manifest(path)
            dbdump.export_database(engine, backup, dbdump.default_files_dir(), dbdump.app_version())
            result = dbdump.import_database(engine, path, dbdump.default_files_dir(), replace=True)
        except dbdump.DumpError as e:
            raise HTTPException(422, str(e)) from e
    return {
        "rows": sum(result["loaded"].values()),
        "tables": len(result["loaded"]),
        "from_revision": result["manifest"]["alembic_revision"],
        "revision": dbdump.head_revision(),
        "backup": backup.name,
    }
