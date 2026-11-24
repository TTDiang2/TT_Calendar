"""便携版 → 安装版的数据迁移。

老版本把 ``data/`` 放在 exe 旁边；安装版的数据在 ``%LOCALAPPDATA%``。
首次启动若发现新位置还没有数据库，就把旧库热拷贝过来。只用 SQLite 的
backup API，不用文件复制——旧库可能还带着 ``-wal``，裸拷会丢掉最近事务。
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
import time
from pathlib import Path

from .paths import PLUGINS_DIR, PROJECT_ROOT

log = logging.getLogger(__name__)

# 只拿用户亲手创建的表当"有没有数据"的依据。layer_config / meta / subscriptions
# 都是启动时自动 seed 的，新装的空库也有内容，用它们判断会把空库认成"已迁移过"。
_USER_DATA_TABLES: tuple[str, ...] = ("todo", "schedule_items", "events", "marks", "countdown")


def _legacy_candidates() -> list[Path]:
    """便携版可能把 data/ 放在 exe 同目录，也可能放在上一级（源码布局）。"""
    seen: list[Path] = []
    for base in (PROJECT_ROOT, PROJECT_ROOT.parent):
        db = base / "data" / "calendar.db"
        if db not in seen:
            seen.append(db)
    return seen


def _has_user_data(db_path: Path) -> bool:
    """库里有没有用户自己造的东西。

    打不开、表不存在、查询出错一律当作"有数据"：宁可这次不迁，也不能把用户
    现有的东西覆盖掉。迁移只有单向，判错的代价不可逆。
    """
    try:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error as e:
        log.warning("无法检查 %s 是否有数据（按有数据处理）: %s", db_path, e)
        return True
    try:
        for table in _USER_DATA_TABLES:
            try:
                row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            except sqlite3.OperationalError as e:
                # 只有"这张表还没建"才算空；文件损坏、被占用之类都要当有数据
                if "no such table" in str(e).lower():
                    continue
                log.warning("检查 %s 的 %s 失败（按有数据处理）: %s", db_path, table, e)
                return True
            except sqlite3.Error as e:
                log.warning("检查 %s 的 %s 失败（按有数据处理）: %s", db_path, table, e)
                return True
            if row and row[0]:
                return True
        return False
    finally:
        conn.close()


def _backup_before_import(db_path: Path, backup_dir: Path) -> Path | None:
    """覆盖目标库前先留一份。迁移写坏了还能回滚。"""
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
        out = backup_dir / f"calendar-before-import-{time.strftime('%Y%m%d-%H%M%S')}.db"
        _copy_sqlite(db_path, out)
        return out
    except (OSError, sqlite3.Error) as e:
        log.warning("导入前备份失败 %s: %s", db_path, e)
        return None


def _copy_sqlite(src: Path, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".importing")
    tmp.unlink(missing_ok=True)
    src_conn = sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(tmp)
    try:
        src_conn.backup(dst)
    finally:
        dst.close()
        src_conn.close()
    try:
        # dest 的 -wal/-shm 是旧库的事务日志。只换主文件、把它们留下，SQLite
        # 下次打开会拿旧日志"重放"到新库上，刚导进来的数据会被改回去。
        for suffix in ("-wal", "-shm"):
            dest.with_name(dest.name + suffix).unlink(missing_ok=True)
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)


def import_legacy_data(home: Path) -> bool:
    """把旧 data/ 导入新 HOME，返回是否发生迁移。

    目标库不存在、或者存在但一条用户数据都没有，都算"还没迁过"。
    后者正是 2.4.0 之后老用户升级看到空日历的原因：安装版首次启动就建了个空
    库文件，旧逻辑只看 ``target.exists()``，从此再也不迁移。
    """
    target = home / "data" / "calendar.db"
    if target.exists() and _has_user_data(target):
        return False

    for candidate in _legacy_candidates():
        if not candidate.is_file():
            continue
        if candidate.resolve() == target.resolve():
            continue
        if candidate.stat().st_size == 0:
            continue
        if target.exists() and not _has_user_data(target):
            saved = _backup_before_import(target, home / "backups")
            if saved:
                log.info("目标库是空的，覆盖前已备份到 %s", saved)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            _copy_sqlite(candidate, target)
        except (OSError, sqlite3.Error) as e:
            # 不在这里删 target：_copy_sqlite 只有 replace 成功才算写进去，
            # 失败时目标库还是原来那个，删了反而把用户的空库/新库弄没了。
            log.warning("旧数据迁移失败 %s -> %s: %s", candidate, target, e)
            continue

        for name in ("user_config.json",):
            src = candidate.parent / name
            if src.is_file():
                try:
                    shutil.copy2(src, home / "data" / name)
                except OSError as e:
                    log.warning("旧配置迁移失败 %s: %s", src, e)
        log.info("已从 %s 导入历史数据", candidate)
        return True

    return False


def import_legacy_plugins() -> int:
    """把便携包旁的 plugins/*.py 复制到可写插件目录；已存在的不覆盖。"""
    target = PLUGINS_DIR
    candidates = (PROJECT_ROOT / "plugins", PROJECT_ROOT.parent / "plugins")
    if any(candidate.resolve() == target.resolve() for candidate in candidates):
        return 0

    copied = 0
    for base in candidates:
        if not base.is_dir():
            continue
        for src in sorted(base.glob("*.py")):
            if src.name.startswith("_"):
                continue
            dest = target / src.name
            if dest.exists():
                continue
            try:
                target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                copied += 1
            except OSError as e:
                log.warning("插件迁移失败 %s: %s", src, e)
        if copied:
            log.info("已从 %s 迁移 %d 个插件", base, copied)
            break
    return copied
