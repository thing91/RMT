"""§7: hybrid Git sync — Postgres stays the operational source of truth;
each item is mirrored to one YAML file in a local git repo per project, so
the change history stays readable and diffable in Git.

Deliberately local-only for now: no push to a GitLab remote and no webhook
receiver for the reverse direction (Git -> DB). Both need a real GitLab
instance to test against — see README. Every call here is best-effort: a
git failure is logged, never raised, so it can never block the API request
that triggered it (the DB write already succeeded by the time this runs).
"""

import logging
import re
import subprocess
from pathlib import Path

import yaml
from sqlalchemy.orm import Session

from app.config import settings
from app.models.item import Item
from app.models.link import Link, LinkType
from app.models.project import Project

logger = logging.getLogger("rmt.git_sync")


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_") or "untitled"


def _run_git(repo_path: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo_path), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _ensure_repo(project_id) -> Path:
    repo_path = Path(settings.git_repo_root) / str(project_id)
    repo_path.mkdir(parents=True, exist_ok=True)
    if not (repo_path / ".git").exists():
        _run_git(repo_path, "init")
        _run_git(repo_path, "config", "user.email", "rmt-sync@local")
        _run_git(repo_path, "config", "user.name", "RMT Sync Bot")
    return repo_path


def _slug_for(key: str | None, item_id) -> str:
    return key or f"item-{str(item_id)[:8]}"


def _item_slug(item: Item) -> str:
    return _slug_for(item.key, item.id)


def _file_for_slug(repo_path: Path, document_name: str, slug: str) -> Path:
    return repo_path / _slug(document_name) / f"{slug}.yaml"


def _serialize(db: Session, item: Item) -> dict:
    links = (
        db.query(Link, LinkType)
        .join(LinkType, Link.link_type_id == LinkType.id)
        .filter(Link.source_item_id == item.id)
        .all()
    )
    parent = db.get(Item, item.parent_id) if item.parent_id else None

    data = {
        "key": item.key,
        "item_type": item.item_type.key,
        "title": item.title,
        "updated_at": item.updated_at.isoformat(),
    }
    if item.description_md:
        data["description_md"] = item.description_md
    if item.attributes:
        data["attributes"] = item.attributes
    if links:
        data["links"] = [
            {"target": _item_slug(target), "type": link_type.key}
            for link, link_type in links
            for target in [db.get(Item, link.target_item_id)]
            if target
        ]
    if parent:
        data["parent"] = _item_slug(parent)
    return data


def sync_item(db: Session, project: Project, item: Item) -> None:
    if not settings.git_sync_enabled:
        return
    try:
        repo_path = _ensure_repo(project.id)
        file_path = _file_for_slug(repo_path, item.document.name, _item_slug(item))
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(
            yaml.safe_dump(_serialize(db, item), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        rel = file_path.relative_to(repo_path)
        _run_git(repo_path, "add", str(rel))
        _run_git(repo_path, "commit", "-m", f"sync: {_item_slug(item)} ({item.title[:60]})")
    except Exception:
        logger.exception("Git sync failed for item %s", item.id)


def sync_item_delete(project: Project, document_name: str, item_key: str | None, item_id) -> None:
    if not settings.git_sync_enabled:
        return
    slug = _slug_for(item_key, item_id)
    try:
        repo_path = _ensure_repo(project.id)
        file_path = _file_for_slug(repo_path, document_name, slug)
        if not file_path.exists():
            return
        rel = file_path.relative_to(repo_path)
        file_path.unlink()
        _run_git(repo_path, "add", str(rel))
        _run_git(repo_path, "commit", "-m", f"sync: delete {slug}")
    except Exception:
        logger.exception("Git sync delete failed for item %s", item_id)


def repo_log(project_id) -> list[dict]:
    repo_path = Path(settings.git_repo_root) / str(project_id)
    if not (repo_path / ".git").exists():
        return []
    result = subprocess.run(
        ["git", "-C", str(repo_path), "log", "--format=%H|%ad|%s", "--date=iso-strict", "-n", "50"],
        capture_output=True,
        text=True,
    )
    commits = []
    for line in result.stdout.strip().splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            commits.append({"sha": parts[0], "date": parts[1], "message": parts[2]})
    return commits
