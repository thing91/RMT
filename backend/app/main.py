import asyncio
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.config import settings
from app.database import Base, engine
from app import models  # noqa: F401  (registers all models on Base metadata)

API_DESCRIPTION = """
REST API of RMT — everything the web application does goes through it.

**Authentication.** Send `Authorization: Bearer <token>` with either a
session token (`POST /api/v1/auth/login`) or a personal API token
(`rmt_…`, created under ⚙ Administration → API). The caller has exactly the
permissions of the token's owner. Reads of public projects work without a
token.

**Optimistic concurrency.** Item reads return an `ETag`; writes to item
content require `If-Match` with it (428 without, 412 with a diff when
someone else changed the item meanwhile).

**History.** Every record's changes are available from
`GET /api/v1/changes/{entity_type}/{entity_id}`.
"""

app = FastAPI(
    title="Requirements Management Tool",
    version="0.1.0",
    description=API_DESCRIPTION,
    # Under /api so they're reachable through the frontend's /api proxy too.
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


def _openapi_with_bearer():
    """Adds the bearer scheme so Swagger's "Authorize" button works."""
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi

    schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
    schema.setdefault("components", {})["securitySchemes"] = {
        "bearer": {"type": "http", "scheme": "bearer", "description": "Session token or personal API token (rmt_…)"}
    }
    schema["security"] = [{"bearer": []}, {}]
    app.openapi_schema = schema
    return schema


app.openapi = _openapi_with_bearer


@app.middleware("http")
async def _request_actor(request, call_next):
    """A fresh "who is acting" holder per request, filled in by
    get_current_user and read by the record-history hook."""
    from app.services.record_history import new_request_actor, reset_request_actor

    token = new_request_actor()
    try:
        return await call_next(request)
    finally:
        reset_request_actor(token)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.on_event("startup")
async def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    asyncio.create_task(_sweep_expired_locks())


async def _sweep_expired_locks() -> None:
    """Every 30 s: drop expired edit locks, announcing them (presence
    avatars disappear, "notify me when free" fires) even when nobody
    released them explicitly — e.g. a closed laptop."""
    from fastapi.concurrency import run_in_threadpool

    from app.database import SessionLocal
    from app.services.locks import sweep_expired

    def sweep() -> None:
        db = SessionLocal()
        try:
            sweep_expired(db)
        finally:
            db.close()

    while True:
        await asyncio.sleep(30)
        try:
            await run_in_threadpool(sweep)
        except Exception:  # noqa: BLE001 — keep sweeping even if one pass fails
            logging.getLogger("rmt.locks").exception("Lock sweep failed")


@app.get("/api/v1/health")
def health():
    return {"status": "ok"}


# Optional: serve the built frontend from this same process (the
# single-container deployment sets FRONTEND_DIST; the normal dev setup,
# where the frontend runs separately under `npm run dev`, leaves it unset
# and nothing below is registered). Registered last so it never shadows an
# /api/... route — FastAPI matches routes in registration order.
_frontend_dist = os.environ.get("FRONTEND_DIST", "")
if _frontend_dist and os.path.isdir(_frontend_dist):
    _assets_dir = os.path.join(_frontend_dist, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="frontend-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        # A real static file (e.g. favicon.ico) if one exists at that path,
        # otherwise index.html — React Router owns everything else
        # client-side, so a deep link/refresh on e.g. /projects/123 must
        # still get the SPA shell, not a 404.
        candidate = os.path.join(_frontend_dist, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_frontend_dist, "index.html"))
