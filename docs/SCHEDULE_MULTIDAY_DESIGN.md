# 日程系统优化：统一新建入口、自动待办、多日日程（2026-09-03）

## 1. 需求与决策

起因：日程功能年久失修——双击日历格子只能建"点点"日程，涂色要绕道右侧面板；
日程与待办完全割裂；不支持跨天。

三个改动的关键决策（与用户确认过）：

| 决策点 | 结论 |
|---|---|
| 双击格子的弹窗 | 统一为一个 `DayEntryDialog`，顶部切换「涂色 / 点点」两种呈现方式 |
| 自动创建待办 | 勾选后自动建待办，列表用「日程待办」（不存在则自动创建）；计划日期=起始日，截止日期=结束日（单日时两者都是点击的那天） |
| 多日日程的待办 | **只建 1 条**，不每天建一条（避免列表爆炸） |
| 多日月视图呈现 | **首日显示标题 + 后续天画延续细色条**，鼠标悬停可见完整区间 |

## 2. 数据模型（`schedule_items` 表）

新增一列：

```sql
end_date TEXT  -- 多日日程结束日（含，'YYYY-MM-DD'）；NULL=单日
```

- 迁移走既有的 `_ensure_schedule_item_columns`（PRAGMA 检查 + ALTER TABLE），老库自动升级。
- **归一化**：`end_date <= date`（倒挂或同日）一律存 NULL，且在 `upsert_schedule_item`
  入口直接改对象——返回值会回给前端，必须和库里的真实状态一致，否则 UI 画幽灵跨天条。
- Pydantic 模型加了 `is_multi_day` / `span_days` 计算属性，聚合层直接用。

## 3. 查询与聚合：区间相交 + 按天展开

**查询**（`fetch_schedule_items_between`）：判定从「date 落在区间内」改为**区间相交**：

```sql
WHERE date <= :end AND COALESCE(end_date, date) >= :start
```

否则跨月视图里，上月开始、本月仍在持续的日程会整条消失。

**聚合**（`backend/aggregator.py`）：
- `_expand_schedule_spans`：把多日条目按天复制引用到视图窗口内每一天（窗口外裁剪）。
- `_build_day`：跨天条目附带 span 元信息——

| 字段 | 含义 |
|---|---|
| `is_multi_day` | 是否跨天 |
| `span_start` / `span_end` | 整个区间的起止（恒定，不随当天变） |
| `span_index` / `span_total` | 今天是第几天 / 共几天 |

**身份语义（重要）**：展开后的条目在所有天都保持 `date = 起始日`（DB 行的真实日期）。
「今天是第几天」由 `span_index` 表达，不改 `date`——否则前端把展开后的条目原样 PUT
回去会把日程改短。

## 4. 前端

### DayEntryDialog（`dialogs.tsx`，替换了原 DotEntryDialog + ColorEntryDialog）

- 顶部「涂色 / 点点」分段切换：涂色 = 色块标记（marks/coloring），点点 = 带时间的日程条目。
- 点点模式下有日期区间选择（开始=双击的格子，结束默认同日，改结束日即成多日）。
- 「同时创建待办」勾选框：
  - 列表用「日程待办」，不存在则先 `createTodoList` 再用；
  - `planned_date = 起始日`，`due_date = 结束日`（多日时跨整个区间）；
  - 待办标题与日程标题一致。
- 入口：双击格子、快捷键 N、右侧面板的「+ 日程/标记」按钮，全部统一走它。

### 渲染

- **月视图 DayCell**：`span_index === 1` 的天显示「时段 + 标题 + ↦N天」；
  后续天画一条 3px 的延续色条（不占文字行），title 悬停显示完整区间。
- **日视图 DayView / 右侧 DetailPanel**：跨天条目显示「第 x/N 天 · 起~止」。
- **日程编辑弹窗 ScheduleDialog**：每行加结束日期输入（默认空=单日）。

## 5. 重大踩坑：upsert 的「假更新」隐形 bug（存量 bug）

改多日时写 HTTP 集成测试暴露了一个**从 schedule_items 诞生起就存在**的 bug：

```sql
INSERT INTO schedule_items(date, start_time, ...) VALUES(...)   -- ← 没有 id 列！
ON CONFLICT(id) DO UPDATE SET ...
```

`INSERT` 不指定 id 时永远拿到新自增 id，**`ON CONFLICT(id)` 永不触发**——每次"更新"
实际都插入了一行新数据，旧行原样留在库里。测试表现：把 9/10~9/12 的多日日程 PUT
缩成单日，接口返回正确，但月视图里 9/11、9/12 照样画着日程（旧行阴魂不散）。

为什么用户从没发现：
1. 日程功能本来就少人维护、少人编辑；
2. 编辑通常改标题/时间，重复行内容不完全相同，肉眼难以察觉"多了一条"；
3. 单元测试只测了 create+fetch，从没测过 update 路径。

**教训**：
- `INSERT ... ON CONFLICT` 的冲突列必须在 INSERT 的列清单里，否则就是摆设。
  现在改成显式分支：`id is None` → INSERT，否则 → `UPDATE ... WHERE id=?`。
- **CRUD 里 U 是最容易被测试漏掉的**。补了 `test_update_edits_in_place` 单元测试
  （更新后库里必须仍只有 1 行）+ HTTP 层的 shrink 场景。

## 6. 测试矩阵

| 层 | 文件 | 覆盖 |
|---|---|---|
| 后端单测 | `tests/test_schedule_multiday.py` | 单日不受影响、倒挂归一化、跨月相交查询、窗口裁剪展开、span 元信息、老库迁移、**原地更新** |
| 后端 HTTP 集成 | `tests/test_schedule_multiday_http.py` | 真实 uvicorn：创建多日→月视图三天展开+span 标记→缩单日→区间中间日按天查询命中→删除无残留 |
| 前端组件 | `frontend/src/components/__tests__/DayEntryDialog.test.tsx` | 11 条：涂色/点点切换、多日日期联动、自动建待办（含「日程待办」列表不存在时创建、计划=首日/截止=末日）、不勾选则不建 |

运行方式：

```bash
python tests/test_schedule_multiday.py
python tests/test_schedule_multiday_http.py
cd frontend && npx vitest run
```

## 7. 部署注意

纯前端改动 + 后端 Python 改动，**sidecar 后端需要重打**（这次动了 `tt_calendar/`），
Tauri exe 也要重建（前端变了）。按 `EXE_LOADING_TROUBLESHOOT.md` §4.4 完整流程走，
别只 `npm run build` 就以为 exe 能看到。
