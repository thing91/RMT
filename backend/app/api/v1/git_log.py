from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import require_project_read
from app.models.project import Project
from app.services.git_sync import repo_log

router = APIRouter(tags=["git-sync"])


class GitCommit(BaseModel):
    sha: str
    date: str
    message: str


@router.get("/projects/{project_id}/git-log", response_model=list[GitCommit])
def get_git_log(project: Project = Depends(require_project_read)):
    return repo_log(project.id)
