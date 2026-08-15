"""merge 三方合并纯函数单测（不碰真实 db）。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tt_calendar.sync.merge import first_bind_merge, merge


def row(k, title, ts):
    return {"id": k, "title": title, "updated_at": ts, "status": "notStarted"}


def data(*rows):
    return {"todo": list(rows)}


TOMBS_EMPTY = {}


def test_no_changes():
    base = remote = local = data(row("t1", "a", "2026-08-01 10:00:00"))
    out = merge(base, remote, local, {}, {}, {})
    assert out["report"] == {"pulled": 0, "pushed": 0, "conflicts": 0,
                             "deleted": 0, "revived": 0}
    assert out["upsert"]["todo"] == []
    assert out["deletes"] == {}


def test_pull_only_remote_changed():
    base = local = data(row("t1", "a", "10:00"))
    remote = data(row("t1", "a2", "11:00"))
    out = merge(base, remote, local, {}, {}, {})
    assert out["report"]["pulled"] == 1
    assert out["upsert"]["todo"][0]["title"] == "a2"


def test_push_only_local_changed():
    base = remote = data(row("t1", "a", "10:00"))
    local = data(row("t1", "a3", "12:00"))
    out = merge(base, remote, local, {}, {}, {})
    assert out["report"]["pushed"] == 1
    assert out["upsert"]["todo"] == []
    assert out["data"]["todo"][0]["title"] == "a3"


def test_lww_local_newer():
    base = data(row("t1", "a", "10:00"))
    remote = data(row("t1", "remote-edit", "11:00"))
    local = data(row("t1", "local-edit", "12:00"))
    out = merge(base, remote, local, {}, {}, {})
    assert out["report"]["conflicts"] == 1
    assert out["data"]["todo"][0]["title"] == "local-edit"


def test_lww_remote_newer():
    base = data(row("t1", "a", "10:00"))
    remote = data(row("t1", "remote-edit", "13:00"))
    local = data(row("t1", "local-edit", "12:00"))
    out = merge(base, remote, local, {}, {}, {})
    assert out["report"]["conflicts"] == 1
    assert out["upsert"]["todo"][0]["title"] == "remote-edit"


def test_remote_delete_wins_over_stale_row():
    base = data(row("t1", "a", "10:00"))
    remote = {}
    local = data(row("t1", "a", "10:00"))
    remote_tombs = {("todo", "t1"): "11:00"}
    out = merge(base, remote, local, {}, remote_tombs, {})
    assert out["report"]["deleted"] == 1
    assert out["data"]["todo"] == []
    assert out["deletes"]["todo"] == ["t1"]
    assert ("todo", "t1") in out["tombstones"]


def test_local_edit_beats_remote_tombstone():
    base = data(row("t1", "a", "10:00"))
    remote = {}
    local = data(row("t1", "edited", "12:00"))
    remote_tombs = {("todo", "t1"): "11:00"}
    out = merge(base, remote, local, {}, remote_tombs, {})
    assert out["report"]["revived"] == 1
    assert out["data"]["todo"][0]["title"] == "edited"
    assert ("todo", "t1") not in out["tombstones"]


def test_both_added_different_rows():
    base = data()
    remote = data(row("r1", "remote-new", "11:00"))
    local = data(row("l1", "local-new", "12:00"))
    out = merge(base, remote, local, {}, {}, {})
    titles = {r["title"] for r in out["data"]["todo"]}
    assert titles == {"remote-new", "local-new"}
    assert out["report"]["conflicts"] == 0


def test_same_row_identical_no_conflict():
    base = data()
    same = row("x1", "same", "11:00")
    out = merge(base, data(same), data(dict(same)), {}, {}, {})
    assert out["report"]["conflicts"] == 0
    assert len(out["data"]["todo"]) == 1


def test_tombstone_union_takes_newer():
    tombs_l = {("todo", "t1"): "10:00"}
    tombs_r = {("todo", "t1"): "13:00", ("todo", "t2"): "09:00"}
    out = merge(data(), data(), data(), {}, tombs_r, tombs_l)
    assert out["tombstones"][("todo", "t1")] == "13:00"
    assert out["tombstones"][("todo", "t2")] == "09:00"


def test_local_delete_pushes():
    base = remote = data(row("t1", "a", "10:00"))
    local = data()
    local_tombs = {("todo", "t1"): "12:00"}
    out = merge(base, remote, local, {}, {}, local_tombs)
    assert out["data"]["todo"] == []
    assert ("todo", "t1") in out["tombstones"]
    assert out["deletes"] == {}


def test_first_bind_merge_push_union():
    remote = data(row("r1", "remote", "11:00"))
    local = data(row("l1", "local", "12:00"))
    out = first_bind_merge("merge_push", remote, local, {}, {})
    titles = {r["title"] for r in out["data"]["todo"]}
    assert titles == {"remote", "local"}


def test_first_bind_pull_overwrite_ignores_local():
    remote = data(row("r1", "remote", "11:00"))
    local = data(row("l1", "local", "12:00"), row("r1", "local-older", "09:00"))
    out = first_bind_merge("pull_overwrite", remote, local, {}, {})
    assert len(out["data"]["todo"]) == 1
    assert out["data"]["todo"][0]["title"] == "remote"
    assert out["deletes"]["todo"] == ["l1"]


def test_first_bind_pull_overwrite_covers_local_only_tables():
    # 本地独有表（远端快照缺失）也必须纳入 deletes，否则「覆盖」后残留本地行
    remote = data(row("r1", "remote", "11:00"))
    local = {"todo": [row("r1", "local-older", "09:00")],
             "marks": [{"id": "m1", "sync_uid": "u1", "updated_at": "10:00"}]}
    out = first_bind_merge("pull_overwrite", remote, local, {}, {})
    assert out["data"].get("marks", []) == []
    assert out["deletes"].get("marks") == ["u1"]
