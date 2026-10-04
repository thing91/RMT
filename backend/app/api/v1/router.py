from fastapi import APIRouter

from app.api.v1 import (
    auth,
    baselines,
    comments,
    exports,
    git_log,
    glossary,
    graph,
    item_types,
    items,
    link_types,
    links,
    matrix,
    matrix_views,
    organizations,
    parameters,
    projects,
    references,
    table_views,
    workflow,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(organizations.router)
api_router.include_router(projects.router)
api_router.include_router(baselines.router)
api_router.include_router(item_types.router)
api_router.include_router(link_types.router)
api_router.include_router(items.router)
api_router.include_router(links.router)
api_router.include_router(table_views.router)
api_router.include_router(matrix.router)
api_router.include_router(matrix_views.router)
api_router.include_router(exports.router)
api_router.include_router(git_log.router)
api_router.include_router(glossary.router)
api_router.include_router(graph.router)
api_router.include_router(workflow.router)
api_router.include_router(references.router)
api_router.include_router(parameters.router)
api_router.include_router(comments.router)
