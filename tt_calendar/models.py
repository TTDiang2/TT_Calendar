"""数据模型（Pydantic v2）。

所有图层共用一个 Event 模型，通过 layer_id 区分。Schedule / Coloring 是
特殊形态（按天唯一、不是事件流），单独建表。
"""

from __future__ import annotations

from datetime import date as date_t, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class Event(BaseModel):
    """万能事件。

    每条事件属于一个图层 (layer_id)，来源于一个数据源 (source)。
    外部导入的事件用 source_ref 做去重，再次同步时更新而非重复插入。
    """

    id: Optional[int] = None
    layer_id: str
    source: str = "manual"  # 'manual' / 'jisilu' / 'chinese_calendar' / 'migrated'
    date: date_t
    title: str
    description: Optional[str] = None
    color: Optional[str] = None  # hex like '#FFE66F'
    # 自定义字段：AM/PM/EV、jisilu code/url、纪念日 offset、节假日调休标记等
    extra: dict[str, Any] = Field(default_factory=dict)
    source_ref: Optional[str] = None  # 外部源唯一 ID（去重/更新用）
    sort_key: int = 0  # 同一天多事件排序

    def key(self) -> str:
        """生成日历渲染时的去重 key（按 layer+source_ref）。"""
        return f"{self.layer_id}::{self.source_ref or self.title}"


class ScheduleEntry(BaseModel):
    """AM/PM/EV 三段日程（保留旧版结构）。"""

    date: date_t
    am: Optional[str] = None
    pm: Optional[str] = None
    ev: Optional[str] = None


class ScheduleItem(BaseModel):
    """带起止时间的单条日程（新结构，一天可多条）。"""

    id: Optional[int] = None
    date: date_t
    start_time: Optional[str] = None   # 'HH:MM'
    end_time: Optional[str] = None     # 'HH:MM'
    title: str
    color: Optional[str] = None
    category: str = "work"             # work/course/sport/play/other
    sort_order: int = 0


class ColoringEntry(BaseModel):
    """5 档充实度染色。"""

    date: date_t
    level: int  # 0..4


class Mark(BaseModel):
    """涂色标记（打卡/自定义完成度）。按 layer_id+date 唯一，不进 events 表。

    打卡(solid)：level=None，仅记录"打卡了"；
    完成度(graded)：level=0..4，对应图层 palette 的档位。
    """

    id: Optional[int] = None
    layer_id: str
    date: date_t
    level: Optional[int] = None
    note: Optional[str] = None
    created_at: Optional[datetime] = None


class LayerConfig(BaseModel):
    """图层配置（在 sidebar 中显示）。"""

    layer_id: str
    display_name: str
    enabled: bool = True
    color: Optional[str] = None  # 图层主色（用于侧栏图标、色点）
    sort_order: int = 0
    kind: str = "color"  # 'color'（涂色）| 'dot'（点点）
    group: Optional[str] = None  # 二级分组名（如"日程"/"集思录"/"约饭"）
    config: dict[str, Any] = Field(default_factory=dict)


class ImportResult(BaseModel):
    """导入源同步结果。"""

    source: str
    layer_id: str
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    error: Optional[str] = None
    finished_at: datetime = Field(default_factory=datetime.now)


class TodoList(BaseModel):
    """待办列表（任务分组容器）。"""

    id: str
    display_name: str
    sort_order: int = 0
    created_at: Optional[datetime] = None


class Todo(BaseModel):
    """单条待办任务。"""

    id: str
    list_id: str
    title: str
    body: Optional[str] = None
    status: str = "notStarted"      # notStarted|inProgress|completed|waitingOnOthers|deferred
    importance: str = "normal"      # low|normal|high
    due_date: Optional[date_t] = None      # 截止日期（DDL）
    planned_date: Optional[date_t] = None  # 计划日期（今天规划要做）
    start_date: Optional[date_t] = None
    complexity: str = "medium"      # simple|medium|hard
    tags: Optional[list[str]] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    sort_order: int = 0


class Countdown(BaseModel):
    """倒数日（独立表，日期动态计算）。

    base_date 为基准日期；repeat_yearly 表示每年重置（生日/节日）；
    repeat_type='solar' 按公历月日重复，'lunar' 按农历月日重复（春节=正月初一，
    公历日期年年不同）；milestone_rule 为里程碑规则（如 "100,365,520,1000,3650"），
    从 base_date 起自动推算特殊日子；never_expire 表示过期后
    不显示「已过 N 天」（纪念日类事件）。
    """

    id: Optional[int] = None
    name: str
    category: str = "其他"          # 生日/纪念日/节日/重要事件/自定义
    base_date: date_t
    repeat_yearly: bool = False
    repeat_type: str = "solar"      # solar | lunar
    milestone_rule: Optional[str] = None  # 逗号分隔天数
    never_expire: bool = False
    notes: Optional[str] = None
    color: Optional[str] = None
    sort_order: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class Subscription(BaseModel):
    """订阅：外部日历数据源。

    内置订阅（source_key='jisilu'）开箱即用；自定义订阅由用户登记
    url/rules_text（自然语言需求单，给 agent 读），status='pending' 等 agent 适配。
    适配规范见 docs/SUBSCRIPTION_SPEC.md。
    """

    id: str                        # 内置固定 id（builtin:jisilu）；自定义用 uuid
    display_name: str
    source_key: str                # jisilu / custom:<slug>（agent 适配后改为实际 key）
    url: Optional[str] = None
    rules_text: Optional[str] = None   # 自然语言抓取规则（给 agent 的需求单）
    enabled: bool = True
    auto_update: bool = True       # 打开应用时自动拉取（一年一更的可关）
    status: str = "active"         # active | pending | error
    last_synced_at: Optional[str] = None
    config_json: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
