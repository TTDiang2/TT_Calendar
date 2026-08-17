# 待办多视图设计（TODO_VIEWS_DESIGN）

> 状态：已实施（v2.2.x）。四项识别逻辑已于 2026-08-17 与用户确认。

## 1. 设计理念

一个待办清单在不同时刻回答不同的问题。单一列表视图只回答「接下来做什么」，
其余问题——优先级是否失衡、工作怎么分布、时间跨度多长、今天装了多满——都需要切换视角才能看见。

五个视图各自回答一个问题：

| 视图 | 回答的问题 | 使用时机 |
|---|---|---|
| 列表 | 接下来做什么？ | 日常执行 |
| 矩阵 | 什么被推着走、什么被忽视了？ | 每周复盘优先级 |
| 看板 | 工作在某维度上怎么分布？ | 分组透视、拖动整理 |
| 甘特图 | 每件事拖了多久、还剩多久？ | 时间线审视、发现长尾 |
| 量筒 | 今天装了多少大块与零碎？ | 每天开工前估算容量 |

所有视图共享同一份未完成数据、左列表栏与标签筛选——视图是「透镜」，不是独立功能。

## 2. 已确认的识别逻辑

### 2.1 紧急度（矩阵横轴）

**due 优先 + planned 兜底**（用户确认）：

```
有 due_date：
  剩余天数 slack = (due - today).days
  slack < 0            → 紧急（已过期，最靠前）
  slack ≤ 3            → 紧急
  3 < slack ≤ 7        → 临近（黄色缓冲带）
  slack > 7            → 不紧急
无 due_date 但有 planned_date：
  planned ≤ today      → 紧急（计划日已到/已过还没做）
  planned 在未来       → 不紧急（还没到动工时间）
两者都无               → 不紧急
```

矩阵只分「紧急 / 不紧急」两档；「临近」作为卡片上的黄色角标提示，
落轴时临近算不紧急（4-7 天的缓冲不该占用第一象限的注意力）。

### 2.2 重要性（矩阵纵轴）

`importance: high = 重要；normal / low = 不重要`（用户确认）。
经典二分，第一象限只留真正重要的事，逼自己少排高优先级。

### 2.3 甘特图日期规则（用户定义）

```
start = created_at（创建日；缺省 fallback planned_date / due_date / today）
end   优先级：completed → completed_at
              否则有 due_date → due_date
              否则有 planned_date → planned_date
              否则 → start（当天一个点）
```

过期未完成的任务条从 start 延伸到 today 并标红（虚拟 end = today，红色示警）。

### 2.4 量筒大块识别（用户确认）

- 范围：今日待办（未完成且 due=今天 或 planned=今天）+ 今日已完成（completed_at=今天，沉底半透明）
- 大小块：纯复杂度三档 —— `hard = 岩石，medium = 卵石，simple = 沙子`
- 重要性不改变块的大小，用描边色体现（high = 红描边）
- 已完成 → 半透明 + 对勾，沉在筒底

## 3. TopBar 集成

待办 tab 的 TopBar 与日历 tab 同构：标题右侧一组视图切换按钮
`列表 / 矩阵 / 看板 / 甘特 / 量筒`，选中态与日历月/周/日/年按钮一致。
选择持久化到 localStorage（`todo-view`），默认列表。

## 4. 各视图设计

### 4.1 矩阵（艾森豪威尔）

- 2×2 网格：横轴紧急度，纵轴重要度
- 四象限标题沿用经典行动指引：
  - 重要×紧急 →「立即做」
  - 重要×不紧急 →「规划做」（矩阵的核心价值区）
  - 不重要×紧急 →「快速清」
  - 不重要×不紧急 →「 reconsider（考虑丢）」
- 卡片 = 迷你待办卡（标题 + 逾期天数/紧急角标），点击打开右侧详情
- 象限计数显示在标题行；只展示未完成（含 inProgress/waiting/deferred）
- 「临近」状态（3 < slack ≤ 7）在卡片右上角黄色角标提示

### 4.2 看板

- 顶部一个维度切换器（五个维度，用户指定）：
  1. **按状态**：notStarted / inProgress / waitingOnOthers / deferred / completed
  2. **按计划日期**：同一 planned_date 的卡片同一纵列，按日期升序
  3. **按重要性**：高 / 中 / 低 三列
  4. **按复杂度**：困难 / 中等 / 简单 三列
  5. **按标签**：每个 tag 一列 + 「无标签」列
- 列内按现有 sort 排序；列头显示计数
- 拖拽：按状态维度下可拖卡片换状态（跨列拖动 = 改 status）；
  其他维度暂不提供拖拽改值（避免误改 planned_date 等结构数据）

### 4.3 甘特图

- 行 = 待办，按 start 排序；列 = 日期（自动缩放：最早 start → max(end, today) + 少量余量）
- 每行一个条：start → end；today 竖线；过期未完成条标红到 today
- 完成的条变绿带对勾；进行中蓝色；未开始灰色
- 周末列浅灰底纹；月份分界线 + 月份标签
- 时间窗超过 ~120 天时自动按周聚合刻度，避免列宽爆炸

### 4.4 量筒（岩石/卵石/沙子）

- 左侧：SVG 玻璃罐，岩石（hard，大圆角多边形）、卵石（medium，椭圆）、
  沙子（simple，小圆点簇）从下往上堆；已完成沉底半透明
- 堆放顺序寓意「先装大石头」：岩石最先入筒（底部），卵石次之，沙子填缝
- 右侧图例 + 分类清单（每块石头可点击 → 右侧详情），显示三类数量与占比
- 高重要性 = 红描边；筒身刻度线示意「满」的位置（按数量相对值，不虚构时间估算）
- 空态：今天没有安排时显示引导文案

## 5. 实现要点

- 纯前端计算：矩阵/看板/甘特/量筒全部由现有 Todo 字段推导，后端 API 零改动
- 视图组件接收 TodoView 已加载的数据（incomplete / completed / lists / 选中与勾选回调），
  复用左列表栏、tag 筛选、右侧详情面板
- 数据拉取调整：非列表视图时同时拉取 completed（`status: 'all'` 一次拉全量，
  看板状态维度需要全部状态）
- 共享推导逻辑集中在 `frontend/src/utils/todoLogic.ts`：
  `urgencyOf(todo, today)`、`isImportant(todo)`、`ganttRange(todo, today)`
- 新文件：
  - `frontend/src/components/todo/TodoMatrixView.tsx`
  - `frontend/src/components/todo/TodoKanbanView.tsx`
  - `frontend/src/components/todo/TodoGanttView.tsx`
  - `frontend/src/components/todo/TodoJarView.tsx`

## 6. v2.2.0 打磨记录（2026-08-17）

### 6.1 卡片勾选（跨视图同步）

- `TodoMiniCard` 新增圆形勾选按钮（左缘，`aria-label=标记为已完成/未完成`）：
  点击 → `onToggle(!done)` → TodoView 的 toggle 变更（PUT completed/notStarted），
  矩阵/看板所有视图即时重排，侧栏计数同步。逾期角标在已完成时隐藏。
- 矩阵/看板通过 `onToggle` prop 接线；列表视图沿用原有 checkbox。

### 6.2 看板五维 + 已完成折叠列

- 维度切换器：按状态 / 按计划日期 / 按重要性 / 按复杂度 / 按标签（激活态白底阴影）。
- 各维度列染色：状态列用 STATUS_TONE（灰/蓝/紫/琥珀），重要性 high/normal/low 红/琥珀/绿，
  复杂度困难/中等/简单红/琥珀/绿；列头「标题+计数」。
- **按计划日期**：`planned_date < today` 的任务跳过（只列今天及以后）；今天标题显示「今天」；
  未计划归 `__none__` 列排最后。
- **已完成列**（仅状态维）：独立绿色列头按钮「已完成 {count}」（默认折叠，计数来自
  `/api/todo/stats` 的 stats.completed——列表 limit=500 会截断，不可用 completed.length）；
  展开后显示已完成卡片，可一键勾回未完成。
- 拖拽仅状态维可用（dragId/overCol + drop 调 update status），其余维度禁拖避免误改结构数据。

### 6.3 甘特：默认一个月 + 自动滚到今天

- `VISIBLE_DAYS=30`：`dayW = (viewW - LABEL_W) / 30`（最小 3px），默认恰好可见一个月。
- 首次挂载自动 `scrollLeft = todayX - 30`（clamp 到 [0, max]），只滚一次（didInitScroll ref）。

### 6.4 量筒：扁平风重绘 + 物理堆叠

- 纯 SVG 玻璃罐（260×470）：石板灰岩石（每行 2 个，沉底贴 shelf）、灰蓝卵石
  （每行 4 个，砖纹交错）、沙子（#f0e6c8 底 + pattern 点，画在石头之上）。
- **沙子波状底边**：sandPath 在两两相邻顶行卵石之间下探 +10、卵石处凸起 +2（行不变量
  用 `cy = y + ry`，同行卵石 ry 各异，不能按 y 取顶行）；波谷下再画 trickleDots 渗漏点簇。
- 沉底已完成带（半透明 +「✓ ×N」）；溢出判定 `sandTop < TOP_Y + 6`。
- 容量校准：典型日（2 岩 + 8 卵 + 3 沙）≈ 75% 满，5 沙 ≈ 96%+ 触发溢出提示。

### 6.5 后端修复：completed 排序

- **问题**：completed 场景排序键（due/planned）无意义，1153 条已完成按旧序排，
  刚勾选的任务沉底被 `limit=500` 截断 → 看板展开列/列表已完成区看不到刚完成的任务。
- **修复**：`tt_calendar/db.py` `fetch_todos` 在 `status_filter == "completed"` 时
  强制 `completed_at DESC`（最新完成排最前），忽略传入 sort（注释说明原因，
  避免未来被当作 bug「修掉」重新引入截断问题）。
