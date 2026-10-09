"""同步全链路 e2e：两台设备 + 一个共享远端。

之前所有 sync 测试都停在零件层面——纯函数 `merge()`、单层 DB 触发表、或把
provider 整个 stub 掉的 base 时序测试。没有任何测试驱动过完整的
`sync_now` / `resolve_first_bind`，而这条链路恰好串起了本轮改过的全部东西：
base 锚点、墓碑、触发器、合并顺序。零件各自对、拼起来不对，是这类改动最典型
的漏网方式。

打桩边界刻意只放在传输层：`encode_files` 保持真实（否则 fake 远端解码的格式
与线上不一致，测试就自说自话），merge / snapshot / import_plan / 触发器 /
墓碑全部走生产代码。两台设备共用一个内存远端，模拟同一份 Git 仓库。
"""

from __future__ import annotations

import copy
import json
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402
from tt_calendar.sync import engine as E  # noqa: E402
from tt_calendar.sync import snapshot as S  # noqa: E402
from tt_calendar.sync.providers import ProviderError  # noqa: E402
from tt_calendar.sync.schema import ensure_sync_schema  # noqa: E402


# --------------------------------------------------------------------- 假远端


def _decode(files: dict[str, str]) -> tuple[dict, dict]:
    """按 encode_files 的真实格式解回 (data, tombstones)。"""
    data: dict = {}
    tombstones: dict = {}
    for name, blob in files.items():
        if name == "manifest.json":
            continue
        if name == "data/tombstones.json":
            for combined, dt in json.loads(blob).items():
                table, key = combined.split("|", 1)
                tombstones[(table, key)] = dt
        elif name.startswith("data/"):
            table = name[len("data/"):-len(".json")]
            data[table] = json.loads(blob)["rows"]
    return data, tombstones


class FakeRemote:
    """代表那一份 Git 仓库。committed 为 None 即「远端还是空的」。"""

    def __init__(self) -> None:
        self.committed: tuple[dict, dict] | None = None
        self.pushes = 0
        self.fail_with: str | None = None

    def provider(self) -> "_Provider":
        return _Provider(self)


class _Provider:
    def __init__(self, remote: FakeRemote) -> None:
        self.remote = remote

    def fetch(self):
        if self.remote.committed is None:
            return None
        data, tombstones = self.remote.committed
        # 深拷贝：否则一台设备改动会就地污染「远端」，把合并语义全架空
        return SimpleNamespace(data=copy.deepcopy(data),
                               tombstones=copy.deepcopy(tombstones))

    def push(self, files: dict[str, str], msg: str) -> str:
        self.remote.pushes += 1
        if self.remote.fail_with:
            raise ProviderError(self.remote.fail_with)
        self.remote.committed = _decode(files)
        return f"https://fake.local/commit/{self.remote.pushes}"


# --------------------------------------------------------------------- 设备


class Device:
    """一台设备 = 一份内存库 + 自己的一份 base 快照。"""

    def __init__(self, name: str, tmp_path: Path, remote: FakeRemote) -> None:
        self.name = name
        self.remote = remote
        self.conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
        self.conn.row_factory = sqlite3.Row
        db.init_db(self.conn)
        ensure_sync_schema(self.conn)
        self.base_dir = tmp_path / name / "sync_base"

    def close(self) -> None:
        self.conn.close()


@pytest.fixture
def remote() -> FakeRemote:
    return FakeRemote()


@pytest.fixture
def wired(monkeypatch, tmp_path):
    """把 engine 的两处全局状态按设备切换。

    base 快照存在模块级常量 BASE_FILE 里，不是按连接存的——同进程内两台设备会
    共用一份 base，三方合并的锚点直接错乱。故每次操作前把常量指向当前设备。
    同步本身是串行的，重定向常量是安全的。
    """
    devices: dict[str, Device] = {}
    by_conn: dict[int, FakeRemote] = {}

    def make(name: str, remote: FakeRemote) -> Device:
        d = devices.get(name)
        if d is None:
            d = devices[name] = Device(name, tmp_path, remote)
            by_conn[id(d.conn)] = remote
        return d

    def fake_provider(conn):
        return by_conn[id(conn)].provider()

    monkeypatch.setattr(E, "_provider", fake_provider)

    def activate(device: Device) -> None:
        monkeypatch.setattr(E, "BASE_DIR", device.base_dir, raising=False)
        monkeypatch.setattr(E, "BASE_FILE", device.base_dir / "snapshot.json",
                            raising=False)

    yield make, activate
    for d in devices.values():
        d.close()


# --------------------------------------------------------------------- 便捷


def add_todo(conn, tid: str, title: str, list_id: str = "L1") -> None:
    conn.execute(
        "INSERT INTO todo(id, list_id, title, status, importance, complexity) "
        "VALUES(?,?,?,'notStarted','normal','medium')", (tid, list_id, title))


def delete_todo(conn, tid: str) -> None:
    conn.execute("DELETE FROM todo WHERE id=?", (tid,))


def titles(conn) -> set[str]:
    return {r["title"] for r in conn.execute("SELECT title FROM todo").fetchall()}


def exported(conn) -> dict:
    return S.export_data(conn)


def bring_online(activate, device: Device, mode: str = "merge_push") -> dict | None:
    """让一台全新设备完成首次绑定。

    新设备没有 base，而远端已有数据时 sync_now 会抛 NeedsDecision 要求用户选
    合并方式——这是设计如此，不是异常。所以「第二台设备加入」的正确流程是：
    先触发决策，再 resolve_first_bind，之后才谈得上增量同步。
    """
    activate(device)
    try:
        return E.sync_now(device.conn)
    except E.NeedsDecision:
        return E.resolve_first_bind(device.conn, mode)


# --------------------------------------------------------------------- 用例


def test_first_sync_on_empty_remote_initializes(wired, remote) -> None:
    """远端为空且本地无 base：直接上传，不必问用户。"""
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "买菜")
    activate(a)

    out = E.sync_now(a.conn)

    assert out["result"] == "initialized", out
    assert remote.committed is not None, "应已推送到远端"
    assert remote.pushes == 1
    assert titles(a.conn) == {"买菜"}


def test_second_device_binds_then_receives_incremental(wired, remote) -> None:
    """核心传播：B 绑定后，A 新增的数据要能增量到达 B。

    B 作为新设备必须先走首次绑定（NeedsDecision -> resolve），绑定后才具备
    做增量同步的前提；这之后 A 的新数据才会推给 B。
    """
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "初始")
    activate(a)
    E.sync_now(a.conn)

    b = make("B", remote)
    bring_online(activate, b)
    assert "初始" in titles(b.conn)

    add_todo(a.conn, "t2", "A的后续新增")
    activate(a)
    assert E.sync_now(a.conn)["result"] == "ok"

    activate(b)
    assert E.sync_now(b.conn)["result"] == "ok"
    assert "A的后续新增" in titles(b.conn), f"B 未收到 A 的数据：{titles(b.conn)}"


def test_empty_remote_with_existing_base_is_an_error(wired, remote) -> None:
    """远端被清空而本地已有同步历史：必须报错，不能默默把本地当权威推上去。"""
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "买菜")
    activate(a)
    E.sync_now(a.conn)

    remote.committed = None  # 模拟仓库被误清空
    with pytest.raises(E.SyncError):
        E.sync_now(a.conn)


def test_delete_propagates_via_tombstone(wired, remote) -> None:
    """删除要靠墓碑传播，否则 B 上的数据会永久残留。"""
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "买菜")
    add_todo(a.conn, "t2", "做饭")
    activate(a)
    E.sync_now(a.conn)

    b = make("B", remote)
    bring_online(activate, b)
    assert titles(b.conn) == {"买菜", "做饭"}

    delete_todo(a.conn, "t1")
    activate(a)
    assert E.sync_now(a.conn)["result"] == "ok"

    activate(b)
    E.sync_now(b.conn)
    assert titles(b.conn) == {"做饭"}, f"删除未传播到 B：{titles(b.conn)}"


def test_both_devices_converge(wired, remote) -> None:
    """各改各的再各同步一次，两边应完全一致。"""
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "买菜")
    activate(a)
    E.sync_now(a.conn)

    b = make("B", remote)
    bring_online(activate, b)

    add_todo(a.conn, "t2", "做饭")
    delete_todo(b.conn, "t1")

    activate(a)
    E.sync_now(a.conn)
    activate(b)
    E.sync_now(b.conn)
    activate(a)
    E.sync_now(a.conn)

    assert titles(a.conn) == titles(b.conn), \
        f"未收敛：A={titles(a.conn)} B={titles(b.conn)}"
    assert exported(a.conn) == exported(b.conn), "收敛后导出快照应逐字节相同"


def test_push_failure_leaves_base_untouched_then_retries_succeed(wired, remote) -> None:
    """F-002 在真实链路上的回归。

    push 失败还落 base，会让 base 领先于远端；下一轮三方合并把那批变更判成
    「无需推送」，于是永远补不上——UI 只显示一条 warning，数据在另一台设备上
    静默消失。断言三件事：失败时不落 base、报 partial、重试能把变更补推上去。
    """
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "初始")
    activate(a)
    E.sync_now(a.conn)

    b = make("B", remote)
    bring_online(activate, b)

    add_todo(a.conn, "t2", "离线新增")
    remote.fail_with = "网络不可达"
    activate(a)
    out = E.sync_now(a.conn)

    assert out["result"] == "partial", out
    assert out.get("warning"), "必须留 warning 说明远端未更新"
    base_after_fail = (a.base_dir / "snapshot.json").read_text(encoding="utf-8")
    assert "离线新增" not in base_after_fail, "push 失败时 base 不该包含未推送的变更"

    remote.fail_with = None
    activate(a)
    assert E.sync_now(a.conn)["result"] == "ok"

    activate(b)
    E.sync_now(b.conn)
    assert "离线新增" in titles(b.conn), \
        f"重试后变更未补推，B 仍是：{titles(b.conn)}"


def test_needs_decision_raised_when_remote_has_data(wired, remote) -> None:
    """远端已有数据且本地无 base：必须让用户选合并方式，不能替他决定。"""
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "A的旧数据")
    activate(a)
    E.sync_now(a.conn)

    b = make("B", remote)
    add_todo(b.conn, "t9", "B的本地独有")
    activate(b)

    with pytest.raises(E.NeedsDecision) as ei:
        E.sync_now(b.conn)
    assert ei.value.remote_pulled >= 1


def test_resolve_first_bind_pull_overwrite_discards_local(wired, remote) -> None:
    """pull_overwrite：本地独有数据应被丢弃，全盘接受远端。"""
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "A的数据")
    activate(a)
    E.sync_now(a.conn)

    b = make("B", remote)
    add_todo(b.conn, "t9", "B会被丢弃")
    activate(b)
    E.resolve_first_bind(b.conn, "pull_overwrite")

    assert "B会被丢弃" not in titles(b.conn), "pull_overwrite 不应保留本地独有数据"
    assert "A的数据" in titles(b.conn)


def test_resolve_first_bind_merge_push_unions_both(wired, remote) -> None:
    """merge_push：两边并集，且合并结果要推回远端。"""
    make, activate = wired
    a = make("A", remote)
    add_todo(a.conn, "t1", "A的数据")
    activate(a)
    E.sync_now(a.conn)
    pushes_before = remote.pushes

    b = make("B", remote)
    add_todo(b.conn, "t9", "B的本地独有")
    activate(b)
    out = E.resolve_first_bind(b.conn, "merge_push")

    assert out["result"] == "ok", out
    assert {"A的数据", "B的本地独有"} <= titles(b.conn), titles(b.conn)
    assert remote.pushes == pushes_before + 1, "merge_push 必须把并集推回远端"

    activate(a)
    E.sync_now(a.conn)
    assert "B的本地独有" in titles(a.conn), "A 应在下一次同步收到 B 的数据"


def test_resolve_first_bind_rejects_unknown_mode(wired, remote) -> None:
    make, activate = wired
    a = make("A", remote)
    activate(a)
    with pytest.raises(E.SyncError):
        E.resolve_first_bind(a.conn, "随便写个模式")
