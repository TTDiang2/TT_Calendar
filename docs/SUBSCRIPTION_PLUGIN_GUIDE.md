# 订阅插件开发指南（社区 API 草案 v1）

> 2026-09 插件化重构后，**任何外部日历源 = 一个插件**，不需要改核心代码。
> 本文档写给想贡献订阅插件的开发者（开源社区共享时，大家不必重复造轮子）。

## 1. 插件是什么

一个插件就是一个 Python 文件，内含一个 `Source` 子类。把文件放进应用的
`plugins/` 目录（源码模式项目根 / 打包模式 exe 旁），重启即自动注册。
事件会自动：出现在对应图层、参与订阅刷新调度、右侧详情面板按你的
`field_specs` 渲染字段。

```
TT_Calendar/
├─ plugins/
│  └─ my_holiday.py      ← 你的插件（也可整理成 pip 包，声明 Source 子类即可）
```

## 2. 最小实现

```python
"""我的节假日日历插件"""
from datetime import date
from tt_calendar.sources.base import Source, LayerSpec
from tt_calendar.models import Event, ImportResult


class MyHolidaySource(Source):
    source_id = "my_holiday"        # 全局唯一，会写入 events.source 与订阅 source_key
    display_name = "我的节假日"      # UI 显示名（订阅卡片、图层侧栏分组）
    # 自动刷新窗口（天）：start = today - 2，end = today + 14（默认值，可按需覆盖）
    refresh_past_days = 30
    refresh_future_days = 90

    def layer_specs(self):
        # 声明本源需要哪些图层（侧栏勾选 = 是否落库 + 显示）
        return [
            LayerSpec(
                layer_id="myholiday_cn",     # 完整 layer_id
                display_name="我的节假日·中国",
                color="#E53935",
                enabled=True,                 # 默认开启？
                group=self.display_name,      # 侧栏分组（默认即可）
                config={},                    # 任意附加元数据
            ),
        ]

    async def fetch(self, start, end, **kwargs):
        # ⚠️ 只做一件事：拉 [start, end] 区间的事件。
        #   你的 HTTP 请求、凭据（cookie/token）、限流全在这里自管。
        events = [...]
        result = ImportResult(source=self.source_id, layer_id="myholiday_*")
        result.fetched = len(events)
        return events, result
```

### LayerSpec 字段

| 字段 | 必需 | 说明 |
|---|---|---|
| `layer_id` | ✅ | 完整 id，事件用它归层 |
| `display_name` | ✅ | 侧栏显示名 |
| `color` / `enabled` / `sort_order` / `kind` / `group` | ❌ | 常规图层属性 |
| `config` | ❌ | 任意附加元数据，随图层存进 `layer_config.config_json` |
| `sub_filter` | ❌ | `SubFilterSpec(group_key=..., title_pattern=...)`，声明本图层可按「子动作」再过滤（见下） |
| `manual_pickable` | ❌ | 默认 `True`；填 `False` 表示该图层由数据源填充，不该让用户手工往上放事件 |

**`sub_filter`：子动作过滤**

有些源把事件进一步细分成子动作（集思录把「申购日/赎回日/上市日」写在标题的
`【】` 里）。核心不认识任何具体源，只按你声明的规则从事件标题提取子动作，
与用户在设置页勾选的集合求交集：

```python
from tt_calendar.sources.base import LayerSpec, Source, SubFilterSpec

_SUB_FILTER = SubFilterSpec(group_key="qtype", title_pattern=r"^【(.+?)】")

def layer_specs(self):
    return [LayerSpec(..., sub_filter=_SUB_FILTER)]
```

- `group_key`：事件 `extra` 里承载分组值的键名（如集思录的 `qtype`）。
- `title_pattern`：从标题提取子动作的正则，**须含恰好一个捕获组**。

> ⚠️ **不声明 = 该功能静默失效**（不报错，只是不生效）。同理，源填充的图层建议声明
> `manual_pickable=False`，否则用户手工加的标记会被下次同步覆盖——核心过去是靠
> 图层 id 前缀猜的，现在一律看声明。

两个字段都存进图层行，所以源被卸载后规则仍在。`ensure_layers` 只写这两个键
与你自己的 `config`，**不会**动用户数据（例如已勾选的子动作）。

> 需要带 `SubFilterSpec` 的 app 版本；旧版加载插件会记一条 `plugin load failed`
> 并跳过该插件，已有图层照常工作。

### Event 字段约定

| 字段 | 必需 | 说明 |
|---|---|---|
| `layer_id` | ✅ | 必须等于 `layer_specs` 里声明过的 id |
| `source` | ✅ | 等于 `source_id` |
| `date` | ✅ | `date` 对象，事件归属日（今天→明天等，跨日自己算） |
| `title` | ✅ | 显示标题 |
| `description` | ❌ | 长描述（详情面板显示，建议 ≤200 字） |
| `color` | ❌ | CSS 色；缺省用图层色 |
| `source_ref` | ✅ | **去重键**：`(layer_id, source_ref)` 唯一。同一次拉取同 id 覆盖更新（upsert）。例：`f"{event_id}"` 或 `f"{qtype}:{code}"`。没有它会每次插入新行 |
| `extra` | ❌ | 任意 JSON 字段（数字/字符串）。详情面板按 `field_specs` 渲染 |
| `sort_key` | ❌ | 排序，默认 0 |

### 错误与状态

`ImportResult.error` 非空 → 订阅状态变 `error` 并在订阅面板展示；空 → `active`。
**部分成功**：拿到一部分事件时不要抛异常，把剩余错误拼进 `result.error`（前端显示"部分失败"）。

## 3. 图层播种（进阶）

默认 `ensure_layers`：缺失插入、名字变更是 `display_name` 改名（不碰用户 enabled）。
特殊迁移需求（如国家 ID 体系更换需要覆盖 enabled）可覆写：

```python
def ensure_layers(self, conn):
    # 先按默认播种，再补自己的迁移逻辑
    super().ensure_layers(conn)
    ...
```

## 4. 字段 UI 规格（field_specs）

插件**不用写前端**。返回一个 dict，前端 `SourceFields` 按它渲染 `extra`：

```python
def field_specs(self):
    return {
        # 首行小字序列：按序取 extra 键并显示
        "meta": [{"key": "time"}, {"key": "currency"}, {"key": "period"}],
        # importance：星级（1..max）
        "importance": {"key": "importance", "max": 3},
        # 多列表格：label 是列头，缺值显示 —
        "columns": [
            {"key": "actual", "label": "今值"},
            {"key": "forecast", "label": "预测值"},
            {"key": "previous", "label": "前值"},
        ],
        # 徽标：值 → 显示文本 + 语气色（good/bad/info/muted）
        "badges": {
            "key": "vs_forecast",
            "map": {
                "超预期": {"label": "▲ 超预期", "tone": "good"},
                "不及":   {"label": "▼ 不及预期", "tone": "bad"},
                "符合":   {"label": "● 符合预期", "tone": "info"},
                "待公布": {"label": "— 待公布", "tone": "muted"},
            },
        },
    }
```

没有 `field_specs`（返回 None）的源：详情面板只显示标题/描述（如集思录）。

> schema 通过 `GET /api/sources` 下发到前端（`/api/sources/{id}` 未来可按需加）。

## 5. 网络凭据

刷新器不感知 cookie/token —— **源自己负责**。推荐的模式（见 investing）：

```python
async def fetch(self, start, end, **kwargs):
    cookies = self._load_credentials()   # 读 data/my_sub_cookies.json / 环境变量 / 配置
    ...
```

- 用户导出的凭据文件放 `data/` 下（`cfg.DATA_DIR`，gitignore 之外个人数据）
- 错误提示里写明"如何导出 / 放入哪个文件"

## 6. 分发与注册

当前实现：**把 `.py` 放进 `plugins/` 目录即注册**（懒加载扫描，坏插件只记日志不影响启动）。
TT Calendar 主仓库不捆绑任何插件；插件统一发布在社区仓库：

> **插件仓库** → https://github.com/TTDiang2/TT_Calendar_Plugins
> 用户从这里下载 `.py` 放进本地 `plugins/` 即完成安装（README 有详述）。

完整范例请看插件仓库里的实现：
- `jisilu.py`：最简（无 field_specs）
- `investing.py`：完整（curl_cffi CF 绕过 + cookie + 图层播种迁移 + field_specs + 事件字段 UI 规格）

## 7. 测试建议

插件自带测试（可选）。插件仓库的测试设计为在 TT Calendar 项目根运行：
```bash
# 在 TT Calendar 源码根目录（sys.path 含 tt_calendar）
python -m pytest ../TT_Calendar_Plugins/tests
```
核心协议测试在主仓库 `tests/test_sources_registry.py`：不依赖任何真实插件文件，
用临时假插件验证发现 / 播种 / 刷新调度，保证你的插件不被核心改动破坏。

---

**插件仓库**：`TTDiang2/TT_Calendar_Plugins` —— 欢迎大家把自己的订阅插件丢进去共享。