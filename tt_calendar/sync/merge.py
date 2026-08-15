"""三方合并（纯函数，不碰 db）：base + remote + local + 三方墓碑 → 合并结果 + 报告。

行合并产出候选集，墓碑随后做删除裁决：
- 行胜条件：行.updated_at >= 墓碑.deleted_at（相等视为行胜，避免同秒抖动）
- 两边都改且内容不同 → updated_at 字符串大者胜（LWW，本地优先）
"""

from .snapshot import Upsert, Deletes, Tombstones

Data = Upsert
Row = dict


def _by_key(rows: list[Row], key: str) -> dict[str, Row]:
    return {r[key]: r for r in rows if r.get(key)}


def merge(
    base: Data | None,
    remote: Data,
    local: Data,
    base_tombs: Tombstones,
    remote_tombs: Tombstones,
    local_tombs: Tombstones,
    diff_local: Data | None = None,
) -> dict:
    """diff_local：计算 upsert/deletes 差集的基准（默认=local）。
    pull_overwrite 场景合并参与者传空、差集基准传真实本地。"""
    tables = set(remote) | set(local) | set(diff_local or {}) | set(base or {})
    merged: Data = {}
    upsert: Data = {}
    deletes: Deletes = {}
    report = {"pulled": 0, "pushed": 0, "conflicts": 0, "deleted": 0, "revived": 0}

    for table in tables:
        key = _key_of(table)
        if key is None:
            continue
        b = _by_key((base or {}).get(table, []), key)
        r = _by_key(remote.get(table, []), key)
        l = _by_key(local.get(table, []), key)

        out: dict[str, Row | None] = {}
        for k in set(b) | set(r) | set(l):
            brow, rrow, lrow = b.get(k), r.get(k), l.get(k)
            if rrow == lrow:
                out[k] = rrow
            elif brow == rrow:
                out[k] = lrow
                if lrow is not None:
                    report["pushed"] += 1
            elif brow == lrow:
                out[k] = rrow
                if rrow is not None:
                    report["pulled"] += 1
            else:
                win = _lww(lrow, rrow)
                out[k] = win
                report["conflicts"] += 1
                if win is lrow:
                    report["pushed"] += 1
                else:
                    report["pulled"] += 1
        merged[table] = {k: v for k, v in out.items() if v is not None}

    tombs: Tombstones = dict(local_tombs)
    for k2, dt in remote_tombs.items():
        if dt > tombs.get(k2, ""):
            tombs[k2] = dt

    for (table, k), dt in list(tombs.items()):
        row = merged.get(table, {}).get(k)
        if row is None:
            continue
        if dt > str(row.get("updated_at") or ""):
            del merged[table][k]
        else:
            del tombs[(table, k)]
            report["revived"] += 1

    diff_src = local if diff_local is None else diff_local
    for table, rows in merged.items():
        key = _key_of(table)
        local_now = _by_key(diff_src.get(table, []), key)
        upsert[table] = [row for k2, row in rows.items()
                         if row is not None and row != local_now.get(k2)]
        for k2 in local_now:
            if k2 not in rows:
                deletes.setdefault(table, []).append(k2)
                report["deleted"] += 1

    return {
        "data": {t: [row for row in rows.values() if row is not None]
                 for t, rows in merged.items()},
        "upsert": upsert,
        "deletes": deletes,
        "tombstones": tombs,
        "report": report,
    }


def first_bind_merge(mode: str, remote: Data, local: Data,
                     remote_tombs: Tombstones, local_tombs: Tombstones) -> dict:
    """首次绑定（无 base）。pull_overwrite：远端覆盖；merge_push：全量并集 + LWW。"""
    if mode == "pull_overwrite":
        return merge(None, remote, {}, {}, remote_tombs, {}, diff_local=local)
    return merge({}, remote, local, {}, remote_tombs, local_tombs)


def _lww(lrow: Row | None, rrow: Row | None) -> Row | None:
    if lrow is None:
        return rrow
    if rrow is None:
        return lrow
    lt = str(lrow.get("updated_at") or "")
    rt = str(rrow.get("updated_at") or "")
    return lrow if lt >= rt else rrow


def _key_of(table: str) -> str | None:
    from .schema import SYNC_TABLES
    cfg = SYNC_TABLES.get(table)
    return cfg[1] if cfg else None
