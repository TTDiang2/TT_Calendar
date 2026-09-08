# 英为财情-投资日历 订阅适配交接（2026-09-03 创建 / 2026-09-07 v2 重写）

> 本文档写给接手的 agent。用户需求 + 已完成事实 + 卡点 + 下一步，按此推进。
> 总规范见 `docs/SUBSCRIPTION_SPEC.md`。

## 0. 当前状态（2026-09-07 v2 API 切换后，全链路已验证）

- ✅ 数据源切换为 **v2 occurrences API**（`endpoints.investing.com/pd-instruments/v1/calendars/economic/events/occurrences`）——旧 `Service/getCalendarFilteredData` 已弃用（无视日期/国家过滤、只回当天、HTML 混排多国）
- ✅ `plugins/investing.py`：v2 fetch（ISO 日期 + country_ids 并集 + **超页日期窗口拆分**）+ JSON 解析（events↔occurrences 按 event_id join）+ 行级国家归属（未收录国家 → `investing_other`）
- ✅ HTTP 层：curl_cffi chrome120 优先（CF TLS 指纹绕过），httpx 兜底；cookie 注入
- ✅ `tt_calendar/config.py`：v2 端点/domain_id=6/limit=200/国家表（16 国校准）/请求国家并集
- ✅ `tt_calendar/db.py` `ensure_default_layer_configs`：国家 ID 迁移（display_name 不符即改名/改色/覆盖 enabled）+ `investing_other` 补种
- ✅ 前端 `DetailPanel.tsx` `InvestingFields`：时间/货币/统计周期/重要性星级 + 今值/预测值/前值 + vs 徽标
- ✅ 解析单测 18/18（含真实抓包样本 docs/investing_v2_sample.json、docs/sample.json）；全量 50/50
- ✅ e2e 实测（开发机直连，非用户环境）：9/5~9/21 全量 506 条 → 启用图层（美 134/日 40/欧 6）写入 DB 180 条，14 天日期分布正确，extra 完整
- ✅ 更新语义：upsert 按 (layer_id, source_ref) 覆盖 extra_json → 每次刷新自动更新今值/预测值/前值
- ✅ 刷新节奏（用户已确认）：每天首次打开应用自动刷一次 + 手动「立即更新」
- ⚠️ 用户桌面端需重启 launcher 加载新代码（uvicorn 无 --reload）

## 1. 用户需求（原话整理）

- 订阅名：**英为财情-投资日历**
- 网址：**https://cn.investing.com/economic-calendar**
- 想要：按国家分门别类的投资日历事件。期望示例表格：

| 时间 | 国家 | 事件 / 指标 | 实际值 | 预报值 | 前值 | vs 预期 |
|---|---|---|---|---|---|---|
| 10:00 | 🇳🇿 新西兰 | 新西兰央行利率决议 | 2.75% | 2.75% | 2.50% | ● 符合 |
| 20:15 | 🇺🇸 美国 | ADP就业人数（八月） | 38K | 47K | 46K | ▼ 不及 |
| 22:30 | 🇺🇸 美国 | 当周EIA原油库存变动 | -4.450M | -0.400M | 0.095M | ▲ 超预期 |
| 20:30 | 🇺🇸 美国 | 初请失业金人数 | 待公布 | 205K | 203K | — |

- 字段：时间(HH:MM)、国家、事件名、实际/预报/前值、vs预期（符合/不及/超预期/待公布）
- 频率：每工作日更新（用户接受：每天首次启动自动刷 + 手动立即更新）
- 用户在意字段完整呈现：重要性/今值/预测值/前值（已做右侧详情面板）

## 2. 抓包确认的关键事实（勿再依赖旧资料）

### 2.1 v2 API 请求格式（浏览器真实请求）

```
GET https://endpoints.investing.com/pd-instruments/v1/calendars/economic/events/occurrences
    ?domain_id=6                      # 中文站
    &limit=200                        # 服务端上限 200
    &start_date=2026-09-07T00:00:00.000+08:00     # ISO8601 带时区（+ 交给 HTTP 库编码 %2B）
    &end_date=2026-09-13T23:59:59.999+08:00
    &country_ids=25,32,6,37,...       # 逗号分隔 investing 国家 ID（过滤有效）
    # 响应 next_page_cursor：游标回传参数名未公开（page_cursor/cursor 等实测被忽略），
    # 实现改为日期窗口对半拆分（单页 ~5-6 天全球事件，超过 200 就拆段重拉）
```
```

### 2.2 响应结构（浏览器抓包，docs/investing_v2_sample.json + docs/sample.json）

```json
{
  "events": [{"event_id": 1004, "country_id": 35, "currency": "JPY",
              "importance": "low", "event_translated": "日本外汇储备(美元)", ...}],
  "occurrences": [{"event_id": 1004, "occurrence_id": 556231,
                   "occurrence_time": "2026-09-06T23:50:00Z",   // UTC！
                   "actual": 1207.5, "forecast": ..., "previous": 1287.1,
                   "precision": 1, "unit": "B",                 // 显示 "1,207.5B"
                   "reference_period": "八月",
                   "actual_to_forecast": "neutral", ...}],
  "next_page_cursor": "..."
}
```

- occurrences 按 event_id join events；occurrence_id 唯一 → source_ref = `<country_id>:<occurrence_id>`
- actual/forecast/previous 为**数值** + precision + unit（显示时格式化）；forecast 只在有预测时出现（actual 公布后可能仍带）；actual 缺失 = 未公布
- occurrence_time 是 **UTC** → 转 Asia/Shanghai 得本地日期/时间（跨日事件注意）
- importance 字符串 low/medium/high → 1/2/3（前端星级）
- actual_to_forecast: positive/neutral/negative → 超预期/符合/不及；actual 缺失 → 待公布；actual 有且无 forecast → 不写 vs_forecast 键
- 国家/重要性**以行内字段为准**，请求参数仅服务端过滤范围

### 2.3 国家 ID（v2，旧 Service 时代的 ID 表整体失效！）

已校准（三次浏览器抓包，样本 docs/sample.json + investing_v2_sample.json）：

| ID | 国家 | ID | 国家 | ID | 国家 |
|---|---|---|---|---|---|
| 5 | 美国 | 25 | 澳大利亚 | 43 | 新西兰 |
| 6 | 加拿大 | 26 | 德国 | 48 | 印度尼西亚 |
| 14 | 印度 | 32 | 巴西 | 51 | 希腊 |
| 35 | 日本 | 37 | 中国 | 72 | 欧洲央行(讲话) |
| 39 | 中国香港 | 42 | 马来西亚 | 96 | 欧元区 |
| 110 | 南非 | | | | |

请求全集 = `INVESTING_REQUEST_COUNTRY_IDS`（24 国浏览器抓包）∪ cfg 已配置国家（fetch 内并集去重，
保证开启的每个国家图层都有数据；注意浏览器原始 24 国里没有 96=欧元区，不并集会漏欧区）。

## 3. 未完成 / 卡点

### 3.1 ~~翻页 cursor~~ → 已解决：日期窗口拆分

next_page_cursor 游标的回传参数名未公开（page_cursor/cursor/next_page_cursor/after 实测均被忽略，
无开源实现翻页）。现实现为：单页返回满 200 条就把日期窗口对半拆开递归请求（按 occurrence_time
过滤天然无重复）。17 天窗口实测拆 2-3 段，全量拉到 494-506 条。`INVESTING_MAX_PAGES=32` 兜底防死循环。

### 3.2 剩余国家 ID 校准

URL 24 国中仍有部分 ID（4/10/11/12/17/22/36/41/46/178 等）未校准 → 目前进 investing_other。
用户开启"英为财情·其他"图层可见；若要细分图层，按 investing_other 里出现的事件（country_id+currency）补 cfg 即可。

### 3.3 生效前提

8765 后端由 launcher 用 system python 跑源码（无 --reload）。改代码后需用户重启 launcher。
当前用户 DB：investing_5/35/96 已启用且有数据（180 条 9/5~9/21）；investing_37（中国）enabled=0
（旧手动状态），用户在 UI 打开后下次刷新即写入。

### 3.4 rebuild（发布用）

PyInstaller sidecar 需重建（curl_cffi 已在 spec hiddenimports；v2 无新第三方依赖）。

## 4. 环境备忘

- 生产后端 8765 跑 system python 源码（E:\TT_Calendar 树），改动重启 launcher 生效
- 测试：`python -m pytest tests/`（50 通过）；investing 单测 `python tests/test_investing_source.py`（可脱离 pytest 直跑）
- 真实抓包样本：`docs/investing_v2_sample.json`（9 条 occurrences）、`docs/sample.json`（34 events / 36 occurrences）
- 订阅 events 是派生数据（source='investing' 不参与数据同步，可删了重拉）
- **CF 限流观察**：开发机每次连续成功请求（1~10 个不等）后会进入冷却（403 边缘拒），冷却分钟~小时级。验证时控制请求量；生产每工作日一次 refresh 没问题。cf_clearance cookie 有寿命（半天~1 天），过期后用户需重新导出 data/investing_cookies.json
- 页面 sample（view-source_*.html / investing_api_sample.html）是旧 Service/空壳页，对 v2 无参考价值，可删

## 5. 改动文件清单（2026-09-07 v2 轮）

- `plugins/investing.py`：**重写** —— v2 fetch/解析/行级归属；删旧 Service HTML/JSON 解析
- `tt_calendar/config.py`：v2 常量 + 国家 ID 表 v2 校准（16 国）+ `LayerID.INVESTING_OTHER`
- `tt_calendar/db.py`：`ensure_default_layer_configs` 国家迁移（改名/覆盖 enabled）+ other 补种
- `frontend/src/components/DetailPanel.tsx`：`InvestingFields`（时间/货币/周期/重要性/今值/预测/前值/vs 徽标）
- `tests/test_investing_source.py`：重写为 v2 解析测试（18 个，含真实样本）
- `docs/investing_v2_sample.json` / `docs/sample.json`：真实抓包样本（测试 fixture）
- 前置轮次：curl_cffi HTTP 层 + CF 指纹根因（见 git log 9/7 提交说明）

## 6. 插件化重构轮（2026-09-07 下午）

订阅架构从「核心硬编码两个源」升级为「可插拔插件协议」——新源=一个 plugins/*.py 文件，
核心零改动。设计见 docs/SUBSCRIPTION_PLUGIN_GUIDE.md。

- `tt_calendar/sources/base.py`：Source 协议扩展（LayerSpec/layer_specs/ensure_layers/
  field_specs/refresh_past_days/refresh_future_days）；ensure_layers 默认播种（改名不碰用户 enabled）
- `tt_calendar/sources/__init__.py`：注册中心（内置显式 + plugins/*.py 目录扫描发现）
- `plugins/jisilu.py`：源内化（常量/图层声明/窗口 180/90）
- `plugins/investing.py`：源内化（国家表/指令集/cookie 自读/窗口 2/14/ensure_layers 迁移/field_specs）
- `tt_calendar/config.py`：**删除** JISILU_*/INVESTING_* 常量（迁入源内）与 LayerID 源专属前缀
- `tt_calendar/db.py`：`ensure_default_layer_configs` 通用化（通用层首启动 + 无条件播种所有源图层）
- `backend/routes.py`：`_fetch_jisilu_range`/`_fetch_investing_range` 合并为 `_fetch_source_range`；
  `_refresh_one_subscription` 按注册表+源声明窗口统一调度；新增 `GET /api/sources`（源元数据+field_specs）
- `frontend/src/api/client.ts`：+SourceFieldSpec/SourceInfo/getSources
- `frontend/src/components/SourceFields.tsx`：**新** —— spec 驱动通用字段渲染（替代硬编码 InvestingFields）
- `frontend/src/components/DetailPanel.tsx`：删 InvestingFields，改按 ev.source 查 spec 渲染
- 测试：+`tests/test_sources_registry.py`（10 个协议测试）；前端 +`SourceFields.test.tsx`（8 个）
  全量：后端 60/60、前端 32 passed（+25 skipped）
- 文档：+`docs/SUBSCRIPTION_PLUGIN_GUIDE.md`、`plugins/_README.md`
