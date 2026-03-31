from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

try:
    from pydantic import ConfigDict
except ImportError:  # pragma: no cover - Pydantic v1 compatibility
    ConfigDict = None


class ORMBaseModel(BaseModel):
    if ConfigDict is not None:
        model_config = ConfigDict(from_attributes=True)
    else:

        class Config:
            orm_mode = True


class UserBrief(ORMBaseModel):
    id: UUID
    name: str
    role: str


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    member_ids: list[UUID] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_archived: bool | None = None


class ProjectMemberAdd(BaseModel):
    user_id: UUID


class ProjectResponse(ORMBaseModel):
    id: UUID
    name: str
    description: str | None
    owner_id: UUID
    is_archived: bool
    created_at: datetime
    members: list[UserBrief]
