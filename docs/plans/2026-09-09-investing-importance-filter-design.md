# Investing 插件：按重要性（星级）过滤 + 同日星级排序 — 设计

日期：2026-09-09 · 状态：已批准（用户确认三个决策点后开工）

## 背景

investing 插件当前只有「按地区」一层（15 个国家图层 + 兜底图层）。用户日常用法是
「只看中美 3 星事件」。需要增加重要性维度：每个国家图层可独立设置最低星级，
且同一天内事件按星级优先排列。

## 已确认的需求决策

1. **设置位置**：每个国家图层各自设置（设置面板 → 图层展开区），不做订阅级统一开关。
2. **默认值**：美国（investing_5）、中国（investing_37）默认 3★；其余图层默认全部。
3. **排序**：同一天内 3★ 在最上、同级按时间先后（不只是过滤）。

## 架构：沿用「声明式渲染时过滤」模型

事件全量入库（现有行为不变），渲染时按图层 config 过滤 —— 与集思录 `sub_qtypes`
白名单同构（见 `backend/aggregator.py::_event_passes_layer_filter`）。
`layer_config` 是同步表，`min_importance` 存放在既有 `config_json` 内 →
**不动 sync 协议、不动 gen_types、不动 schema 生成器**。

## 改动清单

### 核心（主仓库 E:\TT_Calendar）

| 文件 | 改动 |
|---|---|
| `backend/aggregator.py` | `_event_passes_layer_filter` 增加 `min_importance` 段：键存在且 >0 时，`int(ev.extra.importance or 0) < min` 的事件剔除。无该键的图层（集思录等）行为不变；无 importance 的 non-investing 事件在 investing 图层里不会被该段误伤（它们本就不在该图层）。 |
| `backend/routes.py` | `LayerConfigBody` 增加 `min_importance: int \| None`；`update_layer_config` 中非 None 时写入 `cfg["min_importance"]`（0=不过滤，保留键）。 |
| `frontend/src/api/client.ts` | `updateLayerConfig` 参数类型加 `min_importance?: number`。 |
| `frontend/src/components/SettingsDialog.tsx` | `LayerAccordion` 展开区：图层 config 含 `min_importance` 键（数据驱动，不写死 investing）→ 渲染 `LayerMinImportance` 组件（全部 / 1★以上 / 2★以上 / 3★ 四档按钮，乐观更新 + invalidate view/layers 查询，复用 `updateLayerConfig`）；此时隐藏 `LayerSubActions`（investing 层无 qtype 事件，子动作面板只会显示空态）。无该键的图层维持现状。 |

### 插件（`plugins/investing.py`，同步插件仓库 TTDiang2/TT_Calendar_Plugins）

- `layer_specs()`：每个国家图层 config 增加 `"min_importance"`：5/37 → 3，其余 → 0（含 `investing_other`）。
- `ensure_layers()`：现有图层 config 缺 `min_importance` 键时**补种**为 spec 默认值
  （只补缺失键，不覆盖用户已改的值；否则用户现有的中美图层拿不到默认 3★）。
- 事件 `sort_key`：从固定 0 改为 `(3 - importance) * 10000 + 当地时间分钟数`
  （3★ 在最上、同级按时间；importance=0 未知排最后）。`db.fetch_events` 本来就
  `ORDER BY date, sort_key, id`，DayCell/DayView/内置图层都按 sort_key 排 → 排序零核心改动。

## 测试

- 主仓库 `tests/`：aggregator 过滤用例 —— min=3 时 importance=3 保留 / importance=2 剔除 /
  无 min_importance 键的图层全通过 / min=0 不过滤。
- 插件仓库 `tests/test_investing_source.py`：`layer_specs` 默认值断言（5/37 → 3，其余 → 0）、
  sort_key 公式断言。

## 边界与不动的

- 被过滤事件仍在库里：关掉过滤即恢复，多端同步无冲突。
- 集思录图层无 `min_importance` 键 → 完全不受影响。
- 用户当前跑的是源码树 uvicorn（127.0.0.1:8765）：核心改动 + 插件改动都需**重启后端**生效
  （插件模块被 `ensure_layers` 首次调用时缓存）。
