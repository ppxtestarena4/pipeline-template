from fastapi import FastAPI
from database import Base, engine
from routes import projects_router
from auth.routes import router as auth_router

app = FastAPI(title="TaskApp API", version="0.1.0")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


app.include_router(auth_router)
app.include_router(projects_router)


@app.get("/health")
def health():
    return {"status": "ok"}
