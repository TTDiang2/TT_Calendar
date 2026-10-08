"""数据导入源注册中心（订阅插件协议）。

所有订阅源都是插件，由用户放进 `plugins/` 目录（应用目录/项目根旁）：
    plugins/<anything>.py   内含 Source 子类的任意插件

TT Calendar 主仓库不再内置任何官方插件 —— 插件从社区插件仓库获取
（https://github.com/TTDiang2/TT_Calendar_Plugins），下载 .py 放入 plugins/ 即注册，
重启生效。插件"抓什么 / 图层怎么建 / 字段怎么显示"全部自描述，核心代码不认识具体源。

核心代码（routes/db/UI）通过 list_sources()/get_source() 与源交互。
坏插件只记日志，不影响应用启动。
"""

from __future__ import annotations

import importlib.util
import logging
import sys

from .base import Source, collect_sources, protocol_incompatibility

log = logging.getLogger(__name__)

# 插件缓存：{source_id: type[Source]}；发现失败只记日志
_PLUGINS: dict[str, type[Source]] | None = None


def _plugins_dir():
    """插件目录：项目根/plugins（源码模式）或 exe 旁 plugins（打包模式）。"""
    from .. import config as cfg

    return cfg.PROJECT_ROOT / "plugins"


def _discover_plugins() -> dict[str, type[Source]]:
    """懒扫描 plugins/*.py，逐个文件加载并收集 Source 子类（幂等）。

    用文件加载而非包导入：插件目录无需 __init__.py，模块名带 stem 前缀避免冲突。
    """
    global _PLUGINS
    if _PLUGINS is not None:
        return _PLUGINS
    found: dict[str, type[Source]] = {}
    pdir = _plugins_dir()
    if pdir.is_dir():
        for path in sorted(pdir.glob("*.py")):
            if path.name.startswith("_"):
                continue
            mod_name = f"tt_plugin_{path.stem}"
            try:
                spec = importlib.util.spec_from_file_location(mod_name, path)
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                sys.modules[mod_name] = module
                spec.loader.exec_module(module)
                for cls in collect_sources(module):
                    if not cls.source_id:
                        continue
                    reason = protocol_incompatibility(cls)
                    if reason:
                        log.error("plugin %s: source %r 未启用 — %s",
                                  path.name, cls.source_id, reason)
                        continue
                    if cls.source_id in found:
                        log.warning("plugin %s: source_id %r 重复，跳过", path.name, cls.source_id)
                        continue
                    found[cls.source_id] = cls
                    log.info("plugin source discovered: %s (%s)", cls.source_id, path.name)
            except Exception as e:  # 插件坏掉不能拖垮应用
                log.error("plugin load failed %s: %s", path.name, e)
    _PLUGINS = found
    return found


def list_sources() -> list[type[Source]]:
    """全部可用源类。"""
    return list(_discover_plugins().values())


def get_source(source_id: str) -> Source | None:
    """按 source_id 实例化一个源；未注册返回 None。"""
    for cls in list_sources():
        if cls.source_id == source_id:
            return cls()
    return None


def register_source(source_id: str, cls: type[Source]) -> None:
    """运行时注册（供测试/高级集成用）。"""
    if source_id != cls.source_id:
        raise ValueError("source_id 必须与类属性一致")
    global _PLUGINS
    if _PLUGINS is None:
        _PLUGINS = {}
    _PLUGINS[source_id] = cls


def all_source_ids() -> list[str]:
    return [cls.source_id for cls in list_sources()]
