# 【交接】老端新增 todo.repeat 列 —— Neo 端兼容改造

> 写给：TT_Calendar_Neo 端 agent。
> 来源：老端 2026-09-21「待办重复」功能（老端 commit 见 `git log`，设计要点在本文第 3 节）。
> 结论先行：**Neo 本期只做必做 A/B（补列 + 收发映射透传）；生成逻辑（第 3 节规格）留给二期，
> 二期必须按规格逐字实现，不得自创语义。**

---

## 1. 老端加了什么

todo 表新增一列：

```sql
repeat TEXT   -- 可空；NULL = 不重复；'daily' 每日 | 'weekdays' 每工作日 | 'weekly' 每周
```

老端业务：**完成转化时自动生成下一期克隆**（未完成 → 完成，PUT /todo/{id} 路径内）：
新行新 uuid、status=notStarted、completed_at=NULL、planned_date=下一期、
due_date/start_date 按相同位移平移、其余字段（含 repeat）原样继承。

## 2. 必做 A —— 建列（照抄 alarm_at 模式）

`packages/db/src/migrate.ts` 的 `ENSURE_COLUMNS` 幂等序列加：

```
ALTER TABLE todo ADD COLUMN repeat TEXT
```

## 3. 必做 B —— 收发映射 + 未知键容忍（有时限！）

- `packages/contracts/src/todo.ts` 的 todo schema 加 `repeat: string | null`。
- `packages/db/src/sync-service.ts` 收发映射两端都加 `repeat`。
- **确认导入路径对未知键是"忽略"而非"报错"**：老端已上线，快照里的 todo 行**现在就带**
  `repeat` 键。若 Neo 用 zod 等做 `.strict()` 校验或动态拼 INSERT，先加容忍/白名单再同步。

时间线：老端导入侧已有未知列过滤（2026-09-21 加），所以 **Neo 端进度不阻塞老端**；
但 Neo 端下次 pull 前必须自己先兼容。

## 4. 二期规格 —— 生成逻辑（若 Neo 要在端内点掉重复待办）

**不做二期的话，行为缺口：在 Neo 上点掉重复待办 = 链条断在那期**（不生成下一期）。
可接受就跳过本节；要做，逐字实现以下规则：

### 4.1 触发

仅当 **本地用户完成动作** 使 todo 从「非 completed」转为「completed」时触发。
**同步导入进来的已完成行不触发**（否则两台设备会对同一行各生成一期，同步后重复卡片）。

### 4.2 下一期计划日

```
输入: mode ∈ {daily, weekdays, weekly}, planned(旧计划日), completedDay(完成日)
weekly:   d = planned + 7天;  while d <= completedDay: d += 7天
daily:    d = planned + 1天;  while d <= completedDay: d += 1天
weekdays: d = planned + 1天;  while d <= completedDay 或 d 非工作日: d += 1天
工作日判定: 中文日历（法定节假日排除 + 调休补班周末算工作日）；
           日历数据缺该年份时回退「周一~周五」
```

即：拖延补卡不产生过期待办（跳过错过的期），周重复保持星期几不变。

### 4.3 新行

- 新 uuid；status='notStarted'；completed_at=NULL
- planned_date = 4.2 结果；delta = 新 planned − 旧 planned
- due_date / start_date：旧值非空则 旧值+delta，否则保持 NULL
- title/body/list_id/importance/complexity/tags/sort_order/repeat 原样继承

### 4.4 测试向量（两端对拍用）

| mode | planned | completedDay | 期望 next |
|---|---|---|---|
| daily | 2026-09-25(五) | 2026-09-25 | 2026-09-26 |
| daily | 2026-09-18(五) | 2026-09-21(一) | 2026-09-22 |
| weekly | 2026-09-14(一) | 2026-09-16 | 2026-09-21 |
| weekly | 2026-09-07(一) | 2026-09-21(一) | 2026-09-28 |
| weekly | 2026-09-14(一) | 2026-09-21(一) | 2026-09-28 |
| weekdays | 2026-09-11(五) | 2026-09-11 | 2026-09-14 |
| weekdays | 2026-09-25(五) | 2026-09-25 | 2026-09-28 |

老端参考实现：`backend/routes.py::_next_repeat_date` / `_spawn_next_repeat`，
Python 测试：`tests/test_todo_repeat.py`。

## 5. 禁改清单

- 不要动行身份（id）、墓碑、合并逻辑 —— repeat 只是普通可空列。
- 不要给 repeat 设非 NULL 默认值或改写枚举；未知值一律原样透传。
- 二期实现不得在同步导入路径触发生成（见 4.1，防双生）。

---

老端仓库：TTDiang2/TT_Calendar · 相关：docs/HANDOFF-alarm-at-compat.md（同款补列模式）
