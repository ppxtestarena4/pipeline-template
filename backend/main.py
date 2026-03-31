from fastapi import FastAPI

from backend.database import Base, engine
from backend.routes import projects_router

app = FastAPI(title="TaskApp API")


@app.on_event("startup")
def on_startup() -> None:
    # Ensure the minimal schema exists when the application starts.
    Base.metadata.create_all(bind=engine)


app.include_router(projects_router)
