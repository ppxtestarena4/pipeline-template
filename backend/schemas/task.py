from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

try:
    from pydantic import ConfigDict
except ImportError:  # pragma: no cover - Pydantic v1 compatibility
    ConfigDict = None

from backend.models.task import TaskCategory, TaskPriority, TaskStatus


class ORMBaseModel(BaseModel):
    if ConfigDict is not None:
        model_config = ConfigDict(from_attributes=True)
    else:

        class Config:
            orm_mode = True


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    project_id: UUID
    assignee_id: UUID | None = None
    priority: TaskPriority = TaskPriority.medium
    category: TaskCategory
    parent_task_id: UUID | None = None
    deadline: datetime | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee_id: UUID | None = None
    priority: TaskPriority | None = None
    category: TaskCategory | None = None
    deadline: datetime | None = None


class TaskMove(BaseModel):
    status: TaskStatus


class SubtaskProgress(BaseModel):
    completed: int
    total: int


class TaskResponse(ORMBaseModel):
    id: UUID
    title: str
    description: str | None
    project_id: UUID
    assignee_id: UUID | None
    created_by_id: UUID | None
    status: TaskStatus
    priority: TaskPriority
    category: TaskCategory
    parent_task_id: UUID | None
    deadline: datetime | None
    created_at: datetime
    updated_at: datetime | None
    completed_at: datetime | None
    subtask_progress: SubtaskProgress
