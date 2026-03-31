import uuid
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Column, DateTime, ForeignKey, String, Table, Text, func, select
from sqlalchemy.dialects.postgresql import UUID as SQLAlchemyUUID
from sqlalchemy.orm import Session

from backend.database import Base, get_db
from backend.models import User
from backend.routes.projects import get_current_user
from backend.schemas.task import SubtaskBrief, SubtaskProgress, TaskResponse, TaskStatus

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

tasks_table = Table(
    "tasks",
    Base.metadata,
    Column("id", SQLAlchemyUUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("title", String, nullable=False),
    Column("description", Text, nullable=True),
    Column("status", String, nullable=False, default=TaskStatus.todo),
    Column("priority", String, nullable=False, default="medium"),
    Column("category", String, nullable=True),
    Column(
        "project_id",
        SQLAlchemyUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    Column(
        "parent_task_id",
        SQLAlchemyUUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    ),
    Column(
        "assignee_id",
        SQLAlchemyUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    ),
    Column("created_at", DateTime, nullable=False, default=datetime.utcnow),
    Column("updated_at", DateTime, nullable=True, onupdate=datetime.utcnow),
    Column("completed_at", DateTime, nullable=True),
    extend_existing=True,
)


def get_task_row(db: Session, task_id: UUID) -> dict | None:
    result = (
        db.execute(select(tasks_table).where(tasks_table.c.id == task_id))
        .mappings()
        .first()
    )
    return dict(result) if result is not None else None


def compute_subtask_progress(db: Session, task_id: UUID) -> SubtaskProgress:
    total_row = db.execute(
        select(func.count()).where(tasks_table.c.parent_task_id == task_id)
    ).scalar()
    completed_row = db.execute(
        select(func.count()).where(
            tasks_table.c.parent_task_id == task_id,
            tasks_table.c.status == TaskStatus.done,
        )
    ).scalar()
    return SubtaskProgress(completed=completed_row or 0, total=total_row or 0)


def build_task_response(db: Session, row: dict, include_progress: bool = True) -> TaskResponse:
    progress = compute_subtask_progress(db, row["id"]) if include_progress else None
    return TaskResponse(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        status=row["status"],
        priority=row["priority"],
        category=row["category"],
        project_id=row["project_id"],
        parent_task_id=row["parent_task_id"],
        assignee_id=row["assignee_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        completed_at=row["completed_at"],
        subtask_progress=progress,
    )


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    row = get_task_row(db, task_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    return build_task_response(db, row)
