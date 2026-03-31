import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from backend.database import Base


class UserRole(str, Enum):
    manager = "manager"
    employee = "employee"
    ai_agent = "ai_agent"
    admin = "admin"


class UserType(str, Enum):
    human = "human"
    ai = "ai"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False, default=UserRole.employee)
    user_type = Column(String, nullable=False, default=UserType.human)
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    avatar_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    api_token = Column(String, unique=True, nullable=True)

    # Self-referential relationship: manager → direct_reports
    direct_reports = relationship(
        "User",
        back_populates="manager",
        foreign_keys=[parent_id],
    )
    manager = relationship(
        "User",
        back_populates="direct_reports",
        remote_side=[id],
        foreign_keys=[parent_id],
    )
