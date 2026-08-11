"""TT Calendar FastAPI 应用入口。

开发：uvicorn backend.main:app --reload --port 8000
生产（sidecar）：python -m backend.main（监听 127.0.0.1:8765）
"""

from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

from backend import deps
from backend.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = deps.connect_db()
    app.state.db = conn
    try:
        from tt_calendar import db
        db.migrate_schedule_to_items(conn)
        db.ensure_schedule_category_layers(conn)
        db.backfill_layer_kind_group(conn)
        conn.commit()
        yield
    finally:
        conn.close()


app = FastAPI(title="TT Calendar API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://tauri.localhost",  # Tauri 生产环境 origin (Windows)
        "https://tauri.localhost",  # Tauri 生产环境 origin (macOS/Linux)
        "tauri://localhost",  # 兼容旧版 Tauri origin
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"ok": True}


# 生产模式：同时 serve frontend/dist（让 Pake 加载 http://127.0.0.1:8765 单端口）
def _frontend_dist() -> Path:
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        near = exe_dir / "frontend" / "dist"
        if near.exists():
            return near
        meipass = Path(getattr(sys, "_MEIPASS", ""))
        if meipass.is_dir():
            bundled = meipass / "frontend" / "dist"
            if bundled.is_dir():
                return bundled
    return Path(__file__).resolve().parent.parent / "frontend" / "dist"


FRONTEND_DIST = _frontend_dist()


class NoCacheHtmlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response: StarletteResponse = await call_next(request)
        if "text/html" in response.headers.get("content-type", ""):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response


app.add_middleware(NoCacheHtmlMiddleware)

if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
