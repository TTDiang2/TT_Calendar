#!/usr/bin/env python
"""生成 Tauri updater 用的 latest.json。

Tauri v2 开了 `bundle.createUpdaterArtifacts` 之后，NSIS 产物旁边会多一对
`*.nsis.zip` + `*.nsis.zip.sig`（zip 里装的是 setup.exe）。updater 下载的就是
这个 zip，校验的也是它的签名，所以 latest.json 里的 url 必须指向 zip、signature
必须是 zip 的 .sig 内容——指向 setup.exe 会验签失败。

用法：
    python scripts/gen_latest_json.py                       # 版本取 version.json
    python scripts/gen_latest_json.py --tag v2.4.0 --notes-file notes.md
    python scripts/gen_latest_json.py --dry-run             # 只打印不落盘

产物默认写到 release/latest.json，同时把「该上传哪几个文件」打印出来给 CI 用。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "TTDiang2/TT_Calendar"

# 国内可达的 GitHub 加速前缀。每加一条就会多生成一份 latest-<name>.json：
# 清单本身从 raw 取（体积 1KB，秒回），清单里的 url 则指向该镜像代理的安装包。
# 顺序 = updater 的尝试顺序，前面的通了就不会继续试。
MIRROR_PREFIXES: tuple[tuple[str, str], ...] = (
    ("ghfast", "https://ghfast.top/"),
    ("ghproxy", "https://gh-proxy.com/"),
)


def read_version(root: Path) -> str:
    data = json.loads((root / "version.json").read_text(encoding="utf-8"))
    version = str(data.get("version") or "").strip()
    if not version:
        raise SystemExit("version.json 里没有 version 字段")
    return version


def find_updater_artifact(bundle_dir: Path, version: str) -> tuple[Path, Path]:
    """返回 (被签名的安装包, 签名文件)。"""
    if not bundle_dir.is_dir():
        raise SystemExit(f"找不到 bundle 目录：{bundle_dir}")

    # 优先 zip：updater 下载的就是它
    zips = _prefer_version(sorted(bundle_dir.glob("*.nsis.zip")), version)
    for z in zips:
        sig = z.with_name(z.name + ".sig")
        if sig.is_file():
            return z, sig

    # 回退：直接签名 setup.exe（某些 tauri 版本/配置只出这一份）
    setups = _prefer_version(sorted(bundle_dir.glob("*-setup.exe")), version)
    for exe in setups:
        sig = exe.with_name(exe.name + ".sig")
        if sig.is_file():
            return exe, sig

    raise SystemExit(
        f"{bundle_dir} 下没找到带 .sig 的 updater 产物；"
        "确认 tauri.conf.json 里 bundle.createUpdaterArtifacts=true 且构建时提供了签名私钥"
    )


def _prefer_version(candidates: list[Path], version: str) -> list[Path]:
    """把文件名里带本次版本号的产物排到最前。

    本地 bundle 目录会堆积历史版本（2.3.0 / 2.4.0 / 2.5.1 都在），单纯按名字排序
    会挑到 2.4.0 那份——生成的 latest.json 就会把老包连同老签名推给用户。
    CI 每次都是干净环境不会复现，只在本地手动发版时咬人。
    """
    marker = f"_{version}_"
    return sorted(candidates, key=lambda p: (marker not in p.name, p.name))


def release_asset_name(artifact: Path, version: str) -> str:
    """GitHub Release 上的文件名（统一成 TT-Calendar-* 便于用户辨认）。"""
    if artifact.name.endswith(".nsis.zip"):
        return f"TT-Calendar-{version}.nsis.zip"
    return f"TT-Calendar-Setup-{version}.exe"


def main() -> int:
    # 本脚本会 print 中文；Windows 上若控制台是 cp1252（GitHub Actions runner 就是），
    # 直接 print 会 UnicodeEncodeError 退出，而且是在「已经写盘成功」之后崩——
    # 表面上像生成失败，其实文件是好的。自己兜住，不指望调用方设对编码。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default=None, help="不传则读 version.json")
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--tag", default=None, help="默认 v<version>")
    ap.add_argument("--notes", default="", help="更新说明（纯文本）")
    ap.add_argument("--notes-file", default=None)
    ap.add_argument("--bundle-dir", default=str(ROOT / "frontend/src-tauri/target/release/bundle/nsis"))
    ap.add_argument("--out", default=str(ROOT / "release/latest.json"))
    ap.add_argument(
        "--stage-dir",
        default=None,
        help="给了就把被签名的产物复制过去并按 release 资产名重命名（CI 上传用）",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    version = args.version or read_version(ROOT)
    tag = args.tag or f"v{version}"
    notes = args.notes
    if args.notes_file:
        notes = Path(args.notes_file).read_text(encoding="utf-8").strip()

    artifact, sig_path = find_updater_artifact(Path(args.bundle_dir), version)
    signature = sig_path.read_text(encoding="utf-8").strip()
    if not signature:
        raise SystemExit(f"签名文件是空的：{sig_path}")

    asset = release_asset_name(artifact, version)
    github_url = f"https://github.com/{args.repo}/releases/download/{tag}/{asset}"
    payload = {
        "version": version,
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": signature,
                "url": github_url,
            }
        },
    }

    # 镜像清单：同一份内容，只是把下载 url 换成「镜像前缀 + GitHub 原始地址」。
    # 之所以要单独的文件而不是让 updater 自己拼，是因为 latest.json 的 url 是写死的
    # 一个地址，镜像源必须提供一份改过该字段的清单。
    mirror_payloads: list[tuple[Path, dict]] = []
    for name, prefix in MIRROR_PREFIXES:
        mirror = json.loads(json.dumps(payload))
        mirror["platforms"]["windows-x86_64"]["url"] = prefix + github_url
        mirror_payloads.append((ROOT / f"latest-{name}.json", mirror))

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    print(body)
    print()
    print(f"[upload] {artifact}  ->  {asset}")
    print(f"[upload] {Path(args.out)}")
    for path, data in mirror_payloads:
        print(f"[mirror] {path.name}  ->  {data['platforms']['windows-x86_64']['url']}")
    if args.dry_run:
        print("[dry-run] 未写盘")
        return 0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body + "\n", encoding="utf-8")
    print(f"[ok] 写入 {out}")
    for path, data in mirror_payloads:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[ok] 写入 {path}（需提交到默认分支，供镜像源 raw 读取）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
