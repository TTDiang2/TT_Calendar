#!/usr/bin/env python
"""从 Microsoft To Do 导出 tasks 为 CSV（匹配 TT Calendar 的 6 列 schema）。

用法:
    python scripts/export_ms_todo.py [token_file]

token_file 默认 access_token.md（从 Azure / Graph Explorer 拿的 access token）。
产出 ms_todo_export.csv，可直接用 TT Calendar 的「CSV 导入」按钮导入。
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import httpx

GRAPH = "https://graph.microsoft.com/v1.0"


def load_token(path: Path) -> str:
    raw = path.read_text(encoding="utf-8").strip()
    # 去掉 markdown 包装（```...```）
    if raw.startswith("```"):
        raw = "\n".join(l for l in raw.splitlines() if not l.startswith("```")).strip()
    return raw


def fetch_all(client: httpx.Client, url: str, params: dict | None = None) -> list[dict]:
    items: list[dict] = []
    while url:
        r = client.get(url, params=params if items == [] or params is None else None)
        r.raise_for_status()
        data = r.json()
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")  # 分页链接（已含参数，不再传 params）
    return items


def main() -> None:
    token_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("access_token.md")
    if not token_file.exists():
        print(f"ERROR: token 文件不存在: {token_file}")
        sys.exit(1)
    token = load_token(token_file)
    headers = {"Authorization": f"Bearer {token}"}

    with httpx.Client(timeout=30, headers=headers) as client:
        # 1. 健康检查 + 拉 lists（不用 $select：Graph API v1.0 对 todoList 端点的 $select 报 ParseUri 400）
        try:
            r = client.get(f"{GRAPH}/me/todo/lists", params={"$top": 50})
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            print(f"ERROR: Graph API 返回 {e.response.status_code}")
            print(e.response.text[:500])
            if e.response.status_code == 401:
                print("token 可能过期，重新获取 access token")
            sys.exit(1)

        lists = r.json().get("value", [])
        print(f"找到 {len(lists)} 个列表")

        rows: list[dict] = []
        for lst in lists:
            list_name = lst["displayName"]
            tasks = fetch_all(
                client,
                f"{GRAPH}/me/todo/lists/{lst['id']}/tasks",
                params={"$top": 999},  # 同上：todoTasks 端点的 $select 也可能 ParseUri
            )
            for t in tasks:
                due_obj = t.get("dueDateTime") or {}
                due_dt = due_obj.get("dateTime", "")
                body_obj = t.get("body") or {}
                rows.append({
                    "title": t.get("title", "(无标题)"),
                    "due_date": due_dt[:10] if due_dt else "",
                    "importance": t.get("importance", "normal"),
                    "status": t.get("status", "notStarted"),
                    "list_name": list_name,
                    "body": body_obj.get("content", ""),
                })
            print(f"  {list_name}: {len(tasks)} tasks")

    out = Path("ms_todo_export.csv")
    # utf-8-sig 让 Excel 正确识别中文
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["title", "due_date", "importance", "status", "list_name", "body"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n导出完成: {out.resolve()}")
    print(f"共 {len(rows)} 条 → 可用 TT Calendar 的「CSV 导入」按钮导入")


if __name__ == "__main__":
    main()
