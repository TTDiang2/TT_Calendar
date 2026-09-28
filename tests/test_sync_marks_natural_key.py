"""marks 自然键冲突归一测试（回归：关闭前同步必崩的那条 IntegrityError）。

背景：marks 行身份是本地生成的 sync_uid，但表上有 UNIQUE(layer_id, date)。
两端各自给同一 (层, 日期) 打卡 → 两个不同 sync_uid 的行共存于远端快照；
老端 import 时按 sync_uid upsert 不冲突，却撞自然唯一索引 →

    IntegrityError: UNIQUE constraint failed: marks.layer_id, marks.date

整笔同步回滚，表现为"关闭前同步失败"每次必现。import_plan 现按 LWW 归一：
胜者占用自然键，输家留墓碑，两端收敛。
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402
from tt_calendar.sync.schema import ensure_sync_schema  # noqa: E402
from tt_calendar.sync import snapshot as S  # noqa: E402

LAYER = "custom_early_sleep"
DAY = "2026-09-18"
LOCAL_UID = "b9159985-fd89-7605-1c16-537e6dc2ba39"
REMOTE_UID = "9032096d-9fcc-4f51-b56b-5019cc3059f7"


def _mem_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    ensure_sync_schema(conn)
    return conn


def _local_row(uid: str, updated_at: str, level=None, note=None) -> dict:
    return {
        "layer_id": LAYER, "date": DAY, "level": level, "note": note,
        "created_at": "2026-09-18 09:00:00", "updated_at": updated_at,
        "sync_uid": uid,
    }


def _remote_row(uid: str, updated_at: str, level=None, note=None) -> dict:
    return _local_row(uid, updated_at, level, note)


def _marks(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return list(conn.execute(
        "SELECT id, layer_id, date, level, note, sync_uid, updated_at FROM marks "
        "WHERE layer_id=? ORDER BY id", (LAYER,)))


def _tombs(conn: sqlite3.Connection) -> set[str]:
    return {r["row_key"] for r in conn.execute(
        "SELECT row_key FROM sync_tombstones WHERE table_name='marks'")}


# ---------------------------------------------------------------------------
# 回归：本地较新（真实数据：老端朴素时间戳 vs Neo 端 +08:00 ISO）
# ---------------------------------------------------------------------------


def test_local_newer_skips_remote_and_tombstones_loser() -> None:
    """本地行较新 → 跳过远端行（不再抛 IntegrityError），并给远端身份留墓碑。"""
    conn = _mem_db()
    S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, "2026-09-21 09:02:20")]}, {}, {})

    tombs: dict = {}
    S.import_plan(
        conn,
        {"marks": [_remote_row(REMOTE_UID, "2026-09-18 19:13:59+08:00")]},
        {},
        tombs,
    )
    rows = _marks(conn)
    assert len(rows) == 1, "撞自然键后必须仍只有一行"
    assert rows[0]["sync_uid"] == LOCAL_UID
    assert rows[0]["updated_at"] == "2026-09-21 09:02:20", "本地行内容不得被覆盖"
    assert REMOTE_UID in _tombs(conn), "输家身份应留墓碑，另一端据此删除自己那行"
    assert ("marks", REMOTE_UID) in tombs


def test_remote_newer_adopts_remote_identity() -> None:
    """远端行较新 → 本地行原地改认远端身份（单行保留），旧身份留墓碑。"""
    conn = _mem_db()
    S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, "2026-09-18 09:00:00", note="旧")]}, {}, {})

    tombs: dict = {}
    S.import_plan(
        conn,
        {"marks": [_remote_row(REMOTE_UID, "2026-09-21 10:00:00", note="新")],
         "layer_config": [{"layer_id": LAYER, "display_name": "早睡", "updated_at": "2026-09-21 10:00:00"}]},
        {},
        tombs,
    )
    rows = _marks(conn)
    assert len(rows) == 1
    assert rows[0]["sync_uid"] == REMOTE_UID, "远端胜出后本地行应改认远端 sync_uid"
    assert rows[0]["note"] == "新"
    assert rows[0]["updated_at"] == "2026-09-21 10:00:00"
    assert LOCAL_UID in _tombs(conn), "被换下的本地身份也要留墓碑，另一端才能收敛"


def test_timestamp_formats_compared_as_instants() -> None:
    """混合格式时间戳按时刻比较，不按字符串：'+08:00' 偏移要被正确换算。"""
    conn = _mem_db()
    # 本地 2026-09-21 09:02:20 本地时间(UTC+8) == 01:02:20Z
    # 远端 2026-09-18 19:13:59+08:00 == 11:13:59Z → 本地确实更新
    S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, "2026-09-21 09:02:20")]}, {}, {})
    S.import_plan(conn, {"marks": [_remote_row(REMOTE_UID, "2026-09-18 19:13:59+08:00")]}, {}, {})
    assert [r["sync_uid"] for r in _marks(conn)] == [LOCAL_UID]


def test_tie_broken_deterministically_by_sync_uid() -> None:
    """时间戳完全相等：按 sync_uid 字典序裁决（两端一致，不能"本地优先"）。"""
    conn = _mem_db()
    same_ts = "2026-09-20 08:00:00"
    S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, same_ts)]}, {}, {})
    S.import_plan(conn, {"marks": [_remote_row(REMOTE_UID, same_ts)]}, {}, {})
    rows = _marks(conn)
    assert len(rows) == 1
    winner = max(LOCAL_UID, REMOTE_UID)
    assert rows[0]["sync_uid"] == winner, "平局应按 sync_uid 大者胜，两端算出同一个赢家"


# ---------------------------------------------------------------------------
# 无冲突路径不得受影响
# ---------------------------------------------------------------------------


def test_same_identity_normal_upsert() -> None:
    """同一 sync_uid 的常规更新走原路径（自然键归一不介入）。"""
    conn = _mem_db()
    S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, "2026-09-18 09:00:00", note="a")]}, {}, {})
    S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, "2026-09-19 09:00:00", note="b")]}, {}, {})
    rows = _marks(conn)
    assert len(rows) == 1
    assert rows[0]["note"] == "b"
    assert rows[0]["updated_at"] == "2026-09-19 09:00:00"
    assert not _tombs(conn)


def test_different_days_coexist() -> None:
    """不同 (层, 日期) 是不同逻辑行，各自独立导入。"""
    conn = _mem_db()
    S.import_plan(conn, {
        "marks": [
            _local_row(LOCAL_UID, "2026-09-18 09:00:00"),
            {**_remote_row(REMOTE_UID, "2026-09-19 09:00:00"), "date": "2026-09-19"},
        ],
    }, {}, {})
    assert len(_marks(conn)) == 2
    assert not _tombs(conn)


def test_no_conflict_no_extra_local_row_after_reimport() -> None:
    """同一条远端行重复导入幂等（回归测试：不得每次同步都新增墓碑/行）。"""
    conn = _mem_db()
    S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, "2026-09-18 09:00:00")]}, {}, {})
    before = (len(_marks(conn)), len(_tombs(conn)))
    for _ in range(3):
        S.import_plan(conn, {"marks": [_local_row(LOCAL_UID, "2026-09-18 09:00:00")]}, {}, {})
    assert (len(_marks(conn)), len(_tombs(conn))) == before
