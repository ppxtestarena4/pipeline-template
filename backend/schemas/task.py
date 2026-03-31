from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel

try:
    from pydantic import ConfigDict
except ImportError:  # pragma: no cover - Pydantic v1 compatibility
    ConfigDict = None


class TaskPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class TaskStatus(str, Enum):
    todo = "todo"
    in_progress = "in_progress"
    review = "review"
    done = "done"


class TaskCategory(str, Enum):
    feature = "feature"
    bug = "bug"
    improvement = "improvement"
    chore = "chore"
    documentation = "documentation"


class ORMBaseModel(BaseModel):
    if ConfigDict is not None:
        model_config = ConfigDict(from_attributes=True)
    else:

        class Config:
            orm_mode = True


class SubtaskProgress(ORMBaseModel):
    completed: int
    total: int


class SubtaskBrief(ORMBaseModel):
    id: UUID
    title: str
    status: TaskStatus
    assignee_id: UUID | None
    completed_at: datetime | None


class TaskResponse(ORMBaseModel):
    id: UUID
    title: str
    description: str | None
    status: TaskStatus
    priority: TaskPriority
    category: TaskCategory | None
    project_id: UUID
    parent_task_id: UUID | None
    assignee_id: UUID | None
    created_at: datetime
    updated_at: datetime | None
    completed_at: datetime | None
    subtask_progress: SubtaskProgress | None = None
