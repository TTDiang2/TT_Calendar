# 自动更新的源（GitHub → 镜像 → Gitee）

updater 会按 `frontend/src-tauri/tauri.conf.json` 里 `plugins.updater.endpoints` 的**顺序**逐个尝试，
拿到第一份能用的 `latest.json` 就停。国内网络下 GitHub 大概率不通，所以后面还挂着镜像和 Gitee。

| 顺序 | 源 | 清单地址 | 安装包实际下载地址 |
|---|---|---|---|
| 1 | GitHub（主） | `github.com/TTDiang2/TT_Calendar/releases/latest/download/latest.json` | GitHub Release 资产 |
| 2 | ghfast 镜像 | `ghfast.top/https://raw.githubusercontent.com/.../main/latest-ghfast.json` | `ghfast.top/https://github.com/.../releases/download/...` |
| 3 | gh-proxy 镜像 | `gh-proxy.com/https://raw.githubusercontent.com/.../main/latest-ghproxy.json` | `gh-proxy.com/https://github.com/.../releases/download/...` |
| 4 | Gitee（兜底） | `gitee.com/TTDiang/tt-calendar-update/raw/master/latest.json` | Gitee Release 附件 |

每份清单里的 `url` 字段写死了各自的下载地址，所以**每多一个源就多一份清单文件**，
不能共用同一份 GitHub 的 `latest.json`。

## 5 秒超时是硬的

updater 的 Rust 侧请求默认没有超时。国内连 `github.com` 时 TCP 会卡到系统默认的 ~21 秒，
后面的镜像源永远轮不到。所以 `UpdateSection.tsx` 里显式传了 `check({ timeout: 5000 })`
（这个 timeout 对**每个** endpoint 单独生效）。

改超时就改 `CHECK_TIMEOUT_MS`，别再退回不带参数的 `check()`。

## 发版时自动做什么

`.github/workflows/release.yml`：

1. `gen_latest_json.py` 生成 `release/latest.json` + 仓库根的 `latest-ghfast.json` / `latest-ghproxy.json`；
2. `Publish mirror manifests` 把两份镜像清单提交到 `main`（失败只报警告，不阻断发版）；
3. `Mirror to Gitee` 在配置了 `GITEE_TOKEN` 时执行 `sync_gitee_update.py`：建仓库/release、传安装包、写 `latest.json`。

镜像清单必须落在**默认分支**上，因为源地址用的是 `raw.githubusercontent.com/.../main/...`。

## 本地手动补一次 Gitee

CI 没 token 时跳过，事后可以本地补：

```bash
GITEE_TOKEN=xxx py -3.10 scripts/sync_gitee_update.py --version 2.5.2
py -3.10 scripts/sync_gitee_update.py --version 2.5.2 --dry-run   # 只看计划，不发请求
```

## 验证某个源是否真的能用

```bash
curl -sS -m 8 <清单地址> | head -20          # 能出 JSON 就通
curl -sS -m 8 -o /dev/null -w '%{http_code}\n' <清单里的 url>   # 期望 200/302
```

## 安全性

安装包带 minisign 签名，公钥写死在客户端（`tauri.conf.json` 的 `pubkey`）。
镜像或中间人篡改安装包会在验签阶段失败，走第三方镜像不降低安全等级——**但前提是别把
`dangerousAcceptInvalidCerts` 打开**。
