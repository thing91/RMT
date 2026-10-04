"""§workflow notifications (§ user request, not in the original brief).

Sends via SMTP when `settings.smtp_host` is configured; otherwise writes each
message as a standalone .html file under `settings.mail_outbox_dir` instead
of failing — same dev-fallback spirit as the LDAP auth path (app/config.py),
so the whole review/approve flow is exercisable without a real mail server.
"""

import smtplib
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

from app.config import settings

_CARD_TEMPLATE = """\
<div style="background:#f8fafc;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#1d4ed8;padding:18px 24px;">
      <span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:.02em;">RMT</span>
      <span style="color:#bfdbfe;font-size:13px;margin-left:8px;">Requirements Management Tool</span>
    </div>
    <div style="padding:24px;">
      <p style="display:inline-block;background:{badge_bg};color:{badge_fg};font-size:12px;font-weight:600;
                padding:3px 10px;border-radius:999px;margin:0 0 14px;text-transform:uppercase;letter-spacing:.03em;">
        {badge}
      </p>
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 10px;">{heading}</h1>
      <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 18px;">{intro}</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
        {details}
      </div>
      {action_html}
      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;line-height:1.5;">{footer}</p>
    </div>
  </div>
</div>
"""

_DETAIL_ROW = (
    '<p style="margin:0 0 6px;font-size:13px;color:#475569;">'
    '<span style="color:#94a3b8;">{label}:</span> <strong style="color:#0f172a;">{value}</strong></p>'
)

_ACTION_BUTTON = (
    '<p style="margin:0 0 4px;">'
    '<a href="{url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;'
    'font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">{label}</a></p>'
)


def _render(
    *,
    badge: str,
    badge_bg: str,
    badge_fg: str,
    heading: str,
    intro: str,
    details: dict[str, str],
    action_url: str | None,
    action_label: str = "Open in RMT",
    footer: str = "You're receiving this because of your role on this project/document in RMT.",
) -> str:
    details_html = "".join(_DETAIL_ROW.format(label=k, value=v) for k, v in details.items())
    action_html = _ACTION_BUTTON.format(url=action_url, label=action_label) if action_url else ""
    return _CARD_TEMPLATE.format(
        badge=badge,
        badge_bg=badge_bg,
        badge_fg=badge_fg,
        heading=heading,
        intro=intro,
        details=details_html,
        action_html=action_html,
        footer=footer,
    )


def item_url(project_id: uuid.UUID, document_id: uuid.UUID, item_id: uuid.UUID) -> str:
    return f"{settings.app_base_url}/projects/{project_id}/documents/{document_id}?item={item_id}"


def document_url(project_id: uuid.UUID, document_id: uuid.UUID) -> str:
    return f"{settings.app_base_url}/projects/{project_id}/documents/{document_id}"


def render_review_requested_email(
    *, item_key: str, item_title: str, project_name: str, document_name: str,
    status_label: str, changed_by: str, url: str,
) -> str:
    return _render(
        badge="Action needed",
        badge_bg="#fef3c7",
        badge_fg="#92400e",
        heading=f"Review requested: {item_key}",
        intro=(
            f'"{changed_by}" moved this item to <strong>{status_label}</strong> — '
            "it's waiting on you as an assigned reviewer or approver for this document."
        ),
        details={
            "Item": f"{item_key} — {item_title}",
            "Project": project_name,
            "Document": document_name,
            "New status": status_label,
            "Changed by": changed_by,
        },
        action_url=url,
        action_label="Review this item",
    )


def render_item_approved_email(
    *, item_key: str, item_title: str, project_name: str, document_name: str,
    status_label: str, approved_by: str, note: str | None, url: str,
) -> str:
    details = {
        "Item": f"{item_key} — {item_title}",
        "Project": project_name,
        "Document": document_name,
        "New status": status_label,
        "Approved by": approved_by,
    }
    intro = f'"{approved_by}" approved this item and moved it to <strong>{status_label}</strong>.'
    if note:
        intro += f' Note: "{note}"'
    return _render(
        badge="Approved",
        badge_bg="#dcfce7",
        badge_fg="#166534",
        heading=f"{item_key} was approved",
        intro=intro,
        details=details,
        action_url=url,
        action_label="View item",
    )


def render_document_approved_email(
    *, document_name: str, project_name: str, status_label: str, approved_by: str,
    approved_count: int, note: str | None, url: str,
) -> str:
    intro = (
        f'"{approved_by}" approved <strong>{approved_count}</strong> item(s) in this document, '
        f"moving them to <strong>{status_label}</strong>."
    )
    if note:
        intro += f' Note: "{note}"'
    return _render(
        badge="Document approved",
        badge_bg="#dcfce7",
        badge_fg="#166534",
        heading=f"{document_name} was approved",
        intro=intro,
        details={
            "Document": document_name,
            "Project": project_name,
            "Items approved": str(approved_count),
            "Approved by": approved_by,
        },
        action_url=url,
        action_label="Open document",
    )


def render_mention_email(
    *, item_key: str, item_title: str, project_name: str, document_name: str,
    author_name: str, comment_body: str, url: str,
) -> str:
    excerpt = comment_body if len(comment_body) <= 300 else comment_body[:300] + "…"
    return _render(
        badge="Mentioned",
        badge_bg="#e0e7ff",
        badge_fg="#3730a3",
        heading=f"{author_name} mentioned you on {item_key}",
        intro=f'"{author_name}" mentioned you in a comment on <strong>{item_key} — {item_title}</strong>.',
        details={
            "Item": f"{item_key} — {item_title}",
            "Project": project_name,
            "Document": document_name,
            "Comment": excerpt,
        },
        action_url=url,
        action_label="View comment",
        footer="You're receiving this because someone mentioned you by @username in a comment on RMT.",
    )


def render_generic_email(*, badge: str, heading: str, intro: str, url: str | None) -> str:
    """Used by app/services/notifications.py for every in-app notification
    that also goes out by email — one neutral card, no per-kind template."""
    from html import escape

    return _render(
        badge=escape(badge),
        badge_bg="#e0e7ff",
        badge_fg="#3730a3",
        heading=escape(heading),
        intro=escape(intro).replace("\n", "<br>"),
        details={},
        action_url=url,
        footer="You're receiving this because you watch this item or have a role on it in RMT.",
    )


def send_email(to: list[str], subject: str, html_body: str) -> None:
    to = [addr for addr in to if addr]
    if not to:
        return

    if not settings.smtp_host:
        _write_to_outbox(to, subject, html_body)
        return

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.mail_from
    msg["To"] = ", ".join(to)
    msg.set_content("This email requires an HTML-capable mail client.")
    msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)


def _write_to_outbox(to: list[str], subject: str, html_body: str) -> None:
    outbox = Path(settings.mail_outbox_dir)
    outbox.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    path = outbox / f"{stamp}_{uuid.uuid4().hex[:8]}.html"
    header = (
        f"<!-- To: {', '.join(to)} -->\n<!-- Subject: {subject} -->\n"
    )
    path.write_text(header + html_body, encoding="utf-8")
    print(f"[mail:dev-fallback] wrote {path} (To: {', '.join(to)} | Subject: {subject})")
