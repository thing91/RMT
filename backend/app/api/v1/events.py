"""GET /api/v1/events — Server-Sent Events stream for the signed-in user.

EventSource can't send an Authorization header, so the JWT comes as the
`token` query parameter. Subscribing with `project_id` adds that project's
lock events (presence avatars); the user's own notification events always
come through.
"""

import asyncio
import json
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app.database import SessionLocal
from app.models.project import Project
from app.models.user import User
from app.services.auth import AuthError, decode_access_token
from app.services.events import Subscriber, bus
from app.services.permissions import can_read

router = APIRouter(tags=["events"])

KEEPALIVE_SECONDS = 25


def _authorize(token: str, project_id: uuid.UUID | None) -> tuple[uuid.UUID, uuid.UUID]:
    try:
        payload = decode_access_token(token)
    except AuthError:
        raise HTTPException(401, "Invalid token.")
    db = SessionLocal()
    try:
        user = db.get(User, uuid.UUID(payload["sub"]))
        if user is None:
            raise HTTPException(401, "Invalid token.")
        if project_id is not None:
            project = db.get(Project, project_id)
            if project is None or not can_read(db, project, user.id):
                raise HTTPException(404, "Project not found")
        return user.id, user.org_id
    finally:
        db.close()


@router.get("/events")
async def events(request: Request, token: str, project_id: uuid.UUID | None = None):
    user_id, org_id = await run_in_threadpool(_authorize, token, project_id)
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    sub = Subscriber(
        user_id=user_id,
        org_id=org_id,
        queue=queue,
        loop=asyncio.get_running_loop(),
        project_ids={project_id} if project_id else set(),
    )
    bus.subscribe(sub)

    async def stream():
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"event: {evt.get('type', 'message')}\ndata: {json.dumps(evt)}\n\n"
        finally:
            bus.unsubscribe(sub)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
