"""TT Calendar - 一个基于 Flet 的图层化桌面日历。

模块结构:
- config: 路径、API endpoint、qtype 映射等常量
- db: SQLite 初始化、CRUD、JSON 数据迁移
- models: Pydantic 数据模型
- theme: 浅色清爽主题
- utils: 日期/颜色/文本工具
- layers: 图层（schedule/important/coloring/holiday/jisilu）
- sources: 数据导入源（集思录等）
- widgets: UI 组件（格子、侧栏、详情、顶栏、编辑器）
- views: 视图（月/周/日/年）
- app: 主窗口组装
"""

__version__ = "2.0.0"
