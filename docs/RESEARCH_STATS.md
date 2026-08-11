# 调研文档：统计面板（Research — 待用户确认，未实施）

> **状态**：🔬 调研阶段，仅方案分析，未动手实现。用户确认后再开工。
> **背景**：用户提出「统计（象限图）」想法——对日历 + TODO 数据做可视化复盘。本文梳理可用数据、统计维度、图表形态与实现路径。

## 1. 可用数据源（现有表结构，`tt_calendar/db.py`）

| 表 | 关键字段 | 可支撑的统计维度 |
|---|---|---|
| `events` | date、layer_id、source、title、extra_json、source_ref、sort_key、created_at | 事件量/日、按图层分布、按子动作（标题 `【…】`）分布、集思录导入量时间线 |
| `todo` | status、importance、due_date、**created_at、completed_at** | 完成率、完成趋势、逾期率、按列表/重要性分布、每日完成数 |
| `todo_list` | display_name | 按列表分组 |
| `coloring` | date、level (0..4) | 充实度分布、每周充实度热力 |
| `schedule` | date、am/pm/ev | 日程填写率 |
| `meta` | key/value | 系统信息（无业务统计价值） |

**关键点**：todo 表有 `completed_at`，是唯一带**完成时间戳**的数据 → 「每日完成数」折线/热力图可精确计算；events 无「事件产生时间线」之外的统计价值（都是已安排的全天事件）。

## 2. 用户诉求「象限图」拆解（推测 + 需确认）

「象限图」在中文产品语境常见两种含义：

1. **四象限（优先级矩阵）**：横轴=紧急度，纵轴=重要度，把待办散点落入四象限（经典时间管理法）。
2. **散点/分布图**：把「统计」理解成任意可视化图表的泛称。

结合本应用数据，**可落地的统计图**：

| 图表 | 数据 | 说明 |
|---|---|---|
| **四象限待办矩阵** | todo（importance + due_date） | 横轴=到期紧迫度（due_date 距今天数，横轴负方向=已逾期），纵轴=重要性（high/normal/low）；点=单个 todo，可勾选完成态 |
| **每日完成数** | todo.completed_at | 近 30/90 天折线或热力日历 |
| **待办状态分布** | todo.status | 环形图：未开始 / 进行中 / 已完成 |
| **重要性分布** | todo.importance | 柱状：high / normal / low 的完成率对比 |
| **事件图层分布** | events.layer_id | 柱状/环形：各图层事件数量 |
| **充实度热力** | coloring.level | 月历热力（红→绿 = 0..4 级） |

## 3. 推荐首期范围（P1 最小可用）

若只做「统计 Tab」+ 一个图表，推荐 **每日完成数折线 + 待办四象限矩阵**（两者最能体现「做了多少事、怎么分配精力」）：

- **后端**：`GET /api/stats/summary` → 聚合：
  - `daily_done`: 近 90 天 `completed_at` 按日 count（SQL `GROUP BY date(completed_at)`）
  - `quadrant`: todo（未完成 + 已完成近 7 天）带 importance/due_date/completed
  - `layer_counts`: events 按 layer_id count
- **前端**：新建 `StatsView.tsx`（顶级 Tab「统计」或设置页内嵌）：
  - 折线图：轻量 SVG 自绘（避免引 recharts 大依赖；本应用已有 lucide-react，SVG path 手绘 90 点折线 ~40 行）
  - 四象限：绝对定位散点（`left/right = 紧迫度归一化`, `top = 重要性`），hover 显示 todo 名
  - 环形图：CSS `conic-gradient` 实现，零依赖

## 4. 需要用户确认的分叉

| # | 问题 | 选项 |
|---|---|---|
| 1 | 「象限图」具体指 | A. 四象限待办矩阵（推荐） / B. 只要每日完成数 / C. 都要 |
| 2 | 统计入口 | 顶级 Tab「统计」（与日历/待办并列） / 设置页内嵌区块 |
| 3 | 时间范围 | 近 30 天 / 近 90 天 / 可切换 |
| 4 | 图表库 | 零依赖自绘（推荐，~150 行 SVG/CSS）/ 引 recharts（~+300KB，交互强） |
| 5 | 是否含事件/充实度统计 | 只做待办 / 待办+事件+充实度全量 |

## 5. 技术路径（推荐方案）

```
后端 GET /api/stats/summary
  ├─ daily_done:  SELECT date(completed_at) d, COUNT(*) FROM todo
  │               WHERE completed_at IS NOT NULL AND completed_at >= date('now','-90 day')
  │               GROUP BY d
  ├─ quadrant:    SELECT title, importance, due_date, status, completed_at FROM todo
  │               WHERE status != 'completed' OR completed_at >= date('now','-7 day')
  └─ layer_counts: SELECT layer_id, COUNT(*) FROM events GROUP BY layer_id

前端 StatsView.tsx（topTab='stats'）
  ├─ DailyDoneChart: <svg> polyline，90 个点 + 均值参考线 + 最大/最小标注
  ├─ QuadrantMatrix: 2x2 分区（紧-重/紧-轻/缓-重/缓-轻），散点 + hover tooltip
  └─ LayerRing: conic-gradient 环形 + 图例
```

数据量评估：todo 1228 条（含 1196 已完成）、events 千级，聚合查询均 <10ms，无缓存压力。

## 6. 风险与注意事项

- **completed_at 缺失**：早期导入的历史 todo 若 completed_at 为空但 status='completed'，每日完成数会漏计。对策：导入/补齐时若 status=completed 且无 completed_at，回填 created_at 或导入日。
- **四象限坐标语义**：紧迫度需定义「距 due_date 的天数」映射（due_date 为空 → 放最右侧「缓」区），避免空值散点聚集。
- 若引 recharts，需评估 Pake 壳 bundle 体积（当前 251KB JS，recharts 会 +200KB+）；首期建议零依赖。

## 7. 结论

**推荐 P1 = 统计 Tab + 每日完成数折线 + 四象限待办矩阵（零依赖 SVG/CSS 自绘）**，工作量约 3-4 小时。是否开工等用户确认。
