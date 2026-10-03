# 老端 Python 侧 i18n 勘察清单（批③ AST 级扫描产出，门2 条件1 落档）

> 状态：**全部登记，零实施**（涉及跨端契约/数据结构，属独立批次=批⑤）。
> 扫描范围：tt_calendar/（9 文件）+ backend/。总状态：用户可见错误约 33 条 + 协议键 1 + 展示串两族 + 种子映射若干。

## 一、用户可见错误消息（→结构化错误码+前端按码翻译，约 33 条）

| 文件 | 条数 | 明细 |
|---|---|---|
| backend/routes.py | ~10 | 只支持 jisilu 图层 / 内置图层不可删除 / 标题不能为空 / 订阅不存在×3 / 内置订阅不可删除 / 待 agent 适配 / CSV 解码与表头 / 第 N 行错误×3 |
| tt_calendar/sync/engine.py | 8 | 尚未配置同步 / 远端为空警告 / PAT 解密失败 / 推送失败 / 并发冲突重试等 |
| backend/providers.py | ~15 | GitHub 401/403/404/限流/网络错误（带修复指引，经 testSync detail 与设置页消息区直显） |

处置原则（手册 §5.1）：前端直接 toast 的→结构化错误码+前端按码翻译；纯开发者错误→改英文（§8.7）。例外见协议键。

**协议键（禁译）**：`同步正在进行中，请稍候` 被 App.tsx `SYNC_IN_PROGRESS_MARK`（'正在进行'）做子串匹配（fragments/app.ts:7 头注登记）——改它=断同步协议。**台账 D2**：错误码化落地时迁出 i18n/** 并删除子串匹配。

## 二、aggregator 拼好的中文展示串（→结构化标签，数据结构变更单独排期）

- countdown 横幅 3 句：🎉 今天是「X」/ 距离「X」还有 N 天 / 「X」已过 N 天
- next_label 4 形态：今年 / N 周年 / 农历周年 / N 天
- `暂无倒数日` 空态
- `lunar_display`（七月初四/闰六月等）——**台账 D3**：结构化为 {year,month,day,leap} 后，lunarDisplay 的 ja/ko 从透传升格翻译档（旧暦/음력）

## 三、db.py 种子/持久化（只出映射清单，禁动库）

- 内置图层 display_name 13 个：日程（旧）/日程/重要日期/充实度染色/公共节假日/待办/待办·已完成/工作/课程/运动/玩耍/其他/集思录（L1087-1204/L1651）→显示时映射（zhDefault 基准表照抄种子）
- `migrate_schedule_to_items` 把 `上午:/下午:/晚上:` 前缀写入 schedule_items.title 持久化（L768）→显示层映射
- countdown `category DEFAULT '其他'`（L149）→前端映射已存在
- countdown→important 事件 title `N 周年/N 天`（L1700-1702，持久化）

## 四、未实施项（批③量力判断，随批⑤一并定）

- layerLabel 老端版（layers fragment+用户改名检测 zhDefault 基线；Neo adapt/layerLabel.ts 为蓝本）
- 后端 Web 界面/admin 页存在性查证（任务书"明确不做"清单要求先查证）
