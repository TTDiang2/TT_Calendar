"""临时调试脚本：验证迁移和 DB 内容。"""

import logging
import sqlite3

logging.basicConfig(level=logging.INFO, format="%(message)s")

from tt_calendar.db import (
    connect,
    init_db,
    migrate_legacy_json,
    ensure_default_layer_configs,
)

conn = connect()
init_db(conn)
counts = migrate_legacy_json(conn)
ensure_default_layer_configs(conn)
print("Migration result:", counts)
print()

rows = conn.execute(
    "SELECT layer_id, COUNT(*) AS c FROM events GROUP BY layer_id"
).fetchall()
print("Events by layer:")
for r in rows:
    print(" ", r["layer_id"], "->", r["c"])

rows = conn.execute("SELECT COUNT(*) AS c FROM coloring").fetchall()
print("\nColoring total:", rows[0]["c"])

rows = conn.execute("SELECT COUNT(*) AS c FROM schedule").fetchall()
print("Schedule total:", rows[0]["c"])

rows = conn.execute(
    "SELECT layer_id, display_name, enabled FROM layer_config ORDER BY sort_order"
).fetchall()
print("\nLayers:")
for r in rows:
    print(" ", r["layer_id"], "->", r["display_name"], "(enabled=", r["enabled"], ")")

print("\nSample important events:")
rows = conn.execute(
    "SELECT date, title, color, extra_json FROM events WHERE layer_id='important' LIMIT 5"
).fetchall()
for r in rows:
    print(" ", r["date"], "|", r["title"], "|", r["color"], "|", r["extra_json"])

print("\nSample schedule:")
rows = conn.execute("SELECT * FROM schedule LIMIT 3").fetchall()
for r in rows:
    print(" ", dict(r))

conn.close()
