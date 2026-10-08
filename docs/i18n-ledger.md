# 老端 i18n 施工台账（20261003 夜开工，20261004 凌晨续）

> 施工手册：`E:\TT_Calendar_Neo\docs\i18n-handoff-tt-calendar.md`（已过 Neo 架构终审）。
> 本文件是老端施工的**义务台账**：智者门的条件、承诺与禁令都落在这里，逐项核销。
> Python 侧勘察全清单见 `docs/i18n-python-survey.md`（门2 条件1 要求的仓内实体）。

## 门记录

| 门 | 内容 | 裁决 | 条件核销 |
|---|---|---|---|
| 智者门 1（P0 基建 320097c） | i18n 运行时移植+中文棘轮+白名单 28 文件 | **有条件放行** | C1-C4 全核销（见下） |
| 智者门 2（A2 抽词四批 055ec43） | 批①表单三大件/批②日历视图/批③杂项+双盲+lunar/批④todo 全视图，白名单 28→**0** | **有条件放行**（20261004 凌晨） | D1 已补（本台账+python-survey 文档）；D2/D3 登记↓ |

### 门 1 条件核销（20261003 夜）

- [x] **C1 口径更正**：白名单 28 vs grep 32 差额=main.tsx/types.ts/core/types.ts（纯注释）+data.ts（代码级中文对象键）。
- [x] **C2 data.ts 双盲义务**：→批③ 执行完毕（GRADED_PALETTES 键 绿/蓝/橙/紫/红/青/靛/灰→green/blue/orange/purple/red/cyan/indigo/gray + `palette.*` 字典标签；Sidebar.tsx:237 实证存色值数组；门2 复核"双盲死角已封"）。
- [x] **C3 golden lunarText 恢复**：→批③ 执行（降级路线：Day.lunar 系后端拼好的中文串 aggregator.py:310，不改数据结构；golden 恢复为 lunarDisplay 回归钉——zh 三形态透传/非 CJK 决策#9 隐藏；门2 裁断接受，附条件 D3↓）。
- [x] **C4 禁令**：common.daysAfter/daysBefore 仅测试脚手架，禁接入 UI（fmtRelativeDays 唯一正路）。

### 门 2 条件（20261004）

- [x] **D1 台账欠账（本文件+python-survey.md，批④后/A3 前补齐）**：A2 四批记录、C2/C3 核销、Python 侧勘察清单全部落仓内实体。**申报口径纪律（门2 警示，第二次）：凡"成文/已登记"类申报必须有仓内实体对应，再犯打回。**
- [x] **门3 条件2 原生勘察口径补记**：原生面勘察范围 = `frontend/src-tauri`（lib.rs 恰 1 处注释）**+ `launcher/src/main.rs`（16 处中文全为注释、非注释 0 条）**——结论"原生面无用户可见中文"对整个原生面成立；A3 申报"src-tauri 全扫"口径漏 launcher，已由门3 指正（第三次口径苗头，零损害记账不罚）。
- [ ] **D2 SYNC_IN_PROGRESS_MARK 迁移**：`fragments/app.ts` 导出的 `'正在进行'` 子串匹配属协议逻辑键，Python 结构化错误码落地时迁出 i18n/** 并删子串匹配（现 TODO-REVIEW 在代码，暂不强制搬家）→列入 Python 批次范围。
- [ ] **D3 lunar ja/ko 升格**：Python 侧 Day.lunar 结构化（{year,month,day,leap}）落地时，lunarDisplay 的 ja/ko 从透传升格为翻译档（旧暦/음력）→列入 Python 批次范围。

## A2 批次记录（P1 抽词）

| 批 | commit | 范围 | 白名单 |
|---|---|---|---|
| ① | b66c4f7 | dialogs/TodoDetailPanel/SettingsDialog（+fragments dialogs/todoDetail/settings） | 28→25 |
| ② | 0d753ff | App/Sidebar/TopBar/CountdownView/日周月年视图（+terms/topbar/shell/countdown/calendar/app） | 25→16 |
| ③ | ea8db5e | 杂项七组件+api/client+todoLogic+data.ts(C2)+lunar golden(C3)（+stats/detail/todoEditor/todo/palette/sourceFields/errors+adapt/labels） | 16→7 |
| ④ | 055ec43 | TodoView+todo/ 六视图（+todoview/todoboards） | 7→**0** |

- 行级豁免六处（门2 逐一核验全为持久化数据/逻辑键）：BUILTIN_CATEGORIES、`category || '其他'`、`日程待办`（todo_lists.display_name+查找键）、自动建待办 body 模板、Sidebar 图层默认名、`任务`（createTodoList）。
- 有意 zh 差异登记：TopBar 标题 Intl 去空格（「2026 年」→「2026年」，唯一）；gantt 月份刻度保留手拼 `{n} 月`（Intl 会去空格，留 P5）；DayView 年周空格 `2023年 周六` Intl 恰好保留（门2 逐字节实证）。
- 词表并存：todoview.imp/status/complexity 与 todoDetail 同文不同 key——手册 §4.2 抽词期禁合并，合并留抽词后独立任务。

## 待办批次

- **A3（P2 语言选择页）**：✅ 已落地（a41abd4+返工 07e0880）。
- **批⑤（Python 侧结构化，独立批次）**：按 `docs/i18n-python-survey.md` 清单实施（错误码化 ~33 条/协议键迁移 D2/lunar 结构化+D3 升格/db.py 种子显示映射/layerLabel 老端版）。开工前置=本台账 D1 已核销 ✅。
- **A4（P3 翻译生产）**：en 已随批产出；**ja/ko ✅（见下 A4 批次记录）**；fr/es/ru/zh-Hant 待时间窗。

## A4 批次记录（P3 翻译生产，ja/ko）

- 产出：`dict/ja.ts`、`dict/ko.ts`（完整树，各 539 条叶子）+ `dict/index.ts` 挂入。
- 抄/翻（逐 key 比对两端 fragments 的 zh 值，两语言同口径）：**431 抄 / 108 翻**（抄=同源同文照抄 Neo
  `dict/ja.ts`/`ko.ts`，含 11 处歧义按所属 fragment 裁决；翻=老端独有/zh 分叉以 zh 直译）。逐命名空间
  明细见两文件头注释；对照/生成脚本在仓外工作区（a4-work），产物已全量入库。
- 术语：沿用 Neo `docs/i18n-translation-spec.md` §2 冻结表（倒数日/图层/待办/订阅 4 词 + 既有 7 词）；
  老端独有概念（适配/待适配/子动作/星级/事件导入/量筒三段）首译定名登记在各语言文件头。
- 质检：结构测试全绿（key 深度相等/复数仅 other/占位符一致，en+ja+ko 三语言 12 检全过）；
  tsc 3 错误=存量基线不增；eslint 0 errors；白名单 0。
- 回译抽查 48 条（24/语言，覆盖全部新翻命名空间）+ 长度审计：`docs/i18n-backtranslation-ja-ko.md`。
  ja 4 处按钮超限（キャンセル/カウントダウン/レイヤーを新規作成/サブスクリプション）系逐字沿用 Neo
  同名 key 译文（同槽位 Neo 实证+冻结术语），已登记为沿用例外；ko 零超限。
- 边界：未碰 i18n 运行时/zh/en fragments/测试文件；Day.lunar 农历串仍为后端中文透传（D3，等批⑤
  结构化后升格，老端 lunar 不进字典，与 A2 裁决一致）。

### 门4(老端) 条件登记（20261004，A4 39dae14 有条件放行）

- [x] ja「订阅」术语分流裁决登记（ja.ts 头注）：标签位（弹窗标题/terms 徽章）サブスクリプション×2、行文位（intro/toggle/deleteConfirm 等）購読×9——有意分流非失统一，依 Neo spec §2 自带追加条款登记（Neo 仓只读不回改）；ko 不动（구독 全文统一）。
- [x] 引据更正：术语表「订阅」行真实出处=Neo dict terms.subscription 字典值+终审清单 4 词目录（Neo spec §2 原表无此行）——ja.ts 头注与台账同步更正。引据失准计口径记录（实体虚报四笔+引据失准一笔），最终警告持续生效。

### 门5(P2.5) 批次记录（20261004，用户英文界面实测六账 → 513469e/清偿提交）

- 六账闭环：①选择页提示随所选语言（makeI18n(picked)）②设置页 LanguageSection ③倒数日横幅+label 结构化（后端 banner/label_kind，text 保留兼容）④内置图层名 layerLabel 映射（BY_ID 11 项+BY_NAME 日程待办/任务）⑤yyyy/mm/日+中文小日历=浏览器原生控件边界（见发版批次）⑥日程待办显示映射。
- **类型坑（§8.3 复发，进手册候选）**：layers 命名空间含键 `other` 撞 PluralEntry.other → 整棵子树被 SimplePaths 剔除 TxKey → 改键 `misc`。
- autoTodoDetail 存储取舍：显示映射名/存储单一 zh 列表名（防数据分裂）；dialogs.tsx:799 colorCfg.display_name 流入待办标题同属"存储名"政策（已登记）。
- 事故：_next_occurrence 四元组改造漏第二调用点（aggregator:376 染色钩子）→ /api/view/month 500（pytest 未覆盖，实机炸出）→ 修复+回归测试 test_aggregator_countdown_structured.py（DB 隔离）。
- 实测数字（冻结树复跑）：vitest 83 passed|25 skipped；pytest 71 passed；白名单 0；tsc 3 存量。
- **申报纪律**：本批申报"17 存量 warnings"实为 19（2 条本批引入，LanguagePicker 未用 import/变量）——智者实测抓出，已清偿并更正注释；申报数字一律以冻结树复跑为准。

## 发版批次（门3 建议3，20261004 真实登记）

- [ ] **发版说明必须注明**：老用户升级后首次打开会见到语言选择页（系统语言已预选，一键"开始使用"即进主界面）——手册 §0 定稿行为"所有用户必须显式确认"；**禁止**添加"检测老用户自动跳过"之类逻辑（破坏显式确认语义）。
- [ ] **发版说明同步注明**：日期选择框的占位格式与点开的日历面板是**浏览器原生控件**，跟浏览器/系统语言走（App 内语言设置不改变它）——用户实测反馈已说明（20261004 门5 账5 定性：原生控件边界，非代码缺陷）。

## 环境

- node v22.22.2 便携版 `$HOME/node22/node-v22.22.2-win-x64`（**无 /bin 子目录**，export PATH 到该目录本身；node18 无法运行 vitest4/jsdom）。
- tsc 存量基线 3 错误（TodoView.tsx repeat 字段——批④后行号 545→564 + 两个测试文件），i18n 施工不得新增。
