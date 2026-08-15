"""生成同步合并协议的 golden vectors（幂等，可重复运行）。

用 merge.py 参考实现跑一组精心构造的场景，输出 JSON 测试向量。
TS/Rust 实现对拍此文件全绿 = 与 Python 实现行为一致。

运行：python tests/gen_golden.py
校验幂等：连续两次运行输出零 diff（CI 中执行）。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tt_calendar.sync.merge import first_bind_merge, merge

OUT = Path(__file__).resolve().parent / "golden" / "merge_vectors.json"


def row(k, title, ts, status="notStarted", extra=None):
    r = {"id": k, "title": title, "updated_at": ts, "status": status}
    if extra:
        r.update(extra)
    return r


def urow(uid, title, ts):
    return {"sync_uid": uid, "title": title, "updated_at": ts}


def d(*rows):
    return {"todo": list(rows)}


def vec(name, kind, **kw):
    return {"name": name, "kind": kind, **kw}


VECTORS = []


def build_vectors():
    # ---- 行合并基本分支 ----
    base = d(row("t1", "a", "2026-01-01 10:00:00"))
    VECTORS.append(vec("no_change", "merge",
                       base=base, remote=d(row("t1", "a", "2026-01-01 10:00:00")),
                       local=d(row("t1", "a", "2026-01-01 10:00:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    VECTORS.append(vec("pull_only", "merge",
                       base=base, local=base,
                       remote=d(row("t1", "a2", "2026-01-01 11:00:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    VECTORS.append(vec("push_only", "merge",
                       base=base, remote=base,
                       local=d(row("t1", "a3", "2026-01-01 12:00:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    VECTORS.append(vec("conflict_local_newer", "merge",
                       base=base,
                       remote=d(row("t1", "r-edit", "2026-01-01 11:00:00")),
                       local=d(row("t1", "l-edit", "2026-01-01 12:00:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    VECTORS.append(vec("conflict_remote_newer", "merge",
                       base=base,
                       remote=d(row("t1", "r-edit", "2026-01-01 13:00:00")),
                       local=d(row("t1", "l-edit", "2026-01-01 12:00:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # 平局：updated_at 相同 → local 胜
    VECTORS.append(vec("conflict_tie_local_wins", "merge",
                       base=base,
                       remote=d(row("t1", "r-edit", "2026-01-01 12:00:00")),
                       local=d(row("t1", "l-edit", "2026-01-01 12:00:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # 时间戳缺失（空串）：存在方胜过 absent；双边缺失 → local
    VECTORS.append(vec("missing_ts_remote_wins_over_absent", "merge",
                       base=d(), local=d(),
                       remote=d({"id": "t9", "title": "no-ts", "updated_at": ""}),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # 双边独立新增不同行（无冲突，都保留）
    VECTORS.append(vec("both_add_different_rows", "merge",
                       base=d(),
                       remote=d(row("r1", "remote-new", "11:00")),
                       local=d(row("l1", "local-new", "12:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # 双边新增同 key 不同内容 → 冲突 LWW
    VECTORS.append(vec("both_add_same_key", "merge",
                       base=d(),
                       remote=d(row("x1", "from-remote", "11:00")),
                       local=d(row("x1", "from-local", "12:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # 完全一致的新增 → 无冲突
    VECTORS.append(vec("both_add_identical", "merge",
                       base=d(),
                       remote=d(row("x1", "same", "11:00")),
                       local=d(row("x1", "same", "11:00")),
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # ---- 删除 / 墓碑 ----
    # 远端删除（墓碑）vs 本地未动 → 删除胜
    VECTORS.append(vec("remote_delete_wins", "merge",
                       base=base, local=base, remote=d(),
                       base_tombs={}, local_tombs={},
                       remote_tombs={("todo", "t1"): "2026-01-01 11:00:00"}))

    # 远端墓碑 vs 本地修改（行胜：本地改更晚）
    VECTORS.append(vec("local_edit_beats_tombstone", "merge",
                       base=base, remote=d(),
                       local=d(row("t1", "edited", "2026-01-01 12:00:00")),
                       base_tombs={},
                       remote_tombs={("todo", "t1"): "2026-01-01 11:00:00"},
                       local_tombs={}))

    # 墓碑更晚 → 删除胜（即便本地也改过）
    VECTORS.append(vec("tombstone_newer_beats_edit", "merge",
                       base=base, remote=d(),
                       local=d(row("t1", "edited", "2026-01-01 12:00:00")),
                       base_tombs={},
                       remote_tombs={("todo", "t1"): "2026-01-01 13:00:00"},
                       local_tombs={}))

    # 墓碑 == 行时间戳 → 行胜（复活）边界
    VECTORS.append(vec("tombstone_equal_revives", "merge",
                       base=base, remote=d(),
                       local=d(row("t1", "edited", "2026-01-01 12:00:00")),
                       base_tombs={},
                       remote_tombs={("todo", "t1"): "2026-01-01 12:00:00"},
                       local_tombs={}))

    # 本地删除 → 推送删除
    VECTORS.append(vec("local_delete_pushes", "merge",
                       base=base, remote=base, local=d(),
                       base_tombs={}, remote_tombs={},
                       local_tombs={("todo", "t1"): "2026-01-01 12:00:00"}))

    # 墓碑并集取新
    VECTORS.append(vec("tombstone_union_newer_wins", "merge",
                       base=d(), remote=d(), local=d(),
                       base_tombs={},
                       remote_tombs={("todo", "t1"): "2026-01-01 13:00:00",
                                     ("todo", "t2"): "2026-01-01 09:00:00"},
                       local_tombs={("todo", "t1"): "2026-01-01 10:00:00"}))

    # 墓碑指向不存在的行 → 原样保留墓碑
    VECTORS.append(vec("tombstone_for_absent_row_kept", "merge",
                       base=d(), remote=d(), local=d(),
                       base_tombs={},
                       remote_tombs={("todo", "ghost"): "2026-01-01 10:00:00"},
                       local_tombs={}))

    # ---- 自增表（sync_uid 行身份）----
    VECTORS.append(vec("auto_table_merge", "merge",
                       base={"marks": [urow("u1", "m-a", "10:00")]},
                       remote={"marks": [urow("u1", "m-r", "11:00")]},
                       local={"marks": [urow("u1", "m-a", "10:00"),
                                        urow("u2", "new-local", "12:00")]},
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # ---- 多表混合 ----
    VECTORS.append(vec("multi_table", "merge",
                       base={"todo": [row("t1", "a", "10:00")],
                             "coloring": [{"date": "2026-01-01", "level": 2,
                                           "updated_at": "10:00"}]},
                       remote={"todo": [row("t1", "a", "10:00")],
                               "coloring": [{"date": "2026-01-01", "level": 4,
                                             "updated_at": "11:00"}]},
                       local={"todo": [row("t1", "a-rw", "12:00")],
                              "coloring": [{"date": "2026-01-01", "level": 2,
                                            "updated_at": "10:00"}]},
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # ---- 表集合完整性：本地独有表 ----
    VECTORS.append(vec("local_only_table_in_merge", "merge",
                       base={"todo": [row("t1", "a", "10:00")]},
                       remote={"todo": [row("t1", "a2", "11:00")]},
                       local={"todo": [row("t1", "a", "10:00")],
                              "marks": [urow("u9", "local-only", "10:00")]},
                       base_tombs={}, remote_tombs={}, local_tombs={}))

    # ---- 首次绑定 ----
    VECTORS.append(vec("first_bind_pull_overwrite", "first_bind",
                       mode="pull_overwrite",
                       remote=d(row("r1", "remote", "11:00")),
                       local=d(row("l1", "local", "12:00"),
                               row("r1", "local-older", "09:00")),
                       remote_tombs={}, local_tombs={}))

    VECTORS.append(vec("first_bind_pull_overwrite_local_only_table", "first_bind",
                       mode="pull_overwrite",
                       remote=d(row("r1", "remote", "11:00")),
                       local={"todo": [row("r1", "local-older", "09:00")],
                              "marks": [urow("u1", "m", "10:00")]},
                       remote_tombs={}, local_tombs={}))

    VECTORS.append(vec("first_bind_merge_push_union", "first_bind",
                       mode="merge_push",
                       remote=d(row("r1", "remote", "11:00")),
                       local=d(row("l1", "local", "12:00")),
                       remote_tombs={}, local_tombs={}))

    VECTORS.append(vec("first_bind_merge_push_conflict_lww", "first_bind",
                       mode="merge_push",
                       remote=d(row("x1", "from-remote", "13:00")),
                       local=d(row("x1", "from-local", "12:00")),
                       remote_tombs={}, local_tombs={}))


def key_str(k):
    table, row_key = k
    return f"{table}|{row_key}"


def run():
    build_vectors()
    out = []
    for v in VECTORS:
        if v["kind"] == "merge":
            result = merge(v.pop("base"), v.pop("remote"), v.pop("local"),
                           v.pop("base_tombs"), v.pop("remote_tombs"),
                           v.pop("local_tombs"))
        else:
            result = first_bind_bind(v)
        out.append({
            "name": v["name"],
            "kind": v["kind"],
            "input": {k: _norm(x) for k, x in v.items() if k not in ("name", "kind")},
            "expect": {
                "data": {t: sorted(rows, key=lambda r: json.dumps(r, sort_keys=True))
                         for t, rows in sorted(result["data"].items())},
                "tombstones": {key_str(k): dt for k, dt in sorted(result["tombstones"].items())},
                "report": result["report"],
            },
        })
    return out


def first_bind_bind(v):
    return first_bind_merge(v.pop("mode"), v.pop("remote"), v.pop("local"),
                            v.pop("remote_tombs"), v.pop("local_tombs"))


def _norm(x):
    """向量文件里墓碑统一用 "table|key" 字符串键并按键排序（跨进程哈希随机化
    会导致 dict 迭代序不稳定，排序保证幂等），其余原样。"""
    if isinstance(x, dict) and x and all(isinstance(k, tuple) for k in x):
        return {key_str(k): x[k] for k in sorted(x)}
    if isinstance(x, dict):
        return {k: _norm(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_norm(i) for i in x]
    return x


def main():
    vectors = run()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({"version": 1, "vectors": vectors},
                      ensure_ascii=False, indent=1)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {len(vectors)} vectors -> {OUT}")


if __name__ == "__main__":
    main()
