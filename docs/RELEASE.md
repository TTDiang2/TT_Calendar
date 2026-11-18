# 发布手册

这份文档只讲「怎么把一个版本发出去」。日常开发、架构说明见 `README.zh-CN.md` 与
`docs/DEV_ENVIRONMENT.md`。

---

## 1. 版本号只有一个来源

改版本只改一个地方：

```json
// version.json
{ "version": "2.4.0" }
```

然后跑：

```bash
python scripts/sync_version.py
```

它会同步到 `frontend/package.json`、`frontend/src-tauri/tauri.conf.json`、
`frontend/src-tauri/Cargo.toml`、`tt_calendar/_build_version.py`，并校验四处一致。
CI 里这一步是构建前的固定动作，所以**不要在别处手改版本号**——下一次同步就被覆盖，
而且 tag 与 version.json 不一致时 release workflow 会直接失败。

版本号的语义：

| 位 | 什么时候加 |
| --- | --- |
| major | 数据格式不兼容（需要迁移脚本并且不可回退） |
| minor | 新功能（当前阶段基本都走这里） |
| patch | 只修 bug |

---

## 2. 自动更新的签名密钥

Tauri updater 靠一对 minisign 密钥保证「这个安装包确实是作者发的」，缺了私钥就出不了
更新产物（`createUpdaterArtifacts` 会失败）。

### 生成一次，然后备份

```powershell
cd frontend
npx tauri signer generate -w ../.keys/tt-calendar.key --ci
```

- 私钥：`.keys/tt-calendar.key`（**已在 .gitignore，绝不入库**）
- 公钥：`.keys/tt-calendar.key.pub` → 内容写进 `tauri.conf.json` 的
  `plugins.updater.pubkey`

> ⚠️ 私钥或密码丢了，就没法再发布「能被老版本信任」的更新——用户只能手动下载安装包。
> 至少在两处离线位置各存一份（密码管理器 + 离线介质）。

### 本地构建时怎么给私钥

CLI 只认 `TAURI_SIGNING_PRIVATE_KEY`（私钥内容，不是路径）：

```bash
# Git Bash
TAURI_SIGNING_PRIVATE_KEY="$(cat .keys/tt-calendar.key)" npm run tauri build

# PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content .keys/tt-calendar.key -Raw
npm run tauri build
```

私钥没有设密码时，CLI 会提示「assuming an empty password」，这是正常的。

### CI 里怎么给

GitHub 仓库 → Settings → Secrets and variables → Actions，加两个：

| Secret | 值 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `.keys/tt-calendar.key` 的完整内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设的密码；没设就留空 |

没配这两个 secret 也能出包：workflow 会带 `createUpdaterArtifacts=false` 构建，
安装包照常产出，只是老用户收不到自动更新（job 里会有 warning）。

---

## 3. 本地出包

```bat
build_release.bat            :: 安装包 + MSI + 便携 zip + checksum
build_release.bat preview    :: 只出 target\release\TT Calendar.exe（验证用，快）
```

产物落在 `release/`：

| 文件 | 说明 |
| --- | --- |
| `TT-Calendar-Setup-2.4.0.exe` | NSIS 安装包，当前用户安装，不需要管理员 |
| `TT-Calendar-2.4.0.msi` | 同一应用的 MSI，批量部署用 |
| `TT-Calendar-Portable-2.4.0.zip` | 便携版，解压即用 |
| `latest.json` | updater 的清单（指向被签名的那份安装包） |

脚本会自动选 Python：优先 `py -3.10`（后端 exe 是 cp310 构建），没装再退回
`python`。两者都没有 PyInstaller 时直接报错退出，不会打出一个半成品。

### latest.json 单独重生成

```bash
python scripts/gen_latest_json.py --tag v2.4.0 --notes "本次改了什么"
```

它从 `bundle/nsis/*-setup.exe.sig` 读签名、从 `version.json` 读版本，生成的 `url`
必须指向**被签名的那份文件**（现在就是 `TT-Calendar-Setup-x.y.z.exe`）。指向别的
文件会验签失败，用户侧表现为「下载完成但安装不动」。

---

## 4. CI 出包

`.github/workflows/release.yml`，两种触发方式：

```bash
# 推荐：打 tag 触发
git tag v2.4.1
git push origin v2.4.1
```

或在 Actions 页面 `workflow_dispatch` 手动跑（可以填更新说明）。

流程：同步版本 → 校验 tag 与 version.json 一致 → PyInstaller 打后端 → `tauri build`
→ 收集安装包 → 便携 zip → latest.json → 校验和 → 发布 Release。

tag 与 `version.json` 不一致会**直接失败**，这是故意的：否则会出现「tag 是 v2.4.1、
包里装着 2.4.0」的版本错乱，而 updater 靠版本号判断要不要升级。

---

## 5. 代码签名（可选，但强烈建议）

没有代码签名证书时，用户第一次运行会看到 SmartScreen 蓝色警告（「Windows 已保护你的
电脑」），点「更多信息 → 仍要运行」才能继续。

拿到 PFX 后：

1. 转成 base64 存进 secret `WINDOWS_CERT_PFX_BASE64`
2. 密码存 `WINDOWS_CERT_PASSWORD`
3. 在 `release.yml` 的构建步骤后加 signtool 步骤（`signtool sign /f ... /p ... /tr http://timestamp.digicert.com /td sha256`）

证书不配也能发版，只是首次安装多一步确认。

---

## 6. 回滚

代码回滚：

```bash
git revert <bad-commit>
```

已经发出去的版本无法「撤回」，只能发一个更高版本号的修复版：updater 只会往新版本升。
紧急情况下可以在 GitHub Release 页面把坏版本标为 pre-release，但已经装上的用户不会
自动降级——必要时在 release note 里写清「请手动下载旧版覆盖安装」。

---

## 7. 发布前检查清单

- [ ] `version.json` 改好，`python scripts/sync_version.py` 跑过
- [ ] `python -m pytest tests -q` 全绿（用 `py -3.10`）
- [ ] `cd frontend && npm run typecheck && npm test && npm run lint`
- [ ] 安装包静默安装 → 启动 → 建一条日程 → 重启仍在
- [ ] 设置页能装/卸插件，装完图层出现
- [ ] 卸载后 `%APPDATA%\TT Calendar` 仍在，重装能读到旧数据
- [ ] `latest.json` 的 url 与 release 上的文件名一致
