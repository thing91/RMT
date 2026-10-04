"""Seeds a default organization with the two system item types (§4.2),
a Section structural type, a sample project/document, and two link types
that demonstrate both ends of §4.6: one constrained, one free-form.

Run with: .venv/Scripts/python.exe -m app.seed
"""

from app import models  # noqa: F401
from app.database import Base, SessionLocal, engine
from app.models.document import Document
from app.models.item_type import ItemType, ItemTypeAttribute
from app.models.link import LinkType
from app.models.organization import Organization
from app.models.project import Project
from app.models.project_access import ProjectAccess
from app.models.user import User

PRIORITY_OPTIONS = [
    {"value": "low", "label": "Low", "deprecated": False},
    {"value": "medium", "label": "Medium", "deprecated": False},
    {"value": "high", "label": "High", "deprecated": False},
]
STATUS_OPTIONS = [
    {"value": "draft", "label": "Draft", "deprecated": False},
    {"value": "review", "label": "In Review", "deprecated": False, "notify_reviewers": True},
    {"value": "approved", "label": "Approved", "deprecated": False, "requires_approval": True},
]


def _ensure_admin_bootstrap(db, org: Organization) -> None:
    """Idempotent: safe to re-run against an already-seeded database (e.g.
    after adding the auth system to a database seeded before it existed).

    Creates a dev-mode-friendly "admin" user and grants them admin on every
    project in the org — otherwise, once writes require a role (§13.2),
    nobody could ever grant the first one.
    """
    admin = db.query(User).filter_by(username="admin").first()
    if not admin:
        admin = User(org_id=org.id, username="admin", display_name="Admin", email="admin@example.com")
        db.add(admin)
        db.flush()
        print(f"Created dev admin user (id={admin.id}); log in as 'admin' with any password.")
    elif not admin.email:
        admin.email = "admin@example.com"  # backfill so workflow email notifications have somewhere to go

    for project in db.query(Project).filter_by(org_id=org.id).all():
        has_grant = (
            db.query(ProjectAccess)
            .filter_by(project_id=project.id, subject_type="user", subject_id=admin.id)
            .first()
        )
        if not has_grant:
            db.add(
                ProjectAccess(
                    project_id=project.id, subject_type="user", subject_id=admin.id, role="admin"
                )
            )
    db.commit()


def run() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        org = db.query(Organization).filter_by(name="Demo Organization").first()
        if org:
            _ensure_admin_bootstrap(db, org)
            print(f"Already seeded (org_id={org.id}). Admin bootstrap ensured. Skipping the rest.")
            return

        org = Organization(name="Demo Organization")
        db.add(org)
        db.flush()

        section = ItemType(
            org_id=org.id, key="section", name="Section", prefix="",
            is_system=True, behavior="structural", icon="folder", color="#64748b",
        )
        requirement = ItemType(
            org_id=org.id, key="requirement", name="Requirement", prefix="SYS-",
            is_system=True, behavior="content", icon="file-text", color="#2563eb",
        )
        verification_activity = ItemType(
            org_id=org.id, key="verification_activity", name="Verification Activity",
            prefix="VA-", is_system=True, behavior="content", icon="check-circle",
            color="#16a34a",
        )
        db.add_all([section, requirement, verification_activity])
        db.flush()

        db.add_all(
            [
                ItemTypeAttribute(
                    item_type_id=requirement.id, key="status", label="Status",
                    data_type="enum", enum_options=STATUS_OPTIONS, required=True,
                    order=0, is_system=True,
                ),
                ItemTypeAttribute(
                    item_type_id=requirement.id, key="priority", label="Priority",
                    data_type="enum", enum_options=PRIORITY_OPTIONS, order=1,
                ),
                ItemTypeAttribute(
                    item_type_id=requirement.id, key="justification",
                    label="Justification", data_type="rich_text", order=2,
                ),
                ItemTypeAttribute(
                    item_type_id=requirement.id, key="owner", label="Owner",
                    data_type="user_ref", order=3,
                ),
                ItemTypeAttribute(
                    item_type_id=requirement.id, key="verification_method",
                    label="Verification Method", data_type="enum",
                    enum_options=[
                        {"value": "test", "label": "Test", "deprecated": False},
                        {"value": "analysis", "label": "Analysis", "deprecated": False},
                        {"value": "inspection", "label": "Inspection", "deprecated": False},
                        {"value": "demonstration", "label": "Demonstration", "deprecated": False},
                    ],
                    order=4,
                ),
                ItemTypeAttribute(
                    item_type_id=verification_activity.id, key="status", label="Status",
                    data_type="enum", enum_options=STATUS_OPTIONS, required=True,
                    order=0, is_system=True,
                ),
                ItemTypeAttribute(
                    item_type_id=verification_activity.id, key="test_method",
                    label="Test Method", data_type="text", order=1,
                ),
                ItemTypeAttribute(
                    item_type_id=verification_activity.id, key="result", label="Result",
                    data_type="enum",
                    enum_options=[
                        {"value": "pass", "label": "Pass", "deprecated": False},
                        {"value": "fail", "label": "Fail", "deprecated": False},
                        {"value": "pending", "label": "Pending", "deprecated": False},
                    ],
                    order=2,
                ),
                ItemTypeAttribute(
                    item_type_id=verification_activity.id, key="executed_date",
                    label="Executed Date", data_type="date", order=3,
                ),
            ]
        )

        # Constrained per §4.6 example from the brief: "verifies" must run
        # from Verification Activity -> Requirement, not the other way round.
        db.add(
            LinkType(
                org_id=org.id, key="verifies", name="Verifies", inverse_name="Verified by",
                allowed_source_types=[str(verification_activity.id)],
                allowed_target_types=[str(requirement.id)],
            )
        )
        # Free-form per §4.6: [] on both sides = any item type may use it.
        db.add(
            LinkType(
                org_id=org.id, key="derives_from", name="Derives from",
                inverse_name="Derived by", allowed_source_types=[], allowed_target_types=[],
            )
        )
        db.flush()

        # Public per §13.4 so the app is browsable read-only without logging
        # in; writes still require the admin-granted role below regardless.
        project = Project(org_id=org.id, name="Demo Project", visibility="public")
        db.add(project)
        db.flush()

        document = Document(project_id=project.id, name="System Requirements", order=0)
        db.add(document)
        db.flush()

        db.commit()
        print(f"Seeded organization {org.id}, project {project.id}, document {document.id}")

        _ensure_admin_bootstrap(db, org)
    finally:
        db.close()


if __name__ == "__main__":
    run()
