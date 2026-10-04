import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.models.comment import ItemComment
from app.models.document import Document
from app.models.item import Item
from app.models.user import User
from app.schemas.comment import CommentCreate, CommentRead, CommentUpdate
from app.services import email as mail
from app.services.mentions import extract_mentioned_users
from app.services.permissions import can_read, has_role_at_least

router = APIRouter(tags=["comments"])


def _to_read(comment: ItemComment, replies: list[ItemComment] | None = None) -> CommentRead:
    return CommentRead(
        id=comment.id,
        item_id=comment.item_id,
        parent_comment_id=comment.parent_comment_id,
        author_id=comment.author_id,
        author_name=comment.author.display_name,
        body=comment.body,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        resolved=comment.resolved,
        resolved_by=comment.resolved_by.display_name if comment.resolved_by else None,
        resolved_at=comment.resolved_at,
        suggestion_id=comment.suggestion_id,
        replies=[_to_read(r) for r in sorted(replies or [], key=lambda c: c.created_at)],
    )


def _threads(all_comments: list[ItemComment]) -> list[CommentRead]:
    by_parent: dict[uuid.UUID | None, list[ItemComment]] = {}
    for c in all_comments:
        by_parent.setdefault(c.parent_comment_id, []).append(c)
    top_level = sorted(by_parent.get(None, []), key=lambda c: c.created_at)
    return [_to_read(c, by_parent.get(c.id, [])) for c in top_level]


def _item_or_404(db: Session, item_id: uuid.UUID) -> Item:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    return item


def _require_item_read(db: Session, item: Item, user: User | None) -> None:
    if not can_read(db, item.document.project, user.id if user else None):
        raise HTTPException(404, "Item not found")


@router.get("/documents/{document_id}/comments", response_model=list[CommentRead])
def list_document_comments(
    document_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All comment threads for every item in a document, in one round trip —
    Document View needs a per-item comment indicator for every visible item
    at once, and firing one /items/{id}/comments request per item would mean
    dozens of requests just to render the page."""
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    if not can_read(db, document.project, user.id if user else None):
        raise HTTPException(404, "Document not found")

    all_comments = (
        db.query(ItemComment)
        .join(Item, ItemComment.item_id == Item.id)
        .filter(Item.document_id == document_id, ItemComment.suggestion_id.is_(None))
        .all()
    )
    return _threads(all_comments)


@router.get("/items/{item_id}/comments", response_model=list[CommentRead])
def list_comments(
    item_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _item_or_404(db, item_id)
    _require_item_read(db, item, user)

    all_comments = (
        db.query(ItemComment)
        .filter(ItemComment.item_id == item_id, ItemComment.suggestion_id.is_(None))
        .all()
    )
    return _threads(all_comments)


@router.post("/items/{item_id}/comments", response_model=CommentRead, status_code=201)
def create_comment(
    item_id: uuid.UUID,
    payload: CommentCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item = _item_or_404(db, item_id)
    _require_item_read(db, item, user)

    if not payload.body.strip():
        raise HTTPException(422, "Comment body can't be empty.")

    suggestion_id = payload.suggestion_id
    if payload.parent_comment_id:
        parent = db.get(ItemComment, payload.parent_comment_id)
        if not parent or parent.item_id != item_id:
            raise HTTPException(404, "Parent comment not found on this item.")
        if parent.parent_comment_id is not None:
            raise HTTPException(422, "Replies can't themselves be replied to — reply on the thread's first comment.")
        suggestion_id = parent.suggestion_id
    if suggestion_id is not None:
        from app.models.suggestion import Suggestion

        suggestion = db.get(Suggestion, suggestion_id)
        if not suggestion or suggestion.item_id != item_id:
            raise HTTPException(404, "Suggestion not found on this item.")

    comment = ItemComment(
        item_id=item_id,
        parent_comment_id=payload.parent_comment_id,
        suggestion_id=suggestion_id,
        author_id=user.id,
        body=payload.body.strip(),
    )
    db.add(comment)
    db.flush()
    mentioned = _notify_mentions(db, item, comment, user)
    _notify_watchers(db, item, comment, user, exclude={u.id for u in mentioned})
    db.commit()
    db.refresh(comment)
    return _to_read(comment)


def _notify_watchers(db: Session, item: Item, comment: ItemComment, author: User, exclude: set) -> None:
    """New comment/reply → the item's (or suggestion's) watchers and everyone
    already in the thread. Commenting makes the author a watcher."""
    from app.services.notifications import item_route, notify, watch, watchers

    if comment.suggestion_id:
        subject_type, subject_id = "suggestion", comment.suggestion_id
    else:
        subject_type, subject_id = "item", item.id
    watch(db, author, subject_type, subject_id)
    thread_root = comment.parent_comment_id or comment.id
    participants = (
        db.query(User)
        .join(ItemComment, ItemComment.author_id == User.id)
        .filter((ItemComment.id == thread_root) | (ItemComment.parent_comment_id == thread_root))
        .all()
    )
    recipients = [u for u in watchers(db, subject_type, subject_id) + participants if u.id not in exclude]
    label = item.key or item.title[:40]
    verb = "replied" if comment.parent_comment_id else "commented"
    notify(
        db,
        recipients,
        kind="comment.reply" if comment.parent_comment_id else "comment.new",
        title=f"{author.display_name} {verb} on {label}",
        body=comment.body[:500],
        url=item_route(item.document.project_id, item.document_id, item.id) + f"&comment={thread_root}",
        actor=author,
        subject_type=subject_type,
        subject_id=subject_id,
        badge="Comment",
    )


def _notify_mentions(db: Session, item: Item, comment: ItemComment, author: User) -> list[User]:
    from app.services.notifications import item_route, notify

    project = item.document.project
    mentioned = extract_mentioned_users(db, project.org_id, comment.body, exclude_user_id=author.id)
    # In-app entry for every mention; the email below keeps its dedicated
    # "you were mentioned" template.
    notify(
        db,
        mentioned,
        kind="comment.mention",
        title=f"{author.display_name} mentioned you on {item.key or item.title[:40]}",
        body=comment.body[:500],
        url=item_route(project.id, item.document_id, item.id) + f"&comment={comment.parent_comment_id or comment.id}",
        actor=author,
        subject_type="item",
        subject_id=item.id,
        email=False,
    )
    emails = [u.email for u in mentioned if u.email]
    if not emails:
        return mentioned
    html = mail.render_mention_email(
        item_key=item.key or str(item.id)[:8],
        item_title=item.title,
        project_name=project.name,
        document_name=item.document.name,
        author_name=author.display_name,
        comment_body=comment.body,
        url=mail.item_url(item.document.project_id, item.document_id, item.id),
    )
    mail.send_email(emails, f"[RMT] {author.display_name} mentioned you on {item.key or item.title}", html)
    return mentioned


def _load_comment(db: Session, comment_id: uuid.UUID) -> ItemComment:
    comment = db.get(ItemComment, comment_id)
    if not comment:
        raise HTTPException(404, "Comment not found")
    return comment


@router.patch("/comments/{comment_id}", response_model=CommentRead)
def update_comment(
    comment_id: uuid.UUID,
    payload: CommentUpdate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    comment = _load_comment(db, comment_id)
    if comment.author_id != user.id:
        raise HTTPException(403, "You can only edit your own comments.")
    if not payload.body.strip():
        raise HTTPException(422, "Comment body can't be empty.")
    comment.body = payload.body.strip()
    db.commit()
    db.refresh(comment)
    replies = comment.replies if comment.parent_comment_id is None else None
    return _to_read(comment, replies)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: uuid.UUID,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    comment = _load_comment(db, comment_id)
    is_own = comment.author_id == user.id
    if not is_own and not has_role_at_least(db, comment.item.document.project_id, user.id, "editor"):
        raise HTTPException(403, "You can only delete your own comments (or need an editor role).")
    db.delete(comment)
    db.commit()


@router.post("/comments/{comment_id}/resolve", response_model=CommentRead)
def resolve_comment(
    comment_id: uuid.UUID,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    comment = _load_comment(db, comment_id)
    if comment.parent_comment_id is not None:
        raise HTTPException(422, "Only the thread's first comment can be resolved — resolve that one instead.")
    if not (
        comment.author_id == user.id
        or has_role_at_least(db, comment.item.document.project_id, user.id, "editor")
    ):
        raise HTTPException(403, "Only the thread's author or an editor can resolve it.")
    comment.resolved = True
    comment.resolved_by_id = user.id
    comment.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    return _to_read(comment, comment.replies)


@router.post("/comments/{comment_id}/reopen", response_model=CommentRead)
def reopen_comment(
    comment_id: uuid.UUID,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    comment = _load_comment(db, comment_id)
    if comment.parent_comment_id is not None:
        raise HTTPException(422, "Only the thread's first comment can be reopened.")
    if not (
        comment.author_id == user.id
        or has_role_at_least(db, comment.item.document.project_id, user.id, "editor")
    ):
        raise HTTPException(403, "Only the thread's author or an editor can reopen it.")
    comment.resolved = False
    comment.resolved_by_id = None
    comment.resolved_at = None
    db.commit()
    db.refresh(comment)
    return _to_read(comment, comment.replies)
