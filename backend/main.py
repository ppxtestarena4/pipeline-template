from fastapi import FastAPI
from backend.database import Base, engine
from backend.routes import projects_router, subtasks_router, tasks_router

app = FastAPI(title="TaskApp API", version="0.1.0")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(subtasks_router)


@app.get("/health")
def health():
    return {"status": "ok"}
