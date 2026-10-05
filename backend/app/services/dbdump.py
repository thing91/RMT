"""Export and import of the whole database — for moving RMT between
machines and for big migrations.

The archive is a .zip:

    manifest.json              format, schema revision, row counts, file list
    tables/<table>.jsonl       one JSON object per row
    files/reference_files/...  uploaded standard/reference PDFs

Everything is read from the live database (reflection), not from the
application's models, so an archive from an older version of RMT holds
exactly what that version had. Import recreates the schema *at the
archive's revision*, loads the rows, and then runs the normal migrations up
to the current version — the same path a long-lived installation takes, so
moving data forward between versions needs nothing special.
"""

from __future__ import annotations

import base64
import json
import os
import uuid
import zipfile
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path
from typing import Callable, Iterator

from sqlalchemy import MetaData, Table, inspect, text, types
from sqlalchemy.engine import Connection, Engine

FORMAT = "rmt-dump"
FORMAT_VERSION = 1
BATCH = 1000
SKIP_TABLES = {"alembic_version"}
BACKEND_DIR = Path(__file__).resolve().parents[2]


class DumpError(Exception):
    pass


# ---- value encoding ----------------------------------------------------------


def _encode(value):
    if value is None or isinstance(value, (bool, int, float, str, dict, list)):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, memoryview)):
        return {"$b64": base64.b64encode(bytes(value)).decode()}
    return str(value)


def _decoder(column_type) -> Callable:
    """How to turn a JSON value back into what the column expects."""
    if isinstance(column_type, types.JSON):
        return lambda v: v
    if isinstance(column_type, types.Uuid) or column_type.__class__.__name__.upper() == "UUID":
        return lambda v: uuid.UUID(v) if isinstance(v, str) else v
    if isinstance(column_type, types.DateTime):
        return lambda v: datetime.fromisoformat(v) if isinstance(v, str) else v
    if isinstance(column_type, types.Date):
        return lambda v: date.fromisoformat(v) if isinstance(v, str) else v
    if isinstance(column_type, types.Time):
        return lambda v: time.fromisoformat(v) if isinstance(v, str) else v
    if isinstance(column_type, types.Numeric) and not isinstance(column_type, (types.Float, types.Integer)):
        return lambda v: Decimal(v) if isinstance(v, str) else v
    if isinstance(column_type, types.LargeBinary):
        return lambda v: base64.b64decode(v["$b64"]) if isinstance(v, dict) and "$b64" in v else v
    return lambda v: v


# ---- schema helpers ----------------------------------------------------------


def _reflect(conn: Connection) -> MetaData:
    md = MetaData()
    md.reflect(bind=conn)
    return md


def _app_tables(md: MetaData) -> list[Table]:
    """Tables in an order where every referenced table comes first. Where
    references form a cycle (comments ↔ suggestions), the table whose
    unmet references are all optional goes first; those columns are filled
    in after loading (see _load_rows)."""
    tables = {t.name: t for t in md.tables.values() if t.name not in SKIP_TABLES}
    deps = {
        name: {fk.column.table.name for fk in t.foreign_keys if fk.column.table.name in tables and fk.column.table.name != name}
        for name, t in tables.items()
    }
    ordered: list[str] = []
    remaining = set(tables)
    while remaining:
        ready = sorted(n for n in remaining if deps[n] <= set(ordered))
        if not ready:
            def optional_only(n: str) -> bool:
                t = tables[n]
                return all(
                    fk.parent.nullable for fk in t.foreign_keys
                    if fk.column.table.name in remaining and fk.column.table.name != n
                )
            candidates = sorted(remaining, key=lambda n: (not optional_only(n), len(deps[n] - set(ordered)), n))
            ready = [candidates[0]]
        for n in ready:
            ordered.append(n)
            remaining.discard(n)
    return [tables[n] for n in ordered]


def current_revision(conn: Connection) -> str | None:
    if not inspect(conn).has_table("alembic_version"):
        return None
    row = conn.execute(text("SELECT version_num FROM alembic_version")).first()
    return row[0] if row else None


def head_revision() -> str:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(_alembic_config()).get_current_head()


def _alembic_config():
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _upgrade(conn: Connection, revision: str) -> None:
    from alembic import command

    cfg = _alembic_config()
    cfg.attributes["connection"] = conn
    command.upgrade(cfg, revision)


# ---- export ------------------------------------------------------------------


def _rows(conn: Connection, table: Table) -> Iterator[dict]:
    order = list(table.primary_key.columns) or list(table.columns)[:1]
    result = conn.execution_options(stream_results=True).execute(table.select().order_by(*order))
    for row in result.mappings():
        yield {k: _encode(v) for k, v in row.items()}


def export_database(engine: Engine, dest: str | Path, files_dir: str | Path | None = None, app_version: str = "") -> dict:
    """Write the whole database (and uploaded files) to `dest`. Returns the
    manifest. Runs in one repeatable-read transaction, so the archive is a
    consistent picture even while people keep working."""
    dest = Path(dest)
    counts: dict[str, int] = {}
    file_list: list[str] = []
    with engine.connect() as conn, zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        conn = conn.execution_options(isolation_level="REPEATABLE READ")
        with conn.begin():
            revision = current_revision(conn)
            md = _reflect(conn)
            for table in _app_tables(md):
                n = 0
                with zf.open(f"tables/{table.name}.jsonl", "w") as out:
                    for row in _rows(conn, table):
                        out.write(json.dumps(row, ensure_ascii=False).encode() + b"\n")
                        n += 1
                counts[table.name] = n
        if files_dir and Path(files_dir).is_dir():
            root = Path(files_dir)
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    rel = path.relative_to(root).as_posix()
                    zf.write(path, f"files/reference_files/{rel}")
                    file_list.append(rel)
        manifest = {
            "format": FORMAT,
            "format_version": FORMAT_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "app_version": app_version,
            "alembic_revision": revision,
            "tables": counts,
            "files": file_list,
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    return manifest


# ---- import ------------------------------------------------------------------


def read_manifest(src: str | Path) -> dict:
    try:
        with zipfile.ZipFile(src) as zf:
            manifest = json.loads(zf.read("manifest.json"))
    except (KeyError, zipfile.BadZipFile, json.JSONDecodeError) as e:
        raise DumpError("This is not an RMT database export (no valid manifest.json).") from e
    if manifest.get("format") != FORMAT:
        raise DumpError("This is not an RMT database export.")
    if manifest.get("format_version", 0) > FORMAT_VERSION:
        raise DumpError("The export was made by a newer RMT — update this installation first.")
    return manifest


def _has_data(conn: Connection) -> bool:
    for table in _app_tables(_reflect(conn)):
        if conn.execute(table.select().limit(1)).first():
            return True
    return False


def _drop_everything(conn: Connection) -> None:
    for name in inspect(conn).get_table_names():
        conn.execute(text(f'DROP TABLE IF EXISTS "{name}" CASCADE'))


def import_database(
    engine: Engine,
    src: str | Path,
    files_dir: str | Path | None = None,
    replace: bool = False,
    upgrade_to_head: bool = True,
) -> dict:
    """Load an export into this database.

    The target must be empty unless `replace` is set (then every table is
    dropped first). The schema is created at the export's revision, rows are
    loaded, and the schema is migrated to the current version. All in one
    transaction: if anything fails, the database is left as it was.
    """
    manifest = read_manifest(src)
    revision = manifest.get("alembic_revision")
    if not revision:
        raise DumpError("The export has no schema revision — it can't be migrated safely.")
    loaded: dict[str, int] = {}
    with zipfile.ZipFile(src) as zf, engine.connect() as conn:
        with conn.begin():
            # Fail instead of hanging if someone still holds a table open.
            conn.execute(text("SET LOCAL lock_timeout = '30s'"))
            if inspect(conn).get_table_names():
                if _has_data(conn) and not replace:
                    raise DumpError("The target database is not empty. Use replace to overwrite it.")
                _drop_everything(conn)
            _upgrade(conn, revision)
            md = _reflect(conn)
            tables = {t.name: t for t in _app_tables(md)}
            missing = set(manifest["tables"]) - set(tables)
            if missing:
                raise DumpError(f"Tables in the export that the schema doesn't have: {', '.join(sorted(missing))}")
            loaded = _load_rows(conn, zf, [t for t in tables.values() if t.name in manifest["tables"]])
            if upgrade_to_head:
                _upgrade(conn, "head")
    if files_dir and manifest.get("files"):
        root = Path(files_dir)
        with zipfile.ZipFile(src) as zf:
            for rel in manifest["files"]:
                target = (root / rel).resolve()
                if root.resolve() not in target.parents:
                    continue  # never write outside the files directory
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(f"files/reference_files/{rel}") as fin, open(target, "wb") as fout:
                    fout.write(fin.read())
    return {"manifest": manifest, "loaded": loaded}


def _load_rows(conn: Connection, zf: zipfile.ZipFile, ordered: list[Table]) -> dict[str, int]:
    """Insert in dependency order. A foreign key pointing at its own table
    or at a table not loaded yet (cycles such as comments ↔ suggestions) is
    inserted as NULL first and filled in once everything is in."""
    done: set[str] = set()
    deferred: list[tuple[Table, list[str], dict]] = []  # (table, pk cols, {col: value} per row) collected below
    counts: dict[str, int] = {}
    for table in ordered:
        later_cols = {
            fk.parent.name
            for fk in table.foreign_keys
            if fk.column.table.name == table.name or fk.column.table.name not in done
        }
        for col in later_cols:
            if not table.columns[col].nullable:
                raise DumpError(f"Can't order {table.name}.{col} — a required reference forms a cycle.")
        decode = {c.name: _decoder(c.type) for c in table.columns}
        pk = [c.name for c in table.primary_key.columns]
        batch: list[dict] = []
        n = 0
        with zf.open(f"tables/{table.name}.jsonl") as f:
            for line in f:
                raw = json.loads(line)
                row = {k: decode[k](v) for k, v in raw.items() if k in decode}
                fill = {c: row[c] for c in later_cols if row.get(c) is not None}
                if fill:
                    deferred.append((table, pk, {**{k: row[k] for k in pk}, **{f"__set_{c}": v for c, v in fill.items()}}))
                    for c in fill:
                        row[c] = None
                batch.append(row)
                n += 1
                if len(batch) >= BATCH:
                    conn.execute(table.insert(), batch)
                    batch = []
        if batch:
            conn.execute(table.insert(), batch)
        counts[table.name] = n
        done.add(table.name)
    for table, pk, values in deferred:
        sets = {k[len("__set_"):]: v for k, v in values.items() if k.startswith("__set_")}
        where = [table.c[k] == values[k] for k in pk]
        conn.execute(table.update().where(*where).values(**sets))
    return counts


def default_files_dir() -> str:
    from app.config import settings

    path = Path(settings.reference_files_dir)
    return str(path if path.is_absolute() else (BACKEND_DIR / path))


def app_version() -> str:
    try:
        from app.main import app

        return app.version
    except Exception:  # noqa: BLE001
        return os.environ.get("RMT_VERSION", "")
