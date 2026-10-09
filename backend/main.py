"""TT Calendar FastAPI 应用入口。

开发：uvicorn backend.main:app --reload --port 8000
生产（sidecar）：python -m backend.main（监听 127.0.0.1:8765）
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

from backend import deps
from backend.routes import router
from tt_calendar import config as cfg

logger = logging.getLogger(__name__)


_logging_ready = False


def _configure_logging() -> None:
    """把 Python 日志落到 data/backend.log。

    打包后后端由 launcher 以 GUI 方式拉起，stderr 用户根本看不到；而此前全仓
    没有配置任何 handler，db.py 里那些迁移告警（log.warning）实际只走了
    logging 的 lastResort 写 stderr，等于写进虚空——用户丢掉 legacy 数据也毫无
    察觉。补上可写文件的 handler，日志才真正可诊断。

    两条约束：日志不可写（权限/只读介质）不得拦住启动；文件要有上限，否则
    长期运行会无声撑大。

    幂等靠模块级标记而非「root 有没有 handler」：后者会被 uvicorn 等库抢先
    basicConfig 掉，导致文件日志静默失效——那正是本函数要解决的问题本身。
    """
    global _logging_ready
    if _logging_ready:
        return
    _logging_ready = True

    root = logging.getLogger()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        cfg.DATA_DIR.mkdir(parents=True, exist_ok=True)
        fh = RotatingFileHandler(cfg.DATA_DIR / "backend.log",
                                 maxBytes=1_000_000, backupCount=3, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError as e:
        sys.stderr.write(f"logging: cannot open backend.log ({e})\n")
    root.addHandler(logging.StreamHandler(sys.stderr))
    root.setLevel(logging.INFO)


_configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = deps.connect_db()
    app.state.db = conn
    try:
        from tt_calendar import db
        db.migrate_schedule_to_items(conn)
        db.ensure_schedule_category_layers(conn)
        db.backfill_layer_kind_group(conn)
        db.sync_countdown_events(conn)
        conn.commit()
        yield
    finally:
        conn.close()


app = FastAPI(title="TT Calendar API", version="2.0.0", lifespan=lifespan)

# 本地 sidecar API 无认证，故必须校验 Host 头：否则恶意网页用 DNS rebinding 把
# 域名解析到 127.0.0.1 后，同源即可读写本机全部个人数据，并改写同步目标仓库
# （本进程持有可写 GitHub PAT 的操作能力）。CORS 挡不住这个——它只约束 JS 读响应，
# 不阻止请求发出；真正生效的是 Host 校验。
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[
        "127.0.0.1",
        "localhost",
        "[::1]",
        "tauri.localhost",   # Tauri 生产 origin（Windows）
        "testserver",        # fastapi TestClient
        # Pake 打包版以 tauri://localhost 或本地文件协议加载
        "tauri",
    ],
)

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

@app.exception_handler(ValueError)
async def value_error_handler(request: StarletteRequest, exc: ValueError) -> JSONResponse:
    """把路由层的裸 ValueError 归一成 400。

    路径参数与请求体里的畸形日期（parse_date 对 "abc"、"2026-13-45" 等一律抛
    ValueError）此前一律变成 500，把「客户端传错了」误报成服务端故障——既误导
    调用方，也让真实的服务端异常被淹没在噪声里。

    这里刻意记 warning 而非静默：若将来某个真正的 bug 也抛 ValueError，日志里
    仍留有痕迹，不会被这个处理器悄悄吃掉。
    """
    logger.warning(
        "请求参数被拒 %s %s -> ValueError: %s",
        request.method, request.url.path, exc,
    )
    return JSONResponse(status_code=400, content={"detail": f"invalid value: {exc}"})


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
