#!/usr/bin/env python
"""把更新包镜像到 Gitee，作为 GitHub 不可达时的兜底更新源。

CI 里只有配置了 `GITEE_TOKEN` 才会执行（见 .github/workflows/release.yml），
没配就整步跳过，不影响 GitHub 主源与镜像源。

做四件事：

1. 确保公开仓库存在（仓库里只有安装包和 latest.json，不含任何用户数据）；
2. 为该版本建 release（已存在则复用）；
3. 上传安装包附件（已上传则跳过）；
4. 用附件的下载地址生成 latest.json，写回仓库默认分支——updater 从
   `https://gitee.com/<owner>/<repo>/raw/<branch>/latest.json` 读它。

用法：
    GITEE_TOKEN=xxx python scripts/sync_gitee_update.py --version 2.5.2
    python scripts/sync_gitee_update.py --version 2.5.2 --dry-run   # 完全离线，只打印计划

注意：Gitee 仓库必须公开才能被匿名下载；安装包本身是公开产物，签名在 latest.json 里，
updater 会校验，所以公开不降低安全性。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://gitee.com/api/v5"


def _utf8_streams() -> None:
    """CI 的 Windows runner 默认 cp1252，print 中文会崩在最后一步。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _die(msg: str) -> None:
    raise SystemExit(f"[gitee] {msg}")


def _json(resp, what: str) -> dict | list:
    if resp.status_code >= 300:
        _die(f"{what} 失败：HTTP {resp.status_code} {resp.text[:300]}")
    try:
        return resp.json()
    except ValueError:
        _die(f"{what} 返回的不是 JSON：{resp.text[:200]}")


def _make_public(s, owner: str, repo: str) -> None:
    """Gitee 建仓库时 `private=false` 不总生效（实测建出来是私有的），必须显式再改一次。

    私有仓库的 raw 与 release 附件对匿名请求一律 403，updater 拿不到。
    PATCH 必须带 name，否则报 `name is missing`。
    """
    _json(
        s.patch(f"{API}/repos/{owner}/{repo}", data={"name": repo, "private": "false"}),
        "改仓库可见性",
    )
    info = _json(s.get(f"{API}/repos/{owner}/{repo}"), "复查仓库")
    if isinstance(info, dict) and info.get("private"):
        _die("仓库仍是私有，updater 无法匿名读取；请到仓库设置里手动改成公开")
    print(f"[gitee] 仓库已公开：{owner}/{repo}")


def ensure_repo(s, owner: str, repo: str) -> None:
    r = s.get(f"{API}/repos/{owner}/{repo}")
    if r.status_code == 200:
        info = _json(r, "查询仓库")
        if isinstance(info, dict) and info.get("id"):
            if info.get("private"):
                print(f"[gitee] 仓库 {owner}/{repo} 是私有的，改为公开（updater 需匿名读取）")
                _make_public(s, owner, repo)
            else:
                print(f"[gitee] 仓库已存在：{owner}/{repo}")
            return
    elif r.status_code != 404:
        _json(r, "查询仓库")  # 401/403 等直接抛，不要走到「创建」
    print(f"[gitee] 仓库不存在，创建公开仓库 {owner}/{repo}")
    _json(
        s.post(
            f"{API}/user/repos",
            data={
                "name": repo,
                "private": "false",
                "auto_init": "true",
                "description": "TT Calendar 更新镜像（仅安装包，不含用户数据）",
            },
        ),
        "创建仓库",
    )
    _make_public(s, owner, repo)


def ensure_release(s, owner: str, repo: str, tag: str, version: str) -> int:
    r = s.get(f"{API}/repos/{owner}/{repo}/releases/tags/{tag}")
    if r.status_code == 200:
        rel = _json(r, "查询 release")
        # Gitee 在「tag 不存在」时返回的不是 404，而是 200 + JSON null
        if isinstance(rel, dict) and rel.get("id"):
            print(f"[gitee] release {tag} 已存在（id={rel.get('id')}）")
            return int(rel["id"])
    elif r.status_code != 404:
        _json(r, "查询 release")
    print(f"[gitee] 创建 release {tag}")
    rel = _json(
        s.post(
            f"{API}/repos/{owner}/{repo}/releases",
            data={
                "tag_name": tag,
                "name": f"TT Calendar {version}",
                "body": f"TT Calendar {version} 安装包（GitHub 不可达时的备用下载）。",
                "target_commitish": "master",
                "prerelease": "false",
            },
        ),
        "创建 release",
    )
    return int(rel["id"])


def upload_attachment(s, owner: str, repo: str, release_id: int, asset: Path) -> str:
    r = s.get(f"{API}/repos/{owner}/{repo}/releases/{release_id}/attach_files")
    if r.status_code == 200:
        for item in _json(r, "查询附件") or []:
            if item.get("name") == asset.name and item.get("browser_download_url"):
                print(f"[gitee] 附件已存在，复用：{item['browser_download_url']}")
                return str(item["browser_download_url"])
    print(f"[gitee] 上传附件 {asset.name}（{asset.stat().st_size / 1024 / 1024:.1f} MB）")
    with asset.open("rb") as fh:
        item = _json(
            s.post(
                f"{API}/repos/{owner}/{repo}/releases/{release_id}/attach_files",
                files={"file": (asset.name, fh, "application/octet-stream")},
            ),
            "上传附件",
        )
    url = item.get("browser_download_url") if isinstance(item, dict) else None
    if not url:
        _die(f"上传成功但没拿到下载地址：{item}")
    return str(url)


def put_manifest(owner: str, repo: str, branch: str, manifest: dict, token: str) -> None:
    """把 latest.json 写进仓库默认分支。

    不用 Gitee 的 contents API：它对「文件尚不存在」的 PUT 也强制要 sha，
    传空串照样报 `sha is empty`（2026-11 实测）。直接 git clone/commit/push
    只搬 1KB 的 JSON，反而更省事也更稳。
    """
    import shutil
    import subprocess
    import tempfile

    body = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    remote = f"https://{owner}:{token}@gitee.com/{owner}/{repo}.git"
    tmp = Path(tempfile.mkdtemp(prefix="ttc-gitee-"))
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", branch, remote, str(tmp)],
            check=True,
            capture_output=True,
            text=True,
        )
        target = tmp / "latest.json"
        if target.is_file() and target.read_text(encoding="utf-8") == body:
            print("[gitee] latest.json 无变化，跳过提交")
            return
        target.write_text(body, encoding="utf-8")
        subprocess.run(["git", "-C", str(tmp), "add", "latest.json"], check=True, capture_output=True, text=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(tmp),
                "-c",
                "user.name=tt-calendar-bot",
                "-c",
                "user.email=bot@tt-calendar.local",
                "commit",
                "-m",
                f"chore(release): latest.json {manifest.get('version')}",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(["git", "-C", str(tmp), "push", "origin", branch], check=True, capture_output=True, text=True)
        print(f"[gitee] latest.json 已提交到 {branch}")
    except subprocess.CalledProcessError as exc:
        # 不要把 URL（含 token）打出来
        detail = (exc.stderr or "").replace(token, "***")[:300]
        _die(f"写 latest.json 失败：{detail or exc}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def build_manifest(version: str, src: dict, signature: str, url: str) -> dict:
    return {
        "version": version,
        "notes": src.get("notes", ""),
        "pub_date": src.get("pub_date"),
        "platforms": {"windows-x86_64": {"signature": signature, "url": url}},
    }


def main() -> int:
    _utf8_streams()
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default=os.environ.get("GITEE_TOKEN"))
    ap.add_argument("--owner", default=os.environ.get("GITEE_OWNER") or "TTDiang")
    ap.add_argument("--repo", default="tt-calendar-update")
    ap.add_argument("--tag", default=None, help="默认 v<version>")
    ap.add_argument("--version", default=None, help="默认读 version.json")
    ap.add_argument("--asset", default=None, help="要上传的安装包路径")
    ap.add_argument("--latest-json", default=str(ROOT / "release/latest.json"))
    ap.add_argument("--branch", default="master")
    ap.add_argument("--dry-run", action="store_true", help="不发任何请求，只打印计划与清单")
    args = ap.parse_args()

    version = args.version or json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["version"]
    tag = args.tag or f"v{version}"
    asset = Path(args.asset) if args.asset else ROOT / f"release/TT-Calendar-Setup-{version}.exe"
    if not asset.is_file():
        _die(f"找不到安装包：{asset}")

    src = json.loads(Path(args.latest_json).read_text(encoding="utf-8"))
    signature = src["platforms"]["windows-x86_64"]["signature"]
    expected_url = f"https://gitee.com/{args.owner}/{args.repo}/releases/download/{tag}/{asset.name}"
    manifest = build_manifest(version, src, signature, expected_url)

    if args.dry_run:
        print(f"[gitee][dry-run] 仓库：{args.owner}/{args.repo}（不存在则创建，公开）")
        print(f"[gitee][dry-run] release：{tag}，附件 {asset.name}")
        print(f"[gitee][dry-run] 清单会写到 {args.branch} 分支的 latest.json：")
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0

    if not args.token:
        _die("缺少 GITEE_TOKEN（Gitee 私人令牌，需要 projects 权限）")

    import requests

    s = requests.Session()
    s.params = {"access_token": args.token}  # type: ignore[assignment]

    ensure_repo(s, args.owner, args.repo)
    release_id = ensure_release(s, args.owner, args.repo, tag, version)
    url = upload_attachment(s, args.owner, args.repo, release_id, asset)
    put_manifest(args.owner, args.repo, args.branch, build_manifest(version, src, signature, url), args.token)
    print(f"[gitee] 完成：https://gitee.com/{args.owner}/{args.repo}/raw/{args.branch}/latest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
