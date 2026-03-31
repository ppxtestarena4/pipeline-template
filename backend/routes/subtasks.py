import uuid
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User
from backend.routes.projects import get_current_user
from backend.routes.tasks import build_task_response, get_task_row, tasks_table
from backend.schemas.subtask import SubtaskCreate
from backend.schemas.task import SubtaskBrief, TaskResponse, TaskStatus

router = APIRouter(prefix="/api/tasks", tags=["subtasks"])


@router.post("/{task_id}/subtasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_subtask(
    task_id: UUID,
    payload: SubtaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    parent = get_task_row(db, task_id)
    if parent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent task not found.")

    # Inherit project_id from parent; inherit category if not explicitly provided
    project_id = parent["project_id"]
    category = payload.category if payload.category is not None else parent.get("category")

    subtask_id = uuid.uuid4()
    db.execute(
        insert(tasks_table).values(
            id=subtask_id,
            title=payload.title,
            description=payload.description,
            status=TaskStatus.todo,
            priority=payload.priority,
            category=category,
            project_id=project_id,
            parent_task_id=task_id,
            assignee_id=payload.assignee_id,
            created_at=datetime.utcnow(),
            updated_at=None,
            completed_at=None,
        )
    )
    db.commit()

    row = get_task_row(db, subtask_id)
    return build_task_response(db, row)


@router.get("/{task_id}/subtasks", response_model=list[SubtaskBrief])
def list_subtasks(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SubtaskBrief]:
    parent = get_task_row(db, task_id)
    if parent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    rows = (
        db.execute(
            select(
                tasks_table.c.id,
                tasks_table.c.title,
                tasks_table.c.status,
                tasks_table.c.assignee_id,
                tasks_table.c.completed_at,
            )
            .where(tasks_table.c.parent_task_id == task_id)
            .order_by(tasks_table.c.created_at.asc())
        )
        .mappings()
        .all()
    )

    return [
        SubtaskBrief(
            id=row["id"],
            title=row["title"],
            status=row["status"],
            assignee_id=row["assignee_id"],
            completed_at=row["completed_at"],
        )
        for row in rows
    ]
