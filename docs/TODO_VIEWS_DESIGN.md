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

## 7. v2.2.0 打磨记录·第二轮（2026-08-17）

### 7.1 矩阵：象限命名「有空做」

- 「不重要 × 不紧急」象限 action 由「考虑丢」改为「有空做」（icon Hourglass），
  文案「不占用最佳精力，有空再说」——不暗示丢弃，只表达低优先级。

### 7.2 看板卡片信息增强

- `TodoMiniCard` 信息密度提升：状态圆点（未开始灰/进行中蓝/等待紫/延后琥珀）、
  重要性（high 红 / 其余灰）、复杂度（困难红/中等琥珀/简单绿）、
  截止/计划/开始日期行（逾期红、今天角标）、标签 chips（#tag）、备注单行预览。
- 已完成卡片隐藏元信息行，标题划线——完成态只留「标题 + 完成于 MM-DD」。

### 7.3 看板：计划日期色阶 + 标签配色

- **按计划日期**：同色系蓝色阶，计划越远越浅——今天及逾期 `blue-200/60`、
  ≤2 天 `blue-100/80`、≤7 天 `blue-50`、更远 `blue-50/50`；未计划灰列。
  今天列头显示「今天 · MM-DD」。
- **按标签**：10 色调色板（rose/orange/amber/lime/emerald/teal/sky/indigo/violet/fuchsia），
  按标签名 hash（`tagHash` = charCode*31 累加）确定性分配，同名标签跨会话颜色稳定。

### 7.4 看板：已完成列平滑折叠

- 已完成列改为真正的折叠列：折叠 = 窄条 w-11（绿色，竖排「已完成」+ 计数 + ChevronLeft），
  点击展开 = w-60 整列（ChevronRight），`transition-all duration-300` 宽度动画。
- `COMPLETED_RENDER_LIMIT=50` 限量渲染 + 页脚「已显示最近 50 / 共 N 条」，
  避免 1200+ 条完成数据拖垮渲染。

### 7.5 量筒：emoji 石块 + 沙纹质感

- 岩石/卵石改用 SVG `<text>` 🪨 emoji（font-size 与占位行高 0.62 比例校准，
  容量不变量保持：2 岩/行、4 卵/行、行高 70/28 不变），确定性旋转（岩石 ±12°、卵石 ±8°）、
  模糊椭圆落影（feGaussianBlur filter）、选中蓝环 / 高重要红环。
- 沙子：`feTurbulence(fractalNoise 0.85)` + feColorMatrix 暖沙色颗粒滤镜直接打在
  沙 path 上，散落颗粒点缀；玻璃体加横向渐变、双高光条、杯嘴唇边、筒底反光、刻度。
- 完成带改祖母绿渐变（done-sediment）+ 上缘亮线 +「✓ ×N」。
- 验证：Windows Segoe UI Emoji 含 🪨 字形（`document.fonts.check` = true），
  岩石/卵石/沙纹/颗粒/落影全部渲染正常。


## 8. 每日提醒（2026-08-27）

> 决策背景：调研了 Windows toast / tauri-plugin-notification / schtasks 三条路径，用户裁定只做 V1 应用内轻推——纯视觉静默、不碰系统、未来提醒（remind_at）本轮不做。哲学依据：应用目前是纯拉模型，提醒是唯一的「推」，必须保持克制（默认关、当日仅一次、无声）。

### 行为

- 到达设定时间（默认 16:00，本地时间）后，若 `planned_date == 今天` 且未完成的待办数 > 0，TopBar 下方出现一条琥珀色安静横幅：`今日还有 N 条计划任务未完成` + 「查看」+ 关闭 ×
- 「查看」跳转待办 tab；关闭 = 当日不再出现（localStorage `tt_reminder_dismissed_<date>`），次日自动重置
- 应用重启后只要仍在当日内且条件满足会再次提示（补递语义）；无声音、无系统通知、无系统足迹

### 实现

- 配置存 meta KV 表 `todo_reminder_config_v1`（`{enabled: false, time: "16:00"}`，默认关），GET/PUT `/api/settings/todo-reminder`，读取时校验归一化时间格式
- 前端 `ReminderBanner.tsx`：60s interval 触发检查 + react-query（`['todoReminderConfig']` 与 500 条 incomplete 待办查询），App.tsx 在 TopBar 与内容区之间渲染
- 设置对话框「每日提醒」节：复选框即时保存 + time input 失焦保存


## 9. 备注双击放大编辑（2026-08-27）

### 行为

待办详情面板里的「备注」textarea 现在支持**双击放大**——弹出一个独立模态（与设置对话框同一 Modal 组件，宽 680px、min-h 320px），可专心写长备注。关闭方式：× 按钮 / ESC / 点击空白处。关闭即自动写回面板原 textarea（不再需要额外保存按钮——保留与详情面板现有自动保存链路一致）。

> 留意：当前详情面板对所有字段都是「Ctrl+Enter 或切页面时显式保存」，双击放大后的修改**不触发立即持久化**，要等用户切走/关闭面板/按 Ctrl+Enter 才落库——和内联编辑同一套机制。

### 进阶项评估：WYSIWYG Markdown 编辑器（已调研、不采纳）

调研了 6 款主流 React WYSIWYG 编辑器（2026-08 数据）：

| 库 | 体积（gz） | 维护 | Markdown 双向 | 中文 IME | 评估 |
|---|---|---|---|---|---|
| TipTap v3 + tiptap-markdown | ~180-220KB | 活跃 v3.30.5 (08/24) | ✓ 社区扩展 v3 兼容 | Safari 已知 heading IME 重复 (#7271)，Win WebView2 无关 | 灵活 / headless / Tailwind 友好 |
| Milkdown v7 | ~140-170KB | 活跃 7.22.1 (08/12) | ✓ 内置 listener 插件 | 良好 | Markdown 原生最克制，bundle 最小 |
| BlockNote v0.54 | ~180-230KB | 活跃 (08/13) | ✓ 内置 | ✓ 2025-26 多次修 IME | Notion 风格 / 块结构偏长文 |
| Cherry Markdown | ~150-200KB | 活跃 (08/24) | ✓ 原生 | ✓ 中文优秀 | 自带主题，Tailwind 集成成本 |
| Vditor | ~90-120KB | 活跃 3.11.3 (08/11) | ✓ 三模式 | ✓ 中文原生 | 强 WYSIWYG + 重样式 |
| @uiw/react-md-editor | 编辑器小, 预览动态 | 活跃 v4.1.2 | ✓ | ✓ | **非 WYSIWYG**（分屏编辑+预览） |

**结论：暂不采纳。** 理由：
1. **场景不匹配**：备注通常是 1-3 句话的轻量记录，强 WYSIWYG 工具栏是过度设计
2. **体积成本**：当前前端总包 ~104KB gz，引入任意 WYSIWYG 至少 +50%，且仅服务单字段
3. **哲学约束**：PHILOSOPHY.md 强调 Agent-First + 打磨而非加法；为单字段引新依赖 = 加法
4. **撤换成本**：NotesEditor 抽象了「onClose(next) → 父组件 setState」，未来若真要做，Milkdown 是最小代价的后路，drop-in 替换

如果将来发现「备注里写多行 Markdown 已经成为日常」，届时再单独评估迁移（NotesEditor 组件接口不变，仅替换内部实现）。
