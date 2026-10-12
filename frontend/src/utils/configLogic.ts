/**
 * 设置对话框的纯逻辑。
 *
 * 抽出来的原因与 utils/todoLogic.ts 相同：充实度权重编辑器要能改任意层级的数值
 * （['weights','complexity','high']），这类按路径寻址的代码写错时报错发生在
 * 几十行之后的渲染里，没有测试就只能靠肉眼。而它本来只是一个纯函数。
 */

/**
 * 按路径不可变地写入一个数值。
 *
 * - 非数字输入（空串、字母、非法浮点）返回**原对象引用**，由调用方据此跳过 setState
 *   ——这正是原实现用 NaN 守卫的语义：输入框清空时不该把 0 写进去。
 * - 路径上不存在的层级不做隐式创建：cur 会拿到 undefined 并在下一轮解引用时抛错，
 *   这比悄悄造出半个结构更安全——错误该在开发期暴露，而不是在用户保存后。
 * - 不修改入参（内部走 structuredClone）。
 */
export function setNumberAtPath<T>(obj: T, path: (string | number)[], raw: string): T {
  const n = Number(raw)
  if (Number.isNaN(n)) return obj
  const next = structuredClone(obj)
  let cur = next as unknown as Record<string | number, unknown>
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]] as Record<string | number, unknown>
  }
  cur[path[path.length - 1]] = n
  return next
}

/** 深比较两个配置对象是否等价（按 JSON 序列化比较，用于「保存」按钮的脏检查）。 */
export function configChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}