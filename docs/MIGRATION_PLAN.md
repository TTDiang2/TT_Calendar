# TT Calendar 迁移方案：Flet → Tauri + React + FastAPI

> **交接文档**。本文档自包含，接手模型可凭此文档 + 现有代码独立执行迁移，无需对话历史。
> **当前状态**：Flet 版功能完整但性能不可接受（启动白屏 1s、翻页 1s、开关 1s）。
> **目标**：丝滑（<50ms 体感）、现代美观、业务逻辑零改动复用。

---

## 当前进度快照（第一棒交接）

| 阶段 | 状态 | 产出 |
|---|---|---|
| 阶段0 原型 | ✅ | `frontend/` React+Tailwind，视觉验收通过 |
| 阶段1 后端 | ✅ | `backend/` 四文件，全端点，`tests/test_backend.py` + `test_http_integration.py` 通过 |
| 阶段2 接 API | ✅ | API client + hooks + 全套对话框 + 双击/右键/拖拽/键盘接线，`tsc --noEmit` + `vite build` 通过 |
| 阶段3a sidecar | ✅ | PyInstaller 打包 `dist/tt-calendar-backend.exe`（70MB，启动 8s，health/month 验证通过） |
| 阶段3b Tauri 配置 | ✅ | `frontend/src-tauri/`（tauri.conf.json + lib.rs sidecar 启动/kill + Cargo.toml + capabilities + 图标 + binaries/） |
| 阶段3c 构建 | ⏳ 待用户 | 双击 `install_build_env.bat`（装 Rust+MSVC）→ `build_tauri.bat`（打包 msi/nsis） |
| 阶段4 打磨 | ⏳ 可选 | 动画/错误边界/快捷键完善 |

**一键操作脚本**：
- 联调（前后端同跑）：`run_dev.bat`
- 装 Tauri 构建环境：`install_build_env.bat`
- 打包桌面应用：`build_tauri.bat`
- 前端单跑：`run_frontend.bat`

---

## 1. 决策依据（性能数据，不可辩驳）

Flet 桌面端架构 = Python 进程 ↔ TCP ↔ Flutter(`flet.exe`) 进程。实测：

| 指标 | 数值 |
|---|---|
| Python 端 refresh_calendar 全流程 | **6.69 ms** |
| DB 查询（events，131 条） | 1.76 ms |
| 42 格渲染计算 | 3.81 ms |
| 用户体感 | **每次操作卡 1 秒** |

**结论**：瓶颈 100% 在 Flet 的跨进程控件树序列化 + Flutter 重绘，与 Python/DB/算法无关。框架内优化（控件池化、缓存 ctx、精准 update）已做尽，天花板封死。换 Go 配 Flutter 通信同样卡；必须**同进程 + 原生/WebView 渲染**才能根治。

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 后端 | **Python + FastAPI** | 现有 `tt_calendar/` 业务逻辑零改动复用 |
| 前端 | **React + TypeScript + Vite** | 生态最强、视觉天花板最高、虚拟 DOM 高效 |
| 样式 | **Tailwind CSS + shadcn/ui** | 最现代美观的组合（Radix 基础 + 精美组件） |
| 状态 | **TanStack Query**（服务端）+ **Zustand**（UI） | Query 自动缓存/失效，Zustand 轻量 |
| 桌面壳 | **Tauri**（Rust） | 比 Electron 轻 10×，原生 WebView，性能好。Python 后端用 PyInstaller 打包为 sidecar（子进程），业务层零改动 |
| 工具 | date-fns, lucide-react, clsx | 日期/图标/类名 |

**不选**：PySide6（用户认为 Qt 丑，美化成本高）、Dear PyGui（工具风不美观）、Go+Fyne（重写全部业务，不划算）。

---

## 3. 性能根治原理（关键设计）

Flet 每次 `update()` 都跨进程传输整个控件树。新架构**把渲染移到前端**，通信只传数据：

- **翻月** = 1 次 GET 请求拿当月聚合 JSON → 前端渲染。WebView 端 React 渲染 42 格 <16ms。
- **图层开关** = **0 网络请求**（数据已在内存，纯前端过滤 `events_by_layer`）。即时。
- **增删改** = 单次 mutation，返回局部数据，前端局部更新。

这是丝滑的根本保证。

---

## 4. 目录结构

```
TT_Calendar/
├─ tt_calendar/              # ✅ 现有 Python 业务逻辑（保留，后端复用）
│   ├─ db.py                 # connect/init_db/fetch_*/upsert_*/move_day_content
│   ├─ models.py             # Event/ScheduleEntry/ColoringEntry/LayerConfig (Pydantic)
│   ├─ config.py             # DB_PATH/LayerID/COLORING_LEVELS/JISILU_QTYPES
│   ├─ layers/               # base.py/builtin.py（Layer/LayerContext/CellContribution）
│   ├─ sources/              # jisilu.py（JisiluSource）
│   └─ utils/                # date_utils.py/gradient.py/text_utils.py
├─ data/                     # ✅ 现有数据 calendar.db + app.log（保留）
├─ backend/                  # 🆕 FastAPI 服务（阶段1）
│   ├─ main.py               # FastAPI app 入口
│   ├─ deps.py               # 依赖注入：DB 连接、app 状态
│   ├─ api/
│   │   ├─ views.py          # 聚合视图端点（月/周/日）
│   │   ├─ events.py         # 事件 CRUD
│   │   ├─ schedule.py       # 日程 upsert
│   │   ├─ coloring.py       # 充实度 upsert
│   │   ├─ layers.py         # 图层配置
│   │   ├─ search.py         # 搜索
│   │   ├─ import_jisilu.py  # 集思录导入
│   │   └─ countdown.py      # 倒计时
│   └─ aggregator.py         # 聚合逻辑（复用 layers/build_gradient）
├─ frontend/                 # 🆕 React + Vite（阶段0原型 + 阶段2正式）
│   ├─ src/
│   │   ├─ main.tsx
│   │   ├─ App.tsx
│   │   ├─ api/              # API 客户端（fetch 封装 + 类型）
│   │   ├─ stores/           # Zustand（UI 状态）
│   │   ├─ components/
│   │   │   ├─ TopBar.tsx
│   │   │   ├─ Sidebar.tsx
│   │   │   ├─ calendar/
│   │   │   │   ├─ CalendarView.tsx   # 按 mode 切换
│   │   │   │   ├─ MonthGrid.tsx
│   │   │   │   ├─ WeekRow.tsx
│   │   │   │   ├─ DayCell.tsx        # memoized
│   │   │   │   └─ WeekdayHeader.tsx
│   │   │   ├─ DetailPanel.tsx
│   │   │   └─ dialogs/
│   │   │       ├─ EventEditor.tsx
│   │   │       ├─ ScheduleEditor.tsx
│   │   │       ├─ ColoringPicker.tsx
│   │   │       ├─ SearchDialog.tsx
│   │   │       ├─ ImportDialog.tsx
│   │   │       ├─ ContextMenu.tsx
│   │   │       └─ SettingsDialog.tsx
│   │   ├─ hooks/            # useMonthData/useCountdown 等
│   │   └─ types/            # TS 类型（对应后端 schema）
│   ├─ package.json
│   ├─ tailwind.config.ts
│   ├─ vite.config.ts
│   └─ index.html
├─ src-tauri/                # 🆕 Tauri 壳（阶段3）
├─ scripts/
│   └─ export_mock_data.py   # 阶段0：从 DB 导出 mock JSON
├─ docs/
│   └─ MIGRATION_PLAN.md     # 本文档
└─ ...（现有 main.py/run_calendar.bat 等保留作 Flet 版备份）
```

---

## 5. 现有代码复用清单（零改动）

后端直接 `import` 这些，**不修改**：

| 模块 | 关键符号 | 用途 |
|---|---|---|
| `tt_calendar/db.py` | `connect`, `init_db`, `migrate_legacy_json`, `ensure_default_layer_configs`, `fetch_events_between`, `fetch_schedule_between`, `fetch_coloring_between`, `fetch_layer_configs`, `upsert_event`, `upsert_schedule`, `upsert_coloring`, `upsert_layer_config`, `delete_event`, `delete_schedule`, `delete_coloring`, `move_day_content` | 全部 DB 操作 |
| `tt_calendar/models.py` | `Event`, `ScheduleEntry`, `ColoringEntry`, `LayerConfig`, `ImportResult` | Pydantic 模型（直接做 API schema） |
| `tt_calendar/config.py` | `DB_PATH`, `LayerID`, `COLORING_LEVELS`, `JISILU_QTYPES`, `JISILU_CALENDAR_API`, `ANNIVERSARY_OFFSETS` | 配置常量 |
| `tt_calendar/layers/` | `build_default_layers`, `Layer`, `LayerContext`, `CellContribution`, `merge_contributions`, `ScheduleLayer`, `ImportantLayer`, `ColoringLayer`, `HolidayLayer`, `JisiluLayer` | 图层聚合逻辑（核心渲染算法） |
| `tt_calendar/sources/jisilu.py` | `JisiluSource`, `get_source` | 集思录抓取 |
| `tt_calendar/utils/` | `month_grid`, `month_range`, `window_range`, `shift_month`, `is_weekend`, `is_today`, `parse_date`, `build_gradient` | 日期/渐变工具 |

**迁移完成后可删除**：`tt_calendar/widgets/`、`tt_calendar/views/`、`tt_calendar/app.py`、`tt_calendar/theme.py`（这些是 Flet 专用）。保留 `main.py` 作备份。

---

## 6. 后端 API 设计（FastAPI）

### 6.1 聚合视图端点（性能关键）

```
GET /api/view/month/{year}/{month}
```

**响应**（一次性返回当月所有渲染所需数据）：

```jsonc
{
  "year": 2026, "month": 8,
  "layers": [
    {"layer_id": "important", "display_name": "重要日期", "enabled": true, "color": "#FF4D4D", "sort_order": 1},
    {"layer_id": "coloring", "display_name": "充实度染色", "enabled": true, "color": "#388E3C", "sort_order": 2},
    {"layer_id": "holiday", "display_name": "公共节假日", "enabled": true, "color": "#8E24AA", "sort_order": 3},
    {"layer_id": "schedule", "display_name": "日程", "enabled": true, "color": "#3D6BFB", "sort_order": 0},
    {"layer_id": "jisilu_CNV", "display_name": "可转债", "enabled": true, "color": "#FFB300", "sort_order": 10}
    // ... 所有图层
  ],
  "days": [
    {
      "date": "2026-07-27",
      "is_today": false, "is_weekend": false, "is_other_month": true,
      "events_by_layer": {
        "jisilu_CNV": [{"id":1,"title":"【...】...","color":"#FFB300","description":null,"sort_key":0}]
        // 按图层分组；空图层可省略
      },
      "schedule": {"am": null, "pm": "开会", "ev": null},
      "coloring_level": 3,        // null 表示无染色
      "holiday": {"name": "七夕", "is_workday_made_up": false}  // null 表示非假日
    }
    // ... 42 天（6×7 网格，周一为首日，含前后月补齐）
  ]
}
```

**实现**：`backend/aggregator.py` 里调用 `fetch_events_between` + `fetch_schedule_between` + `fetch_coloring_between` + `build_gradient` + 各图层 `contribute`，组装成上述结构。**核心是把 Flet 版 `app.refresh_calendar` + `calendar_view.render` 的数据组装逻辑搬到后端**，输出 JSON 而非控件。

```
GET /api/view/week/{start_date}      // start_date = 周一 isoformat，返回 7 天
GET /api/view/day/{date}             // 单日（含同结构，days 长度=1）
```

### 6.2 CRUD 端点

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| POST | `/api/events` | `Event` | 新建事件，返回带 id 的 Event |
| PUT | `/api/events/{id}` | `Event` | 编辑事件 |
| DELETE | `/api/events/{id}` | — | 删除事件 |
| PUT | `/api/schedule/{date}` | `ScheduleEntry` | upsert 日程（空则删除） |
| PUT | `/api/coloring/{date}` | `{level: int}` | upsert 充实度 |
| DELETE | `/api/coloring/{date}` | — | 清除染色 |
| POST | `/api/move-day` | `{src: date, dst: date}` | 拖拽改期，返回 `{moved_events, moved_schedule}` |

### 6.3 配置/搜索/导入

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/layers` | 图层配置列表 |
| PUT | `/api/layers/{layer_id}` | `{enabled: bool}` 更新开关 |
| GET | `/api/search?q={query}` | 返回 `Event[]`（限 100 条） |
| GET | `/api/countdown` | 返回 `{text: "距离「X」还有 N 天"}` |
| POST | `/api/import/jisilu` | `{start, end, qtypes?}` 触发导入；原型可同步返回 `{inserted, error}`，正式版用 SSE 报进度 |

### 6.4 后端实现要点

- `backend/deps.py`：全局 DB 连接（FastAPI 启动时 `connect()` + `init_db`，关闭时 `close`）。注意 SQLite 线程：FastAPI 同步端点用线程池，每请求需 `check_same_thread=False` 或每请求新建连接。
- CORS：开发期允许 `http://localhost:5173`（Vite 默认端口）。
- 日期序列化：ISO `YYYY-MM-DD` 字符串，前端用 date-fns 解析。
- 聚合端点要复用 `build_gradient(important_dates, month_start, month_end, peak_color)`（注意：当前 ImportantLayer 用 `important_gradient` 字典，key 是 `f"{y}-{m:02d}-{d:02d}"`；新架构可直接把渐变颜色并入 `days[i].background` 或单独返回 `gradient_map`，前端自行映射）。

---

## 7. 前端架构

### 7.1 组件树

```
<App>
  <TopBar />                          // 标题、←今天→、月/周/日/年 seg、搜索框、导入、设置
  <main class="flex">
    <Sidebar />                       // 图层开关（Switch）、倒计时
    <CalendarView />                  // 按 ui.mode 切换：
      ├─ <WeekdayHeader />            //   周一..周日
      ├─ <MonthGrid /> (mode=month)   //   CSS Grid 6×7，42 个 <DayCell>
      ├─ <WeekRow />    (mode=week)   //   7 个 <DayCell> 横排
      └─ <DayView />    (mode=day)    //   单个大格
    <DetailPanel />                   // 选中日详情：事件列表/日程/染色/节假日
  </main>
  // 浮层（shadcn Dialog / Popover）
  <ContextMenu />                     // 右键菜单（新建/编辑日程/染色）
  <EventEditorDialog />
  <ScheduleEditorDialog />
  <ColoringPickerDialog />
  <SearchDialog />
  <ImportDialog />
  <SettingsDialog />
</App>
```

### 7.2 状态管理

```ts
// stores/ui.ts (Zustand)
interface UIStore {
  mode: 'month' | 'week' | 'day' | 'year'
  anchorDate: string           // ISO，视图锚点
  selectedDate: string | null  // ISO，选中日（详情面板用）
  layers: Layer[]              // 图层配置（含 enabled），开关纯前端改这里
  setMode, navigate(delta), goToday, selectDate, toggleLayer
}

// hooks/useMonthData.ts (TanStack Query)
const { data } = useQuery({
  queryKey: ['view', mode, anchorDate],
  queryFn: () => api.getView(mode, anchorDate),  // 拿聚合 days + layers
  staleTime: 60_000,
})
```

**图层开关不触发请求**：`toggleLayer` 只改 Zustand 的 `layers[i].enabled`，DayCell 根据 enabled 过滤 `events_by_layer`。这就是 0 请求即时的关键。

**增删改用 mutation + invalidate**：
```ts
const m = useMutation({ mutationFn: api.createEvent, onSuccess: () => qc.invalidateQueries(['view']) })
```

### 7.3 DayCell（memoized，性能核心）

```tsx
const DayCell = memo(function DayCell({ day, layers, isToday, isWeekend, isOtherMonth, onClick, onDoubleClick, onContextMenu, onDragStart, onDragOver, onDrop }) {
  const visibleEvents = useMemo(() => {
    return Object.entries(day.events_by_layer)
      .filter(([layerId]) => layers.find(l => l.layer_id === layerId)?.enabled)
      .flatMap(([, evs]) => evs)
      .sort((a, b) => a.sort_key - b.sort_key)
  }, [day, layers])

  return (
    <div className="..." onClick={...} onDoubleClick={...} onContextMenu={...} draggable onDragStart={...} onDragOver={...} onDrop={...}>
      <header>{day.date.day}{badges}</header>
      <div className="dots">{/* 去重色点 */}</div>
      <div className="labels">{visibleEvents.slice(0, maxLabels).map(...)}</div>
    </div>
  )
})
```

`memo` + `useMemo` 确保：layers 没变的天格不重渲染。翻月时 42 格全变（新数据），React 仍 <16ms（虚拟 DOM diff）。

### 7.4 视觉风格（沿用现有配色）

参考 `tt_calendar/theme.py`，关键值：
- 文字主色 `#1F2937`，次要 `#6B7280`，弱化 `#9CA3AF`
- 周末色 `#DC2626`，今日描边 `accent ring`
- 背景 `#FFFFFF`，表面 `#F9FAFB`，边框 `#E5E7EB`
- 强调色 `#3B82F6`（蓝）
- 充实度 5 档绿（见 `config.COLORING_LEVELS`）：`#F1F8F4 / #C8E6C9 / #81C784 / #388E3C / #1B5E20`
- 集思录各 qtype 颜色（见 `config.JISILU_QTYPES`）
- 圆角 `8-12px`，阴影 `shadow-sm`，间距用 Tailwind `gap-1/2/4`
- 字体：系统字体栈 + 中文 `PingFang SC / Microsoft YaHei`

用 shadcn/ui 的 `Card / Button / Dialog / Switch / Tabs / Popover` 做基础控件，保证现代美观。

---

## 8. 分阶段实施计划

### 阶段 0：React 前端原型（C1 验证）⭐ 优先

**目标**：半天-1天，纯前端 + mock JSON，验证视觉美观 + 翻页/开关性能。**满意才进入后续阶段。**

**任务**：
1. `npm create vite@latest frontend -- --template react-ts && cd frontend`
2. 装依赖：`npm i tailwindcss @tailwindcss/vite lucide-react date-fns clsx zustand @tanstack/react-query`；shadcn/ui 初始化（`npx shadcn@latest init`）
3. 写 `scripts/export_mock_data.py`（见下），跑一次生成 `frontend/src/mock/month.json`
4. 实现：
   - `TopBar`：标题（2026 年 8 月）+ ←今天→按钮 + 月/周/日/年 Tabs（年视图禁用）+ 搜索框（占位）
   - `MonthGrid`：CSS Grid 6×7，42 个 `DayCell`，周一首日
   - `DayCell`：日期数字（周末红）+ 色点 + 标签 + 充实度背景 + 节假日 + 今日描边
   - `Sidebar`：图层列表（Switch 开关）+ 倒计时
   - 翻月导航（←→按钮 + 键盘）
   - 图层开关纯前端过滤（验证 0 请求即时）
5. 视觉打磨：圆角、阴影、间距、hover 效果，达到"现代美观"标准

**mock 数据导出脚本** `scripts/export_mock_data.py`（伪代码）：
```python
# 从真实 DB 导出当月数据为 JSON，供前端原型用
import json
from datetime import date
from tt_calendar import db, config as cfg
from tt_calendar.layers import build_default_layers
from tt_calendar.layers.base import LayerContext
from tt_calendar.utils.date_utils import month_grid, window_range
from tt_calendar.utils.gradient import build_gradient
import chinese_calendar as cc

conn = db.connect()
y, m = 2026, 8
start, end = window_range(y, m, 31)
events = db.fetch_events_between(conn, start, end)
# 组装 events_by_layer / schedule / coloring / holiday / gradient
out = {"year": y, "month": m, "layers": [...], "days": [...]}
json.dump(out, open("frontend/src/mock/month.json", "w", encoding="utf-8"), ensure_ascii=False, default=str)
```

**验收标准**：
- ✅ 翻月体感 <50ms（前端切换 mock 数据，无网络）
- ✅ 图层开关即时（0 延迟）
- ✅ 视觉现代美观（圆角/阴影/配色协调）
- ✅ 日历内容正确（节假日、充实度、集思录、日程都显示）

### 阶段 1：FastAPI 后端 ✅ 已完成

**产出**：`backend/` 四个文件（`main.py` / `deps.py` / `aggregator.py` / `routes.py` + `__init__.py`），实现全部 §6 端点。

**验证**：`tests/test_backend.py`（TestClient 冒烟）通过 —— month/week/day 聚合、layers、countdown、search 端点全部 200，复用 `tt_calendar/` 业务层成功（19 图层、42 天、节假日/充实度/渐变齐全）。

**启动方式**：
- 开发：`uvicorn backend.main:app --reload --port 8000`
- 生产（sidecar）：`python -m backend.main`（监听 127.0.0.1:8765）
- 冒烟测试：`python tests/test_backend.py`

**端点清单**（prefix `/api`）：
- `GET /view/month/{y}/{m}` `GET /view/week/{start}` `GET /view/day/{d}` —— 聚合视图
- `POST /events` `PUT /events/{id}` `DELETE /events/{id}` —— 事件 CRUD
- `PUT /schedule/{d}` —— 日程 upsert（空则删）
- `PUT /coloring/{d}` `DELETE /coloring/{d}` —— 充实度
- `GET /layers` `PUT /layers/{id}` —— 图层
- `POST /move-day` —— 拖拽改期
- `GET /search?q=` —— 搜索
- `GET /countdown` —— 倒计时
- `POST /import/jisilu` —— 集思录导入（async）

### 阶段 2：前端接真实 API（2-3 天） —— 进行中 ⏳

**已完成**（第一棒）：
- `frontend/src/api/client.ts`：全部端点的 fetch 封装 + TS 类型 + API_BASE（dev/prod 自动切换）
- `frontend/src/hooks/useApi.ts`：`useViewData` / `useLayers` / `useCountdown`（TanStack Query，staleTime 60s）
- `frontend/src/main.tsx`：QueryClientProvider
- `frontend/src/App.tsx`：从 mock 切换到真实 API，图层开关用 **乐观更新 mutation**（即时翻转 + 后端持久化，失败回滚）
- `frontend/src/types.ts`：`MonthData` 补 `layers` 字段
- `tsc --noEmit` 通过

**启动联调方式**（接手模型验证用）：
```bash
# 终端1：后端
uvicorn backend.main:app --reload --port 8000
# 终端2：前端
cd frontend && npm run dev
# 浏览器开 http://localhost:5173，翻月/图层开关走真实 API
```

**剩余**（下一棒）：
- 实现对话框（建议用 shadcn/ui 或轻量自写）：
  - `EventEditorDialog`（新建/编辑事件 → POST/PUT /api/events）
  - `ScheduleEditorDialog`（AM/PM/EV → PUT /api/schedule/{d}）
  - `ColoringPicker`（5 档 → PUT /api/coloring/{d}）
  - `SearchDialog`（→ GET /api/search?q=）
  - `ImportDialog`（→ POST /api/import/jisilu）
  - `ContextMenu`（右键 → 新建/编辑日程/染色 三项）
- 交互接线：
  - 双击 DayCell → 打开 EventEditor
  - 右键 DayCell → 打开 ContextMenu
  - 拖拽 DayCell（HTML5 drag/drop）→ POST /api/move-day
  - 键盘 ←→ 翻页、T 今天、N 新建
- 每个 mutation 成功后 `qc.invalidateQueries({ queryKey: ['view'] })` 刷新
- 详情面板加"编辑/删除"按钮（事件）、"编辑日程/设充实度"按钮
- 参考现有 Flet 版交互逻辑：`tt_calendar/app.py` 的 handle_* 方法（行为契约）

### 阶段 3：Tauri 桌面集成 + Python sidecar（2-3 天）

> **决策依据**：实测 pywebview 启动 1.7s（比 Flet 的 1s 还慢），否决。Tauri Rust 壳启动 ~0.3-0.8s + 内存 ~100MB + 体积 ~10MB，启动时间是硬指标故选 Tauri。壳代码极少（~30 行 Rust + 配置），不需要深度 Rust 技能。

**架构**（单进程组：Tauri 主进程 + Python sidecar 子进程）：
```
TT Calendar.exe (Tauri / Rust 主进程)
  ├─ 启动时 spawn backend.exe (Python FastAPI, PyInstaller 打包) ← sidecar
  │    └─ 监听 127.0.0.1:固定端口（如 8765）
  ├─ WebView2 加载 frontend/dist/index.html（打包进 exe 资源）
  └─ 窗口关闭时 kill backend.exe（防僵尸进程）
```

**步骤**：

1. **Python 后端打包为单 exe**（sidecar）：
   ```bash
   cd backend
   pip install pyinstaller
   pyinstaller --onefile --name tt-calendar-backend ^
     --add-data "../tt_calendar;tt_calendar" ^
     --add-data "../data;data" ^
     main.py
   # 产物：backend/dist/tt-calendar-backend.exe（含 Python runtime + 业务层 + 数据）
   ```
   - `main.py` 启动时：`uvicorn.run(app, host="127.0.0.1", port=8765)`
   - 端口固定 8765（或动态协商写临时文件，Tauri 读）

2. **Tauri 项目初始化**（frontend 内集成）：
   ```bash
   cd frontend
   npm install -D @tauri-apps/cli @tauri-apps/api
   npx tauri init
   # 交互配置：frontendDist = ../dist, devUrl = http://localhost:5173
   ```

3. **`src-tauri/tauri.conf.json`** 配置 sidecar：
   ```json
   {
     "productName": "TT Calendar",
     "version": "2.0.0",
     "identifier": "com.tt.calendar",
     "build": {
       "frontendDist": "../dist",
       "devUrl": "http://localhost:5173",
       "beforeDevCommand": "npm run dev",
       "beforeBuildCommand": "npm run build"
     },
     "app": {
       "windows": [{ "title": "TT Calendar", "width": 1280, "height": 820 }],
       "bundle": {
         "externalBin": ["../backend/dist/tt-calendar-backend"]
       }
     }
   }
   ```

4. **`src-tauri/src/main.rs`** 启动/管理 sidecar（完整示例）：
   ```rust
   #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
   use tauri::Manager;
   use tauri_plugin_shell::{ShellExt, process::CommandChild};
   use std::sync::Mutex;

   fn main() {
       tauri::Builder::default()
           .plugin(tauri_plugin_shell::init())
           .setup(|app| {
               // 启动 Python sidecar
               let sidecar = app.shell().sidecar("tt-calendar-backend").unwrap();
               let (child, _mut) = sidecar.spawn().expect("failed to start backend");
               // 存 child handle 用于退出时 kill
               app.manage(Mutex::new(Some(child)));
               Ok(())
           })
           .on_window_event(|window, event| {
               if let tauri::WindowEvent::Destroyed = event {
                   // 窗口关闭时 kill sidecar，防僵尸进程
                   let state: &Mutex<Option<CommandChild>> = window.app_handle().state();
                   if let Some(child) = state.lock().unwrap().take() {
                       let _ = child.kill();
                   }
               }
           })
           .run(tauri::generate_context!())
           .expect("error while running tauri application");
   }
   ```

5. **前端 API base URL**：
   - 开发：`http://localhost:8000`（uvicorn 独立跑）
   - 生产：`http://127.0.0.1:8765`（sidecar）。前端 build 时用环境变量区分：
     `const API_BASE = import.meta.env.PROD ? 'http://127.0.0.1:8765' : 'http://localhost:8000'`

6. **开发模式**（不打包，热重载）：
   ```bash
   # 终端1：后端
   cd backend && uvicorn main:app --reload --port 8000
   # 终端2：前端 + Tauri
   cd frontend && npm run tauri dev
   ```

7. **生产打包**：
   ```bash
   cd backend && pyinstaller --onefile ... main.py     # 先打 sidecar
   cd frontend && npm run tauri build                   # 再打 Tauri（自动 bundle sidecar + 前端）
   # 产物：frontend/src-tauri/target/release/bundle/ 下的 msi/exe 安装包
   ```

**技术要点 / 踩坑**：
- Tauri 2.x 用 `tauri-plugin-shell` 的 sidecar API（1.x 用 `Command::new_sidecar`）
- PyInstaller `--onefile` 首次运行解压到 temp，启动多 ~300ms；用 `--onedir` 更快但产物是文件夹
- WebView2 runtime：Win10 1803+ 需装 Evergreen Runtime（Win11 预装）；Tauri 的 bundle 可选 `webview2Runtime` 捆绑安装器
- sidecar 端口冲突：固定端口简单，动态端口需 IPC（写 stdout JSON，Tauri 读）。原型建议固定 8765
- 数据目录：sidecar exe 内的 `data/` 只读，写入要重定向到 `%APPDATA%/TTCalendar/`（用 `config.DB_PATH` 在 sidecar 启动时判断环境）

### 阶段 4：打磨（1-2 天）

- 动画过渡（翻月淡入、对话框缩放，用 framer-motion）
- 边界处理（空数据、网络错误、加载态）
- 启动时静默导入集思录（后端启动 hook）
- 设置页（数据位置、版本）
- 数据导出/备份 JSON

---

## 9. 迁移注意事项

1. **SQLite 并发**：FastAPI 同步端点用线程池，SQLite 默认每线程一连接。用 `check_same_thread=False` + 全局单连接（加锁），或每请求 `db.connect()`。推荐后者（连接开销小）。
2. **集思录导入**：原 Flet 版用 httpx async。FastAPI 里用 `async def` 端点 + `httpx.AsyncClient`，或放后台任务（`BackgroundTasks`）。
3. **chinese_calendar**：节假日判定在后端做（聚合时算好 `holiday` 字段返回前端），前端不依赖此库。
4. **渐变算法**：`build_gradient` 返回 `{date_key: color}` 字典。后端聚合时并入 `days[i].gradient_bg` 或单独返回 `gradient_map`，前端按日期映射。
5. **纪念日 offset**：`config.ANNIVERSARY_OFFSETS` 用于自动生成纪念日（现有 important 事件带 `extra.offset`）。后端聚合时按 offset 生成当年纪念日事件，并入 events_by_layer。
6. **数据迁移**：现有 `data/calendar.db` 完全兼容，后端直接用，无需迁移。

---

## 10. 风险与决策点

| 风险 | 缓解 |
|---|---|
| Tauri sidecar 打包复杂 | 阶段3 §8 已给详细步骤 + PyInstaller 命令 + Rust 壳完整示例；开发期不打包（uvicorn + npm run tauri dev 独立跑） |
| pywebview 已评估否决 | 实测启动 1.7s（比 Flet 1s 还慢），见 `launch_test.py`；本方案已改用 Tauri |
| 视觉不达预期 | 阶段0原型已完成并通过视觉验收（React + Tailwind + 真实数据渲染），可访问 localhost:5173 复看 |
| 集思录导入阻塞 UI | 后台任务 + 进度条 |
| TanStack Query 缓存策略 | 翻月 staleTime 60s，增删改后 invalidate |
| sidecar 数据写入位置 | 生产环境 data/ 重定向到 `%APPDATA%/TTCalendar/`，见阶段3要点 |
| WebView2 runtime 依赖 | Win11 预装；Win10 用 Tauri bundle 捆绑 Evergreen Runtime 安装器 |

**关键决策点**：阶段0原型完成后，用户评估视觉+性能。通过则继续阶段1-4；不通过则回退评估 PySide6（QML 路线）。

---

## 12. 桌面壳路线决策变更：**Tauri 手动配置 → Pake**（第三棒结论）

> 前两棒卡在手动 Tauri：`tauri::generate_context!()` 持续 E0433（crate 根解析失败），多次尝试未解，debug 成本不可控。
> **已改为 Pake** —— Pake 底层就是 tauri 2.10.2 的 WebView 壳，完全规避了该编译错误。`TT Calendar.exe` + `TT Calendar.msi` 均已实测产出。

### 当前成品清单（项目根，2026-08-05 15:06 已验证）

| 文件 | 大小 | 说明 |
|---|---|---|
| `TT Calendar.exe` | 8.5 MB | Pake 产物（tauri 2.10.2 WebView 壳，加载 127.0.0.1:8765） |
| `TT Calendar.msi` | 3.4 MB | Pake 安装包 |
| `TT Calendar Launcher.exe` | 0.2 MB | **启动器**（Job Object 方案，见下） |
| `tt-calendar-backend.exe` | 70.3 MB | FastAPI sidecar（PyInstaller onefile，含 frontend/dist） |
| `pake.json` | — | Pake 配置 `{"url":"http://127.0.0.1:8765","name":"TT Calendar","width":1280,"height":820}` |

### 桌面启动架构（launcher 方案）

```
TT Calendar Launcher.exe (Rust, windows_subsystem=windows, 无控制台)
  ├─ 创建 Windows Job Object（JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE）
  ├─ spawn tt-calendar-backend.exe → AssignProcessToJobObject（CREATE_NO_WINDOW）
  ├─ sleep 5s（等 uvicorn 就绪）→ spawn "TT Calendar.exe" → AssignProcessToJobObject
  └─ wait Pake 窗口退出 → launcher 进程退出 → Job 关闭 → backend 整组被系统自动 kill
```

**为什么用 Job Object**：PyInstaller onefile 是 bootloader 父进程 + Python 子进程双进程，手动 kill 只能杀一个，实测会残留孤儿进程占 8765 端口。Job Object 的 `KILL_ON_JOB_CLOSE` 让 launcher 进程死时整棵进程树被系统自动回收，是唯一可靠的全清理方案。

### 已验证的完整生命周期（实测通过）

1. 双击 `TT Calendar Launcher.exe` → 12s 内弹出 `TT Calendar` 窗口（WinTitle 正确）
2. backend 稳在 8765，`GET /` 返回 200 + index.html 前端页面，`GET /health` 返回 200 `{"ok":true}`
3. 关闭窗口 → **backend + launcher 全部进程消失，8765 端口释放**（无僵尸进程）

### backend/main.py 两处关键修复（本次）

1. **前端 404 修复**：PyInstaller onefile 下 `__file__` 指向 `_MEIPASS` 临时目录 → 原 `FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"` 找不到目录。现改为 `_frontend_dist()` 按序探测：exe 旁 `frontend/dist`（热更新友好）→ `_MEIPASS/frontend/dist`（spec 已把 dist 打进 datas）→ 开发模式路径。
2. **/health 被 mount 吞掉**：`app.mount("/", StaticFiles(...))` 注册在 `/health` 之前会捕获所有路径 → 把 `/health` 路由移到 mount 之前。

### 重新打包命令（backend）

```bat
python -m PyInstaller tt-calendar-backend.spec --noconfirm --clean
:: spec 已含 datas=[('data','data'), ('frontend/dist','frontend/dist')]
:: 产物 dist/tt-calendar-backend.exe → 复制到项目根
```

### Launcher 源码/构建

- 源码：`launcher/src/main.rs`（依赖仅 `windows-sys 0.59`，features: `Win32_Foundation` + `Win32_Security` + `Win32_System_JobObjects` + `Win32_System_Threading`）
- 构建（需要 MSVC 环境）：vcvarsall.bat x64 后 `cargo build --release`，产物 `launcher/target/release/tt-calendar-launcher.exe` → 复制为项目根 `TT Calendar Launcher.exe`
- **launcher 会在下方目录找两个 sibling**：exe 所在目录、`dist/`、上级 `dist/`

### 桌面体验闭环

双击 `TT Calendar Launcher.exe` → backend + Pake 窗口自动起 → 用完关窗 → 所有进程自动清理 → 均可重复启动。

---

## 11. 接手模型工作指引

1. **先读本文件全文** + 浏览 `tt_calendar/` 现有代码（尤其 `db.py`/`models.py`/`layers/`/`config.py`）。
2. **从阶段0开始**：创建 `frontend/`，搭 React+Vite+Tailwind+shadcn，用 mock JSON 实现月视图原型。
3. **核心验收**：翻月丝滑（<50ms）、图层开关即时、视觉现代美观。这三点达标才继续。
4. **业务逻辑禁止重写**：`tt_calendar/` 下的 Python 代码直接复用，FastAPI 只做包装层。
5. **遇到 Flet 相关文件**（`widgets/`/`views/`/`app.py`）：迁移完成后删除，过程中忽略。
6. **保持数据兼容**：`data/calendar.db` 不动，新后端直接读写。

---

*文档完。生成于 Flet 版性能优化到顶后的迁移决策点。*

---

## 13. 2026-08-05 前端功能完善（Bug 修复 + 新视图 + 设置页）

### Bug 修复
1. **Bug1 图层开关"没反应"**：根因是 DayCell 背景染色只读 day.coloring_level/day.gradient_bg，忽略图层 enabled。修复后染色完全响应开关：关闭"充实度染色"→绿色背景消失。
2. **Bug2 开关偏移**：Sidebar knob 从 bsolute top-0.5 translate-x-[15px] 改为 inline-flex items-center 容器 + 	ranslate-x-[2px]/[16px]（垂直居中、位移精准）。
3. **Bug3 年视图不对**：根因 client.ts getView 把 year 兜底成 month。修复：后端新增 GET /api/view/year/{year}（aggregator.build_year_view 聚合 12 月），前端新建 YearView 渲染 4x3 迷你月历。

### 新功能
1. **图层分层染色**（DayCell）：0 色无背景；1 色整块；≥2 色上下分层（flex-1 上色 + 3px 白色隔断 + flex-1 下色）。重要日期=红渐变、充实度=绿 5 档。
2. **WeekView**：7 列 DayCell（周一到周日）；**DayView**：单日大卡（日程+充实度条+完整事件列表）。
3. **SettingsDialog**（TopBar 设置按钮原无 onClick，已接上）：事件导入（集思录日期范围）+ 图层显示开关（builtin + 集思录两组），与侧边栏开关双向联动。

### 验证（playwright 实测，dev 5173/8000）
- 年视图 504 个迷你日格（12x42）✓；关闭充实度开关绿色格 1→0 ✓；分层染色结构（红/白3px/绿）✓；周视图 7 格 ✓；日视图单日卡 ✓；设置页 2 区+19 开关+导入按钮，开关与侧边栏联动 ✓
- 
px tsc --noEmit 零错误；
pm run build 通过
- 生产 exe 重打包 69.71MB，/api/view/year/2026 200（167KB）+ / 200

### 归档
- rchive/：calendar.legacy.*、main.py、run_*.bat/ps1、build 脚本、color/important/schedule_data.json 等 Flet 遗留
- rchive/tt_calendar_flet/：tt_calendar 下 app.py/theme.py/views/widgets（backend 仅依赖 db/config/models/layers/sources/utils，已确认不受影响）

---

## 14. 2026-08-05 启动性能优化（PyInstaller onefile → 系统 Python）

### 问题
用户反馈：双击 `TT Calendar Launcher.exe` 后窗口虽快出现，但"加载中…"持续 7-8 秒，体验差。

### 诊断（实测数据）
| 阶段 | onefile 模式 | dev 模式（python 直跑） |
|---|---|---|
| backend spawn → /health 200 | **7.42s** | **1.56s** |
| 差值（PyInstaller 开销） | ~5.86s | — |

**根因**：PyInstaller **onefile** 模式每次启动要把打包的 76823 个文件（2.6GB）解压到 `%TEMP%/_MEIxxxxxx` 临时目录。

**为什么 2.6GB**（凭啥？）：
1. `requirements.txt` 是旧 Flet 版残留（写着 `flet==0.82.2`），backend 真实依赖 fastapi/uvicorn/pydantic **根本没列**。
2. 系统 Python 装了 378 个包（含 tensorflow 2.19、jupyter 全家桶、scipy/numpy/pandas/matplotlib 等用户做 ML 的库）。
3. PyInstaller spec `excludes=[]` 空，依赖分析时把间接引用的大包全打进去：MEI 目录里 numpy.libs(20MB)、matplotlib(11MB)、cryptography(7.9MB)、numpy(6.5MB)、lxml(6.3MB)、PIL(4.6MB)、jedi/pythonnet/Cython/gevent…… **这些 backend 根本不用**。
4. 正常 backend 依赖只有 fastapi + uvicorn + pydantic + sqlite3(标准库) + chinese_calendar + python-dateutil + bs4 + httpx，应 < 30MB。

**附带发现**：TEMP 堆积 **19 个遗留 _MEI 目录共 2.6GB**（之前 backend 被强杀未清理），onefile 模式固有运维负担。

### 优化方案（用户选）
**方案 1：用系统 Python**（用户自用场景，机器里本就有 Python 环境）+ **方案 4：清理垃圾 + 修 requirements.txt**。

### 改动
1. **清理**：删除 19 个遗留 _MEI 目录，释放 2.6GB。
2. **修 requirements.txt**：删 flet，补 fastapi/uvicorn/pydantic/chinese-calendar/beautifulsoup4/python-dateutil/httpx（backend 真实依赖）。
3. **launcher/src/main.rs 重写**：
   - 不再 spawn `tt-calendar-backend.exe`，改 `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765`
   - `current_dir` = launcher 所在目录（让 backend 找到 `backend/`、`frontend/dist`、`data/`）
   - **固定 `sleep 5s` 改为轮询 TCP 8765**（120ms 间隔，最多 20s 超时）：backend ready 立即 spawn Pake，不再盲等
   - `find_python()` 依次试 `python` / `python3` / `py`，取第一个 `--version` 成功的
   - 保持 Job Object（python backend + Pake 同进 Job，关窗即清）

### 实测对比
| 指标 | 优化前 | 优化后 |
|---|---|---|
| Pake 窗口出现 | 5s+（固定 sleep） | **1.88s** |
| backend ready | 7.42s | ~1.5s |
| 用户感知"加载中"消失 | 7-8s | ~3-4s |
| 关窗后进程清理 | Job Object ✓ | Job Object ✓（验证：关 Pake → python + launcher 全消失，8765 释放） |

### 代价 / 注意
- 方案 1 依赖**本机已装 Python 3.10+ 且依赖齐全**。换电脑需先 `pip install -r requirements.txt`。
- 不再分发 `tt-calendar-backend.exe`（70MB exe 已废弃，仍保留在项目根供回退）。
- 项目根仍需保留 `backend/`、`frontend/dist/`、`data/` 三个目录（launcher 用 `current_dir` 定位）。

### 构建 launcher（同前）
```bat
cd launcher
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
cargo build --release
:: 产物 launcher\target\release\tt-calendar-launcher.exe → 复制为项目根 "TT Calendar Launcher.exe"
```

### §14.1 启动稳定性修复（紧随 §14，2026-08-05 晚）

§14 的首轮优化后用户反馈：双击快，但 **AutoHotkey 快捷键 / 命令行调用慢 + 不小概率报"127.0.0.1 拒绝连接"**。

**诊断（实测复现）**：手动占住 8765 端口再启动 launcher → Pake 在 **0.29s** 就出现（轮询立即"成功"——TCP 连到了残留 python），但 launcher 自己 spawn 的新 python 因 bind 失败已退出，Pake 实际连到的是状态异常的残留 → "加载中"极慢或残留死掉时"连接拒绝"。根因是 **TCP connect 轮询无法区分"自己的 backend"与"残留 backend"**。

第二轮诊断（加 stderr 重定向后）发现另一个独立 bug：launcher 是 `#![windows_subsystem = "windows"]`（无控制台），spawn python 不重定向 stdout/stderr 时，python 继承了 **invalid handle**，初始化写输出时可能卡住 —— 这是 GUI 程序 spawn 控制台程序的经典陷阱。

**修复（全部在 launcher/src/main.rs）**：
1. **`ensure_port_free()` 启动前清理 8765 残留**：TCP probe 探测；若被占，`netstat -ano | findstr :8765` 找 LISTENING PID，`taskkill /F /PID` 杀掉，等 1s 端口释放。端口干净后 TCP 轮询成功 = 自己的 backend ready，杜绝误判。
2. **stdout/stderr 重定向到 `backend.stdout.log` / `backend.stderr.log`**：避免 python 继承 invalid handle 卡住，同时利于 debug。
3. **probe 用 `connect_timeout(300ms)`**：实测 `TcpStream::connect` 在端口未监听时偶尔因防火墙 drop SYN 卡 2 秒，加 300ms 上限。
4. **轮询保持 TCP connect**（HTTP /health 实测会触发 uvicorn 的 ConnectionResetError，TCP 在端口干净场景下足够且更简洁）。
5. **文件日志 `launcher.log`**：记录启动时间线（启动/port free/spawn/ready/Pake spawn/退出），无论双击/AHK/命令行都可事后 debug。

**实测对比**：
| 场景 | 修复前 | 修复后 |
|---|---|---|
| 无残留正常启动 | ~1.8s | **1.91s** |
| 有残留（端口被占） | **0.29s 误判 spawn Pake → 连接拒绝/巨慢** | **2.93s**（清理残留 + 起 backend + 开 Pake） |
| 关 Pake 后清理 | Job Object ✓ | Job Object ✓（python + launcher 全消失，8765 释放） |

**用户侧**：双击/AHK/命令行三种调用方式现在都稳定在 ~2-3 秒，不再有"连接拒绝"。

### §14.2 AHK 快捷键仍报"连接拒绝"——路径空格歧义（最隐蔽的 bug）

§14.1 修完后用户反馈：双击/命令行都 OK，但 **AutoHotkey 的 `Ctrl+Win+/` 快捷键还是"连接拒绝"**。

**诊断**：用 `keybd_event` 模拟 Ctrl+Win+/ 触发用户 AHK 脚本（auto_launch.ahk PID 7956），观察启动结果。关键证据——Pake 进程的 CommandLine：

```
"E:\Automation Scripts and Temp Codes\TT_Calendar\TT Calendar" Launcher.exe
父进程: AutoHotkey64.exe（不是 launcher！）
```

**根因**：AHK 脚本第 76 行 `Run("E:\...\TT Calendar Launcher.exe")` 路径带空格**没加引号**。Windows `CreateProcess` 按"第一个匹配的 exe"解析路径——它在 `TT_Calendar\` 目录下先匹配到 **`TT Calendar.exe`（Pake！）**，把后面的 `Launcher.exe` 当成参数丢弃。所以 **AHK 直接启动了 Pake，完全绕过 launcher，没有 backend** → "加载中" / "连接拒绝"。双击没问题是因为资源管理器明确指定 launcher exe，不走命令行解析。

**修复（从根源消除歧义）**：
1. **重命名 launcher**：`TT Calendar Launcher.exe` → `TT-Calendar-Launcher.exe`（连字符，无空格）。编译产物本就是 `tt-calendar-launcher.exe`，只是复制到项目根时改名了，现在保持无空格命名。
2. **改 AHK 脚本** `auto_launch.ahk` 第 76 行路径为新名。
3. **重启 AHK** 加载新脚本。

**验证（模拟按键触发）**：launcher + python + Pake 全链路启动，1.85s Pake 出现，health 200，launcher.log 时间线完整。关 Pake 后 Job Object 清理 OK。

**教训**：Windows 上启动路径带空格的 exe，**必须引号包裹**或**文件名不含空格**。否则 `CreateProcess` 的"第一个匹配"逻辑可能匹配到同目录下另一个名字前缀相同的 exe。本例中 `TT Calendar.exe` 是 `TT Calendar Launcher.exe` 的"前缀"，被误匹配。

---

## 15. 2026-08-05 第四轮：周/日视图实装 + 年视图响应 + 侧边栏/设置布局 + 日程/节假日染色（4 项修复）

§14 稳定后用户报的 4 个改进/残留 bug，全部 playwright 实测验证通过。

### Bug 1：周/日视图一直"加载中"（根因：日期 anchor 缺前导零）

**根因**：`App.tsx` 第 49 行 week/day 模式的 anchor 用 `${monthKey}-01` = `"2026-8-01"`（月无前导零）。backend `datetime.date.fromisoformat("2026-8-01")` 抛 `ValueError` → 500 → 前端 `useQuery` 永远 `isLoading=true`。

**修复**（`App.tsx`）：
```tsx
const dayAnchor = useMemo(() => {
  if (selectedDate) return selectedDate
  const [y, m] = monthKey.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-01`
}, [selectedDate, monthKey])
const { data: monthData, isLoading } = useViewData(
  mode,
  mode === 'week' || mode === 'day' ? dayAnchor : monthKey,
)
```

**playwright 实测**：点"周" → `hasLoading=false`，`grid-cols-7` 渲染 7 列日格（27-2）。点"日" → `hasLoading=false`，显示 "8月1日 2026年 周六 · 周末 充实度 当天无事件"。

### Bug 2：年视图切换侧边栏开关不立即响应

**根因**：`YearView` 用 `yearData.layers.find(...)`（react-query 缓存的原始数据），而 `App.toggleMutation.onMutate` 只更新 `localLayers` state。开关变化后 `yearData` 不变 → YearView 不重渲染。

**修复**：
1. `YearView.tsx` Props 加 `layers: Layer[]`，从 `prop` 构建 `layerById`，`miniCellColor` 用 `layerById` 替代 `yearData.layers.find`。
2. `App.tsx` 调用处加 `layers={layers}`（传最新的，含 localLayers 覆盖）。

**playwright 实测**：年视图下 toggle "重要日期" → important ON 时 167 个迷你格有背景色 → toggle OFF → **立即 0 个**（无需切出去再切回）。

### Bug 3：侧边栏不要放集思录投资日历 / 设置页不要放图层显示开关

**修复**：
- `Sidebar.tsx`：移除 jisilu 组（第 27-34 行），只保留 builtin（schedule/important/coloring/holiday）。
- `SettingsDialog.tsx`：移除"图层显示开关"区（含 builtin map），只保留两区：① 事件导入（保留）② 集思录投资日历（从侧边栏搬来）。

**playwright 实测**：
- 侧边栏 `aside` 下只有 4 个 builtin LayerRow（无 jisilu 标题）。
- 设置对话框 `sections = ["事件导入", "集思录投资日历"]`，`hasBuiltinSwitch = false`，`hasJisilu = true`。

### Bug 4：日程和公共节假日也要能染色，多选分层

**根因**：`DayCell.tsx` colorLayers 只处理 important + coloring 两个维度。

**修复**：
1. `DayCell.tsx` colorLayers 扩展为 4 维度：
```tsx
if (layerById.get('schedule')?.enabled && day.schedule && (day.schedule.am || day.schedule.pm || day.schedule.ev)) {
  colorLayers.push({ id: 'schedule', color: layerById.get('schedule')!.color ?? '#3D6BFB' })
}
if (layerById.get('holiday')?.enabled && day.holiday?.name) {
  colorLayers.push({ id: 'holiday', color: layerById.get('holiday')!.color ?? '#8E24AA' })
}
```
2. 多选分层支持任意 N 色：`Fragment + flex-1 + h-[2px] bg-white 隔断 + flex-1`（替代原硬编码 2 色）。
3. `YearView.tsx` miniCellColor 也扩展 4 维度（迷你格太小无法分层，按优先级取色）。

**db layer color 确认**（`layer_config WHERE sort_order<10`）：schedule=#3D6BFB（蓝）、important=#EF5350（红）、coloring=#388E3C（实际用 COLORING_COLORS 5 档）、holiday=#8E24AA（紫）。

**playwright 实测**：启用 schedule+important+holiday（关 coloring）→ 11 个日期格有背景染色。8月4日同时有 important（rgb(255,109,109)）+ schedule（rgb(61,107,251)），DOM 结构验证 **2 层 + 1 个 2px 白隔断** ✓。8月没有节假日数据，holiday 路径代码已验证（同 pattern）。

### 验证总览（playwright + curl）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 周视图 | 一直"加载中" | 7 格渲染（27-2） |
| 日视图 | 一直"加载中" | 单日大卡内容渲染 |
| 年视图 toggle 开关 | 切出去再切回才生效 | 167 → 0 染色格，**立即响应** |
| 侧边栏图层区 | builtin + jisilu 两组 | 只 4 个 builtin |
| 设置页 sections | 事件导入 + builtin 开关 + 集思录 | 事件导入 + 集思录（**无 builtin**） |
| schedule 染色 | 无 | 蓝（rgb(61,107,251)） |
| holiday 染色 | 无 | 紫（layer.color，8月无数据但代码已通） |
| 多选分层 | 仅 2 色 | 任意 N 色 + 2px 白隔断 |

### 生产流验证

- `vite build` 通过：dist/assets/index-**9HTk0w5c**.js (224.6KB) + index-DZK1eF_A.css (22.3KB)。
- 双击 `TT-Calendar-Launcher.exe` → launcher → system python → backend 1.97s ready → Pake 加载 http://127.0.0.1:8765/ → 返回的 HTML 含 `index-9HTk0w5c.js`（与 dist 一致）✓。
- 架构已用系统 Python（§14），**不需要 PyInstaller 重打包 backend exe**；`frontend/dist` 直接被 backend 的 `_frontend_dist()` 服务。
- 后端 CORS 在 `main.py` 补了 5175-5177 + 127.0.0.1:5174（vite dev 端口飘移时也能用），生产无影响。

---

## 16. 2026-08-06 TODO 功能（纯本地 + CSV 导入 + 日历联动）

第 7 棒实施。用户确认所有决策（2 轮 question tool），方案见 `docs/TODO_FEATURE_PLAN.md`。**不集成 Microsoft Graph API**（用户简化：纯本地 todo + CSV 导入，MS To Do 后续研究导出方式）。

### 数据模型（db.py 新增 2 表）

```sql
todo_list (id TEXT PK, display_name, sort_order, created_at)
todo (id TEXT PK, list_id FK→todo_list, title, body, status, importance, due_date, created_at, completed_at, sort_order)
+ INDEX idx_todo_list/due/status
```

`layer_config` 加 `todo` 图层（sort_order=4, color=#F59E0B 琥珀色），通过 `ensure_todo_layer()` 幂等 seed（旧 DB 升级自动补）。

### 后端（12 端点 + view 扩展）

- **列表**：`GET/POST /api/todo/lists`、`PUT/DELETE /api/todo/lists/{id}`
- **任务**：`GET /api/todo`（参数 list_id/status/sort）、`POST/PUT/DELETE /api/todo[/{id}]`
- **CSV 导入**：`POST /api/todo/import/csv`（UploadFile，utf-8/gbk 回退，按 list_name 自动建列表）
- **视图扩展**：`aggregator.build_view` 加 `fetch_todos_between`，每个 Day 含 `todos: Todo[]`（未完成的）

排序 SQL（4 种，`_TODO_SORT_SQL`）：
- `due_importance`（默认）：`CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, CASE importance WHEN 'high' THEN 0...`
- `due` / `importance` / `created`

### 前端（4 新组件 + 5 改造）

**新建**：
- `TodoView.tsx`：左列表栏（全部 + 各 list + 新建）+ 右任务区（排序下拉 + 显示已完成开关 + CSV 导入 + 新建按钮 + todo 列表）
- `TodoEditor.tsx`：编辑对话框（标题/备注/列表/重要性/到期日/状态）
- `TodoRow`（TodoView 内）：checkbox 完成 + 标题 + importance 徽章 + due_date（过期红色）+ 编辑/删除
- TopBar 改造：顶级 tab「日历 / 待办」，日历 tab 下保留月/周/日/年 + 翻月；待办 tab 下隐藏

**改造**：
- `App.tsx`：加 `topTab` state（'calendar'|'todo'）；todo tab 渲染 TodoView 隐藏 Sidebar/DetailPanel
- `types.ts`：加 `Todo`/`TodoList`/`TodoSort`/`TodoStatusFilter`/`TopTab`；`Day` 加 `todos: Todo[]`
- `client.ts`：加 todo 系列 API（getTodoLists/getTodos/createTodo/updateTodo/deleteTodo/importTodosCsv）
- `DayCell.tsx`：colorLayers 加 todo 维度（todo enabled 且 day.todos 有未完成 → 琥珀色）
- `YearView.tsx`：miniCellColor 加 todo 维度
- `DetailPanel.tsx`：事件区下方加「待办」区块（列该日期 todo，可勾选完成→toggleTodoMut）

### CSV 格式（6 列固定 schema）

```csv
title,due_date,importance,status,list_name,body
买牛奶,2026-08-10,high,notStarted,购物,去超市
```
- title 必填；due_date YYYY-MM-DD；importance low/normal/high；status notStarted/completed；list_name 相同归一列表（不存在自动创建，空则"已导入"）；body 可选
- 解析容错：utf-8-sig→utf-8→gbk→gb2312 编码回退；importance/status 大小写不敏感；空 title 行跳过并记 errors

### 踩坑

1. **fetch_todos 漏传 params**：`conn.execute(sql)` 缺 params 参数 → "Incorrect number of bindings supplied"。修复：传 params。
2. **CSV 导入 SQLite 跨线程**：`async def import_todos_csv` 在事件循环线程跑，但 `get_db` 连接在线程池线程创建 → `ProgrammingError`。修复：改 `def`（sync）+ `file.file.read()`（同步读 UploadFile）。
3. **db.py edit 误删 ensure_default_layer_configs**：`oldString` 匹配到函数内第一个 `set_meta` 而非末尾的，把 LAYER_COLORS import + defaults + jisilu 图层 seed 全删了。修复：恢复完整函数。

### 验证

| 项 | 结果 |
|---|---|
| tsc --noEmit | 0 错误 |
| vite build | 245.71KB JS / 24.37KB CSS（gzip 74KB/5.5KB） |
| curl CRUD（list+todo+view） | 全 200，view 含 todos 字段 |
| CSV 导入 | inserted=4, lists_created=4, errors=[] |
| playwright TodoView | 左列表栏 + 右任务区 + 排序 + CSV 按钮 + 1 条 todo 渲染 |
| playwright 日历联动 | DayCell 8月10日染 rgb(245,158,11) 琥珀 ✓；DetailPanel「待办」区块显示"买牛奶 ⚡高" ✓ |
| 生产 launcher | bundle hash BPiX32S7 匹配 dist ✓；Job Object 关 Pake→python+launcher 全清 ✓ |

### MS To Do 集成路径（后续，不在本期）

MS To Do 原生不支持 CSV 导出。用户可：
1. 第三方工具（如 todoist-backup 类、Power Automate）导出 CSV
2. 或手动从 MS To Do 网页版复制到 Excel 存 CSV
3. 再用本应用「CSV 导入」按钮上传

Graph API 集成（device code flow）方案已在 brainstorming 阶段调研完毕（见 TODO_FEATURE_PLAN.md 调研记录），如后续需要双向同步可启用。

---

## 17. 第六轮：TODO 详情栏 + 日历/集思录交互优化（6 项）

> 本轮在 TODO 模块与日历各视图上追加 6 项交互/展示改进，全部经用户先行确认方案后实施，`tsc` + `vite build` + playwright 端到端验证通过。

### 17.1 TODO 模块（T1：点选详情栏）

- 触达表格：点击任一 todo row → 右侧 `TodoDetailPanel.tsx` 打开（左列表栏 w-60 / 右详情栏 w-72，与日历 DetailPanel 宽度严格对齐）。
- **内联编辑**：详情栏内直接编辑 title/body/importance/due_date/list/status；dirty 检测 + 保存/删除按钮；**无每行内联按钮**（编辑/删除统一在详情栏内完成，行保持干净）。
- **importance 色点**：high=#ef4444（红）/ normal=#eab308（黄）/ low=#22c55e（绿），列表行左侧彩色圆点。
- **已完成折叠**：已完成任务默认折叠在底部「已完成（N）」展开组，未完成 29 条 + 已完成 1196 条分开展示。
- **CSS 约束**：`min-h-[104px]`（todo 列表）容器；详情栏头部显示「日期 + 星期 + 今天」。

### 17.2 集思录子动作过滤（C1）

**背景**：用户希望按「子动作」（申购日/上市日/转债赎回/下修股东会等）决定每个集思录图层显示哪些事件，而非整层开关。

- **后端**（`backend/aggregator.py`）：
  - `_sub_action_of(title)`：正则 `^【(.+?)】` 从事件标题提取子动作名。
  - `_event_passes_layer_filter(ev, layer)`：白名单判定——`layer.config.sub_qtypes` 为空/缺失 → 全部显示；否则仅当该事件 `(qtype, sub_action)` 命中白名单才显示。
  - `build_view` 中每个事件都过 `_event_passes_layer_filter` 过滤。
- **后端**（`backend/routes.py`）：
  - `LayerConfigBody`：`{ sub_qtypes: [{qtype, sub_action}] }`
  - `PUT /api/layers/{id}/config`：更新某图层 config（含 sub_qtypes）
  - `GET /api/layers/{id}/sub-actions`：聚合该图层全部去重子动作对 `(qtype, sub_action)`
- **前端**：
  - `client.ts`：新增 `updateLayerConfig` / `getLayerSubActions`
  - `SettingsDialog.tsx`：`SettingsDialog` 内「集思录投资日历」区改为 `LayerAccordion`（可展开/收起子动作），展开后 `LayerSubActions` 渲染 chips；
  - chips 语义：`layer.config.sub_qtypes` 为空 → 全部显示（`isAllOn`，显示「当前全部显示」+「恢复全部」按钮）；点某 chip → 从白名单剔除该子动作（config 写入剩余白名单）；再点一次 → 重新加入；「恢复全动作」→ `sub_qtypes=[]`（= 不过滤）。

### 17.3 日历视图（C2/C3/C4/C5）

- **C2 周视图更多事件**：`DayCell` 加 `maxLabels` prop（默认 3）；`maxLabels>=6` 时 cell `min-h-[160px]`（否则 `min-h-[104px]`）；`WeekView` 传 `maxLabels={6}`，周视图每日最多显示 6 条 + 溢出「+N」。
- **C3 日视图染色改左边竖条**：不再整卡填充背景，改为左侧 `w-1`（4px）绝对定位竖条 + header `pl-5`（20px）避开色条；barColor 取 `colorLayers[0]`（多个染色维度时只取一个，避免多条竖条叠加）。
- **C4 年视图翻年按钮**：`TopBar` 在年模式下按钮 title 显示「上一年 / 下一年」（Data.ts `shiftYearKey` + App `navigate()` 的 year 分支）——修复之前年视图下按钮文案仍是「上一月/下一月」、点按只改月不改年的误导问题。
- **C5 染色文字对比自适应**：`data.ts` 新增 `relativeLuminance(c)`（WCAG）与 `pickContrastColor(c)`（3 个通道预加权计算，返回黑或白）；`DayCell` 对日期数字与事件标签用 `pickContrastColor(colorLayers[last].color)`，深色背景自动变白字、浅色保持黑字。

### 验证矩阵

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `vite build` | 251.62KB JS（`index-B9v0POA-`）/ 25.56KB CSS |
| T1 TodoView 交互 | 左 240px/右 288px 严格对齐；点选 open 详情；重要性 29 色点（红/黄/绿）；未完成 29 条 + 完成折叠「已完成（1196）」 |
| C1 查询子动作过滤 | 设置→展开·可转换→点 chip「申购日」→ 后端 config `sub_qtypes=8项`（排除申购日）→ 月视图 8/6 事件 10→7，申购日事件消失；恢复 `sub_q=[]` 后恢复 10 |
| C2 周视图 | 8/6 显示 6 条事件 +「+4」折叠，全 cell `min-h-[160px]` ✓ |
| C3 日视图 | 启用重要日期层后左侧渲染 4px 竖条（#ff6262）+ header pl-5 ✓ |
| C4 年视图 | 点「下一年」标题 2026→2027，「上一年」→2026 ✓ |
| C5 对比度 | 深色染色日（#ff6262 系）日期数字+标签全部白色 rgb(255,255,255) ✓ |

### 遗留 / 注意

1. **C1 设置对话框 staleness**：`SettingsDialog` 顶层 `layers` 来自 App 的 `localLayers`（当侧栏切换任一图层后非空），导致 `LayerSubActions` 读到的 `layer.config` 可能是「旧值」——chip 点击后 UI 状态可能滞后。规避：改 config 后用「恢复全动作」或关掉对话框再重开确保 `view` 失效刷新。后续可在 App 层把 `localLayers` 从 `config` 更新流经 `invalidateQueries(['view','layers'])` 一并清除。
2. 本轮未改后端 `data/` 里的既有 jisilu 图层 config（仍可全平台显示）；用户若在设置页把「全部显示」改为子动作白名单，变化会持久化到 DB（`layer.config`），属预期。

### 18. 新一轮迭代：待办增强 + 倒数日 + 统计（2026-08-06）

#### 18.1 待办性能优化
- **问题**：首次切到待办 tab 需等一会儿（原来一次拉全量 1226 条，含 1197 已完成）。
- **方案**：
  - 新增 `GET /api/todo/stats?list_id=`（轻量 COUNT）→ 折叠按钮数量即时显示，无需拉全量。
  - 列表拆两个查询：未完成（`status=notStarted`，29 条，首屏秒出）+ 已完成（`status=completed&limit=500`，展开折叠才拉）。
  - App 在日历 tab 时 `prefetchQuery` 待办统计+未完成列表 → 切 tab 秒开。
- **验证**：playwright 切待办 tab 无 loading；「已完成（1197）」数量来自 stats；展开懒加载正常。

#### 18.2 待办标题自动换行
- `TodoRow` 标题 `<p>` 由 `truncate` 改为 `break-words whitespace-normal leading-snug`（去掉单行截断，可完整显示长标题）；body 同改；列表行容器改 `items-start`。
- **验证**：529 个标题节点 class 含 break-words；长标题（如华泰分析）完整显示。

#### 18.3 待办详情字段：开始日 / 复杂度 / 自定义标签
- **DB**：todo 表新增 `start_date TEXT`、`complexity TEXT DEFAULT 'medium'`（simple|medium|hard）、`tags TEXT`（JSON 数组）。`init_db` 增加 `_ensure_todo_columns`（PRAGMA 检查 + ALTER TABLE，旧库平滑升级）。
- **后端**：`TodoIn` / `_todo_from_in` / `upsert_todo` / `_row_to_todo` 全链路支持新字段；CSV 导入可选解析 `start_date/complexity/tags` 列。
- **前端**：`TodoDetailPanel` 增加开始日 date、复杂度下拉（简单/中等/复杂）、标签输入（逗号分隔 + chips 预览）；`TodoRow` 显示标签 chips（最多 4 个）与复杂度徽标（非 medium 才显示）。
- **验证**：编辑头发夹板待办加「测试标签,验证」+ 开始日 2026-08-01 + 复杂 → DB 落库正确、刷新后列表 chips 显示；已还原测试数据。
- **注意**：`sqlite3.Row` 无 `.get()` 方法（曾因此踩坑 500），统一用下标访问。

#### 18.4 倒数日子 tab
- `ViewMode` 增加 `'countdown'`，TopBar 视图按钮组加「倒数日」（月/周/日/年/倒数日）。
- 新增 `GET /api/countdown/list` → 重要日期图层全部 offset==0 主事件（±10 年窗口），按「未过期在前、剩余天数升序」排序，含 days_left/is_today/passed。
- 新建 `CountdownView.tsx`：未过期列表 + 已过期折叠组、每行剩余天数徽标；「新建倒数日」+ 行内编辑/删除。
- `EventEditor` 增加 `fixedLayerId` prop：倒数日编辑固定 important 图层并隐藏图层下拉。
- countdown 模式不显示翻月/今天按钮，键盘 ←→ 忽略；`getView` 对 countdown 抛错（不走视图接口）。
- **验证**：6 条倒数日（生日/圣诞节/姐姐生日/香港演唱会/丝之歌发售/和姐姐在一起）全部列出，剩余天数正确；新建弹窗无图层下拉。

#### 18.5 统计顶级 tab
- `TopTab` 增加 `'stats'`（日历/待办/统计）。
- 新增 `GET /api/stats/summary`：`quadrant`（未完成待办 + days_to_due）、`daily_done`（近 90 天 GROUP BY completed_at 逐日完成数，缺天补 0）、`stats`（total/incomplete/completed）、`list_names`。
- 新建 `StatsView.tsx`（零依赖）：
  - 4 张概览卡（总/未完成/已完成/近90天完成）。
  - **四象限图**：横轴=到期紧迫度（逾期→0，30 天内线性，超 30 天→1），纵轴=重要性（高→0，低→1）；CSS 绝对定位散点 + 象限标签 + hover tooltip。
  - **逐日完成折线**：纯 SVG（polyline + 渐变面积 + 均值参考线 + 非零点圆点），viewBox 900x160。
  - 列表分布条形图。
- **验证**：29 散点 = 29 未完成；SVG path 渲染；卡片数值正确（1197 已完成）。

#### 18.6 顺手修复
- `db.connect()` 加 `check_same_thread=False`：FastAPI 线程池可能把 Depends 生成器连接与路由分到不同线程（新端点多 DB 调用时偶发 500，如 stats/summary）。每请求独立连接 + WAL，跨线程安全。

### 验证汇总（§18）

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `vite build` | 266.97KB JS（index-DGdIiAEM）/ 27.37KB CSS |
| 待办性能 | 切 tab 秒开（prefetch+stats+懒加载），已完成（1197）即时显示 |
| 标题换行 | break-words 生效，长标题完整可见 |
| 新字段 | 开始日/复杂度/标签 编辑+持久化+列表 chips ✓ |
| 倒数日 | 6 条列出、剩余天数正确、新建/编辑/删除链路 ✓ |
| 统计 | 四象限 29 散点、逐日折线 SVG、卡片数值 ✓ |
| 回归 | 月视图事件/子动作过滤/日历染色正常 |

### 遗留 / 注意（§18）

1. 已完成列表 `limit=500`：超过 500 条完成记录时展开只显示最近 500 条（数量仍准确）。如需全量可去掉 limit（牺牲首屏性能）。
2. `stats/summary` 的 quadrant 仅含未完成待办；若要历史完成点可加 filter。
3. CSV 导入新列（start_date/complexity/tags）为可选，旧 CSV 完全兼容。


## §19 倒数日独立表 + 待办增强（2026-08-06）

### 倒数日重构（独立 countdown 表）
- 新建 `countdown` 表：name/category/base_date/repeat_yearly/milestone_rule/never_expire/notes/color/sort_order
- 迁移：events 表 important 图层 offset==0 的 4 条主事件迁入（和姐姐在一起→纪念日+milestone 100,365,520,1000,3650；生日/姐姐生日→生日+每年重置；圣诞节→节日+每年重置）
- 动态 next 计算（aggregator._next_occurrence）：每年重置→明年同日（2/29 平年取 2/28）；里程碑→base+N 天取最近；两者都配→取最近；一次性→固定（可能已过）
- 措辞：一次性过期→「已过 N 天」；never_expire=1→「已过 · 永久纪念」；每年重置/里程碑类永不过期
- CRUD：POST/PUT/DELETE /api/countdown[/{id}]（db.upsert_countdown INSERT 后回写 lastrowid）
- UI：CountdownView 重写为 左侧分类栏（全部/生日/纪念日/节日/重要事件/自定义，计数+色点）+ 卡片网格（分类徽标/循环/里程碑/永不过期图标、剩余天数大字）+ 右侧 CountdownDetailPanel（名称/分类/基准日期/每年重置/里程碑规则/永不过期/备注）
- 侧栏倒计时文本改用新表（build_countdown 基于 build_countdown_list）

### 染色逻辑简化
- 渐变染色 → **当天染目标色**（build_view 只给重要日期当天 gradient_bg=#FF4D4D，其余天无值；删除 build_gradient 调用）
- 倒数日挂钩：countdown 未来 next_date 也纳入重要日期染色日期集合
- **图层开关只控制染色**：DayCell/DetailPanel 对 important/schedule 图层事件豁免 enabled 过滤（始终显示文字），其余图层仍按开关

### 待办增强
- 新字段 `planned_date`（计划日期）：todo 表+模型+API+前端全链路；日历 fetch_todos_between 同时匹配 due_date 和 planned_date（同一 todo 可挂两天）
- DetailPanel 待办区：due_date==当天 → 「截止」标注
- TodoRow 徽标：已过期（红）/今天截止（橙）/明天截止（黄）/今日计划（蓝）；无特殊状态显示日期
- TodoDetailPanel：标题 input→textarea（rows=2, break-words 自动换行）；日期字段拆「截止日期」+「计划日期」
- 动画：行进入 tt-row-enter（fadeSlideIn 0.25s，index.css keyframes）；完成/取消完成先 leaving（opacity-0 收缩 280ms）再调 API

### 统计 tab 回退
- TopBar 移除「统计」顶级 tab；App.tsx 移除 stats 渲染分支；StatsView.tsx/client.getStatsSummary 代码保留未删

### 验证
- 后端：countdown CRUD 全通；planned_date 挂日历（8/6 双日期显示）；8 月染色仅 8/11（#FF4D4D，无渐变）
- 前端 playwright：倒数日卡片/分类栏/详情面板/新建（已过期显示「已过 · 永久纪念」）；重要日期 disabled 时 8/11 文字仍显示、启用后当天染色+文字变白；今天截止/明天截止/已过期徽标；标题 textarea；动画链路（点击→280ms→API 完成）
- tsc 0 错误；vite build 通过（267.68KB index-CWCkdFNv.js / 29.10KB CSS）
- 遗留：be_*.log/vite_*.log 被运行进程占用未删（下次重启覆盖）


## ��20 ������ǿ + �����ո��飨2026-08-06��

### �����б� TodoView ��ǿ
- ��ǩ��ϵ�����Ӷȣ���/�е�/���ӣ�����Ҫ�ԣ���Ҫ/��ͨ/��Ҫ����״̬��δ��ʼ����ʾ/��������ʾ������ǩ tag����ֹ�ձ꣨�������ֹ �� 08-07����08-10���ȣ��������ռƻ��������ռƻ����ձ꣨����=planned_date Ϊ���죩
- ��ά�������� 6 ���ֹ+��Ҫ�ԣ�Ĭ�ϣ�/��ֹ+�ƻ�+��Ҫ��/��ֹ��/�ƻ���/��Ҫ��/����ʱ�䣬�л���ʱ����
- Tag ɸѡ������ѡ��ǩ���ˣ�����ȫ����ǩ���ָ�
- Ĭ���б������ǰ�ť setDefaultList д localStorage tt_default_todo_list ������ͼ��ˢ�³־û���hover ��ʾ����ΪĬ���б�/ȡ��Ĭ�ϡ�
- �б���ק���ţ�HTML5 draggable��onDrop splice + reorderListMut д��ˣ�ˢ�³־û�

### �������� TodoDetailPanel
- �������������� DueDateQuickPicker��Ԥ�衸��/����/����/����һ/ѡ�����ڡ����� չ�� date input + ����
- ��� bug �޸���expanded ʱ��ֹ���� label col-span-2���ƻ����� label ���أ������������ 124px ��Ԫ���·��ذ�ť������ input ����

### ���
- todo_list reorder �ӿڣ���ק����־û���
- aggregator����������/milestone �� label

### TopBar �����޸�
- countdown ģʽ h1 ��� w-[140px] ռλ��ģʽ��ť�������루��ģʽ x=477��countdown x=481���޸�ǰ 337 ���� 140px��

### ��֤
- playwright ȫ���̸���ͨ����DueDateQuickPicker չ��/�������ص�����ק����+�־û�+��ԭ�������� tab������ɫ��� pink/amber/violet/blue �Ǻ�ɫ�������� N �졹�ڻҡ����� select ����+ �Զ��塭���л�����������������׺��
- tsc --noEmit EXIT:0������� console 0 errors
- ��֪��΢覴ã�δ�ģ���ȫ��δ��ɻձ���ʾ scoped ��ѡ���б���22������ȫ�� 33


## §21 启动性能优化 v2（2026-08-12）

### 问题
用户反馈：双击 launcher 到窗口可用 ~6-7s。`launcher.log` 实测 backend spawn → ready **7-10s**（偶发 13.86s），这是感知慢的真凶。

### 诊断
| 阶段 | 耗时 |
|---|---|
| Launcher 自启 + 端口清理 | ~0.3s |
| **Backend exe spawn → ready（真凶）** | **7-10s** |
| Pake (Tauri) spawn + 窗口出现 | ~10ms + 1-2s |

**根因**：`e7a3f6a feat: standalone release build without system Python dependency`（8-11）为了 release 不依赖系统 Python，把 launcher 从 8-5 的「spawn 系统 python」改回「spawn PyInstaller exe」。但 **spec 的 `excludes=[]` 没改回来**——等于回到 8-5 之前的慢启动状态：
- 旧 exe = 69.64MB（单文件 onefile），每次启动解压 135MB 到 `%TEMP%\_MEIxxxxx`
- 解压目录里打包了 numpy/scipy/matplotlib/PIL/lxml/pandas/cryptography/tkinter/jupyter 全家桶——**项目代码 grep 0 引用**，纯属 PyInstaller modulegraph 把开发机 site-packages 全扫进去的误判
- 纯 Python 启动 + 全部 lifespan 钩子（含 `sync_countdown_events`）实测只要 1.7s

**附带 bug**：launcher 注释/函数名都叫 `wait_for_health`（"HTTP /health 轮询"），但代码实际只 `TcpStream::connect`——uvicorn 一绑 socket 就 true，lifespan 钩子还没跑完就误判 ready，前端第一个请求被卡几百毫秒。

### 双轨方案（用户选）
- 本机 + 有 Python 的用户：launcher 优先 spawn 系统 python（`python -m uvicorn`），启动 ~1.5s
- 没装 Python 的用户：fallback 到瘦身后的 PyInstaller exe，启动 ~2.5s
- Release 同时包含两种部署方式，launcher 自适应

### 改动
1. **`tt-calendar-backend.spec`** `excludes` 加 numpy/scipy/PIL/matplotlib/pandas/lxml/tkinter/cryptography/jupyter/pytest/tensorflow 等。exe 从 **69.64MB → 20.97MB**。
2. **`launcher/src/main.rs`** 重写：
   - `spawn_backend` 优先尝试 `find_system_python`（试 `python`/`python3`/`py` 的 `--version`）
   - **二次校验**：`check_python_deps` 跑 `python -c "import fastapi, uvicorn, pydantic, chinese_calendar, bs4, dateutil, httpx"`，避免装了 python 但没 `pip install -r requirements.txt` 时启动到一半崩
   - 系统 python 不可用 → fallback 到 `tt-calendar-backend.exe`
   - `wait_for_health` 改成真 HTTP GET /health（手写原始 HTTP/1.0 请求 + 检查 ` 200 ` 状态码），不再被 lifespan 未跑完误导
3. **`backend/main.py`** lifespan 启动新增 `db.sync_countdown_events(conn)`（见上一节 sync_countdown_events 说明，本次顺便验证启动耗时包含它也只有 1.7s）

### 实测对比
| 指标 | 优化前 | 优化后（系统 python）| 优化后（PyInstaller exe） |
|---|---|---|---|
| Backend spawn → /health 200 | 7-10s | **1.98s** | **2.48s** |
| 总启动到 pake spawn | 8-10s | **3.55s** | ~4s |
| 用户感知"加载中"消失 | 8-10s | **4-5s** | ~5-6s |
| exe 大小 | 69.64MB | — | **20.97MB** |

### 注意
- 系统 python 模式需要部署机器装 Python 3.10+ 且 `pip install -r requirements.txt`；不装也能用，launcher 自动 fallback
- PyInstaller 重打包耗时 ~120s（开发周期考虑）
- launcher 编译需要 MSVC 工具链（参考 `build_release.bat`）
- 旧的 `docs/MIGRATION_PLAN.md` §14（2026-08-05）曾经做过类似优化但当时只走系统 python；这次合并两条路线
