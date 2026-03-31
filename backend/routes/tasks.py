import uuid
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Column, DateTime, ForeignKey, String, Table, Text, delete, insert, select, update
from sqlalchemy.dialects.postgresql import UUID as SQLAlchemyUUID
from sqlalchemy.orm import Session

from backend.database import Base, get_db
from backend.models import User
from backend.models.task import TaskCategory, TaskPriority, TaskStatus
from backend.schemas.task import TaskCreate, TaskMove, TaskResponse, TaskUpdate, SubtaskProgress

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
security = HTTPBearer(auto_error=False)

tasks_table = Table(
    "tasks",
    Base.metadata,
    Column("id", SQLAlchemyUUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("title", String, nullable=False),
    Column("description", Text, nullable=True),
    Column("project_id", SQLAlchemyUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
    Column("assignee_id", SQLAlchemyUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    Column("created_by_id", SQLAlchemyUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    Column("status", String, nullable=False),
    Column("priority", String, nullable=False),
    Column("category", String, nullable=False),
    Column("parent_task_id", SQLAlchemyUUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
    Column("deadline", DateTime, nullable=True),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=True),
    Column("completed_at", DateTime, nullable=True),
    extend_existing=True,
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    user = (
        db.query(User)
        .filter(User.api_token == credentials.credentials, User.is_active.is_(True))
        .first()
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
        )

    return user


def _get_task_row(db: Session, task_id: UUID) -> dict | None:
    result = (
        db.execute(select(tasks_table).where(tasks_table.c.id == task_id))
        .mappings()
        .first()
    )
    return dict(result) if result is not None else None


def _get_subtask_progress(db: Session, task_id: UUID) -> SubtaskProgress:
    rows = (
        db.execute(
            select(tasks_table.c.status).where(tasks_table.c.parent_task_id == task_id)
        )
        .fetchall()
    )
    total = len(rows)
    completed = sum(1 for row in rows if row[0] == TaskStatus.done)
    return SubtaskProgress(completed=completed, total=total)


def _build_task_response(db: Session, task_row: dict) -> TaskResponse:
    progress = _get_subtask_progress(db, task_row["id"])
    return TaskResponse(
        id=task_row["id"],
        title=task_row["title"],
        description=task_row["description"],
        project_id=task_row["project_id"],
        assignee_id=task_row["assignee_id"],
        created_by_id=task_row["created_by_id"],
        status=task_row["status"],
        priority=task_row["priority"],
        category=task_row["category"],
        parent_task_id=task_row["parent_task_id"],
        deadline=task_row["deadline"],
        created_at=task_row["created_at"],
        updated_at=task_row["updated_at"],
        completed_at=task_row["completed_at"],
        subtask_progress=progress,
    )


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    task_id = uuid.uuid4()
    created_at = datetime.utcnow()
    db.execute(
        insert(tasks_table).values(
            id=task_id,
            title=payload.title,
            description=payload.description,
            project_id=payload.project_id,
            assignee_id=payload.assignee_id,
            created_by_id=current_user.id,
            status=TaskStatus.todo,
            priority=payload.priority,
            category=payload.category,
            parent_task_id=payload.parent_task_id,
            deadline=payload.deadline,
            created_at=created_at,
            updated_at=None,
            completed_at=None,
        )
    )
    db.commit()
    return _build_task_response(db, _get_task_row(db, task_id))


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    project_id: UUID | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    status: TaskStatus | None = Query(default=None),
    category: TaskCategory | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TaskResponse]:
    query = select(tasks_table)
    if project_id is not None:
        query = query.where(tasks_table.c.project_id == project_id)
    if assignee_id is not None:
        query = query.where(tasks_table.c.assignee_id == assignee_id)
    if status is not None:
        query = query.where(tasks_table.c.status == status)
    if category is not None:
        query = query.where(tasks_table.c.category == category)
    query = query.order_by(tasks_table.c.created_at.desc())
    rows = db.execute(query).mappings().all()
    return [_build_task_response(db, dict(row)) for row in rows]


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    task = _get_task_row(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    return _build_task_response(db, task)


@router.put("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    task = _get_task_row(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    values = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    if values:
        values["updated_at"] = datetime.utcnow()
        db.execute(update(tasks_table).where(tasks_table.c.id == task_id).values(**values))
        db.commit()

    return _build_task_response(db, _get_task_row(db, task_id))


@router.put("/{task_id}/move", response_model=TaskResponse)
def move_task(
    task_id: UUID,
    payload: TaskMove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    task = _get_task_row(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    values: dict = {
        "status": payload.status,
        "updated_at": datetime.utcnow(),
    }
    if payload.status == TaskStatus.done:
        values["completed_at"] = datetime.utcnow()
    elif task["status"] == TaskStatus.done:
        # Moving out of done — clear completed_at
        values["completed_at"] = None

    db.execute(update(tasks_table).where(tasks_table.c.id == task_id).values(**values))
    db.commit()
    return _build_task_response(db, _get_task_row(db, task_id))


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    task = _get_task_row(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    db.execute(delete(tasks_table).where(tasks_table.c.id == task_id))
    db.commit()
