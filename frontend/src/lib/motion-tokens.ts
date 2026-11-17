import type { Transition } from 'framer-motion'

/**
 * 动效曲线取自 EasyUI（MIT）的 motion-tokens，按我们这边的节奏做了少量裁剪。
 * 原则：接近临界阻尼，不弹跳；短促、跟手，适合桌面效率工具。
 */
export const springGentle: Transition = {
  type: 'spring',
  stiffness: 170,
  damping: 26,
  mass: 0.9,
}

export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 30,
  mass: 0.5,
}

export const springMorph: Transition = {
  type: 'spring',
  stiffness: 220,
  damping: 32,
  mass: 1.0,
}

/**
 * 右抽屉的收放：动的是宽度（288px），所以要比普通元素切换更「跟手」——
 * 临界阻尼（阻尼比略大于 1）不弹跳，收尾干净；太快会显得硬，太慢会拖住主区布局。
 */
export const springDrawer: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 36,
  mass: 0.8,
}
