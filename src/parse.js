// 来源资料解析：原始记录中数字、日期、标记均为字符串，问号表示缺失值。
// 本模块只负责读取与类型转换，业务判定放在后续模块，保证可重复重放。

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const MISSING = '?'
export const TABLE_NAMES = [
  'green', 'roasts', 'cups', 'labels', 'work',
  'splits', 'shipments', 'channels', 'blends', 'review_actions',
]

export function num(value) {
  if (value === MISSING || value === undefined || value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`无法把值 ${JSON.stringify(value)} 解析为数字`)
  }
  return n
}

export function isMissing(value) {
  return value === MISSING || value === undefined || value === null
}

// 来源系统用加号保存组合编号（如 F1+F3）
export function splitRefs(value) {
  if (isMissing(value)) return []
  return String(value).split('+').map(s => s.trim()).filter(Boolean)
}

export async function loadData(dir) {
  const tables = {}
  const base = resolve(dir)
  for (const name of TABLE_NAMES) {
    tables[name] = JSON.parse(await readFile(`${base}/${name}.json`, 'utf8'))
  }
  return tables
}

// 引用核对：只报告不直接崩溃，因为召回场景里被混批引用的成品可能已无生产记录。
export function validateRefs(tables) {
  const warnings = []
  const greenLots = new Set(tables.green.map(r => r.lot))
  const blindSet = new Set(tables.roasts.map(r => r.blind))
  const labels = new Set(tables.labels.map(r => r.label))
  const finished = new Set(tables.work.map(r => r.finished).filter(v => !isMissing(v)))
  const packages = new Set(tables.shipments.map(r => r.package))

  for (const r of tables.green) {
    if (!isMissing(r.split_parent) && !greenLots.has(r.split_parent)) {
      warnings.push(`green.${r.lot} 的母批 ${r.split_parent} 不存在`)
    }
  }
  for (const r of tables.roasts) {
    for (const key of ['lot_a', 'lot_b']) {
      if (!greenLots.has(r[key])) warnings.push(`roasts.${r.test} 的 ${key}=${r[key]} 无豆批记录`)
    }
  }
  for (const r of tables.cups) {
    if (!blindSet.has(r.blind)) warnings.push(`cups.${r.blind}/${r.judge}/${r.rep} 的盲评号无试烘记录`)
  }
  for (const r of tables.work) {
    if (!labels.has(r.label)) warnings.push(`work.${r.order} 的标注 ${r.label} 不存在`)
    for (const key of ['lot_a', 'lot_b']) {
      if (!greenLots.has(r[key])) warnings.push(`work.${r.order} 的 ${key}=${r[key]} 无豆批记录`)
    }
  }
  for (const r of tables.splits) {
    if (!greenLots.has(r.parent)) warnings.push(`splits 母批 ${r.parent} 不存在`)
    if (!greenLots.has(r.child)) warnings.push(`splits 子批 ${r.child} 不存在`)
  }
  for (const r of tables.shipments) {
    if (!finished.has(r.finished)) warnings.push(`shipments.${r.package} 的成品 ${r.finished} 无生产记录`)
    if (!labels.has(r.label)) warnings.push(`shipments.${r.package} 的标注 ${r.label} 不存在`)
  }
  for (const r of tables.channels) {
    if (!packages.has(r.package) && !finished.has(r.package)) {
      warnings.push(`channels.${r.channel} 的包装/成品 ${r.package} 无记录`)
    }
    if (!labels.has(r.label)) warnings.push(`channels.${r.channel} 的标注 ${r.label} 不存在`)
  }
  for (const r of tables.blends) {
    for (const f of splitRefs(r.uses)) {
      if (!finished.has(f)) warnings.push(`blends.${r.blend} 引用的成品 ${f} 无生产记录`)
    }
  }
  return warnings
}
