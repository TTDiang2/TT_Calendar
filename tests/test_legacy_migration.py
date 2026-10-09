"""旧版 JSON → SQLite 的一次性数据迁移。

这条路径此前完全没有测试覆盖，却是「用户升级后能不能看到自己的历史数据」的
唯一保障，也是失败时最容易静默的一段（旧脚本只 print 结果，且直接跑真实库）。

三个 legacy 文件各有坑：
- color_data.json：存的是 hex 色值，要映射到 0..4 档位；
- schedule_data.json：存的是拼接文本，要拆回上午/下午/晚上三格；
- important_dates.json：GBK 编码（Python 默认 utf-8 直接读会炸），且一个日期
  对应多条事件，带 offset/auto 语义。

外加两条全局语义：单行脏数据不得中断整次迁移；成功后置legacy_migrated 标记，
之后不再重复搬。
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import config as cfg  # noqa: E402
from tt_calendar import db  # noqa: E402


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    yield c
    c.close()


@pytest.fixture
def legacy(tmp_path: Path, monkeypatch) -> Path:
    """把三个 legacy 路径指到 tmp，当前不存在的即视为「没有旧数据」。"""
    for name in ("LEGACY_COLOR_JSON", "LEGACY_SCHEDULE_JSON", "LEGACY_IMPORTANT_JSON"):
        monkeypatch.setattr(cfg, name, tmp_path / f"{name}.json")
    return tmp_path


def _write(path: Path, data, encoding: str = "utf-8") -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding=encoding)


# ---------------------------------------------------------------- coloring


def test_color_hex_mapped_to_levels(conn: sqlite3.Connection, legacy: Path) -> None:
    _write(cfg.LEGACY_COLOR_JSON, {
        "2026-03-01": "#FEF3C7",
        "2026-03-02": "#B45309",
    })
    counts = db.migrate_legacy_json(conn)
    assert counts["coloring"] == 2
    rows = {r["date"]: r["level"] for r in conn.execute("SELECT date, level FROM coloring")}
    assert set(rows) == {"2026-03-01", "2026-03-02"}
    assert all(0 <= v <= 4 for v in rows.values()), f"档位须落在 0..4：{rows}"


def test_single_bad_color_row_does_not_abort_migration(
    conn: sqlite3.Connection, legacy: Path
) -> None:
    """一行脏数据不得让整次迁移失败——那等于用户丢掉全部历史。"""
    _write(cfg.LEGACY_COLOR_JSON, {
        "2026-03-01": "#FEF3C7",
        "not-a-date": "#FEF3C7",
        "2026-03-03": "#B45309",
    })
    counts = db.migrate_legacy_json(conn)
    assert counts["coloring"] == 2, "两条合法数据应迁入"
    assert db.get_meta(conn, "legacy_migrated") == "1", "脏行不应阻止标记置位"


# ---------------------------------------------------------------- schedule


def test_schedule_text_split_into_three_slots(conn: sqlite3.Connection, legacy: Path) -> None:
    """旧格式是 AM:/PM:/EV: 前缀逐行拼在一段文本里。"""
    _write(cfg.LEGACY_SCHEDULE_JSON, {
        "2026-04-01": {"text": "AM: 开会\nPM: 健身\nEV: 散步"},
    })
    counts = db.migrate_legacy_json(conn)
    assert counts["schedule"] == 1
    row = conn.execute("SELECT * FROM schedule WHERE date='2026-04-01'").fetchone()
    assert row is not None
    assert (row["am"], row["pm"], row["ev"]) == ("开会", "健身", "散步"), \
        f"三格拆分错误：{dict(row)}"


def test_schedule_partial_text_leaves_other_slots_empty(
    conn: sqlite3.Connection, legacy: Path
) -> None:
    _write(cfg.LEGACY_SCHEDULE_JSON, {"2026-04-02": {"text": "PM: 只有下午"}})
    assert db.migrate_legacy_json(conn)["schedule"] == 1
    row = conn.execute("SELECT * FROM schedule WHERE date='2026-04-02'").fetchone()
    assert row["pm"] == "只有下午"
    assert row["am"] is None and row["ev"] is None


# ---------------------------------------------------------------- important


def test_important_dates_gbk_and_multi_items(conn: sqlite3.Connection, legacy: Path) -> None:
    """important_dates.json 是 GBK：一个日期可对应多条事件，各带 offset/auto。"""
    _write(cfg.LEGACY_IMPORTANT_JSON, {
        "2026-05-01": [
            {"label": "元旦", "auto": True},
            {"label": "假期第2天", "offset": 1, "source": "manual"},
        ],
    }, encoding="gbk")

    counts = db.migrate_legacy_json(conn)

    assert counts["important"] == 2
    rows = conn.execute(
        "SELECT title, color, source, source_ref, extra_json FROM events "
        "WHERE layer_id=? ORDER BY sort_key", (cfg.LayerID.IMPORTANT,)
    ).fetchall()
    assert [r["title"] for r in rows] == ["元旦", "假期第2天"]
    assert all(r["source"] == "migrated" for r in rows)
    # offset=0 与 offset>0 应有不同底色，否则前端无法区分主日与附带日
    assert rows[0]["color"] != rows[1]["color"], "offset 不同应有不同颜色"
    assert all(r["source_ref"] for r in rows), "source_ref 必须存在，否则重复迁移会灌出重复事件"


def test_important_non_list_payload_skipped(conn: sqlite3.Connection, legacy: Path) -> None:
    _write(cfg.LEGACY_IMPORTANT_JSON, {"2026-05-02": "not-a-list"})
    counts = db.migrate_legacy_json(conn)
    assert counts["important"] == 0


# ---------------------------------------------------------------- 全局语义


def test_missing_legacy_files_is_noop(conn: sqlite3.Connection, legacy: Path) -> None:
    """全新安装没有 legacy 文件：不能报错，计数为 0。"""
    counts = db.migrate_legacy_json(conn)
    assert counts == {"coloring": 0, "schedule": 0, "important": 0}
    assert db.get_meta(conn, "legacy_migrated") == "1"


def test_second_run_is_skipped(conn: sqlite3.Connection, legacy: Path) -> None:
    """标记置位后不再重复搬，否则每次启动都会灌一遍。"""
    _write(cfg.LEGACY_COLOR_JSON, {"2026-03-01": "#FEF3C7"})
    assert db.migrate_legacy_json(conn)["coloring"] == 1
    assert db.migrate_legacy_json(conn)["coloring"] == 0, "第二次应跳过"
    assert conn.execute("SELECT COUNT(*) c FROM coloring").fetchone()["c"] == 1
