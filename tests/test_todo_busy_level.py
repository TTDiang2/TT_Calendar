"""充实度染色（README 首屏卖点「5 档染色」）的评分逻辑。

此前这条路径零断言：把 aggregator 里的 day_busy 读取改成 `busy = None`，
261 个测试全绿——整个特性可以无声坏死。本文件把它钉住。

顺带钉住一个真实缺陷：设置面板的权重以「高/中/低」为键，而 Todo 模型的词汇是
low|normal|high 与 simple|medium/hard，两套词汇没有任何映射。原先直接
`comp.get(t.complexity)` 永远 miss 并回落到 medium，于是 hard 与 simple 得分
完全相同，用户调「复杂度」对评分毫无作用——配置里的 high/low 是死键。
"""

from __future__ import annotations

import sys
from copy import deepcopy
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import aggregator as _bd  # noqa: E402
from backend.aggregator import compute_todo_busy_level  # noqa: E402
from tt_calendar import db  # noqa: E402
from tt_calendar.models import Todo  # noqa: E402

D = date(2026, 8, 10)
OTHER = date(2026, 8, 11)
CFG = db.DEFAULT_TODO_BUSY_CONFIG


def todo(*, imp: str = "normal", cx: str = "medium",
         due: date | None = None, planned: date | None = None) -> Todo:
    return Todo(id="t", list_id="L", title="t", importance=imp,
                complexity=cx, due_date=due, planned_date=planned)


def level(todos: list[Todo], cfg: dict = CFG) -> int | None:
    return compute_todo_busy_level(D, todos, cfg)


# ------------------------------------------------------------------ 基本契约


def test_no_todos_returns_none() -> None:
    assert level([]) is None, "无todo 时不该染色"


@pytest.mark.parametrize("imp,cx,expected", [
    # 默认权重：due 5 / planned 3 / importance{high3,medium2,low1} / complexity{high2,medium1.5,low1}
    # thresholds [0,3,8,15,25] → 得分 1 落档 0，3 落档 1
    ("low", "simple", 0),      # 1*1   = 1
    ("normal", "medium", 1),   # 2*1.5 = 3  → 恰好等于 thresholds[1]
    ("high", "hard", 1),       # 3*2   = 6
])
def test_single_todo_levels(imp: str, cx: str, expected: int) -> None:
    assert level([todo(imp=imp, cx=cx)]) == expected


def test_threshold_is_inclusive_at_lower_edge() -> None:
    """得分恰好等于阈值应落上一档（>= 而非 >）；改成 > 会让整档色块偏移。"""
    assert CFG["thresholds"][1] == 3
    assert level([todo(imp="normal", cx="medium")]) == 1, "score==3 应落档 1"


def test_unknown_importance_and_complexity_fall_back_to_medium() -> None:
    base = level([todo(imp="normal", cx="medium")])
    assert level([todo(imp="??", cx="??")]) == base, "未知取值应回落到 medium 权重"


# ------------------------------------------------------------------ 日期权重


def test_due_date_adds_its_weight() -> None:
    """normal/medium 得3 分，加 due(5) 得 8 → 落档 2。"""
    assert level([todo(due=D)]) == 2


def test_planned_date_adds_its_weight() -> None:
    """normal/medium 得 3 分，加 planned(3) 得 6 → 仍落档 1。"""
    assert level([todo(planned=D)]) == 1


def test_due_on_other_day_adds_nothing() -> None:
    assert level([todo(due=OTHER)]) == level([todo()]), "非当天的 due 不该计分"


def test_due_and_planned_same_day_double_count() -> None:
    """同一天既是截止又是计划时两项都要计。

    数据层 fetch_todos_between 会为同一天的 due 与 planned 各返回一条，评分必须
    与之对齐；若改成 elif 二选一，这里会从 9.5 掉到 6.5，档位从 2 掉到 1。
    """
    low_medium = todo(imp="low", cx="medium", due=D, planned=D)
    assert level([low_medium]) == 2, "due+planned 必须双计"


# ------------------------------------------------------------------ 档位阶梯


def test_reaches_top_level() -> None:
    """两个 high/hard 且 due+planned 全中：(6+5+3)*2 = 28 ≥ 25 → 档 4。"""
    heavy = [todo(imp="high", cx="hard", due=D, planned=D) for _ in range(2)]
    assert level(heavy) == 4


def test_levels_are_monotonic_in_score() -> None:
    """档位必须随分数单调不降。"""
    seen = [level([todo(imp="low", cx="simple") for _ in range(n)])
            for n in range(1, 8)]
    assert seen == sorted(seen), f"档位非单调：{seen}"


# ------------------------------------------------------------------ 配置生效


def test_user_tuned_complexity_weight_actually_applies() -> None:
    """本次修复的回归：调复杂度权重必须真的改变评分。

    修复前 complexity 的 high/low 是永远匹配不到的死键——无论怎么调，hard 与
    simple 都得 medium 分，档位恒等。
    """
    cfg = deepcopy(CFG)
    cfg["weights"]["complexity"] = {"low": 0.0, "medium": 0.0, "high": 10.0}
    # 阈值必须仍是 5 项：评分函数按 range(4, -1, -1) 硬编码遍历 5 档，
    # 与 API 层 min_length=5/max_length=5 的校验是同一套约束。
    cfg["thresholds"] = [0, 1, 2, 3, 4]

    assert level([todo(cx="simple")], cfg) == 0, "simple 映射到 low=0 → 档 0"
    assert level([todo(cx="hard")], cfg) == 4, "hard 映射到 high=10 → 满档"


def test_user_tuned_importance_weight_actually_applies() -> None:
    cfg = deepcopy(CFG)
    cfg["weights"]["importance"] = {"low": 0.0, "medium": 0.0, "high": 10.0}
    cfg["thresholds"] = [0, 1, 2, 3, 4]

    assert level([todo(imp="low")], cfg) == 0
    assert level([todo(imp="high")], cfg) == 4
    # normal 必须落在 medium 档（设置面板的「中」），而不是 high
    assert level([todo(imp="normal")], cfg) == 0, "normal 应对应设置里的「中」"


def test_complexity_levels_are_distinguishable_by_default() -> None:
    """默认配置下 simple/medium/hard 必须给出不同得分。

    两条 low 重要度的 todo：simple 得 2×(1×1)=2 → 档 0，hard 得 2×(1×2)=4 → 档 1。
    修复前两者都落到 medium 权重 1.5，得 3，档位恒为 1。
    """
    def two(cx: str) -> list[Todo]:
        return [todo(imp="low", cx=cx) for _ in range(2)]

    assert level(two("simple")) == 0, "2×(1×1)=2 → 档 0"
    assert level(two("medium")) == 1, "2×(1×1.5)=3 → 档 1"
    assert level(two("hard")) == 1, "2×(1×2)=4 → 档 1，但与 simple 已不同"


# ------------------------------------------------------------------ day 组装


def _build_day(day_busy: dict | None):
    """只关心充实度档位的透传，其余入参给空即可。

    直调私有函数是刻意的：审查发现的存活变异就在这一层，走公开 API 会把
    「评分 → 落库 → 读取 → 渲染」全串起来，失败时定位不到具体环节。
    """
    return _bd._build_day(
        d=D, events_by_date={}, schedule={}, schedule_items_by_date={},
        coloring={}, gradient={}, todos_by_date={}, today=date(2026, 1, 1),
        view_year=2026, view_month=8, day_busy=day_busy,
    )


def test_day_carries_through_busy_levels() -> None:
    """day_busy 里的档位必须真的进到当天输出里。

    评分算对了不代表染得出来：这里守住 _build_day 的读取环节——把
    `busy = day_busy.get(d) if day_busy else None` 改成 `busy = None` 时，
    整条「5 档染色」静默失效而其余测试全绿。
    """
    out = _build_day({D: (3, 1)})
    assert out["predict_level"] == 3, f"预测档位未透传：{out}"
    assert out["done_level"] == 1, f"实际档位未透传：{out}"


def test_day_without_busy_data_has_no_levels() -> None:
    assert _build_day(None)["predict_level"] is None
    assert _build_day({})["predict_level"] is None


def test_day_missing_this_date_has_no_levels() -> None:
    """day_busy 里有别的日期，不代表今天也有档位。"""
    assert _build_day({OTHER: (2, 0)})["predict_level"] is None
