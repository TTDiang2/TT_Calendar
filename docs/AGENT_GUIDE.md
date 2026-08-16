# TT Calendar Agent 操作指南（总入口）

> 你（agent）被用户要求修改 TT Calendar 时的第一站。项目哲学：**agent-first 可定制日历**（docs/PHILOSOPHY.md）——Python + 完整 docs 就是为了让你能安全地改。

## 项目地图

| 主题 | 文档 |
|---|---|
| 设计哲学（最高参照） | PHILOSOPHY.md |
| 技术架构（领域模型/红线） | ARCHITECTURE.md |
| 开发环境 / 构建 / 踩坑 | DEV_ENVIRONMENT.md、EXE_LOADING_TROUBLESHOOT.md |
| 多端同步（协议/架构/指引） | SYNC_PROTOCOL.md、SYNC_PLAN.md、SYNC_SETUP.md |
| **新订阅适配** | SUBSCRIPTION_SPEC.md |
| 功能规划历史 | TODO_FEATURE_PLAN.md、MIGRATION_PLAN.md、RESEARCH_*.md、PLAN_PWA.md（冻结中） |

## 代码结构速查

- `backend/`：FastAPI 路由（routes.py）+ 视图聚合（aggregator.py）
- `tt_calendar/`：数据层（db.py）、模型（models.py）、数据源（sources/）、同步引擎（sync/）
- `frontend/src/`：React（components/ 视图组件，api/client.ts 是唯一后端接口面）
- `launcher/`：Rust 启动器；`frontend/src-tauri/`：Tauri 壳

## 修改后的验证与交付（铁律）

1. **Python 改动**：`python -m pytest tests/test_merge.py tests/test_provider.py -q` + `python tests/test_sync_db.py` 全绿
2. **前端改动**：`cd frontend && npx tsc --noEmit` 零错误（有测试时 `npm run test`）
3. **桌面版生效必须 rebuild**：后端改动 → PyInstaller sidecar + tauri build；纯前端 → 仅 tauri build。完整链路见 DEV_ENVIRONMENT.md「常用命令」
4. 改动涉及同步行为 → 跑 `python tests/gen_golden.py` 确认向量幂等（协议语义没变就不应有 diff）
5. 踩到新坑：先记 docs 再修（用户哲学），commit 信息用 conventional 风格

## 常见任务入口

- **适配新订阅**：读 SUBSCRIPTION_SPEC.md，需求单在 `subscriptions` 表 status='pending' 的行
- **加/改数据字段**：db.py SCHEMA_SQL + 旧库迁移函数（`_ensure_*_columns` 模式）+ models.py + 若参与同步则更新 SYNC_TABLES 并重跑 `python tools/gen_types.py`
- **改忙度/图层渲染**：aggregator.py（后端聚合）+ frontend/src/data.ts（颜色）
