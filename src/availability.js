// 豆批实物台账。
// green.stock 是「开始投料前的实有重量」，母批重量包含已拆分子批数量，
// 因此母批可用量要先扣除已拆分公斤数；已投料（含已包装）订单按实际配比消耗，
// 未投料订单尚未形成事实消耗，只作为待承诺量展示。

import { isMissing, num, splitRefs } from './parse.js'

const r2 = n => Math.round(n * 100) / 100

export function buildLotLedger(tables) {
  const { green, work, splits } = tables
  const splitOut = new Map()
  for (const s of splits) {
    if (s.state !== '已分') continue
    splitOut.set(s.parent, (splitOut.get(s.parent) ?? 0) + num(s.kg))
  }

  const ledger = new Map()
  for (const g of green) {
    const initial = num(g.stock)
    const splitKg = splitOut.get(g.lot) ?? 0
    ledger.set(g.lot, {
      lot: g.lot,
      origin: g.origin,
      grade: g.grade,
      split_parent: isMissing(g.split_parent) ? null : g.split_parent,
      initial,
      split_out: splitKg,
      consumed: 0,
      consumedBy: [],
      committedOpen: 0,
      committedBy: [],
      available: r2(initial - splitKg),
    })
  }

  // 已投料/已包装是事实消耗；未投料不扣实物
  for (const w of work) {
    if (w.state === '未投料') {
      const row = ledger.get(w.lot_a)
      if (row) {
        row.committedOpen += r2(num(w.weight) * num(w.ratio_a))
        row.committedBy.push({ order: w.order, kg: r2(num(w.weight) * num(w.ratio_a)) })
      }
      const rowB = ledger.get(w.lot_b)
      if (rowB) {
        const kgB = r2(num(w.weight) * (1 - num(w.ratio_a)))
        rowB.committedOpen += kgB
        rowB.committedBy.push({ order: w.order, kg: kgB })
      }
      continue
    }
    const kgA = r2(num(w.weight) * num(w.ratio_a))
    const kgB = r2(num(w.weight) * (1 - num(w.ratio_a)))
    for (const [lot, kg] of [[w.lot_a, kgA], [w.lot_b, kgB]]) {
      const row = ledger.get(lot)
      if (row) {
        row.consumed = r2(row.consumed + kg)
        row.consumedBy.push({ order: w.order, kg, state: w.state })
      }
    }
  }

  for (const row of ledger.values()) {
    row.available = r2(row.initial - row.split_out - row.consumed)
    row.committedOpen = r2(row.committedOpen)
  }
  return ledger
}

// 按某配比生产 weight 公斤是否有足够实物
export function canFulfill(ledger, lotA, lotB, ratioA, weight) {
  const needA = r2(num(weight) * num(ratioA))
  const needB = r2(num(weight) * (1 - num(ratioA)))
  const a = ledger.get(lotA)
  const b = ledger.get(lotB)
  const short = []
  if (!a || a.available < needA) short.push({ lot: lotA, need: needA, available: a ? a.available : 0 })
  if (!b || b.available < needB) short.push({ lot: lotB, need: needB, available: b ? b.available : 0 })
  return {
    feasible: short.length === 0,
    need: { lot_a: needA, lot_b: needB },
    short,
  }
}

// 混配/换包装守恒核对：拆分与再包装不得产生新的合格公斤数
export function conservationCheck(tables) {
  const issues = []
  const workWeight = new Map()
  for (const w of tables.work) {
    if (isMissing(w.finished)) continue
    workWeight.set(w.finished, (workWeight.get(w.finished) ?? 0) + num(w.weight))
  }
  const shippedByFinished = new Map()
  for (const s of tables.shipments) {
    shippedByFinished.set(s.finished, (shippedByFinished.get(s.finished) ?? 0) + num(s.weight))
  }
  for (const [f, shipped] of shippedByFinished) {
    const produced = workWeight.get(f)
    if (produced === undefined) {
      issues.push(`成品 ${f} 有发货包装但无生产记录`)
    } else if (r2(shipped) > r2(produced) + 1e-9) {
      issues.push(`成品 ${f} 包装累计 ${shipped}kg 超过产量 ${produced}kg，出现了多余合格公斤数`)
    }
  }
  for (const z of tables.blends) {
    const inputs = splitRefs(z.uses)
      .map(f => workWeight.get(f))
      .filter(v => v !== undefined)
    const totalIn = r2(inputs.reduce((a, b) => a + b, 0))
    if (totalIn > 0 && num(z.weight) > totalIn + 1e-9) {
      issues.push(`混配 ${z.blend} 产出 ${z.weight}kg 超过投入成品 ${totalIn}kg`)
    }
  }
  return issues
}
