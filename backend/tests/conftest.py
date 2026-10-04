"""Test harness: runs the real app against the dev PostgreSQL database but
inside a dedicated `rmt_test` schema (the DB user can't create databases),
recreated once per session and truncated between tests.

Git sync is disabled and mail goes to a temp outbox.
"""

import os
import tempfile
import uuid

os.environ["GIT_SYNC_ENABLED"] = "false"
os.environ["MAIL_OUTBOX_DIR"] = tempfile.mkdtemp(prefix="rmt-mail-")
os.environ["SMTP_HOST"] = ""
os.environ["DEV_AUTH_FALLBACK"] = "true"
os.environ["LDAP_URL"] = ""
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402,F401
from app.config import settings  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

SCHEMA = "rmt_test"

engine = create_engine(
    settings.database_url, connect_args={"options": f"-csearch_path={SCHEMA}"}, pool_pre_ping=True
)
TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    with engine.begin() as c:
        c.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        c.execute(text(f"CREATE SCHEMA {SCHEMA}"))
    Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def _clean():
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as c:
        c.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db():
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


def _override_get_db():
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture
def client():
    return TestClient(app)


class World:
    """Small factory for a ready-to-use org/project/document/users setup."""

    def __init__(self, db, client):
        from app.models.document import Document
        from app.models.item_type import ItemType, ItemTypeAttribute
        from app.models.link import LinkType
        from app.models.organization import Organization
        from app.models.project import Project
        from app.services.bootstrap import ensure_default_workflows

        self.db = db
        self.client = client
        self.org = Organization(name=f"Org {uuid.uuid4().hex[:6]}")
        db.add(self.org)
        db.flush()
        self.section = ItemType(org_id=self.org.id, key="section", name="Section", behavior="structural")
        self.req = ItemType(org_id=self.org.id, key="requirement", name="Requirement", prefix="SYS-")
        self.va = ItemType(org_id=self.org.id, key="verification_activity", name="Verification", prefix="VA-")
        db.add_all([self.section, self.req, self.va])
        db.flush()
        db.add_all(
            [
                ItemTypeAttribute(item_type_id=self.req.id, key="owner", label="Owner", data_type="user_ref", order=1),
                ItemTypeAttribute(
                    item_type_id=self.va.id, key="result", label="Result", data_type="enum", order=1,
                    enum_options=[{"value": v, "label": v, "deprecated": False} for v in ("pass", "fail", "pending")],
                ),
            ]
        )
        self.verifies = LinkType(
            org_id=self.org.id, key="verifies", name="Verifies", inverse_name="Verified by",
            allowed_source_types=[], allowed_target_types=[],
        )
        db.add(self.verifies)
        self.project = Project(org_id=self.org.id, name="P", visibility="private")
        db.add(self.project)
        db.flush()
        self.doc = Document(project_id=self.project.id, name="SRS", order=0)
        db.add(self.doc)
        db.flush()
        ensure_default_workflows(db, self.org)
        db.commit()
        self.users = {}

    def user(self, username: str, role: str | None = None, org_admin: bool = False):
        from app.models.project_access import ProjectAccess
        from app.models.user import User

        u = User(
            org_id=self.org.id, username=username, display_name=username.title(),
            email=f"{username}@example.com", org_role="admin" if org_admin else None,
        )
        self.db.add(u)
        self.db.flush()
        if role:
            self.db.add(ProjectAccess(project_id=self.project.id, subject_type="user", subject_id=u.id, role=role))
        self.db.commit()
        self.users[username] = u
        return u

    def h(self, username: str, **extra) -> dict:
        from app.services.auth import create_access_token

        u = self.users[username]
        return {"Authorization": f"Bearer {create_access_token(u.id, u.username)}", **extra}

    def create_item(self, username: str, title="Req", type_=None, **kw):
        r = self.client.post(
            f"/api/v1/documents/{self.doc.id}/items",
            json={"title": title, "item_type_id": str((type_ or self.req).id), **kw},
            headers=self.h(username),
        )
        assert r.status_code == 201, r.text
        return r.json()

    def patch(self, username: str, item: dict, etag: str | None = None, **body):
        headers = self.h(username)
        if etag is not False:
            headers["If-Match"] = etag or item["etag"]
        return self.client.patch(f"/api/v1/items/{item['id']}", json=body, headers=headers)

    def transition(self, username: str, item: dict, key: str, **body):
        r = self.client.get(f"/api/v1/items/{item['id']}", headers=self.h(username))
        etag = r.headers["ETag"]
        return self.client.post(
            f"/api/v1/items/{item['id']}/transitions/{key}",
            json=body,
            headers=self.h(username, **{"If-Match": etag}),
        )

    def assign(self, document_role: str, username: str):
        from app.models.workflow import DocumentWorkflowRole

        self.db.add(DocumentWorkflowRole(document_id=self.doc.id, user_id=self.users[username].id, role=document_role))
        self.db.commit()


@pytest.fixture
def world(db, client):
    return World(db, client)
