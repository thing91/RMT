import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.config import settings
from app.database import Base, engine
from app import models  # noqa: F401  (registers all models on Base metadata)

app = FastAPI(title="Requirements Management Tool", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


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
