from uuid import UUID

from pydantic import BaseModel

from backend.schemas.task import SubtaskProgress, TaskCategory, TaskPriority

__all__ = ["SubtaskCreate", "SubtaskProgress", "TaskCategory", "TaskPriority"]


class SubtaskCreate(BaseModel):
    title: str
    description: str | None = None
    assignee_id: UUID | None = None
    priority: TaskPriority = TaskPriority.medium
    category: TaskCategory | None = None
