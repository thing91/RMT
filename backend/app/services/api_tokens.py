"""Personal API tokens: `rmt_` + 43 random URL-safe characters. Only the
SHA-256 is stored; the plain token is returned once, at creation."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.api_token import ApiToken
from app.models.user import User

API_TOKEN_PREFIX = "rmt_"
# Refresh last_used_at at most this often, so heavy API use doesn't turn
# every request into a write.
_TOUCH_EVERY = timedelta(minutes=5)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_token(db: Session, user: User, name: str, expires_in_days: int | None) -> tuple[ApiToken, str]:
    plain = API_TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = ApiToken(
        user_id=user.id,
        name=name,
        token_hash=hash_token(plain),
        prefix=plain[:10],
        expires_at=datetime.now(timezone.utc) + timedelta(days=expires_in_days) if expires_in_days else None,
    )
    db.add(row)
    db.flush()
    return row, plain


def user_for_api_token(db: Session, token: str) -> User | None:
    row = db.query(ApiToken).filter(ApiToken.token_hash == hash_token(token)).first()
    now = datetime.now(timezone.utc)
    if row is None or row.revoked_at is not None or (row.expires_at is not None and row.expires_at <= now):
        return None
    if row.last_used_at is None or now - row.last_used_at > _TOUCH_EVERY:
        row.last_used_at = now
        db.commit()
    return db.get(User, row.user_id)
