# 订阅适配规范（给 Agent 的操作手册）

> 你（agent）收到「有新的订阅要做适配」的提醒时，按本文档执行。
> 背景：TT Calendar 的订阅架构见 docs/PHILOSOPHY.md §3；用户在应用内登记订阅后，登记信息存 SQLite `subscriptions` 表（status='pending'），应用不能拉取，等你完成适配。

## 适配流程

1. **读需求单**：
   ```sql
   SELECT id, display_name, url, rules_text, config_json
   FROM subscriptions WHERE status = 'pending';
   ```
   `rules_text` 是用户用自然语言写的抓取规则（抓哪个页面、什么字段、什么频率），是你的需求规格。

2. **实现抓取器**：在 `tt_calendar/sources/` 下新建模块（参考 `jisilu.py` 的结构）：
   - 输入：日期区间（start/end）
   - 输出：`(list[Event], FetchResult)`，Event 的 `layer_id` 必须用你的订阅专属前缀（见下）
   - 网络用 httpx/BeautifulSoup（已有依赖）；解析逻辑按 rules_text 实现
   - 抓不到/解析失败：返回 FetchResult(error=...)，不要抛异常

3. **注册图层**：`tt_calendar/config.py` 的 `JISILU_QTYPES` 同款思路——为你的订阅定义子类别与图层（`layer_id = <prefix>_<subkey>`，`group_name = 订阅的 display_name`，kind='dot'）。侧边栏会自动把它挂到「订阅」超级组下（Sidebar 按订阅 display_name 匹配 group）。同时参考 `db.ensure_default_layer_configs` 的做法幂等 seed 图层。

4. **接线刷新**：`backend/routes.py` 的 `_refresh_one_subscription()` 按 `source_key` 分发——加一个分支调用你的抓取器（区间建议：`last_synced_at`（或今天-180 天）→ 今天+90 天），成功 `db.touch_subscription_synced(conn, id, "active")`，失败传 error。

5. **激活订阅**：
   ```sql
   UPDATE subscriptions SET source_key='<你的key>', status='active',
          updated_at=datetime('now','localtime') WHERE id='<该订阅id>';
   ```
   （若已在第 4 步代码化，直接在应用里点「立即更新」也会转 active。）

6. **验证**：启动 dev 后端（`python -m uvicorn backend.main:app --port 8000`），`POST /api/subscriptions/<id>/refresh` 应返回 `{"ok": true, "inserted": N}`；前端「订阅」面板该订阅显示 active + 可开关。

7. **rebuild**：改了后端代码必须重建 sidecar + exe 才对桌面版生效，流程见 docs/DEV_ENVIRONMENT.md（PyInstaller → tauri build → 清缓存）。

## 约定

- 订阅产生的 events 是**派生数据**：`source != 'manual'` 的 events 不参与数据同步（各设备自行拉取），所以你可以随时删掉重来，不会污染同步
- 用户可能把 `auto_update` 关掉（一年一更的日历）——你的刷新逻辑不需要管这个，`refresh-due` 端点会按开关过滤
- 删除订阅只删登记行，已抓取的事件保留（前端文案已说明）
- 内置订阅 `builtin:jisilu` 不可删除，只可关闭

## 数据模型（subscriptions 表）

| 列 | 说明 |
|---|---|
| id | TEXT PK；内置 `builtin:jisilu`，自定义 uuid |
| display_name | 展示名 = 侧边栏「订阅」分组依据 |
| source_key | 分发键：`jisilu` / 你适配时定的 key / `custom:*`（未适配） |
| url / rules_text | 用户登记的需求单 |
| enabled / auto_update | 用户开关 |
| status | active / pending（待你适配）/ error |
| last_synced_at | 上次成功/失败拉取时间 |
| config_json | 扩展配置；`last_error` 由系统写入 |
