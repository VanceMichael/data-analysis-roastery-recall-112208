// 采购候补试烘表：优先补「能明确改变当前出货或声明」的候选。
// 优先级：
// 1) 有在途订单（尤其已投料事实批）因「未试到/证据不足」被挡住，补一天即可达 min_days；
// 2) 未投料订单无替代方案；
// 3) 仅拓宽声明范围的探索性配比。

import { num } from './parse.js'
import { candidateKey } from './evidence.js'

export function backupTrialPlan(tables, snapshot) {
  const rows = []
  const push = (priority, reason, w, label) => {
    const labelDef = tables.labels.find(l => l.label === label)
    if (!labelDef) throw new Error(`候补试烘引用了不存在的档案 ${label}`)
    const minDays = num(labelDef.min_days)
    const key = candidateKey({ lot_a: w.lot_a, lot_b: w.lot_b, ratio_a: num(w.ratio_a), profile: '中' })
    const existing = snapshot.candidates.find(c => c.key === key)
    const days = existing ? existing.dayCount : 0
    const flavorPass = existing
      ? existing.fruit.mean >= num(labelDef.fruit_min) &&
        existing.bitter.mean <= num(labelDef.bitter_max) &&
        existing.fruit.range <= num(labelDef.range_max) &&
        existing.bitter.range <= num(labelDef.range_max)
      : null
    const additional = Math.max(0, minDays - days)
    rows.push({
      priority,
      order: w.order,
      label,
      candidate: key,
      lot_a: w.lot_a,
      lot_b: w.lot_b,
      ratio_a: num(w.ratio_a),
      profile: '中',
      reason,
      independentDaysNow: days,
      minDaysRequired: minDays,
      // 需要补的独立试烘日数；风味已过线时补日数即可解锁
      additionalDaysNeeded: additional,
      flavorAlreadyWithinSpec: flavorPass,
      unlockEffect: additional === 0
        ? '风味复核通过即可声明'
        : `补足 ${additional} 个独立试烘日且风味在限内即可声明`,
    })
  }

  for (const o of snapshot.orders) {
    const w = tables.work.find(x => x.order === o.order)
    if (o.evidenceState === '合格') continue
    if (o.locked && (o.evidenceState === '未试到' || o.evidenceState === '证据不足')) {
      push(1, `已投料/已包装事实批 ${o.order} 缺少可支撑标注 ${o.label} 的证据`, w, o.label)
    } else if (!o.locked && o.evidenceState === '未试到' && o.alternatives.length === 0) {
      push(2, `未投料订单 ${o.order} 无合格替代候选，补试可直接恢复出货选择`, w, o.label)
    } else if (!o.locked && (o.evidenceState === '证据不足' || o.evidenceState === '未试到')) {
      push(3, `未投料订单 ${o.order} 的补试可拓宽可声明范围`, w, o.label)
    }
  }

  // 探索性配比：暂无订单、但补试能拓宽可声明范围
  const listed = new Set(rows.map(r => r.candidate))
  for (const e of snapshot.evaluated) {
    if (listed.has(e.candidate.key)) continue
    const weak = e.results.find(r => r.status === '证据不足' || r.status === '超限且证据不足')
    if (!weak) continue
    const [lotA, lotB, ratio, profile] = e.candidate.key.split('|')
    const minDays = num(tables.labels.find(l => l.label === weak.label).min_days)
    const additional = Math.max(0, minDays - e.candidate.dayCount)
    rows.push({
      priority: 4,
      order: null,
      label: weak.label,
      candidate: e.candidate.key,
      lot_a: lotA,
      lot_b: lotB,
      ratio_a: num(ratio),
      profile,
      reason: '探索性配比，补独立试烘日可拓宽声明范围',
      independentDaysNow: e.candidate.dayCount,
      minDaysRequired: minDays,
      additionalDaysNeeded: additional,
      flavorAlreadyWithinSpec: !weak.failures.some(x => x.code !== 'MIN_DAYS'),
      unlockEffect: `补足 ${additional} 个独立试烘日可评估档案 ${weak.label}`,
    })
  }
  return rows.sort((a, b) => a.priority - b.priority || b.additionalDaysNeeded - a.additionalDaysNeeded)
}

// 生产侧按豆批或成品批查询
export function queryByLot(snapshot, tables, lotId) {
  const lot = snapshot.ledger.get(lotId)
  if (!lot) return null
  const relatedOrders = snapshot.orders.filter(o =>
    o.composition.lot_a === lotId || o.composition.lot_b === lotId)
  const evidence = snapshot.candidates.filter(c => c.lot_a === lotId || c.lot_b === lotId)
    .map(c => ({ candidate: c.key, days: c.dayCount, blinds: c.blinds }))
  return {
    type: '豆批',
    id: lotId,
    physical: {
      initial: lot.initial,
      split_out: lot.split_out,
      consumed: lot.consumed,
      available: lot.available,
      committedOpen: lot.committedOpen,
    },
    evidenceSources: evidence,
    orders: relatedOrders.map(o => ({
      order: o.order, state: o.state, evidenceState: o.evidenceState,
      blockedReasons: o.reasons, decision: o.decision,
    })),
    pendingScope: classifyPending(relatedOrders),
  }
}

export function queryByFinished(snapshot, tables, finishedId) {
  const w = tables.work.find(x => x.finished === finishedId)
  if (!w) return null
  const order = snapshot.orders.find(o => o.order === w.order)
  const packages = tables.shipments.filter(s => s.finished === finishedId)
  const blends = tables.blends.filter(z => z.uses.split('+').includes(finishedId))
  const channels = tables.channels.filter(c => c.package === finishedId ||
    packages.some(p => p.package === c.package))
  return {
    type: '成品批',
    id: finishedId,
    order: w.order,
    label: w.label,
    produced: num(w.weight),
    evidenceState: order.evidenceState,
    blockedReasons: order.reasons,
    packages: packages.map(p => ({ package: p.package, weight: num(p.weight), state: p.state, label: p.label })),
    blends: blends.map(z => ({ blend: z.blend, state: z.state, packaging: z.packaging })),
    channels: channels.map(c => ({ channel: c.channel, declared: c.declared, package: c.package, delivered: c.delivered })),
    pendingScope: classifyPending([order]),
  }
}

function classifyPending(orders) {
  const out = { 原料不足: [], 未试到: [], 风味证据失效: [] }
  for (const o of orders) {
    for (const r of o.reasons) {
      const key = r === '证据不足' ? '未试到' : r
      if (out[key]) out[key].push(o.order)
    }
  }
  return out
}
