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

### 9.1 后续小调整（2026-08-27）

- **模态标题简化**：去掉「编辑备注 · 」前缀，只显示待办标题（无标题时回退「备注」）。理由：模态弹出来了当然知道是编辑，前缀冗余。
- **列表重命名**：侧栏每个列表右侧的悬停操作新增 Pencil 按钮（在 Star 和 Trash 之间），点击切换为行内输入框；Enter 保存、Esc 取消、失焦保存。后端复用既有 PUT /api/todo/lists/{id}（前端 updateTodoList 此前已有但未挂 UI）。解决「先删后建」的反向工作流。
- **sticker 备忘录模块**：经评估暂搁置。路线 A（新模块）哲学成本高；路线 B（双击卡片）只是绕过痛点；路线 C（memo aside 智能简化）作为后续候选——先观察现有「双击 textarea 打开备注模态」是否已足够覆盖场景。

### 9.2 量筒隐藏 + 便签墙（2026-08-28）

- **量筒视图下架**：TopBar 按钮移除，TodoJarView 组件与 jarTodos 查询保留在代码库（enabled: viewMode === 'jar' 永假），localStorage 存了 jar 的用户自动降级 list。将来想恢复 = TopBar TODO_MODES 加回一行。
- **便签墙视图（stickies）**：所有未完成待办以便利贴形式贴在墙上，只显示标题 + 备注。
  - 6 色粉彩（黄/粉/蓝/绿/橙/淡紫）按 todo.id 哈希确定性分配；便签旋转 -3°~+3°、胶带旋转 -4°~+4°（同一哈希源，重渲染不跳动）
  - 米色点阵墙背景（radial-gradient 22px 网格）、CSS columns 瀑布流（sm/lg/2xl 响应式 2/3/4 列）、break-inside-avoid
  - hover：回正 + 上浮 + 阴影加深（"揭下来"的隐喻）；选中 = 蓝色 ring
  - 交互与列表视图对齐：单击开侧栏、双击开备注模态（复用 detailRef.openNotes）
  - 标题 line-clamp-2、备注 line-clamp-6 保留换行

### 9.3 量筒重设计「日之岩芯」+ 便签去截断（2026-08-28）

- **量筒视图完全重写**（ed240cb，409 行 → 227 行）：放弃 emoji 石头 + SVG 涂鸦方案，改为「岩芯样本」隐喻——
  - 每个任务 = 一条带标题的地层：难 = 66px 厚板岩（斜纹凿痕材质）、中 = 46px 灰岩（素面）、简 = 30px 薄沙层（颗粒点纹），材质即复杂度，标题直接写在层内（第一次可读）
  - 今日完成 = 底部沉积带（祖母绿颗粒质感 + ✓ 计数），高度随完成数增长
  - 440px 宽玻璃器皿：唇边、双高光条、内蚀刻刻度 25/50/75/100、底部投影
  - 顶部读数：日期 + 装填百分比 + 「还能装 N 件简单事」（余量换算）；溢出时琥珀 pill 计数装不下的项
  - 高重要 = 左缘红 accent 条；今日截止 = 层内「截止」chip
  - 交互与列表/便签对齐：单击开侧栏、双击开备注模态
  - 入口恢复：TopBar 量筒按钮回归（6 个视图并存），localStorage 'jar' 重新合法
- **便签墙备注完整显示**（bd8e75c）：移除 body 的 line-clamp-6，whitespace-pre-wrap 保留换行，长备注完整铺开（瀑布流自动适应高度）；标题仍 line-clamp-2。

### 9.4 量筒最终裁决（2026-08-28）

三版迭代（emoji 石头 → 岩芯地层 → 暖色玻璃罐拾贝）后用户裁定：v3「有进步但未达审美线」。处置：**TopBar 移除量筒入口**，TodoJarView 组件与数据链路全部保留归档（localStorage 'jar' 降级 list）。复行条件：将来某个设计真正过关时，TopBar TODO_MODES 加回一行即可。判决记录 commit daca2be。

### 9.5 新建待办双重提交 bug（2026-09-01）

两个并发原因导致「有时会新增两个」：
1. **Save 按钮无 in-flight 保护**：disabled 只检查 title/listId，连点两次各发一次 POST。
2. **自动保存副作用错触发**：`useEffect` 依赖 `[todo?.id]`，从 `__NEW__` 切到 `null`（点 Save 后关闭面板）时也满足触发条件，自动保存又调一次 `onSave` → 第二条记录。

修复（commit 1a17188）：
- `savingRef` + `saving` state：save() 进入即占位，in-flight 期间 button 显示「保存中」」且 onClick 早返；Ctrl+Enter 共用同一守卫
- useEffect 跳过 prev 为 `__NEW__` 或 null 的场景（没有真实旧 todo 要 flush）；saving 状态在 todo 变化时重置

### 9.6 新建待办双重提交修复 v2（2026-09-01）

上一版（9.5 / commit 1a17188）实测仍复发。诚实复盘：上一版的两个修复都"看着对"但条件错了。
- **Bug B 真根因**：`prev.id != null` 对空字符串 `""` 也为真。新待办的 id 就是空串 `''`（TodoView line 531），所以 autosave 在新建→关闭时依然触发。修正：用 truthy 检查 `prev.id && prev.id !== ''`，同时排除 `'__NEW__'` 哨兵。
- **Bug A 真根因**：savingRef 在 useEffect 的 commit 阶段被无条件 reset。Save→onClose→重渲染→effect 跑完之前已经把 savingRef 翻回 false，下一次 click 进 save() 守卫失效。修正：reset 只放在「打开 todo」的分支（`if (todo)` 内），关闭流程中绝不动守卫。

commit 8ebb923，release 已更新，prod 已部署。

### 9.7 新建待办双重提交修复 v3（2026-09-01）

v2（9.6）修好了 Save/Ctrl+Enter 重复提交，但误伤了 case 1（点别处关掉→应自动创建）：phantom 过滤把所有"新建→关闭"路径都拦了。

正确区分「谁关的」：
- `closeReasonRef = 'saved'`：save()/Ctrl+Enter 设的，effect 跳过自动保存（避免重复 POST）
- `closeReasonRef = 'user'`：用户点 X / 侧栏 / 背景 关闭，effect 触发自动保存：
  - prev 真实任务 + 有改动 → update
  - prev 幻影新任务（id=''）+ title 非空 → create（恢复 case 1）

commit 13c9abb，prod 已部署。三个场景应同时正确：
1. 点别处 → 1 条（自动创建）
2. 点保存 → 1 条（显式保存，effect 跳过）
3. Ctrl+Enter → 1 条（同上）

### 9.8 新建待办丢失输入 —— 修复 v4·终版（2026-09-01）

> 四版折腾的终点。这一节的教训比代码本身更值钱，见 9.9。

#### 现象

v3 部署后实测：
- 输入标题 → **点别处 → 完全没有创建，输入丢失**
- 输入标题 → 点保存 → 1 条 ✅
- 输入标题 → Ctrl+Enter → 1 条 ✅

#### 证据先于推理

`backend.stdout.log` 是铁证（比读代码可靠）：整段测试只有 **2 次 `POST /api/todo`**，正好对应「点保存」和「Ctrl+Enter」；「点别处」路径 **一次 POST 都没发出**。

所以不是"创建了两条"、"创建了空的"、"后端拒了"，而是 **前端压根没调用 onSave**。这条结论直接把排查范围从后端/网络/竞态收缩到一个 `if` 条件上。

#### 根因：两条退出路径漏网

v3 的幻影分支判定是：

```ts
if (closeReason === 'user' && prevIsPhantom && curId === null) { ... create ... }
```

`curId === null` 意味着**只有「切到无选中」才会落盘**。而用户能触发"离开编辑态"的路径有四条：

| # | 退出路径 | `todo?.id` 变化 | v3 是否落盘 |
|---|---------|----------------|-----------|
| 1 | 点 X 关闭 | `''` → `undefined` | ✅ 落盘 |
| 2 | 点侧栏「全部」/其它列表 | `''` → `undefined` | ✅ 落盘 |
| 3 | **点另一个待办** | `''` → `'real-2'` | ❌ **丢失** |
| 4 | **切到日历 tab（面板卸载）** | 组件 unmount，effect 不执行 | ❌ **丢失** |

所以用户那句"点别处"，实际是路径 3 或 4。

**更本质的毛病是判定不对称**：真实任务分支用 `prevId !== curId`（任何切换都算），幻影分支却用 `curId === null`（只有置空才算）。同一语义写了两套条件，必然漏。而上一轮只 self-trace 了"切到 null"这一条路径，恰好是两条里能通的那条，于是"看起来对"。

顺带说明：路径 4 漏得最彻底 —— `App.tsx` 是 `topTab === 'todo' ? <TodoView/> : ...`，切 tab 会整体卸载面板，**`useEffect` 的 body 在卸载时根本不执行**，写在 body 里的自动保存等于不存在。

#### 修复：把落盘搬进 effect cleanup

放弃"区分谁关的"这条思路（`closeReasonRef` 是个跨渲染的隐式状态机，每多一条退出路径就要同步维护一次，漏一条就错）。改成：**所有离开路径共用一个出口**。

```ts
useEffect(() => {
  prevTodoRef.current = todo
  if (todo) {
    formRef.current = { /* 从 todo 装载的表单快照 */ }   // ①
    setTitle(todo.title); /* ...其余字段... */
  }
  skipFlushRef.current = false

  return () => {                                        // ②
    if (skipFlushRef.current) { skipFlushRef.current = false; return }
    const leaving = prevTodoRef.current                 // ③
    if (leaving) flushSave(leaving)
  }
}, [todo?.id])
```

三个关键点：

**② 为什么放 cleanup 而不是 body**
cleanup 在 React 提交新渲染之后、下一个 effect body 之前执行，此时 `formRef.current` 仍是用户刚输入的值；而**组件卸载时 React 同样会执行 cleanup**。于是这一条路径同时覆盖了上表全部 1–4。写在 body 里则天然覆盖不到卸载。

**③ 为什么读 ref 而不是闭包捕获 `prev`**
捕获到的是「body 执行那一刻」的上一个 todo。A→B→C 连续切换时，B 那次 cleanup 拿到的是 null（A 那次 body 里 prevTodoRef 还是 null），会漏存。必须读 ref 的当前值。

**① 为什么同步写 formRef**
StrictMode 开发模式下 React 会「body → cleanup → body」模拟一次卸载。若 ref 还停在初始空值，那次模拟 cleanup 会拿空表单去 flush，可能误发一次 PUT。同步写入后，模拟 cleanup 的 `changed` 判定恒为 false，直接静默。同时它也保证了"打开后没改动就关闭"不发请求。

`flushSave` 本身承担全部守卫：

- 空标题 / 无归属列表 → 直接放弃（不建空任务、不建 `list_id` 为空的脏数据）
- 真实任务 → 比对 `changed`，无改动不发 PUT
- 幻影（id `''` / `'__NEW__'`）→ 标题非空就 POST

显式保存与删除改用**消费型标记** `skipFlushRef`：`save()` / 删除按钮自己提交后把它置 true，紧随其后的那一次 cleanup 消费掉并不再落盘，从而保证 case 2/3 只 POST 一次，也避免把刚删掉的记录又 flush 回来。

#### 回归测试

新增 `frontend/src/components/__tests__/TodoDetailPanel.flush.test.tsx`（vitest + jsdom + testing-library），11 条断言覆盖：点 X / 点侧栏 / **点另一个待办** / **卸载** / 点保存 / Ctrl+Enter / 点删除 / 未改动关闭 / 改后切走 / 空标题切走 / A→B→C 连续切换。

**验证过测试不是空转**：把组件回退到 v3 后重跑，用例 3、4 立刻变红（0 次保存），其余 9 条保持通过 —— 与用户"case 2/3 正常、case 1 丢失"的现象完全吻合；恢复修复后 11 条全绿。

`vitest.config.ts` 随之调整：加 `@vitejs/plugin-react`（JSX 转换）、`environment` 改为 `jsdom`、`include` 补上 `.tsx`。原有 `core/merge.golden.test.ts` 不受影响。

#### 端到端验证（真实浏览器）

jsdom 只证明组件逻辑成立，证明不了真实点击路径。补了 `tests/e2e_todo_autosave.cjs`：
用 CDP 驱动本机 Edge headless 打开 `http://127.0.0.1:8765`，发真实鼠标/键盘事件走完流程，再用后端 API 计数。无需安装 Playwright（Node 22 自带 `WebSocket`，Edge 随 Windows 附带）。

**反向验证（金标准）** —— 同一套脚本分别跑 v3 旧包与 v4 修复包：

| 场景 | v3（用户测的那版） | v4（本次修复） |
|---|---|---|
| 1a. 输入标题 → 点另一个待办 | ❌ **0 条（丢失）** | ✅ 1 条 |
| 1b. 输入标题 → 切到日历 tab | ❌ **0 条（丢失）** | ✅ 1 条 |
| 1c. 输入标题 → 点 X 关闭 | ✅ 1 条 | ✅ 1 条 |
| 2. 输入标题 → 点「保存」 | ✅ 1 条 | ✅ 1 条 |
| 3. 输入标题 → Ctrl+Enter | ✅ 1 条 | ✅ 1 条 |
| 4. 空标题 → 切走 | ✅ 0 条 | ✅ 0 条 |

表里 v3 那一列就是用户报告的完整复现：「点保存 / Ctrl+Enter 正常，点别处丢失」，且丢失的正是路径 3、4。

脚本会自动清理测试数据（标题以 `E2E_AUTOSAVE_` 开头，跑完逐条 DELETE）。

commit `0044b8b`，`dist/assets/index-CUN0TNKe.js` 已构建。生产后端 `backend/main.py` 用 `StaticFiles` 挂载 `frontend/dist`，且 `_frontend_dist()` 优先取 exe 同级目录的 `frontend/dist`，所以**重新 build 后重启应用即生效**，不必重新打包 exe。

### 9.9 经验教训：这个 bug 为什么修了四版

同一个 bug 改了四版（9.5 → 9.6 → 9.7 → 9.8），每一版都"修好了上一版"，每一版又引入新问题。值得单独沉淀：

**1. 日志 > 推理**
上一轮靠 code self-trace 得出结论，而 self-trace 只会顺着脑子里那条路径走。这次先数 `backend.stdout.log` 里的 `POST /api/todo` 次数，五秒就把范围从"后端/竞态/双重提交"收敛到"某个 if 条件没进"。**有可观测证据时，永远先看证据。**

**2. 不要造"来源追踪"式的隐式状态机**
v3 的 `closeReasonRef`（区分 `'saved'` / `'user'`）是典型的坏味道：它把"要不要落盘"寄托在"谁触发了关闭"上，于是每新增一条退出路径就要同步维护一次状态，漏一条就静默出错。
正确的方向是反过来 —— 把落盘做成**所有路径的统一出口**，只有"不该走这个出口"的情况（显式保存、删除）才打一个消费型标记跳过去。这样新增退出路径时默认就是对的。

**3. 「离开某状态时的副作用」就该放 cleanup**
这是个通用模式：`useEffect` 的 **body 只在"新值到来"时执行，卸载时完全不执行；cleanup 则同时覆盖"依赖变化"和"卸载"**。凡是"离开时收尾"的语义（落盘、取消订阅、释放资源），放 cleanup 才是默认正确的写法。v1–v3 都栽在把收尾逻辑写进 body。

**4. 同类语义只写一套条件**
真实任务用 `prevId !== curId`，幻影却用 `curId === null` —— 两条规则描述同一件事，就注定会漏。抽成一个函数、一套判定，是消除这类 bug 最省力的办法（这次的 `flushSave`）。

**5. 改完必须能验证，而且要反向验证测试本身**
前几版交付时都写着"请再试一次"，把验证成本推给用户。这次补齐了组件级测试。**关键一步是回退旧代码确认测试会变红** —— 否则你无法区分"测试通过了"和"测试根本没跑到那段逻辑"。写测试的人很容易写出永远为真的断言。

**6. 测试踩坑：从测试代码触发 setState 必须包 `act()`**
`fireEvent` 自带 act 包装，但直接从测试里调用 host 暴露的 `setTodo(...)` 没有。React 18 只调度不提交，effect cleanup 压根不执行，断言会假红（第一版跑出来 5 条失败，全是这个原因）。凡是非 DOM 事件触发的状态变更，一律 `act(() => ...)`。

**7. StrictMode 会模拟卸载**
开发模式下 React 会「body → cleanup → body」跑一遍。任何写在 cleanup 里的副作用都会因此被多执行一次。所以 cleanup 中的逻辑必须**幂等或自带守卫**（这次靠"表单快照同步进 formRef"让模拟那次的 `changed` 恒为 false）。写 cleanup 副作用时先问一句：它被执行两次会怎样？

**8. 组件测试通过 ≠ 真实路径通过**
jsdom 里 11 条断言全绿，仍不能证明用户点鼠标时对。这次补了真实浏览器 E2E 才敢说结论。
单元测试适合钉住**分支逻辑**，端到端适合证明**交互路径**——尤其是"组件会不会被卸载"这种
只有真实路由切换才暴露的事（这次的丢失路径 4 就是）。两者不可互相替代。

**9. 工程小坑：临时备份不能只写一份**
本次把备份写进 `/tmp` 后文件消失了（沙箱与宿主不互通），换到工作区内路径**同样丢了一次**，
害得修改要重做一遍。结论：**做完修改先 commit，用 git 当备份**，而不是依赖手工拷贝文件。
`git checkout HEAD -- <file>` 恢复比任何临时文件都可靠。
