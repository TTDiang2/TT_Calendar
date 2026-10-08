/**
 * settings 命名空间（老端版）：SettingsDialog.tsx —— 设置弹窗全部文案。
 * busy/reminder/layers 等与 Neo 同源（zh 逐字一致直接复用 Neo key 命名与译文）；
 * sync.desc 与 Neo 有分叉（老端提"多台电脑/待办、涂色、纪念日、配置/PAT 用 Windows 加密保存"），
 * zh 以老端原文为准；jisilu 分区（集思录星级过滤/子动作）与事件导入为老端独有。
 * 自定义图层行的图层名是用户数据，原样渲染不走映射。
 */
export const settings = {
  zh: {
    /** 弹窗标题 */
    title: '设置',
    /** 保存进行中的按钮文案（忙度/同步两处共用） */
    saving: '保存中…',
    /** 加载中提示（忙度/提醒两处共用） */
    loading: '加载中…',

    /** ── 事件导入分区（老端独有） ───────────────────────── */
    import: {
      sectionTitle: '事件导入',
    fieldSource: '数据源',
      fieldStart: '开始',
      fieldEnd: '结束',
      desc: '按区间从所选数据源抓取事件。已禁用的图层会跳过。',
      running: '导入中…',
      start: '开始导入',
      /** 导入成功提示，{n} 为新增条数 */
      resultOk: '导入 {n} 条',
      /** 导入成功但有错误提示，{n} 同上，{error} 为错误文本 */
      resultError: '导入 {n} 条；错误：{error}',
    },

    /** ── 集思录投资日历分区（老端独有） ─────────────────── */
    layerFilters: {
      sectionTitle: '数据源图层',
      /** 手风琴收起 */
      collapse: '收起',
      /** 手风琴展开（带星级过滤配置的图层） */
      expandStar: '展开星级过滤',
      /** 手风琴展开（子动作配置图层） */
      expandSub: '展开子动作',
      /** 星级过滤行首小标 */
      minStar: '最低星级',
      /** 星级过滤选项 */
      starAll: '全部',
      star1: '1★ 以上',
      star2: '2★ 以上',
      star3: '3★',
      subLoading: '读取子动作中…',
      /** 子动作为空的提示 */
      subEmpty: '该图层暂无事件数据，无法列出子动作。请先在「事件导入」拉取一次。',
      /** 过滤状态：全开 */
      subAllOn: '当前全部显示',
      /** 过滤状态：部分过滤，{n}/{total} 为已选/可选数 */
      subFiltered: '已过滤 {n}/{total}',
      /** 恢复全部按钮 */
      subReset: '恢复全部',
    },

    /** ── 自定义图层分区 ─────────────────────────────────── */
    layers: {
      sectionTitle: '自定义图层',
      empty: '暂无自定义图层。可在日历左侧边栏点「新建图层」创建。',
      deleteTitle: '删除图层（标记数据不会保留）',
      confirmDelete: '确认删除',
    },

    /** ── 待办忙度分区 ───────────────────────────────────── */
    busy: {
      sectionTitle: '待办忙度',
      desc: '预测层：未完成待办按「截止×5 + 计划×3 + 重要度 + 复杂度」加权，用于未来日期；实际层：勾选当天计分，用于过去日期。',
      fieldDue: '截止权重',
      fieldPlanned: '计划权重',
      fieldImportance: '重要度 高/中/低',
      fieldComplexity: '复杂度 高/中/低',
      fieldThresholds: '分档阈值（5 个）',
      predictLayer: '预测层',
      actualLayer: '实际层',
      /** 色块输入框的 title，{n} 为档位序号（1 起） */
      levelTitle: '档位 {n}',
      save: '保存并重算',
      /** 保存成功提示（复数条目：en day/days） */
      savedDays: { other: '已保存并重算 {n} 天的忙度快照' },
    },

    /** ── 每日提醒分区 ───────────────────────────────────── */
    reminder: {
      sectionTitle: '每日提醒',
      desc: '到了设定时间，若今日仍有计划未完成的待办，应用顶部会出现一条安静横幅。默认关。',
      enable: '启用每日提醒',
      fieldTime: '提醒时间',
    },

    /** ── 数据同步分区 ───────────────────────────────────── */
    sync: {
      sectionTitle: '数据同步',
      /** 老端原文（与 Neo 分叉：多台电脑/数据范围/Windows 加密措辞） */
      desc: '通过你的 GitHub 私有仓库在多台电脑间同步全部数据（待办、涂色、纪念日、配置）。数据明文存于你的仓库；PAT 用 Windows 加密保存、永不上传。配置步骤见 docs/SYNC_SETUP.md。',
      /** 首次绑定决策框正文，{n} 为远端已有行数 */
      decisionPrompt: '远端仓库已有 {n} 行数据，本地是首次绑定。如何处理？',
      resolveMerge: '合并两边并上传（推荐）',
      resolveOverwrite: '用远端覆盖本地',
      /** 状态行：上次同步成功，{time} 为原实现 slice(11,19) 的 HH:MM:SS 切片 */
      lastSyncOk: '✓ 上次同步 {time}',
      lastSyncWarn: '⚠ 上次同步 {time}',
      lastSyncNever: '尚未同步过',
      notConfigured: '未配置',
      fieldRepo: '仓库（owner/repo）',
      fieldBranch: '分支',
      patLabel: 'PAT（{state}）',
      patStored: '已存储，留空则不修改',
      patMissing: 'fine-grained，见操作指引',
      autoOnStart: '启动时自动同步一次',
      syncOnClose: '关闭前自动同步（点窗口 ✕ 时先同步再退出）',
      test: '测试连接',
      testing: '测试中…',
      syncNow: '立即同步',
      syncing: '同步中…',
      savedMsg: '已保存',
      /** 首次初始化完成提示，{n} 为上传行数 */
      initDone: { other: '首次初始化完成：已上传 {n} 行' },
      /** 同步结果报告行：四项计数 */
      report: '拉取 {pulled} · 推送 {pushed} · 冲突 {conflicts} · 删除 {deleted}',
      /** 报告的警告后缀，{warning} 为后端警告文本 */
      reportWarning: '（{warning}）',
      /** 冲突决策执行完成提示，{report} 为 sync.report 渲染结果 */
      resolvedDone: '绑定完成：{report}',
    },
  },
  en: {
    title: 'Settings',
    saving: 'Saving…',
    loading: 'Loading…',

    import: {
      sectionTitle: 'Event import',
    fieldSource: 'Data source',
      fieldStart: 'Start',
      fieldEnd: 'End',
      desc: 'Fetch events for this range from the selected data source. Disabled layers are skipped.',
      running: 'Importing…',
      start: 'Start import',
      resultOk: 'Imported {n} items',
      resultError: 'Imported {n} items; errors: {error}',
    },

    layerFilters: {
      sectionTitle: 'Data source layers',
      collapse: 'Collapse',
      expandStar: 'Star filter',
      expandSub: 'Sub-actions',
      minStar: 'Minimum stars',
      starAll: 'All',
      star1: '1★ and up',
      star2: '2★ and up',
      star3: '3★',
      subLoading: 'Loading sub-actions…',
      subEmpty: 'This layer has no event data yet, so sub-actions cannot be listed. Run an import under "Event import" first.',
      subAllOn: 'All currently shown',
      subFiltered: '{n}/{total} filtered',
      subReset: 'Restore all',
    },

    layers: {
      sectionTitle: 'Custom layers',
      empty: 'No custom layers yet. Create one with "New layer" in the calendar\'s left sidebar.',
      deleteTitle: 'Delete layer (its marks will not be kept)',
      confirmDelete: 'Confirm delete',
    },

    busy: {
      sectionTitle: 'To-do busyness',
      desc: 'Predicted layer: open to-dos are weighted by "due ×5 + planned ×3 + importance + complexity", used for future dates; actual layer: a to-do scores on the day you check it off, used for past dates.',
      fieldDue: 'Due weight',
      fieldPlanned: 'Planned weight',
      fieldImportance: 'Importance high/mid/low',
      fieldComplexity: 'Complexity high/mid/low',
      fieldThresholds: 'Level thresholds (5)',
      predictLayer: 'Predicted',
      actualLayer: 'Actual',
      levelTitle: 'Level {n}',
      save: 'Save & recompute',
      savedDays: {
        one: 'Saved and recomputed the busyness snapshot for {n} day',
        other: 'Saved and recomputed the busyness snapshot for {n} days',
      },
    },

    reminder: {
      sectionTitle: 'Daily reminder',
      desc: 'At the set time, if any planned to-dos for today are still unfinished, a quiet banner appears at the top of the app. Off by default.',
      enable: 'Enable daily reminder',
      fieldTime: 'Reminder time',
    },

    sync: {
      sectionTitle: 'Data sync',
      desc: 'Sync all data (to-dos, coloring, anniversaries, settings) across computers through your own private GitHub repository. Data is stored in plaintext in your repository; the PAT is encrypted with Windows DPAPI and never uploaded. See docs/SYNC_SETUP.md for setup steps.',
      decisionPrompt: 'The remote repository already has {n} rows of data, while this computer is being bound for the first time. How should we proceed?',
      resolveMerge: 'Merge both sides and upload (recommended)',
      resolveOverwrite: 'Overwrite local with remote',
      lastSyncOk: '✓ Last synced at {time}',
      lastSyncWarn: '⚠ Last synced at {time}',
      lastSyncNever: 'Never synced',
      notConfigured: 'Not configured',
      fieldRepo: 'Repository (owner/repo)',
      fieldBranch: 'Branch',
      patLabel: 'PAT ({state})',
      patStored: 'stored; leave blank to keep',
      patMissing: 'fine-grained, see the setup guide',
      autoOnStart: 'Sync once automatically at startup',
      syncOnClose: 'Sync automatically before closing (clicking the window ✕ syncs first, then exits)',
      test: 'Test connection',
      testing: 'Testing…',
      syncNow: 'Sync now',
      syncing: 'Syncing…',
      savedMsg: 'Saved',
      initDone: {
        one: 'First-time initialization complete: uploaded {n} row',
        other: 'First-time initialization complete: uploaded {n} rows',
      },
      report: 'Pulled {pulled} · Pushed {pushed} · Conflicts {conflicts} · Deleted {deleted}',
      reportWarning: ' ({warning})',
      resolvedDone: 'Binding complete: {report}',
    },
  },
} as const
