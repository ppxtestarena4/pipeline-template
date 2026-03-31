from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.auth.jwt import verify_token
from backend.database import get_db
from backend.models.user import User


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    # Try Bearer JWT first
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
        try:
            user_id = verify_token(token)
        except ValueError:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user

    # Try X-API-Token header
    api_token = request.headers.get("X-API-Token")
    if api_token:
        user = db.query(User).filter(User.api_token == api_token).first()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid API token")
        return user

    raise HTTPException(status_code=401, detail="Not authenticated")
