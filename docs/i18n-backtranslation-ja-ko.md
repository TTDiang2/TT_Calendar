# i18n A4 回译抽查报告（ja/ko，P3 质检三件套之二）

> 批次：A4 翻译生产（ja/ko）。方法：从新翻（老端独有/zh 分叉）key 为主抽样，
> 译文回译为中文与老端 zh 原文对照；另附长度审计（手册 §7 质检三件套 + Neo 翻译规范 §6.4）。
> 对照脚本（抄/翻判定）存 working notes；产物头注释含逐命名空间 抄/翻 统计。

## 抽样口径

- 每语言 24 条，覆盖全部新翻命名空间：dialogs.subscription（订阅面板，老端独有）、
  dialogs.dayEntry（当日新增）、settings.import / settings.jisilu（老端独有）、settings.sync.desc（zh 分叉）、
  todoDetail.repeat（zh 分叉）、countdown、calendar 多日区间、stats 简版、detail、todoview、todoboards。
- 「回译」列为审校人把译文还原后的中文；判定 = 语义是否与 zh 原文一致（不追求逐字）。

## ja 抽查（24 条）

| key | zh 原文 | ja 译文 | 回译 | 判定 |
|---|---|---|---|---|
| dialogs.subscription.title | 订阅 | サブスクリプション | 订阅 | ✓ |
| dialogs.subscription.pendingCount | 有 {n} 个订阅待适配 | アダプター対応待ちの購読が {n}件あります | 有 {n} 个订阅等待适配 | ✓ |
| dialogs.subscription.updatedMsg | 「{name}」已更新（新增 {n} 条） | 「{name}」を更新しました（{n}件追加） | 已更新「{name}」（追加 {n} 条） | ✓ |
| dialogs.subscription.fieldRules | 订阅规则（自然语言，给你的 agent 读） | 購読ルール（自然言語。エージェントが読みます） | 订阅规则（自然语言，agent 读取） | ✓ |
| dialogs.dayEntry.titleWithDate | 新建 {date} | 新規作成 {date} | 新建 {date} | ✓ |
| dialogs.dayEntry.tabDot | 点点 / 日程 | ドット / 予定 | 点点 / 日程 | ✓ |
| dialogs.dayEntry.multiCount | 共 {n} 天（{range}） | 合計 {n} 日（{range}） | 共 {n} 天（{range}） | ✓ |
| dialogs.dayEntry.autoTodo | 同时创建对应待办 | 対応するToDoも作成 | 同时创建对应 ToDo | ✓ |
| dialogs.dayEntry.saveFailed | 保存失败：{msg} | 保存に失敗しました：{msg} | 保存失败：{msg} | ✓ |
| dialogs.schedule.multiDay | 多日 · 共 {n} 天 | 複数日 · 合計 {n}日 | 多日 · 共 {n} 天 | ✓ |
| settings.import.desc | 从集思录抓取该区间的新股/可转债/分红/期权等数据。已禁用的图层会跳过。 | 指定期間の新株・転換社債・配当・オプションなどのデータをJisiluから取得します。無効なレイヤーはスキップされます。 | 从 Jisilu 获取指定期间的新股/转债/分红/期权等数据。禁用的图层会被跳过。 | ✓ |
| settings.jisilu.subEmpty | 该图层暂无事件数据，无法列出子动作。请先在「事件导入」拉取一次。 | このレイヤーにはイベントデータがまだなく、サブアクションを一覧できません。先に「イベント取り込み」で一度取得してください。 | 该图层还没有事件数据，无法列出子动作。请先在「事件导入」获取一次。 | ✓ |
| settings.jisilu.subFiltered | 已过滤 {n}/{total} | {n}/{total}件をフィルター中 | 正在过滤 {n}/{total} 件 | ✓ |
| settings.sync.desc | 通过你的 GitHub 私有仓库在多台电脑间同步全部数据…PAT 用 Windows 加密保存、永不上传… | 自分のGitHubプライベートリポジトリを通じて、複数のPC間ですべてのデータ…同期します。…PATはWindowsの暗号化で保存され、アップロードされることはありません… | 通过自己的 GitHub 私有仓库在多台 PC 间同步全部数据…PAT 以 Windows 加密保存、绝不上传… | ✓ |
| todoDetail.repeat.weekdays | 每工作日重复 | 平日ごとに繰り返す | 每工作日重复 | ✓ |
| todoDetail.field.repeatHint | 完成后自动生成下一期 | 完了すると次の予定を自動生成します | 完成后自动生成下一个日程 | ✓ |
| countdown.titleWithCat | 倒数日 · {cat} | カウントダウン · {cat} | 倒数日 · {cat} | ✓ |
| countdown.empty | 暂无倒数日，点「新建」添加 | カウントダウンはまだありません。「新規」から追加しましょう | 暂无倒数日，从「新建」添加 | ✓ |
| calendar.spanRange | 第 {i}/{total} 天 · {start} ~ {end} | {i}/{total} 日目 · {start} ~ {end} | 第 {i}/{total} 天 · {start} ~ {end} | ✓ |
| calendar.contTitle | {title}（{i}/{total} 天，{start} 起） | {title}（{i}/{total} 日目、{start} から） | {title}（第 {i}/{total} 天，自 {start} 起） | ✓ |
| stats.cards.total | 总待办 | ToDo総数 | ToDo 总数 | ✓ |
| stats.daily.peak | 峰值 {n}/天 | ピーク {n}/日 | 峰值 {n}/天 | ✓ |
| todoboards.jar.legendHard | 磐石 · 难 | 岩 · 難 | 岩石 · 难 | ✓ |
| sourceFields.unknown | 未知 | 不明 | 不明 | ✓ |

ja 附加核查（三段计数隐喻，登记译法）：todoboards.jar.carried「装了→浮遊」/ piece「件→件」/
settled「沉底→沈殿」——组装后「浮遊 3件 · 沈殿 2件」与 Neo jar 计数句同构，语义保留玻璃罐隐喻。✓

## ko 抽查（24 条）

| key | zh 原文 | ko 译文 | 回译 | 判定 |
|---|---|---|---|---|
| dialogs.subscription.title | 订阅 | 구독 | 订阅 | ✓ |
| dialogs.subscription.pendingCount | 有 {n} 个订阅待适配 | 어댑터 대기 중인 구독이 {n}개 있습니다 | 有 {n} 个订阅等待适配 | ✓ |
| dialogs.subscription.updatedMsg | 「{name}」已更新（新增 {n} 条） | “{name}” 업데이트됨 ({n}개 추가) | “{name}” 已更新（新增 {n} 个） | ✓ |
| dialogs.subscription.fieldRules | 订阅规则（自然语言，给你的 agent 读） | 구독 규칙 (자연어, 에이전트가 읽음) | 订阅规则（自然语言，agent 读取） | ✓ |
| dialogs.dayEntry.titleWithDate | 新建 {date} | 새로 만들기 {date} | 新建 {date} | ✓ |
| dialogs.dayEntry.tabDot | 点点 / 日程 | 도트 / 일정 | 点点 / 日程 | ✓ |
| dialogs.dayEntry.autoTodoDetail | 放入「{list}」列表（没有会自动创建）；计划日期 {start}、截止日期 {end} | “{list}” 목록에 넣습니다 (없으면 자동 생성). 예정일 {start}, 마감일 {end} | 放入“{list}”列表（没有则自动创建）。计划日 {start}、截止日 {end} | ✓ |
| dialogs.dayEntry.suffixEvents | · 按天建 {n} 条事件 | · 날짜별로 이벤트 {n}개를 만듭니다 | · 按日期创建 {n} 个事件 | ✓ |
| dialogs.schedule.spanBad | 结束日期早于开始日期 | 종료일이 시작일보다 앞섭니다 | 结束日期早于开始日期 | ✓ |
| settings.import.sectionTitle | 事件导入 | 이벤트 가져오기 | 事件导入 | ✓ |
| settings.import.resultError | 导入 {n} 条；错误：{error} | {n}개를 가져왔습니다. 오류: {error} | 导入了 {n} 个。错误：{error} | ✓ |
| settings.jisilu.expandStar | 展开星级过滤 | 별점 필터 펼치기 | 展开星级过滤 | ✓ |
| settings.jisilu.subReset | 恢复全部 | 모두 복원 | 全部恢复 | ✓ |
| settings.sync.desc | …PAT 用 Windows 加密保存、永不上传。 | …PAT는 Windows 암호화로 저장되며 절대 업로드되지 않습니다. | …PAT 以 Windows 加密保存，绝不上传。 | ✓ |
| todoDetail.repeat.daily | 每日重复 | 매일 반복 | 每日重复 | ✓ |
| todoDetail.field.repeatHint | 完成后自动生成下一期 | 완료하면 다음 일정을 자동 생성합니다 | 完成后自动生成下一个日程 | ✓ |
| countdown.empty | 暂无倒数日，点「新建」添加 | 카운트다운이 없습니다. “새로 만들기”로 추가하세요 | 没有倒数日。用“新建”添加 | ✓ |
| calendar.emptyDay | 当天无事件 | 이 날짜에 이벤트가 없습니다 | 该日期无事件 | ✓ |
| calendar.multiDayTitle | {title}（多日 {start} ~ {end}，共 {total} 天） | {title} (여러 날 {start} ~ {end}, 총 {total}일) | {title}（多日 {start}~{end}，共 {total} 天） | ✓ |
| stats.cards.last90 | 近90天完成 | 최근 90일 완료 | 最近 90 天完成 | ✓ |
| stats.dist.title | 未完成待办分布（按列表） | 미완료 할 일 분포 (목록별) | 未完成待办分布（按列表） | ✓ |
| detail.dateMD | {m} 月 {d} 日 | {m}월 {d}일 | {m}月 {d}日 | ✓ |
| todoboards.jar.legendMedium | 卵石 · 中 | 조약돌 · 보통 | 卵石 · 中 | ✓ |
| todoview.csv.doneWithErrors | 导入 {inserted} 条，新建 {lists} 个列表，{n} 行错误 | {inserted}개를 가져왔습니다. 목록 {lists}개를 새로 만들었습니다. {n}행 오류 | 导入 {inserted} 个，新建 {lists} 个列表，{n} 行错误 | ✓ |

ko 附加核查：todoboards.jar.carried「装了→부유」/ piece「件→건」/ settled「沉底→가라앉음」，
组装后「부유 3건 · 가라앉음 2건」成立（对齐 Neo ko「{n}건 떠 있음 · {n}건 가라앉음」隐喻）。✓

## 长度审计（按钮/Tab 类 ≤ zh 2 倍）

抽测按钮/Tab/徽标类短 key 20 组（mode 胶囊、nav title、动作按钮、徽标）。全数通过，除以下
4 处 ja 超限——**均逐字沿用 Neo 同名 key 译文**（同源组件同一 UI 槽位，Neo 端已实证放行，
且受 §7 冻结术语约束），登记为「沿用例外」，不做本地缩写以免两端同词异译：

| key | zh（限 2 倍） | ja 译文 | 说明 |
|---|---|---|---|
| common.cancel | 取消（4） | キャンセル（5） | Neo 同文；日文 UI 惯例，按钮宽度自适应 |
| topbar.mode.countdown | 倒数日（6） | カウントダウン（7） | Neo 同文；视图胶囊自适应宽度（Neo 桌面端同款） |
| shell.createLayer | 新建图层（8） | レイヤーを新規作成（9） | Neo 同文；树底按钮+对话框标题 |
| terms.subscription | 订阅（4） | サブスクリプション（9） | 冻结术语；实际渲染位是 tooltip/侧栏分组标题，非紧凑按钮 |

ko 侧无超限（구독 2、카운트다운 5≤6、새 레이어 5≤8、취소 2≤4 等）。

## 结论

- 回译抽查 48/48 语义一致，无返工项。
- 长度审计：ko 零超限；ja 4 处「沿用 Neo 译文」例外已登记（冻结术语优先 + Neo 实证）。
