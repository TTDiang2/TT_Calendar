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
- **A4（P3 翻译生产）**：en 已随批产出；ja/ko/fr/es/ru/zh-Hant 待时间窗（同文表可抄 Neo 字典）。

## 发版批次（门3 建议3，20261004 真实登记）

- [ ] **发版说明必须注明**：老用户升级后首次打开会见到语言选择页（系统语言已预选，一键"开始使用"即进主界面）——手册 §0 定稿行为"所有用户必须显式确认"；**禁止**添加"检测老用户自动跳过"之类逻辑（破坏显式确认语义）。

## 环境

- node v22.22.2 便携版 `$HOME/node22/node-v22.22.2-win-x64`（**无 /bin 子目录**，export PATH 到该目录本身；node18 无法运行 vitest4/jsdom）。
- tsc 存量基线 3 错误（TodoView.tsx repeat 字段——批④后行号 545→564 + 两个测试文件），i18n 施工不得新增。
