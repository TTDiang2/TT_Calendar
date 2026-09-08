"""全局配置：路径常量、集思录 API、图层 ID 等等。

所有"魔法常量"集中在这里，方便后续修改。
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Final

# ---------------------------------------------------------------------------
# 路径
# ---------------------------------------------------------------------------

# 项目根目录：源码运行时是仓库根；PyInstaller 打包后是 exe 所在目录
# （onefile 模式下 __file__ 指向 _MEIPASS 临时解压目录，写入会丢失）
if getattr(sys, "frozen", False):
    PROJECT_ROOT: Final[Path] = Path(sys.executable).resolve().parent
else:
    PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parent.parent

# 数据目录：SQLite 数据库 + 旧 JSON 备份
DATA_DIR: Final[Path] = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# SQLite 数据库主文件
DB_PATH: Final[Path] = DATA_DIR / "calendar.db"

# 旧 JSON 文件路径（用于首启动迁移 + 备份）
LEGACY_COLOR_JSON: Final[Path] = PROJECT_ROOT / "color_data.json"
LEGACY_SCHEDULE_JSON: Final[Path] = PROJECT_ROOT / "schedule_data.json"
LEGACY_IMPORTANT_JSON: Final[Path] = PROJECT_ROOT / "important_dates.json"

# 用户配置文件（图层开关、视图偏好、最后同步时间等）
USER_CONFIG_JSON: Final[Path] = DATA_DIR / "user_config.json"

# ---------------------------------------------------------------------------
# 图层 ID（统一用字符串，避免散落各处）
# ---------------------------------------------------------------------------

class LayerID:
    SCHEDULE = "schedule"           # AM/PM/EV 三段日程
    IMPORTANT = "important"         # 重要日期（手动 + 自动纪念日）
    COLORING = "coloring"           # 5 档充实度染色
    HOLIDAY = "holiday"             # 中国法定节假日 + 调休
    TODO = "todo"                   # 待办（due_date 染色维度）


TODO_LAYER_COLOR: Final[str] = "#F59E0B"  # 琥珀色（amber-500）


# ---------------------------------------------------------------------------
# 充实度染色：5 档绿色（保留原算法，但用现代一点的色值）
# ---------------------------------------------------------------------------

# 0..4 对应 Relaxed / Mild / Moderate / Busy / Productive
COLORING_LEVELS: Final[list[dict[str, object]]] = [
    {"key": "Relaxed",    "label": "放松",  "color": "#F1F8F4"},   # 极浅绿白
    {"key": "Mild",       "label": "轻松",  "color": "#C8E6C9"},   # 浅绿
    {"key": "Moderate",   "label": "适中",  "color": "#81C784"},   # 中绿
    {"key": "Busy",       "label": "充实",  "color": "#388E3C"},   # 深绿
    {"key": "Productive", "label": "高产",  "color": "#1B5E20"},   # 极深绿
]

# ---------------------------------------------------------------------------
# 纪念日自动生成偏移（保留原版映射）
# ---------------------------------------------------------------------------

ANNIVERSARY_OFFSETS: Final[list[tuple[int, str]]] = [
    (99,   "99 天"),
    (100,  "100 天"),
    (200,  "200 天"),
    (300,  "300 天"),
    (365,  "一周年"),
    (400,  "400 天"),
    (500,  "500 天"),
    (520,  "520 天"),
    (600,  "600 天"),
    (730,  "二周年"),
    (800,  "800 天"),
    (1000, "1000 天"),
    (1095, "三周年"),
    (1314, "1314 天"),
]

# ---------------------------------------------------------------------------
# UI 默认值
# ---------------------------------------------------------------------------

DEFAULT_WINDOW_WIDTH: Final[int] = 1280
DEFAULT_WINDOW_HEIGHT: Final[int] = 820

# 月份网格：每个日期格的最小尺寸
DAY_CELL_MIN_WIDTH: Final[int] = 130
DAY_CELL_MIN_HEIGHT: Final[int] = 110

WORK_WEEK: Final[tuple[str, ...]] = ("一", "二", "三", "四", "五", "六", "日")

# ---------------------------------------------------------------------------
# 英为财情（Investing.com）经济日历
# ---------------------------------------------------------------------------

