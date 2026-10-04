"""@username mentions inside a comment body (§ user request, not in the
original brief) — plain regex extraction against the org directory, same
"no real user picker, just match the free-text token" spirit as user_ref
attributes (app/schemas/item.py)."""

import re
import uuid

from sqlalchemy.orm import Session

from app.models.user import User

MENTION_PATTERN = re.compile(r"@([A-Za-z0-9_.-]+)")


def extract_mentioned_users(
    db: Session,
    org_id: uuid.UUID,
    body: str,
    exclude_user_id: uuid.UUID | None = None,
) -> list[User]:
    usernames = {m.lower() for m in MENTION_PATTERN.findall(body)}
    if not usernames:
        return []
    candidates = db.query(User).filter(User.org_id == org_id).all()
    seen: set[uuid.UUID] = set()
    matched: list[User] = []
    for u in candidates:
        if u.username.lower() not in usernames or u.id == exclude_user_id or u.id in seen:
            continue
        seen.add(u.id)
        matched.append(u)
    return matched
