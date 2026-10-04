from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_user
from app.models.organization import Organization
from app.models.user import User
from app.schemas.user import LoginRequest, TokenResponse, UserRead
from app.services.auth import AuthError, authenticate, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        profile = authenticate(payload.username, payload.password)
    except AuthError as e:
        raise HTTPException(401, str(e))

    user = db.query(User).filter(User.username == profile.username).first()
    if user is None:
        # First LDAP-confirmed login provisions the local user row (§13.1) —
        # there's only one seeded org today, so a brand-new user lands there.
        org = db.query(Organization).first()
        if not org:
            raise HTTPException(500, "No organization exists to attach this user to.")
        user = User(
            org_id=org.id,
            username=profile.username,
            display_name=profile.display_name,
            email=profile.email,
            ldap_dn=profile.dn,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif profile.display_name != user.username or profile.email:
        user.display_name = profile.display_name
        user.email = profile.email
        db.commit()

    token = create_access_token(user.id, user.username)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(require_user)):
    return user
