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


def read_version(root: Path) -> str:
    data = json.loads((root / "version.json").read_text(encoding="utf-8"))
    version = str(data.get("version") or "").strip()
    if not version:
        raise SystemExit("version.json 里没有 version 字段")
    return version


def find_updater_artifact(bundle_dir: Path) -> tuple[Path, Path]:
    """返回 (被签名的安装包, 签名文件)。"""
    if not bundle_dir.is_dir():
        raise SystemExit(f"找不到 bundle 目录：{bundle_dir}")

    # 优先 zip：updater 下载的就是它
    zips = sorted(bundle_dir.glob("*.nsis.zip"))
    for z in zips:
        sig = z.with_name(z.name + ".sig")
        if sig.is_file():
            return z, sig

    # 回退：直接签名 setup.exe（某些 tauri 版本/配置只出这一份）
    setups = sorted(bundle_dir.glob("*-setup.exe"))
    for exe in setups:
        sig = exe.with_name(exe.name + ".sig")
        if sig.is_file():
            return exe, sig

    raise SystemExit(
        f"{bundle_dir} 下没找到带 .sig 的 updater 产物；"
        "确认 tauri.conf.json 里 bundle.createUpdaterArtifacts=true 且构建时提供了签名私钥"
    )


def release_asset_name(artifact: Path, version: str) -> str:
    """GitHub Release 上的文件名（统一成 TT-Calendar-* 便于用户辨认）。"""
    if artifact.name.endswith(".nsis.zip"):
        return f"TT-Calendar-{version}.nsis.zip"
    return f"TT-Calendar-Setup-{version}.exe"


def main() -> int:
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

    artifact, sig_path = find_updater_artifact(Path(args.bundle_dir))
    signature = sig_path.read_text(encoding="utf-8").strip()
    if not signature:
        raise SystemExit(f"签名文件是空的：{sig_path}")

    asset = release_asset_name(artifact, version)
    payload = {
        "version": version,
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": signature,
                "url": f"https://github.com/{args.repo}/releases/download/{tag}/{asset}",
            }
        },
    }

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    print(body)
    print()
    print(f"[upload] {artifact}  ->  {asset}")
    print(f"[upload] {Path(args.out)}")
    if args.dry_run:
        print("[dry-run] 未写盘")
        return 0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body + "\n", encoding="utf-8")
    print(f"[ok] 写入 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
