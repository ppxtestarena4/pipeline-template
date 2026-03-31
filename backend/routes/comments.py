import re
import uuid
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, ForeignKey, String, Text, insert, select
from sqlalchemy.dialects.postgresql import UUID as SQLAlchemyUUID
from sqlalchemy.orm import Session

from backend.database import Base, get_db
from backend.models import User

router = APIRouter(prefix="/api/tasks", tags=["comments"])
security = HTTPBearer(auto_error=False)

# Core table reference for tasks (owned by task model / migration 003)
tasks_table_ref = None  # resolved lazily via Base.metadata

MENTION_RE = re.compile(r"@(\w+)")


class CommentCreate(BaseModel):
    body: str


class AuthorBrief(BaseModel):
    id: UUID
    name: str

    class Config:
        from_attributes = True


class CommentResponse(BaseModel):
    id: UUID
    task_id: UUID
    author_id: UUID
    author: AuthorBrief
    body: str
    mentioned_users: list[str]
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True


def _get_current_user(
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


def _task_exists(db: Session, task_id: UUID) -> bool:
    """Check that a task with the given id exists."""
    tasks_table = Base.metadata.tables.get("tasks")
    if tasks_table is None:
        # Table not yet reflected — assume it exists to avoid hard failure
        # in environments where migrations haven't run yet.
        return True
    result = db.execute(
        select(tasks_table.c.id).where(tasks_table.c.id == task_id)
    ).first()
    return result is not None


def _parse_mentions(body: str) -> list[str]:
    """Return unique @mention handles found in body text."""
    return list(dict.fromkeys(MENTION_RE.findall(body)))


def _build_response(row: dict, author: User, mentioned_users: list[str]) -> CommentResponse:
    return CommentResponse(
        id=row["id"],
        task_id=row["task_id"],
        author_id=row["author_id"],
        author=AuthorBrief(id=author.id, name=author.name),
        body=row["body"],
        mentioned_users=mentioned_users,
        created_at=row["created_at"],
        updated_at=row.get("updated_at"),
    )


@router.post(
    "/{task_id}/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    task_id: UUID,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_get_current_user),
) -> CommentResponse:
    if not _task_exists(db, task_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    comments_table = Base.metadata.tables["comments"]
    comment_id = uuid.uuid4()
    created_at = datetime.utcnow()

    db.execute(
        insert(comments_table).values(
            id=comment_id,
            task_id=task_id,
            author_id=current_user.id,
            body=payload.body,
            created_at=created_at,
            updated_at=None,
        )
    )
    db.commit()

    row = (
        db.execute(
            select(comments_table).where(comments_table.c.id == comment_id)
        )
        .mappings()
        .first()
    )

    return _build_response(dict(row), current_user, _parse_mentions(payload.body))


@router.get("/{task_id}/comments", response_model=list[CommentResponse])
def list_comments(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_get_current_user),
) -> list[CommentResponse]:
    if not _task_exists(db, task_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    comments_table = Base.metadata.tables["comments"]
    rows = (
        db.execute(
            select(comments_table)
            .where(comments_table.c.task_id == task_id)
            .order_by(comments_table.c.created_at.asc())
        )
        .mappings()
        .all()
    )

    result = []
    for row in rows:
        author = db.query(User).filter(User.id == row["author_id"]).first()
        result.append(_build_response(dict(row), author, _parse_mentions(row["body"])))
    return result
