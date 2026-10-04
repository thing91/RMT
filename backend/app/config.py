from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://rmt:rmt@localhost:5432/rmt_kna"
    cors_origins: list[str] = ["http://localhost:5173"]

    # §13.1: LDAP bind-auth. Empty ldap_url means no LDAP server is
    # configured — falls back to a dev-only mode (any username + any
    # non-empty password succeeds) so the rest of the auth/roles flow can be
    # exercised without standing up a real directory. Never enable
    # dev_auth_fallback in production.
    ldap_url: str = ""

    # Two ways to find the user's DN once ldap_url is set:
    #  1. Search-and-bind (set ldap_base_dn) — binds a service account
    #     (ldap_bind_dn/ldap_bind_password, or anonymous if both are blank),
    #     searches ldap_base_dn with ldap_user_search_filter, then binds
    #     again as the DN it finds to verify the password. Works with real
    #     directories (Active Directory included) where users live under
    #     different OUs, not one predictable path.
    #  2. Fixed template (ldap_user_dn_template, used only when ldap_base_dn
    #     is blank) — binds directly at that formatted DN. Simpler, but only
    #     correct when every user's DN follows the exact same pattern.
    ldap_base_dn: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    # OpenLDAP default; Active Directory typically wants
    # "(sAMAccountName={username})" or "(userPrincipalName={username})".
    ldap_user_search_filter: str = "(uid={username})"
    ldap_user_dn_template: str = "uid={username},ou=people,dc=example,dc=com"
    dev_auth_fallback: bool = True

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 600  # §13.1: "reasonable expiry (8-12h)"

    # §7: each project gets a local git repo under this root, one YAML file
    # per item. No remote push/webhook receiver yet — see README — this is
    # the local half of the hybrid model (DB is still the source of truth).
    git_repo_root: str = "./git_sync_repos"
    git_sync_enabled: bool = True

    # Edit locks (wymagania-wspolbieznosc-i-workflow.md §1): a lock is a
    # lease — it expires unless the client keeps sending heartbeats, so a
    # closed tab or dropped connection can never leave an orphaned lock.
    edit_lock_timeout_minutes: int = 10
    # Structure operations (move/indent/reorder) take an implicit, short
    # structure lease on the document instead of an explicit lock — long
    # enough to cover a burst of toolbar clicks, short enough not to block
    # anyone noticeably once the user stops.
    structure_lock_implicit_seconds: int = 90

    # §workflow notifications: empty smtp_host means no mail server is
    # configured — falls back to writing each email as a .html file under
    # `mail_outbox_dir` instead of failing, same dev-fallback spirit as LDAP
    # above, so the whole review/approve flow is exercisable without a real
    # mail server.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    mail_from: str = "rmt-kna@example.com"
    mail_outbox_dir: str = "./mail_outbox"
    # Used to build links back into the app from email bodies.
    app_base_url: str = "http://localhost:5173"

    # §5.4: uploaded standard/reference-document PDFs — local disk, no S3
    # (the brief's `file_ref` is a generic "pointer to the stored file";
    # this build's pointer is just a filename under this directory).
    reference_files_dir: str = "./reference_files"


settings = Settings()
