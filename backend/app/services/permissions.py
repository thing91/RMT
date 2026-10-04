"""§13.2: effective project role = union of direct user grants and group
grants; the most permissive applicable role wins.

§13.3/13.4: visibility gates anonymous/non-member *read* access; every
*write* (even on a public project) still requires an explicit role.

Fine-grained permissions (wymagania-wspolbieznosc-i-workflow.md): every
role maps to a set of named permissions (`lock.override`,
`suggestion.resolve`, ...). The defaults live in ROLE_DEFAULT_PERMISSIONS;
an organization can grant or revoke individual permissions per role via
`role_permissions` rows without touching code. An org admin
(`users.org_role == "admin"`) is treated as a project admin everywhere in
their organization and additionally holds the org-level permissions.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.permission import RolePermission
from app.models.project import Project
from app.models.project_access import ROLE_RANK, ProjectAccess
from app.models.user import GroupMember, User

# Project-scoped permissions.
PROJECT_PERMISSIONS = (
    "item.edit",  # edit item content (title, description, attributes)
    "structure.edit",  # reorder/move/indent items within a document
    "workflow.transition",  # run ordinary workflow transitions (per-transition roles still apply)
    "review.manage",  # create/close reviews
    "baseline.create",
    "audit.read",
    "lock.override",  # release/take over someone else's edit lock
    "suggestion.resolve",  # accept/reject change suggestions
    "applicability.decide",  # set an applicability status on a library record
    "applicability.approve",  # approve "Not applicable" decisions
    "workflow.configure",  # override the org workflow for this project
    "project.admin",  # manage access grants etc.
)

# Organization-scoped permissions — only ever held by org admins (or via an
# explicit role_permissions grant to the pseudo-role "org_member").
ORG_PERMISSIONS = (
    "org.admin",
    "roadmap.manage",
    "library.release",
    "workflow.configure_org",
)

ALL_PERMISSIONS = PROJECT_PERMISSIONS + ORG_PERMISSIONS

_VIEWER: frozenset[str] = frozenset()
_REVIEWER = _VIEWER | {"audit.read"}
_EDITOR = _REVIEWER | {
    "item.edit",
    "structure.edit",
    "workflow.transition",
    "review.manage",
    "baseline.create",
    "applicability.decide",
}
_ADMIN = frozenset(PROJECT_PERMISSIONS)

ROLE_DEFAULT_PERMISSIONS: dict[str, frozenset[str]] = {
    "viewer": frozenset(_VIEWER),
    "reviewer": frozenset(_REVIEWER),
    "editor": frozenset(_EDITOR),
    "admin": _ADMIN,
}

ORG_ADMIN_ROLE = "admin"


def is_org_admin(user: User | None) -> bool:
    return bool(user and user.org_role == ORG_ADMIN_ROLE)


def _project_org_id(db: Session, project_id: uuid.UUID) -> uuid.UUID | None:
    return db.query(Project.org_id).filter(Project.id == project_id).scalar()


def get_effective_role(db: Session, project_id: uuid.UUID, user_id: uuid.UUID | None) -> str | None:
    if user_id is None:
        return None

    user = db.get(User, user_id)
    if is_org_admin(user) and user.org_id == _project_org_id(db, project_id):
        return "admin"

    group_ids = [
        row[0]
        for row in db.query(GroupMember.group_id).filter(GroupMember.user_id == user_id).all()
    ]

    query = db.query(ProjectAccess).filter(ProjectAccess.project_id == project_id)
    grants = [
        g
        for g in query.all()
        if (g.subject_type == "user" and g.subject_id == user_id)
        or (g.subject_type == "group" and g.subject_id in group_ids)
    ]
    if not grants:
        return None
    return min((g.role for g in grants), key=lambda r: ROLE_RANK[r])


def can_read(db: Session, project: Project, user_id: uuid.UUID | None) -> bool:
    if project.visibility == "public":
        return True
    if project.kind == "library" and user_id is not None:
        # A generic requirements library is an org-wide asset: every member
        # of the organization may read (and import) it; writing still needs
        # an explicit role on the library project.
        user = db.get(User, user_id)
        if user is not None and user.org_id == project.org_id:
            return True
    return get_effective_role(db, project.id, user_id) is not None


def has_role_at_least(
    db: Session, project_id: uuid.UUID, user_id: uuid.UUID | None, min_role: str
) -> bool:
    role = get_effective_role(db, project_id, user_id)
    if role is None:
        return False
    return ROLE_RANK[role] <= ROLE_RANK[min_role]


def permissions_for_role(db: Session, org_id: uuid.UUID, role: str) -> set[str]:
    perms = set(ROLE_DEFAULT_PERMISSIONS.get(role, frozenset()))
    overrides = (
        db.query(RolePermission)
        .filter(RolePermission.org_id == org_id, RolePermission.role == role)
        .all()
    )
    for o in overrides:
        if o.granted:
            perms.add(o.permission)
        else:
            perms.discard(o.permission)
    return perms


def project_permissions(db: Session, project_id: uuid.UUID, user: User | None) -> set[str]:
    if user is None:
        return set()
    org_id = _project_org_id(db, project_id)
    if org_id is None:
        return set()
    perms: set[str] = set()
    if is_org_admin(user) and user.org_id == org_id:
        perms |= set(ALL_PERMISSIONS)
    role = get_effective_role(db, project_id, user.id)
    if role:
        perms |= permissions_for_role(db, org_id, role)
    return perms


def has_permission(db: Session, project_id: uuid.UUID, user: User | None, permission: str) -> bool:
    return permission in project_permissions(db, project_id, user)


def org_permissions(db: Session, user: User | None) -> set[str]:
    if user is None:
        return set()
    if is_org_admin(user):
        return set(ORG_PERMISSIONS)
    # "org_member" is a pseudo-role: grants to it apply to every logged-in
    # user of the org (e.g. letting all members manage the roadmap).
    return {p for p in permissions_for_role(db, user.org_id, "org_member") if p in ORG_PERMISSIONS}


def has_org_permission(db: Session, user: User | None, permission: str) -> bool:
    return permission in org_permissions(db, user)
