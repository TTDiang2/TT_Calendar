// 把本轮新增的 i18n key 追加到四份 TSV（zh-Hant / fr / es / ru），已存在则跳过。
// 追加后由 scripts/gen_dict.ts 重新生成 dict，结构测试会校验路径集合与 zh-CN 完全一致。
import { readFileSync, writeFileSync } from 'node:fs'

const KEYS = [
  'calendar.allDay',
  'calendar.noPlans',
  'calendar.untimed',
  'calendar.scheduleUnit',
  'calendar.eventUnit',
  'calendar.moreItems',
  'todoboards.matrix.axisHint',
  'todoboards.kanban.dropHere',
  'todoboards.kanban.openCount',
  'todoboards.jar.capacity',
  'todoboards.jar.loadLabel',
  'todoboards.jar.cellUnit',
  'todoboards.jar.overCapacity',
]

const VALUES = {
  'zh-Hant': [
    '全天', '無安排', '未定時間', '項日程', '個事件', '+{n}',
    '縱軸重要 · 橫軸緊急', '拖到此處', '項未完成',
    '容量', '裝載', '格', '超出 {n} 件',
  ],
  fr: [
    'Toute la journée', 'Rien de prévu', 'Horaire à définir', 'rendez-vous', 'événements', '+{n}',
    'Vertical : importance · Horizontal : urgence', 'Déposer ici', 'en cours',
    'Capacité', 'Chargé', 'cases', '{n} en trop',
  ],
  es: [
    'Todo el día', 'Sin planes', 'Sin hora', 'citas', 'eventos', '+{n}',
    'Vertical: importancia · Horizontal: urgencia', 'Suelta aquí', 'pendientes',
    'Capacidad', 'Cargado', 'casillas', '{n} de más',
  ],
  ru: [
    'Весь день', 'Ничего не запланировано', 'Время не задано', 'записи', 'события', '+{n}',
    'Вертикаль: важность · Горизонталь: срочность', 'Перетащите сюда', 'открыто',
    'Ёмкость', 'Загружено', 'клеток', 'перебор {n}',
  ],
}

for (const [lang, vals] of Object.entries(VALUES)) {
  const file = `i18n_flat.${lang}.tsv`
  const text = readFileSync(file, 'utf8')
  const have = new Set(text.split(/\r?\n/).map((l) => l.split('\t')[0]))
  const add = KEYS.map((k, i) => `${k}\t${vals[i]}`).filter((line) => !have.has(line.split('\t')[0]))
  if (add.length === 0) {
    console.log(`${lang}: 无需追加`)
    continue
  }
  const sep = text.endsWith('\n') ? '' : '\n'
  writeFileSync(file, `${text}${sep}${add.join('\n')}\n`, 'utf8')
  console.log(`${lang}: 追加 ${add.length} 条`)
}
