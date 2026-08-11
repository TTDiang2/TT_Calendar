# TODO 功能方案（待敲定）

> 2026-08-05 · 第 7 棒 brainstorming 产出 · 用户已确认所有关键决策，等最终敲定后实施

## 1. 需求与决策（用户已确认）

| 决策点 | 选择 |
|---|---|
| UI 位置 | **顶级 tab**（日历 / 待办），日历 tab 下保留月/周/日/年 |
| 同步策略 | **纯本地 todo** + CSV 导入（不集成 Microsoft Graph API） |
| MS To Do 集成 | 后续研究导出方式（MS To Do 原生不支持 CSV 导出，需第三方工具/手动） |
| 排序 | **可切换**（双重/到期日/重要性/创建时间），**双重为默认** |
| 日历联动 | ① DetailPanel 加"待办"区块 ② 待办作为染色维度（可分层） |
| 完成态 | 默认隐藏 + 顶部"显示已完成"开关 |
| TodoView 布局 | **左列表栏 + 右任务区**（经典） |
| CSV 格式 | **6 列固定 schema** |

## 2. 数据模型（SQLite，沿用 db.py 现有风格）

```sql
CREATE TABLE IF NOT EXISTS todo_list (
    id            TEXT PRIMARY KEY,          -- uuid4
    display_name  TEXT NOT NULL,
    sort_order    INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS todo (
    id             TEXT PRIMARY KEY,         -- uuid4
    list_id        TEXT NOT NULL REFERENCES todo_list(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    body           TEXT,
    status         TEXT DEFAULT 'notStarted',-- notStarted|inProgress|completed|waitingOnOthers|deferred
    importance     TEXT DEFAULT 'normal',    -- low|normal|high
    due_date       TEXT,                     -- YYYY-MM-DD（可空）
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    completed_at   TEXT,                      -- status→completed 时写
    sort_order     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_todo_list   ON todo(list_id);
CREATE INDEX IF NOT EXISTS idx_todo_due    ON todo(due_date);
CREATE INDEX IF NOT EXISTS idx_todo_status ON todo(status);
```

**layer_config 加一行**：`todo` 图层（sort_order=5，color=#F59E0B 琥珀色，enabled=1）。

## 3. 后端 API（backend/routes.py 新增 ~12 个端点）

### 列表
- `GET    /api/todo/lists` → 列所有 todo_list（按 sort_order）
- `POST   /api/todo/lists` {display_name} → 新建
- `PUT    /api/todo/lists/{id}` {display_name} → 改名
- `DELETE /api/todo/lists/{id}` → 删（CASCADE 删该列表所有 todo）

### 任务
- `GET /api/todo?list_id=X&status=notStarted&sort=due_importance` → 列任务
  - status 过滤：`notStarted`（默认，排除 completed）/ `all` / `completed`
  - sort：`due_importance`（默认）/ `due` / `importance` / `created`
- `POST   /api/todo` {list_id, title, body?, importance?, due_date?} → 新建
- `PUT    /api/todo/{id}` {title?, body?, importance?, due_date?, status?, list_id?} → 改
  - status→completed 时自动写 completed_at
- `DELETE /api/todo/{id}` → 删

### 导入
- `POST /api/todo/import/csv` (multipart file) → 解析 CSV，按 list_name 分组导入
  - 返回 `{inserted: N, lists_created: M, errors: [...]}`

### 视图聚合扩展（aggregator.py）
- `build_view` 时 fetch_todos_between(conn, start, end) → 每个 Day 加 `todos: Todo[]`（未完成的）
- Todo 类型：`{id, list_id, title, body, status, importance, due_date}`

## 4. CSV 格式规范

```csv
title,due_date,importance,status,list_name,body
买牛奶,2026-08-10,high,notStarted,购物,去超市买全脂奶
完成季度报告,2026-08-15,normal,notStarted,工作,Q3 报告
看书,,low,notStarted,生活,
```

| 列 | 必填 | 格式 | 默认 |
|---|---|---|---|
| title | 是 | 文本 | — |
| due_date | 否 | YYYY-MM-DD | 空（无到期日） |
| importance | 否 | low/normal/high | normal |
| status | 否 | notStarted/completed | notStarted |
| list_name | 否 | 文本 | "已导入"（相同名归一列表，不存在自动创建） |
| body | 否 | 文本 | 空 |

解析容错：importance/status 大小写不敏感；空行跳过；title 空行报错跳过该行并记 errors。

## 5. 前端组件设计

### 新建组件
| 文件 | 职责 |
|---|---|
| `components/TodoView.tsx` | 待办 tab 主视图：左列表栏 + 右任务区 + 排序切换 + CSV 导入按钮 |
| `components/TodoItem.tsx` | 单条任务行：checkbox 完成 + 标题 + importance 徽章 + due_date + 编辑/删除 |
| `components/TodoEditor.tsx` | 编辑对话框（title/body/importance/due_date/list 选择） |
| `components/TodoCsvImport.tsx` | CSV 导入对话框（文件选择 + 预览 + 导入） |

### 改造组件
| 文件 | 改动 |
|---|---|
| `components/TopBar.tsx` | 加顶级 tab（日历/待办）；日历 tab 下才显示月/周/日/年 + 翻月按钮 |
| `components/Sidebar.tsx` | builtin 图层加"待办"开关（sort_order=5） |
| `components/DetailPanel.tsx` | 加"待办"区块：列 due_date=该日的未完成 todo，可勾选完成 |
| `components/DayCell.tsx` | colorLayers 加 todo 维度（todo enabled 且 day.todos 非空 → 琥珀色） |
| `components/YearView.tsx` | miniCellColor 加 todo 维度 |
| `App.tsx` | 加 topTab state；todo tab 时渲染 TodoView 隐藏 DetailPanel；选中日联动 |
| `types.ts` | 加 `Todo` / `TodoList` 类型；`Day` 加 `todos: Todo[]`；`ViewMode` 不变 |
| `api/client.ts` | 加 todo 系列 API 函数 |
| `hooks/useApi.ts` | 加 `useTodoLists` / `useTodos` |

## 6. 排序逻辑（SQL）

```sql
-- 双重（默认）：到期日优先 NULLS LAST + 同日内 high>normal>low
ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC,
         CASE importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END

-- 到期日
ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC
-- 重要性
ORDER BY CASE importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END
-- 创建时间（最新在前）
ORDER BY created_at DESC
```

## 7. 染色逻辑（DayCell + YearView，待办作为第 5 维度）

`colorLayers` 推导顺序（与现有 important/coloring/schedule/holiday 并列）：
```tsx
const todoL = layerById.get('todo')
if (todoL?.enabled && day.todos && day.todos.some(t => t.status !== 'completed')) {
  colorLayers.push({ id: 'todo', color: todoL.color ?? '#F59E0B' })  // 琥珀
}
```
分层规则不变：0 色无背景；1 色整块；≥2 色上下分层 + 2px 白隔断（已支持任意 N 色）。

## 8. 实施步骤（分 4 阶段，每阶段可独立验证）

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P1 后端骨架** | db.py 加 2 表 + layer_config 加 todo 行；routes.py 加 12 端点；aggregator 扩展 fetch_todos_between | curl 测 CRUD + view 返回 todos |
| **P2 前端 TodoView** | TopBar 顶级 tab + TodoView/Item/Editor 组件 + client/useApi + 可切换排序 | playwright 测新建/编辑/完成/删除/排序 |
| **P3 日历联动** | DetailPanel 加待办区块 + DayCell/YearView 染色 + Sidebar 加开关 | playwright 测染色分层 + 详情勾选 |
| **P4 CSV 导入** | TodoCsvImport 组件 + 后端 csv 解析（Python csv 模块） | 造测试 CSV 文件测导入 + list 自动创建 |

## 9. 工作量评估

- 后端：~400 行（schema 50 + routes 200 + aggregator 50 + csv 100）
- 前端：~800 行（TodoView 200 + TodoItem 100 + TodoEditor 100 + TodoCsvImport 100 + 改造 300）
- 总计：**~1200 行新代码 + 9 个文件改造**，预计 2-3 个完整工作回合

## 10. 风险与边界

| 风险 | 缓解 |
|---|---|
| CSV 编码（中文 GBK/UTF-8） | 解析时试 utf-8 → gbk 回退 |
| 大量 todo 性能 | idx_todo_due + idx_todo_status 已建；视图聚合只 fetch 范围内 |
| todo 与事件在 DetailPanel 混淆 | 视觉区分：待办用 checkbox + 琥珀色点，事件用色点 |
| MS To Do 导出后续 | 文档说明：用第三方工具（如 todoist-backup 类）或 Power Automate 导 CSV，不在本方案范围 |

---

**待用户确认**：以上方案是否敲定？有要调整的地方吗？确认后从 P1（后端骨架）开始实施。
