import uuid
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    String,
    Table,
    Text,
    and_,
    delete,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import UUID as SQLAlchemyUUID
from sqlalchemy.orm import Session

from database import Base, get_db
from models import User
from schemas import ProjectCreate, ProjectMemberAdd, ProjectResponse, ProjectUpdate, UserBrief

router = APIRouter(prefix="/api/projects", tags=["projects"])
security = HTTPBearer(auto_error=False)

projects_table = Table(
    "projects",
    Base.metadata,
    Column("id", SQLAlchemyUUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("name", String, nullable=False),
    Column("description", Text, nullable=True),
    Column(
        "owner_id",
        SQLAlchemyUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    Column("is_archived", Boolean, nullable=False, default=False),
    Column("created_at", DateTime, nullable=False, default=datetime.utcnow),
)

project_members_table = Table(
    "project_members",
    Base.metadata,
    Column(
        "project_id",
        SQLAlchemyUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id",
        SQLAlchemyUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
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


def _get_project_row(db: Session, project_id: UUID) -> dict | None:
    result = (
        db.execute(
            select(projects_table).where(projects_table.c.id == project_id),
        )
        .mappings()
        .first()
    )
    return dict(result) if result is not None else None


def _project_is_member(db: Session, project_id: UUID, user_id: UUID) -> bool:
    return (
        db.execute(
            select(project_members_table.c.user_id).where(
                and_(
                    project_members_table.c.project_id == project_id,
                    project_members_table.c.user_id == user_id,
                ),
            ),
        ).first()
        is not None
    )


def _get_accessible_project_row(db: Session, project_id: UUID, user: User) -> dict:
    project = _get_project_row(db, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    if project["owner_id"] != user.id and not _project_is_member(db, project_id, user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    return project


def _get_owned_project_row(db: Session, project_id: UUID, user: User) -> dict:
    project = _get_project_row(db, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    if project["owner_id"] != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project owner can perform this action.",
        )

    return project


def _get_members(db: Session, project_id: UUID) -> list[UserBrief]:
    rows = db.execute(
        select(User.id, User.name, User.role)
        .join(project_members_table, User.id == project_members_table.c.user_id)
        .where(project_members_table.c.project_id == project_id)
        .order_by(User.name.asc()),
    ).all()
    return [
        UserBrief(id=row[0], name=row[1], role=row[2])
        for row in rows
    ]


def _build_project_response(db: Session, project_row: dict) -> ProjectResponse:
    return ProjectResponse(
        id=project_row["id"],
        name=project_row["name"],
        description=project_row["description"],
        owner_id=project_row["owner_id"],
        is_archived=project_row["is_archived"],
        created_at=project_row["created_at"],
        members=_get_members(db, project_row["id"]),
    )


def _validate_member_ids(db: Session, member_ids: list[UUID]) -> list[UUID]:
    unique_member_ids = list(dict.fromkeys(member_ids))
    if not unique_member_ids:
        return []

    users = db.query(User.id).filter(User.id.in_(unique_member_ids), User.is_active.is_(True)).all()
    found_ids = {row[0] for row in users}
    missing_ids = [member_id for member_id in unique_member_ids if member_id not in found_ids]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown member ids: {', '.join(str(member_id) for member_id in missing_ids)}",
        )

    return unique_member_ids


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    member_ids = [member_id for member_id in _validate_member_ids(db, payload.member_ids) if member_id != current_user.id]

    project_id = uuid.uuid4()
    created_at = datetime.utcnow()
    db.execute(
        insert(projects_table).values(
            id=project_id,
            name=payload.name,
            description=payload.description,
            owner_id=current_user.id,
            is_archived=False,
            created_at=created_at,
        ),
    )

    if member_ids:
        db.execute(
            insert(project_members_table),
            [{"project_id": project_id, "user_id": member_id} for member_id in member_ids],
        )

    db.commit()
    return _build_project_response(db, _get_project_row(db, project_id))


@router.get("", response_model=list[ProjectResponse])
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProjectResponse]:
    rows = (
        db.execute(
            select(projects_table)
            .select_from(
                projects_table.outerjoin(
                    project_members_table,
                    projects_table.c.id == project_members_table.c.project_id,
                ),
            )
            .where(
                or_(
                    projects_table.c.owner_id == current_user.id,
                    project_members_table.c.user_id == current_user.id,
                ),
            )
            .distinct()
            .order_by(projects_table.c.created_at.desc()),
        )
        .mappings()
        .all()
    )
    return [_build_project_response(db, dict(row)) for row in rows]


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    project = _get_accessible_project_row(db, project_id, current_user)
    return _build_project_response(db, project)


@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    _get_owned_project_row(db, project_id, current_user)

    values = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    if values:
        db.execute(update(projects_table).where(projects_table.c.id == project_id).values(**values))
        db.commit()

    return _build_project_response(db, _get_project_row(db, project_id))


@router.delete("/{project_id}", response_model=ProjectResponse)
def archive_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    _get_owned_project_row(db, project_id, current_user)

    db.execute(
        update(projects_table)
        .where(projects_table.c.id == project_id)
        .values(is_archived=True),
    )
    db.commit()

    return _build_project_response(db, _get_project_row(db, project_id))


@router.post("/{project_id}/members", response_model=ProjectResponse)
def add_project_member(
    project_id: UUID,
    payload: ProjectMemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    project = _get_owned_project_row(db, project_id, current_user)
    _validate_member_ids(db, [payload.user_id])

    if payload.user_id == project["owner_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project owner cannot be added as a member.",
        )

    if not _project_is_member(db, project_id, payload.user_id):
        db.execute(
            insert(project_members_table).values(project_id=project_id, user_id=payload.user_id),
        )
        db.commit()

    return _build_project_response(db, _get_project_row(db, project_id))


@router.delete("/{project_id}/members/{user_id}", response_model=ProjectResponse)
def remove_project_member(
    project_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    project = _get_owned_project_row(db, project_id, current_user)

    if user_id == project["owner_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project owner cannot be removed from the project.",
        )

    deleted_rows = db.execute(
        delete(project_members_table).where(
            and_(
                project_members_table.c.project_id == project_id,
                project_members_table.c.user_id == user_id,
            ),
        ),
    ).rowcount
    if not deleted_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project member not found.",
        )

    db.commit()
    return _build_project_response(db, _get_project_row(db, project_id))
