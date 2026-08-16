"""农历工具（borax 封装）：显示字符串 + 农历重复日期推算。

borax LunarDate 支持范围 1900-2100；闰月日（如闰六月初一）在目标年份
无该闰月时退回非闰月同日（农历节日惯例：节日不设在闰月）。
"""

from datetime import date as date_t

from borax.calendars.lunardate import LunarDate

_CN_MONTHS = "正二三四五六七八九十冬腊"


def lunar_display(d: date_t) -> str:
    """公历日期 → 农历显示串。初一显示月名（「七月」），其余「七月初四」；闰月带「闰」前缀。"""
    ld = LunarDate.from_solar_date(d.year, d.month, d.day)
    month_name = ("闰" if ld.leap else "") + _CN_MONTHS[ld.month - 1] + "月"
    if ld.day == 1:
        return month_name
    return month_name + ld.cn_day


def next_lunar_occurrence(base_date: date_t, today: date_t) -> date_t:
    """农历年重复（春节=正月初一）的下一次公历日期。

    以 base_date 的农历月日为基准，找 >= today 的最近一次出现；
    跨农历年时顺延到下一农历年（春节在公历 1-2 月，农历年边界需先试当年再试下年）。
    """
    base = LunarDate.from_solar_date(base_date.year, base_date.month, base_date.day)
    for lunar_year in {LunarDate.from_solar_date(today.year, today.month, today.day).year,
                       today.year, today.year + 1}:
        try:
            cand = LunarDate(lunar_year, base.month, base.day, 0).to_solar_date()
        except ValueError:
            continue
        if cand >= today:
            return cand
    return base_date
