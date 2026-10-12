"""生成农历黄金向量（幂等、字节稳定）。

borax LunarDate 支持 1900-2100。农历经闰月与 29/30 日交替，是最容易出「看起来
对但差一天」的地方，而它此前零测试覆盖。本生成器把参考实现的输出固化成向量，
test_lunar_golden.py 对拍并断言「生成器输出 == 已落库向量」，防止两者一起漂移。

用法：python tests/gen_lunar_golden.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from borax.calendars.lunardate import LunarDate  # noqa: E402

from tt_calendar.utils.lunar_utils import lunar_display, next_lunar_occurrence  # noqa: E402

OUT = Path(__file__).resolve().parent / "golden" / "lunar_vectors.json"


def _display_cases() -> list[dict]:
    cases: list[dict] = []

    def add(d: date, why: str) -> None:
        cases.append({"name": f"display_{d.isoformat()}", "kind": "display",
                      "input": {"date": d.isoformat()}, "why": why,
                      "expect": lunar_display(d)})

    # borax 支持范围的两端
    add(date(1900, 1, 31), "borax 下界")
    add(date(1900, 2, 1), "borax 下界附近")
    add(date(2100, 12, 31), "borax 上界")

    # 农历元旦：正月初一显示月名而非「正月初一」
    add(date(2024, 2, 10), "正月初一 -> 只显月名")
    add(date(2025, 1, 29), "正月初一")
    add(date(2026, 2, 17), "正月初一")

    # 十二月三十（腊月）—— 腊月是「十二月」，显示为「腊月」；腊月可能只有廿九
    add(date(2025, 1, 28), "腊月廿九")
    add(date(2024, 2, 9), "腊月三十")

    # 中秋（八月十五）与端午（五月初五）
    add(date(2026, 9, 25), "八月十五")
    add(date(2026, 6, 19), "五月初五")

    # 闰月：2025 年闰六月，2023 年闰二月
    add(date(2025, 7, 25), "闰六月初一 -> 显「闰六月」")
    add(date(2025, 8, 23), "闰六月廿九/三十")
    add(date(2023, 3, 22), "闰二月初一")

    # 每个月初一各取一条，钉住「初一显月名」这条规则覆盖全年
    y = 2026
    for m in range(1, 13):
        for probe in range(1, 32):
            try:
                d = date(y, m, probe)
            except ValueError:
                continue
            if LunarDate.from_solar_date(d.year, d.month, d.day).day == 1:
                add(d, "当月初一")
                break

    # 每月的十五，钉住「月名 + 十五」
    for m in range(1, 13):
        for probe in range(1, 32):
            try:
                d = date(y, m, probe)
            except ValueError:
                continue
            if LunarDate.from_solar_date(d.year, d.month, d.day).day == 15:
                add(d, "当月十五")
                break

    return cases


def _occurrence_cases() -> list[dict]:
    cases: list[dict] = []

    def add(base: date, today: date, why: str) -> None:
        cases.append({
            "name": f"occurrence_{base.isoformat()}_from_{today.isoformat()}",
            "kind": "occurrence",
            "input": {"base": base.isoformat(), "today": today.isoformat()},
            "why": why,
            "expect": next_lunar_occurrence(base, today).isoformat(),
        })

    spring_2026 = date(2026, 2, 17)   # 正月初一
    mid_autumn = date(2026, 9, 25)    # 八月十五
    dragon_boat = date(2026, 6, 19)   # 五月初五

    # 基准日正好就是农历元旦，today 在其之前/当天/之后
    add(spring_2026, date(2026, 1, 1), "春节基准，today 在前 -> 命中本年")
    add(spring_2026, spring_2026, "today 恰为基准日本身")
    add(spring_2026, date(2026, 3, 1), "春节已过 -> 顺延到下个农历年")

    # today 在农历年边界附近：正月初一常落在公历 1-2 月，跨年推算最易差一年
    add(spring_2026, date(2027, 1, 5), "today 早于次年春节 -> 应为次年春节")
    add(spring_2026, date(2027, 2, 20), "today 晚于次年春节 -> 再下一年")

    # 非元旦基准
    add(mid_autumn, date(2026, 1, 1), "中秋基准")
    add(mid_autumn, date(2026, 10, 1), "中秋已过")
    add(dragon_boat, date(2026, 1, 1), "端午基准")

    # 闰月基准：目标年可能没有该闰月，按实现退回非闰月同日
    leap_base = date(2025, 7, 25)   # 闰六月初一
    add(leap_base, date(2026, 1, 1), "闰月基准退回非闰同日")
    add(leap_base, date(2027, 1, 1), "闰月基准跨年")

    # 公历 2 月末（接近春节）
    add(spring_2026, date(2026, 2, 10), "春节前一天")

    return cases


def run() -> list[dict]:
    return _display_cases() + _occurrence_cases()


def main() -> None:
    vectors = run()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"version": 1, "vectors": vectors},
                             ensure_ascii=False, indent=1),
                   encoding="utf-8", newline="\n")
    print(f"wrote {len(vectors)} vectors -> {OUT}")


if __name__ == "__main__":
    main()