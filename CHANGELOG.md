# Changelog

本项目所有值得记录的变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [2.3.0] - 2026-09-07

### 🧩 订阅插件系统（本次里程碑）

- **订阅源插件化**：任何外部日历源 = 一个 `Source` 子类（`plugins/*.py`），放入 `plugins/` 目录即注册，无需改核心代码
- **插件独立仓库**：插件不再捆绑在 TT Calendar 主程序里，统一发布在 **TT_Calendar_Plugins** 社区插件仓库（当前收录：英为财情经济日历、集思录投资日历），主仓库 README 说明安装步骤
- **统一刷新调度**：注册表驱动，刷新窗口由各源声明；routes 不再硬编码任何具体源
- **图层声明式播种**：`Source.layer_specs()` 声明图层，核心播种器遍历注册表，不覆盖用户手动开关
- **字段 UI 规格化**：`field_specs()` 描述 extra 字段如何展示（meta / 重要性星级 / 多列数值 / 徽标），前端 `SourceFields` 按规格渲染，插件无需写前端
- **订阅元数据 API**：`GET /api/sources` 下发全部可用源与字段规格
- **新增 [插件开发指南](docs/SUBSCRIPTION_PLUGIN_GUIDE.md)**，方便社区共享订阅插件

### ➕ Added

- **英为财情（investing.com）经济日历适配**：全新 v2 occurrences API、curl_cffi 模拟 Chrome 指纹绕过 Cloudflare、浏览器 cookie 注入、按国家分图层（16 国校准 + 兜底图层）、超页日期窗口拆分
- **待办多视图**：矩阵（含"有空"象限）/ 看板（按重要度/标签着色 + 完成折叠）/ 甘特（月视图）/ 便签墙 / 罐子视图
- **待办操作增强**：双击列表行/便签打开笔记编辑弹窗、保存按钮 + Ctrl+Enter、列表重命名、每日提醒横幅（未计划今日完成项）
- **订阅总开关**：一键隐藏某订阅的全部图层与事件（侧栏 + 日历圆点）
- **日程多日支持**：统一新建弹窗、多日涂色/事件按天展开、连续条加粗渐变、自动建待办（opt-in）
- **数据同步增强**：GitHub 双向同步完善（空仓库引导、pull_overwrite 覆盖本地专属表、启动同步配置、关闭前同步）
- **农历/节气**：内置农历日历支持
- **测试基建**：Vitest + Testing Library、CDP 驱动 Edge 端到端测试

### 🔧 Fixed

- 待办新建防重复提交（空 id + effect 竞态）
- 待办编辑丢失（effect cleanup 时 flush 待写改动）
- 月视图初始月份写死为 8 月（改为按当前日期打开）
- Tauri exe 内嵌旧 dist 的发布问题（sidecar 三份副本同步）
- 后端打包缺 borax（hiddenimports 补齐）

### 🏗️ 架构

- 后端 `Source` 抽象 + `plugins/` 目录发现（`_OFFICIAL` 官方插件 + 第三方扫描双轨）
- `tt_calendar/sources/` 收敛为协议 + 注册中心，不再含任何具体源代码
- `ensure_default_layer_configs` / `_refresh_one_subscription` 通用化

## [2.2.0] - 2026-08-15

**多设备同步（GitHub 私有仓库）**：快照 + 三方合并 + tombstone 删除同步。

（完整历史版本记录：见 git tag `v2.2.0` 及更早提交说明。）

<!-- 链接区 -->
[2.3.0]: https://github.com/TTDiang2/TT_Calendar/releases/tag/v2.3.0
[2.2.0]: https://github.com/TTDiang2/TT_Calendar/releases/tag/v2.2.0
