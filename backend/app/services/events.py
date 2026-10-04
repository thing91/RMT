"""Live events over Server-Sent Events (GET /api/v1/events).

Code that changes something other users should see right away (edit
locks, notifications) calls `emit(db, event)`; the event is queued on the
session and published only after that session commits, so a rolled-back
change never announces itself. Subscribers are per-process asyncio queues:
fine for the single uvicorn process this app runs as — a multi-worker
deployment would need a shared broker (Postgres LISTEN/NOTIFY, Redis).
"""

import asyncio
import threading
import uuid
from dataclasses import dataclass, field

from sqlalchemy import event
from sqlalchemy.orm import Session


@dataclass
class Subscriber:
    user_id: uuid.UUID
    org_id: uuid.UUID
    queue: asyncio.Queue
    loop: asyncio.AbstractEventLoop
    project_ids: set[uuid.UUID] = field(default_factory=set)


class EventBus:
    def __init__(self) -> None:
        self._subs: list[Subscriber] = []
        self._lock = threading.Lock()

    def subscribe(self, sub: Subscriber) -> None:
        with self._lock:
            self._subs.append(sub)

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)

    def publish(self, evt: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for sub in subs:
            if not _wants(sub, evt):
                continue
            try:
                sub.loop.call_soon_threadsafe(sub.queue.put_nowait, evt)
            except RuntimeError:  # loop closed — client went away
                self.unsubscribe(sub)

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)


def _wants(sub: Subscriber, evt: dict) -> bool:
    if "user_id" in evt:
        return str(sub.user_id) == evt["user_id"]
    if "project_id" in evt:
        return evt["project_id"] in {str(p) for p in sub.project_ids}
    return True


bus = EventBus()


def emit(db: Session, evt: dict) -> None:
    db.info.setdefault("pending_events", []).append(evt)


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    pending = session.info.pop("pending_events", [])
    for evt in pending:
        bus.publish(evt)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop("pending_events", None)
