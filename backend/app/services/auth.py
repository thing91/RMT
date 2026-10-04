"""§13.1: LDAP bind-auth (identity confirmed by binding as the user — no
password ever stored) plus a JWT session issued after a successful bind.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from ldap3 import ALL, Connection, Server
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from app.config import settings


class AuthError(ValueError):
    pass


class LdapProfile:
    def __init__(self, username: str, display_name: str, email: str | None, dn: str | None):
        self.username = username
        self.display_name = display_name
        self.email = email
        self.dn = dn


def authenticate(username: str, password: str) -> LdapProfile:
    if not username or not password:
        raise AuthError("Username and password are required.")

    if not settings.ldap_url:
        if not settings.dev_auth_fallback:
            raise AuthError("No LDAP server configured and dev fallback is disabled.")
        # Dev-only stand-in for a real directory (§13.1) — never used when
        # ldap_url is set.
        return LdapProfile(username=username, display_name=username, email=None, dn=None)

    try:
        server = Server(settings.ldap_url, get_info=ALL, connect_timeout=5)

        if settings.ldap_base_dn:
            return _authenticate_search_and_bind(server, username, password)
        return _authenticate_fixed_template(server, username, password)
    except LDAPException as e:
        raise AuthError("Invalid username or password.") from e


def _read_profile(entry, username: str, dn: str) -> LdapProfile:
    display_name = str(entry.displayName) if entry and "displayName" in entry and entry.displayName else username
    email = str(entry.mail) if entry and "mail" in entry and entry.mail else None
    return LdapProfile(username=username, display_name=display_name, email=email, dn=dn)


def _authenticate_fixed_template(server: Server, username: str, password: str) -> LdapProfile:
    dn = settings.ldap_user_dn_template.format(username=username)
    conn = Connection(server, user=dn, password=password, auto_bind=True, receive_timeout=5)
    conn.search(dn, "(objectClass=*)", attributes=["displayName", "mail", "cn"])
    entry = conn.entries[0] if conn.entries else None
    profile = _read_profile(entry, username, dn)
    conn.unbind()
    return profile


def _authenticate_search_and_bind(server: Server, username: str, password: str) -> LdapProfile:
    """Binds a service account (or anonymously, if none is configured),
    looks up the user's real DN by search filter, then binds again *as that
    DN* with the supplied password — the only way to authenticate correctly
    against a directory where users aren't all under one predictable OU
    (Active Directory in particular)."""
    search_conn = Connection(
        server,
        user=settings.ldap_bind_dn or None,
        password=settings.ldap_bind_password or None,
        auto_bind=True,
        receive_timeout=5,
    )
    search_filter = settings.ldap_user_search_filter.format(username=escape_filter_chars(username))
    search_conn.search(settings.ldap_base_dn, search_filter, attributes=["displayName", "mail", "cn"])
    if not search_conn.entries:
        search_conn.unbind()
        raise AuthError("Invalid username or password.")
    entry = search_conn.entries[0]
    dn = entry.entry_dn
    search_conn.unbind()

    conn = Connection(server, user=dn, password=password, auto_bind=True, receive_timeout=5)
    profile = _read_profile(entry, username, dn)
    conn.unbind()
    return profile


def create_access_token(user_id: uuid.UUID, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as e:
        raise AuthError("Invalid or expired session.") from e
