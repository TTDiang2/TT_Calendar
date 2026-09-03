# 英为财情-投资日历 订阅适配交接（2026-09-03）

> 本文档写给接手的 agent。用户需求 + 已完成事实 + 卡点 + 下一步，按此推进。
> 总规范见 `docs/SUBSCRIPTION_SPEC.md`（适配流程 7 步）；模板参照 `tt_calendar/sources/jisilu.py`。

## 0. 当前状态（接手时若看到本节，意味着上家已落地）

- ✅ `tt_calendar/sources/investing.py` 已实现（Source 子类 + JSON 解析器 + cookie 文件读取）
- ✅ `tt_calendar/config.py` 已注册 `INVESTING_COUNTRIES` / `INVESTING_HEADERS` / `LayerID.INVESTING_PREFIX`
- ✅ `tt_calendar/sources/__init__.py` 已注册 `investing` 源
- ✅ `tt_calendar/db.py` `ensure_default_layer_configs` 幂等补种 14 个国家图层（不覆盖已有 enabled）
- ✅ `backend/routes.py` `_refresh_one_subscription` 已分发到 `investing` 分支 + `_fetch_investing_range`
- ✅ 数据库订阅已激活：`source_key='investing'`, `status='active'`
- ✅ 14 个 investing 图层已 seed：`investing_5`(美国,enabled) / `investing_37`(中国,enabled) / `investing_42`(英国,enabled) / `investing_110`(日本,enabled) / `investing_25`(欧元区,enabled) / 其余 9 个国家默认关闭
- ✅ 单测 15/15 通过：`tests/test_investing_source.py`
- ✅ HTTP 端到端在临时端口 8766 验证：refresh 返回结构化 `last_error`（CF 友好提示）

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
- 频率：每工作日更新

## 2. 已完成 / 已确认的事实

### 2.1 「自然语言登记 → pending 存储」机制存在且后端可用 ✅

- 后端 `POST /api/subscriptions`（backend/routes.py:718）接受 `display_name / url / rules_text / auto_update`，**自动存为 `status='pending'`**，规则文本进 `rules_text` 列。
- 已实测（直接 HTTP POST 到 8765）：返回 200，新记录落库且 status=pending ✅
- 前端订阅面板（frontend/src/components/dialogs.tsx:501-556）完整支持 pending 展示：顶部琥珀提示「有 N 个订阅待适配」+ 每张卡片「待适配」badge + 展示 url 与规则原文。代码审读无缺口。

### 2.2 测试用 pending 记录已在库中

数据库（8765 后端所连 SQLite）现有一条待适配记录，接手的 agent 可直接照此实现：

```
id:           386e1dce-f1b4-4c55-97d0-9d08f365330c
display_name: 英为财情-投资日历
url:          https://cn.investing.com/economic-calendar
status:       pending
source_key:   custom:f84ae1ef
rules_text:   目标：按国家分类的投资日历事件. 抓取 cn.investing.com/economic-calendar 的每日事件表格.
              字段: 时间(HH:MM), 国家(NZ/US/CA 等国旗+国名), 事件名, 实际值/预报值/前值,
              vs预期(符合/不及/超预期/待公布). 频率: 每个工作日更新. 期望实现:
              同步近 7 天的经济日历事件, 按国家分组写入 events 表.
```

查证：`SELECT id, display_name, status, url, rules_text FROM subscriptions WHERE status='pending';`

### 2.3 investing.com 抓取被 Cloudflare 强拦截 —— 已用 cookie 路径绕过

**已尝试（全部 403，cf-ray 头部证实是 Cloudflare 边缘拦截）：**

| 尝试 | 结果 |
|---|---|
| httpx 直连 cn/www.investing.com/economic-calendar/ | 403 |
| httpx 直连 `/Service/getCalendarFilteredData` JSON 端点 | 403 |
| curl_cffi（impersonate=chrome120，完整浏览器 headers + cookie 会话保持） | 403 |
| curl_cffi + `country[]/importance/dateFrom/dateTo/timeZone/lang` 参数照真实格式 | 403 |

**确认的真实 JSON 端点**（供浏览器自动化时直接调用）：

```
GET https://www.investing.com/economic-calendar/Service/getCalendarFilteredData
    ?country[]=5&country[]=37&country[]=42&country[]=110
    &importance=2&importance=3
    &dateFrom=MM/dd/yyyy&dateTo=MM/dd/yyyy
    &timeZone=21&lang=zh
（需带 Origin/Referer/X-Requested-With: XMLHttpRequest；国家码与 importance 需从页面/接口反推）
```

**采用的绕过方案：cookie 文件注入**

桌面应用启动后，`_fetch_investing_range` 会自动读 `data/investing_cookies.json`（如果存在），
把 cookie 注入 httpx 请求。如果存在 CF 绕过 cookie（典型名 `cf_clearance`）即可过。

**用户侧导出步骤（写进订阅卡片错误提示，详见 §0 已落地）**：

1. 在桌面用 Edge 打开 https://cn.investing.com/economic-calendar ，首次会弹 CF 验证，按提示点过去
2. 验证通过后，Edge DevTools → Application → Cookies → 选中 `cn.investing.com` 域名
3. 全选所有 cookie 复制为 JSON 格式（或装「cookies.txt」扩展导出 Netscape 格式）
4. 保存到 TT_Calendar 目录的 `data/investing_cookies.json`
5. 应用内点「立即更新」即会带上 cookie 重新拉取

**JSON 格式示例**（最简）：

```json
{
  "cf_clearance": "abc123def456...",
  "__cf_bm": "xyz..."
}
```

或 Netscape cookies.txt 格式（每行 `domain\tflag\tpath\tsecure\texpiry\tname\tvalue`）。
两种格式都被 `load_cookies_file()` 自动识别。

### 2.4 解析器字段约定

`InvestingSource._parse_item` 已实现以下字段映射（与用户期望表格一一对应）：

| 用户表格字段 | investing.com JSON 字段 | 备注 |
|---|---|---|
| 时间 | `time` (HH:MM AM/PM GMT+8) | "All Day" 视为整天事件 |
| 国家 | `country` (int id) → `INVESTING_COUNTRIES[name/currency/color]` | 14 个主要经济体已配置 |
| 事件名 | `title`（去 HTML 标签） | |
| 实际值 | `actual`（去 HTML 标签） | 空表示未公布 |
| 预报值 | `forecast`（去 HTML 标签） | |
| 前值 | `previous`（去 HTML 标签） | |
| vs 预期 | 派生：`actual vs forecast` 数值比较 | "符合" / "不及" / "超预期" / "待公布" |

`extra` 字段存储：`country / country_code / currency / importance / vs_forecast / time / actual / forecast / previous`，
供前端弹窗/详情使用。

## 3. 未完成事项 / 留给用户的事

### 3.1 用户从 UI 新增的订阅没有落库 —— 未诊断

用户称在订阅界面按自然语言新增后没看到 pending 存储；测试 POST 是通的，所以问题大概率在前端表单提交路径（dialogs.tsx:457-477 `createMut` 逻辑审读正确）或用户操作层面（未真正点确认/报错被吞）。

接手需验证：打开应用订阅面板 → 新增订阅 → 填三项 → 确认，观察 Network 里 `POST /api/subscriptions` 是否发出、返回什么。

### 3.2 CF cookie 文件未由用户生成

代理已经把所有非 CF 部分（HTTP 抓取器、解析器、图层 seed、订阅激活、refresh 路由）落地，
实际数据抓取依赖用户从浏览器导出 cookie 到 `data/investing_cookies.json`。详见 §2.3 步骤。

### 3.3 rebuild

改了后端必须重建 sidecar + exe 才对桌面版生效（PyInstaller → tauri build → 三份副本同步，见 docs/EXE_LOADING_TROUBLESHOOT.md「sidecar 三份副本」一节）。

## 4. 环境备忘

- 生产后端 8765 跑 system python 源码（E:\TT_Calendar 树），**后端代码改动重启即生效**，仅发布需 PyInstaller
- 测试可起 dev：`python -m uvicorn backend.main:app --port 8000`（前端 vite 5173）
- release 资产更新脚本（含 release/ 目录同步）：`C:\Users\TTDiang\AppData\Local\Temp\opencode\update_release_v220.ps1`
- 订阅产生的 events 是派生数据（`source != 'manual'` 不参与数据同步，可随意删了重拉）
- Python 3.10 系统自带 pydantic 2.9.2（与 prod 8765 一致），跑单测 `python tests/test_investing_source.py`

## 5. 改动文件清单（本轮）

- 新增：`tt_calendar/sources/investing.py`（Source 子类 + 解析器 + cookie 读取）
- 新增：`tests/test_investing_source.py`（15 个单测）
- 修改：`tt_calendar/config.py`（`LayerID.INVESTING_PREFIX` + `INVESTING_*` 常量 + 14 个国家元数据）
- 修改：`tt_calendar/sources/__init__.py`（注册 `investing` 源）
- 修改：`tt_calendar/db.py` `ensure_default_layer_configs`（幂等补种 investing 图层，不覆盖用户已有 enabled）
- 修改：`backend/routes.py`（`_fetch_investing_range` + `_refresh_one_subscription` 加 `investing` 分支）