"""Whole-database export / import: round trip, safety, and moving data
from an older schema version forward."""

import io
import json
import uuid
import zipfile

import pytest
from sqlalchemy import create_engine, inspect, text

from app.config import settings
from app.services import dbdump
from tests.conftest import SCHEMA


def _schema_engine(name: str):
    base = create_engine(settings.database_url)
    with base.begin() as c:
        c.execute(text(f"DROP SCHEMA IF EXISTS {name} CASCADE"))
        c.execute(text(f"CREATE SCHEMA {name}"))
    base.dispose()
    return create_engine(settings.database_url, connect_args={"options": f"-csearch_path={name}"})


def _drop_schema(name: str):
    base = create_engine(settings.database_url)
    with base.begin() as c:
        c.execute(text(f"DROP SCHEMA IF EXISTS {name} CASCADE"))
    base.dispose()


@pytest.fixture
def source_engine():
    """The test schema itself, stamped with the current revision (the
    test harness builds it with create_all, not with migrations)."""
    eng = create_engine(settings.database_url, connect_args={"options": f"-csearch_path={SCHEMA}"})
    with eng.begin() as c:
        c.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num varchar(32) PRIMARY KEY)"))
        c.execute(text("DELETE FROM alembic_version"))
        c.execute(text("INSERT INTO alembic_version VALUES (:r)"), {"r": dbdump.head_revision()})
    yield eng
    with eng.begin() as c:
        c.execute(text("DROP TABLE IF EXISTS alembic_version"))
    eng.dispose()


def _populate(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    sec = world.create_item("ed", "General", type_=world.section)
    req = world.create_item("ed", "Mass ≤ 85 kg — ünïcode", parent_id=sec["id"], attributes={"owner": "ed"})
    va = world.create_item("ed", "Weigh it", type_=world.va)
    c = world.client
    c.post("/api/v1/links", json={"source_item_id": va["id"], "target_item_id": req["id"],
                                  "link_type_id": str(world.verifies.id)}, headers=world.h("ed"))
    # A comment turned into a suggestion: the comments ↔ suggestions cycle.
    comment = c.post(f"/api/v1/items/{req['id']}/comments", json={"body": "Should be 80?"}, headers=world.h("rev")).json()
    sug = c.post(f"/api/v1/comments/{comment['id']}/convert-to-suggestion",
                 json={"target_field": "title", "proposed_value": "Mass ≤ 80 kg"}, headers=world.h("rev"))
    assert sug.status_code == 201, sug.text
    r = c.post(f"/api/v1/items/{req['id']}/comments", json={"body": "Agreed", "suggestion_id": sug.json()["id"]},
               headers=world.h("ed"))
    assert r.status_code == 201, r.text
    return sec, req


def test_round_trip_keeps_every_row_and_value(world, source_engine, tmp_path):
    sec, req = _populate(world)
    files = tmp_path / "files"
    (files / "std").mkdir(parents=True)
    (files / "std" / "a.pdf").write_bytes(b"%PDF-1.4 test")
    dump = tmp_path / "dump.zip"
    manifest = dbdump.export_database(source_engine, dump, files)
    assert manifest["alembic_revision"] == dbdump.head_revision()
    assert manifest["tables"]["items"] == 3 and manifest["files"] == ["std/a.pdf"]

    target = _schema_engine("rmt_test_import")
    restored = tmp_path / "restored"
    try:
        result = dbdump.import_database(target, dump, restored)
        assert result["loaded"] == manifest["tables"]
        with target.connect() as c:
            row = c.execute(text("SELECT title, parent_id, attributes FROM items WHERE id = :i"),
                            {"i": uuid.UUID(req["id"])}).one()
            assert row.title == "Mass ≤ 85 kg — ünïcode"
            assert str(row.parent_id) == sec["id"] and row.attributes["owner"] == "ed"
            assert c.execute(text("SELECT count(*) FROM suggestions WHERE source_comment_id IS NOT NULL")).scalar() == 1
            assert c.execute(text("SELECT count(*) FROM item_comments WHERE suggestion_id IS NOT NULL")).scalar() == 1
            assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == dbdump.head_revision()
        assert (restored / "std" / "a.pdf").read_bytes() == b"%PDF-1.4 test"
    finally:
        target.dispose()
        _drop_schema("rmt_test_import")


def test_import_refuses_a_database_with_data_unless_replacing(world, source_engine, tmp_path):
    _populate(world)
    dump = tmp_path / "dump.zip"
    dbdump.export_database(source_engine, dump)
    target = _schema_engine("rmt_test_import")
    try:
        dbdump.import_database(target, dump)
        with pytest.raises(dbdump.DumpError, match="not empty"):
            dbdump.import_database(target, dump)
        result = dbdump.import_database(target, dump, replace=True)
        assert result["loaded"]["items"] == 3
    finally:
        target.dispose()
        _drop_schema("rmt_test_import")


def test_export_from_an_older_schema_is_migrated_forward(tmp_path):
    """An archive made by an older RMT (here: before document baselines,
    API tokens and record history) loads and ends up on the current schema."""
    old_revision = "f2ae39d02d1d"
    old = _schema_engine("rmt_test_old")
    target = _schema_engine("rmt_test_import")
    try:
        with old.begin() as c:
            dbdump._upgrade(c, old_revision)
            assert not inspect(c).has_table("record_changes")
            org_id, proj_id = uuid.uuid4(), uuid.uuid4()
            c.execute(text("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (:i, 'Old Org', now(), now())"),
                      {"i": org_id})
            c.execute(text("INSERT INTO projects (id, org_id, name, visibility, kind, default_branch, created_at, updated_at) "
                           "VALUES (:p, :o, 'Legacy', 'private', 'project', 'main', now(), now())"), {"p": proj_id, "o": org_id})
        dump = tmp_path / "old.zip"
        manifest = dbdump.export_database(old, dump)
        assert manifest["alembic_revision"] == old_revision

        dbdump.import_database(target, dump)
        with target.connect() as c:
            assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == dbdump.head_revision()
            assert c.execute(text("SELECT name FROM projects")).scalar() == "Legacy"
            assert "document_id" in {col["name"] for col in inspect(c).get_columns("baselines")}
            assert inspect(c).has_table("record_changes")
    finally:
        old.dispose()
        target.dispose()
        _drop_schema("rmt_test_old")
        _drop_schema("rmt_test_import")


def test_not_an_export_is_rejected(tmp_path):
    bad = tmp_path / "x.zip"
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("hello.txt", "hi")
    with pytest.raises(dbdump.DumpError):
        dbdump.read_manifest(bad)
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"format": "rmt-dump", "format_version": 99}))
    with pytest.raises(dbdump.DumpError, match="newer"):
        dbdump.read_manifest(bad)


def test_export_endpoint_is_for_org_admins(world, source_engine):
    world.user("ed", "editor")
    world.user("boss", "admin", org_admin=True)
    c = world.client
    assert c.get("/api/v1/admin/database/export", headers=world.h("ed")).status_code == 403
    r = c.get("/api/v1/admin/database/export", headers=world.h("boss"))
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    manifest = json.loads(zipfile.ZipFile(io.BytesIO(r.content)).read("manifest.json"))
    assert manifest["tables"]["users"] == 2

    r = c.post("/api/v1/admin/database/inspect", files={"file": ("d.zip", r.content, "application/zip")},
               headers=world.h("boss"))
    assert r.status_code == 200 and r.json()["tables"]["users"] == 2
    r = c.post("/api/v1/admin/database/import", files={"file": ("d.zip", b"x", "application/zip")},
               data={"confirm": "nope"}, headers=world.h("boss"))
    assert r.status_code == 422
