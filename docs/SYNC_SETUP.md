# 多端同步配置指引（GitHub 私有仓库）

> 一次配置，每台电脑各做一遍「第 2、3 步」。全程约 5 分钟。

## 1. 建数据仓库（只需做一次）

1. 打开 <https://github.com/new>
2. Repository name 随意，例如 `tt-calendar-data`
3. 选择 **Private**（必须！数据是明文 JSON）
4. **不要**勾选 README / .gitignore / license（保持空仓库，首次同步会自动初始化）
5. Create repository

## 2. 生成 PAT（fine-grained，最小权限）

1. 打开 <https://github.com/settings/personal-access-tokens/new>
2. Resource owner：你自己（TTDiang2）
3. Repository access：**Only select repositories** → 选中刚建的 `tt-calendar-data`
4. Permissions → Repository permissions：
   - **Contents**：Read and write（唯一必需权限）
   - 其余全部 No access（默认即是不给）
5. 生成后立刻复制 `github_pat_...`（只显示一次）

## 3. 在 TT Calendar 里配置（每台电脑）

1. 设置 → 「数据同步」区块
2. 仓库填 `TTDiang2/tt-calendar-data`，分支 `main`
3. PAT 粘贴进去（保存后用 Windows 加密存在本机，界面上不再显示；留空表示沿用已存的）
4. 点「测试连接」→ 应显示「连通正常」
5. 点「立即同步」：
   - **第一台电脑**：仓库是空的 → 自动上传全部数据（显示「首次初始化完成」）
   - **第二台及以后**：检测到远端已有数据 → 弹出选择：
     - **合并两边并上传（推荐）**：本地与远端全量合并
     - **用远端覆盖本地**：丢弃本地，完全采用远端
6. 勾选「启动时自动同步一次」（默认开启）后，每次打开应用自动双向同步

## 4. 日常使用

- 改完数据后手动点「立即同步」，或等下次启动自动同步
- 同步报告：`拉取 N · 推送 M · 冲突 K · 删除 D`
  - 冲突 = 两台电脑改了同一条数据，按修改时间新者胜
- 每次同步 = 数据仓库里的一个 commit，GitHub 网页可看每次同步改了什么、可回滚
- 数据文件在仓库 `data/` 目录（todo.json、marks.json 等，每表一个，可读）

## 5. 常见问题

| 现象 | 处理 |
|---|---|
| 「PAT 无效或过期（401）」 | PAT 被删/过期 → 重新生成，粘贴到设置里保存 |
| 「触发 GitHub 限流」 | 正常频率不会遇到；遇到就等几分钟 |
| 「远端有新提交（并发冲突）」 | 两台电脑同时在同步 → 再点一次即可（引擎也会自动重试一次） |
| 换了电脑/重装系统后 PAT 解密失败 | DPAPI 绑定原机器 → 新机器重新粘贴 PAT 即可 |
| 想重新初始化远端 | 删掉数据仓库里的所有内容（或删库重建），删除本机 `data/sync_base/` 目录，再「立即同步」 |

## 6. 安全边界

- 数据明文存在**你自己的私有仓库**里（和代码仓库同级安全）
- PAT 用 Windows DPAPI（当前用户+本机）加密后存本地 SQLite，永不上传、不同步、界面不回显
- fine-grained PAT 只授权这一个仓库的 Contents 读写，即使泄露也无法动你的其他仓库
