# 订阅插件目录（本地安装）

本目录放你的订阅插件（`.py` 文件，内含 `Source` 子类），放进去重启即注册生效，
无需改任何核心代码。

## 从插件仓库安装

**社区插件仓库** → https://github.com/TTDiang2/TT_Calendar_Plugins

1. 从插件仓库下载你想要的 `.py`（例如 `investing.py`）
2. 放进本目录：`TT_Calendar/plugins/`（打包版 exe 则放在 exe 旁的 `plugins/` 文件夹，没有就自己建一个）
3. 重启应用 —— 侧边栏出现对应图层，订阅面板可添加该源

> 本目录的 `*.py` 已被 `.gitignore` 忽略：它们是你的本地安装，不会提交进 TT_Calendar 主仓库。
> 想发布自己的插件？上传到 TT_Calendar_Plugins 仓库即可。开发指南见 `docs/SUBSCRIPTION_PLUGIN_GUIDE.md`。

## 快速上手（自己写一个）

新建 `my_source.py`：

```python
from datetime import date
from tt_calendar.sources.base import Source, LayerSpec
from tt_calendar.models import Event, ImportResult


class MySource(Source):
    source_id = "my_source"
    display_name = "我的订阅"

    def layer_specs(self):
        return [LayerSpec(layer_id="mysub_all", display_name="我的订阅·全部", color="#3B82F6")]

    async def fetch(self, start, end, **kwargs):
        events = [
            Event(
                layer_id="mysub_all",
                source=self.source_id,
                date=start,
                title="示例事件",
                source_ref="evt-1",
                extra={},
            )
        ]
        result = ImportResult(source=self.source_id, layer_id="mysub_*")
        result.fetched = len(events)
        return events, result
```

重启应用后：订阅面板点「立即更新」（或启动自动刷新），事件即写入 `mysub_all` 图层。
