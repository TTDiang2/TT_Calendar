# 老端 i18n 施工台账（20261003 夜开工）

> 施工手册：`E:\TT_Calendar_Neo\docs\i18n-handoff-tt-calendar.md`（已过 Neo 架构终审）。
> 本文件是老端施工的**义务台账**：智者门的条件、承诺与禁令都落在这里，逐项核销。

## 门记录

| 门 | 内容 | 裁决 | 条件核销 |
|---|---|---|---|
| 智者门 1（P0 基建 320097c） | i18n 运行时移植+中文棘轮+白名单 28 文件 | **有条件放行**（20261003 夜） | 见下 ↓ |

### 门 1 条件核销

- [x] **C1 口径更正**：白名单 28 vs grep 32 的差额 4 **不是**"豁免测试文件"（测试文件在两口径中均被排除）。真实差额：`src/main.tsx`、`src/types.ts`、`src/core/types.ts`（仅注释含中文，AST 级合法）+ **`src/data.ts`（代码级中文对象键，见 C2）**。申报口径失实一笔已认领，入晨报纪律自省。
- [x] **C2 data.ts 双盲义务**：`src/data.ts:14-21` GRADED_PALETTES 的中文对象键（绿/蓝/橙/紫/红/青/靛/灰）对棘轮三 selector **不可见**（对象键是 Identifier 非 Literal），allowlist 脚本也**永不收录**该文件——**"白名单归零 ≠ 中文清零"**。裁决（手册 §5.2 已定）：改 ASCII key + 字典标签。持久化前提已核实：`Sidebar.tsx:231` 存入 config 的是**色值数组**非键名。→ **A2 批③执行**。
- [x] **C3 golden lunarText 恢复承诺**：`src/i18n/__tests__/i18n-format-golden.test.tsx` 头注释所载"A2 恢复 lunarText 段"升格为本台账条目 → **A2 批③随 data.ts 映射层一并恢复**。
- [x] **C4 禁令**：`common.daysAfter/daysBefore` 两个骨架复数键**仅限测试脚手架，禁止接入 UI 相对天数显示**（手册 §8.10：Intl.RelativeTimeFormat 自带介词与复数，唯一正路是 `format.ts` fmtRelativeDays；zh 输出无空格"3天后"，骨架键带空格会同时破 §8.10 与逐屏一致）。

## A2 批次计划（P1 抽词）

- **批①** 表单三大件：`dialogs.tsx`、`TodoDetailPanel.tsx`、`SettingsDialog.tsx`（对照 Neo fragments：dialogs/todoEditor/settings，zh 以老端原文为准）
- **批②** 日历视图：`App.tsx`、`Sidebar.tsx`、`CountdownView.tsx`、`TopBar.tsx`、`DayCell/DayView/WeekView/YearView/MonthGrid`、`todo/*`（七视图）
- **批③** 杂项+双盲：`StatsView/DetailPanel/NotesEditorModal/ReminderBanner/ErrorBoundary/SourceFields/TodoEditor`、`api/client.ts`、`utils/todoLogic.ts`、**`data.ts`（C2）**、index.css 若有 content 文案；恢复 lunarText golden（C3）；Python 侧分类法（db.py 种子→显示映射、routes 错误消息→结构化码、aggregator 结构化）
- 每批验收四件套：eslint 0 错 + tsc 基线一致 + vitest 全绿 + allowlist 收窄；zh 逐屏一致红线全程有效。

## 环境

- node v22.22.2 便携版 `$HOME/node22/node-v22.22.2-win-x64`（node18 无法运行 vitest4/jsdom）。
- tsc 存量基线 3 错误（TodoView.tsx:545 repeat 字段 + DayEntryDialog.test.tsx:67 + TodoDetailPanel.flush.test.tsx:27），i18n 施工不得新增。
