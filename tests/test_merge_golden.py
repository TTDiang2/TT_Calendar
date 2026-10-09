"""三方合并的 golden 向量对拍。

这套向量此前在三层上都失效，等于没有覆盖：
1. `gen_golden.py` 先用`v.pop(...)` 就地取参，算完再用 `v.items()` 构造input，
   键已被pop 干净 → 每个向量的 input 都是 {}，文件无法驱动任何测试；
2. 前端`merge.golden.test.ts` 靠 `describe.skipIf` 等一个从未实现的 TS merge
   （`__TT_CORE_MERGE__` 全仓无人赋值），25 个断言永远skip；
3. 没有任何 Python 测试读这个文件——`test_merge.py` 用的是内联数据。

现把消费方接到Python 侧：合并是数据一致性的核心，24 条精选向量（20 merge +
4 first_bind）比手写用例更能覆盖边界。合并逻辑只存在于后端，前端不做合并，
故不存在「跨语言漂移」需要守——那份 TS 壳已删除。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar.sync.merge import first_bind_merge, merge  # noqa: E402

VECTORS_PATH = ROOT / "tests" / "golden" / "merge_vectors.json"
VECTORS = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))["vectors"]


def _tombstones(flat: dict) -> dict:
    """把 {"table|key": dt} 还原成 merge 需要的 {(table, key): dt}。"""
    return {tuple(k.split("|", 1)): v for k, v in flat.items()}


def _norm_data(data: dict) -> dict:
    """与生成器同口径：表名排序、行内JSON 排序，消除无序差异。"""
    return {t: sorted(rows, key=lambda r: json.dumps(r, sort_keys=True))
            for t, rows in sorted(data.items())}


def _flat_tombs(tombs: dict) -> dict:
    return {f"{t}|{k}": dt for (t, k), dt in sorted(tombs.items())}


def _run(v: dict) -> dict:
    inp = v["input"]
    if v["kind"] == "merge":
        return merge(inp["base"], inp["remote"], inp["local"],
                     _tombstones(inp["base_tombs"]), _tombstones(inp["remote_tombs"]),
                     _tombstones(inp["local_tombs"]))
    return first_bind_merge(inp["mode"], inp["remote"], inp["local"],
                            _tombstones(inp["remote_tombs"]),
                            _tombstones(inp["local_tombs"]))


def test_vectors_are_usable() -> None:
    """守卫向量文件本身：input 为空的向量驱动不了任何东西。"""
    assert len(VECTORS) >= 24, f"向量数异常：{len(VECTORS)}"
    empty = [v["name"] for v in VECTORS if not v["input"]]
    assert not empty, f"这些向量的 input 为空，无法驱动 merge：{empty}"


@pytest.mark.parametrize("v", VECTORS, ids=[v["name"] for v in VECTORS])
def test_golden_vector(v: dict) -> None:
    result = _run(v)
    expect = v["expect"]
    assert _norm_data(result["data"]) == expect["data"], f"{v['name']}: 合并结果不一致"
    assert _flat_tombs(result["tombstones"]) == expect["tombstones"], \
        f"{v['name']}: 墓碑不一致"
    assert result["report"] == expect["report"], f"{v['name']}: 报告不一致"


def test_vectors_match_generator() -> None:
    """向量文件必须与生成器输出一致——否则它会悄悄过期而没人知道。

    没有这条，改了 merge 语义后旧向量仍能被对上（或对上不该对上的），金色对拍
    就失去了意义。
    """
    sys.path.insert(0, str(ROOT / "tests"))
    import gen_golden  # noqa: PLC0415

    assert gen_golden.run() == VECTORS, \
        "merge_vectors.json 与 gen_golden.py 输出不一致，请重新生成"
