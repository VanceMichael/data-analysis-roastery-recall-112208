// 复评事件：换豆、试烘复评（含撤回）、找回样、重新装包、渠道收悉的统一入口。
// 设计为纯函数重放：给定某时刻的资料和事件清单，重复评估得到相同结论；
// 新原料或返测进入后，重新跑同一套问题即可。

import { num } from './parse.js'
import { buildCandidates } from './evidence.js'
import { evaluateCandidates } from './labels.js'
import { buildLotLedger } from './availability.js'
import { evaluateOrders } from './work.js'
import { reviewImpact, narrowByChannelConfirmation, traceByBlinds } from './traceability.js'

// 杯测撤回/找回对候选边界的影响：direction=withdraw 切向撤回，recover 切向记入。
// 同一盲评号存在多版本时，只作用于版本号最大的那一组记录。
export function withdrawalBoundary(tables, targetBlind, label, direction = 'withdraw') {
  const before = snapshot(tables)
  const versions = tables.cups.filter(c => c.blind === targetBlind).map(c => Number(c.version))
  const latestVersion = versions.length ? String(Math.max(...versions)) : null
  const toggled = {
    ...tables,
    cups: tables.cups.map(c => {
      if (c.blind !== targetBlind) return c
      if (latestVersion !== null && c.version !== latestVersion) return c
      return { ...c, state: direction === 'withdraw' ? '撤回' : '记入' }
    }),
  }
  const after = snapshot(toggled)
  const flips = []
  for (const b of before.evaluated) {
    const a = after.evaluated.find(x => x.candidate.key === b.candidate.key)
    const lb = b.results.find(r => r.label === label)
    const la = a.results.find(r => r.label === label)
    if (lb.claimable !== la.claimable || lb.status !== la.status) {
      flips.push({ candidate: b.candidate.key, from: lb.status, to: la.status, wasClaimable: lb.claimable, nowClaimable: la.claimable })
    }
  }
  return { targetBlind, label, flips, before, after }
}

export function snapshot(tables) {
  const candidates = buildCandidates(tables.roasts, tables.cups)
  const evaluated = evaluateCandidates(candidates, tables.labels)
  const ledger = buildLotLedger(tables)
  const orders = evaluateOrders(tables, candidates, evaluated, ledger)
  return { candidates, evaluated, ledger, orders }
}

// 新标注结果的三类分流
export function triageNewFinding(tables, event) {
  const { kind, ref } = event
  if (kind === '撤回杯测' || kind === '复评') {
    const label = event.label ?? tables.work.find(w =>
      tables.roasts.some(r => r.blind === ref && r.lot_a === w.lot_a && r.lot_b === w.lot_b &&
        num(r.ratio_a) === num(w.ratio_a)))?.label ?? tables.labels[0]?.label
    const diff = withdrawalBoundary(tables, ref, label, 'withdraw')
    const needsRedeclare = diff.flips.some(f => f.wasClaimable && !f.nowClaimable)
    const impact = needsRedeclare ? reviewImpact(tables, [ref], label) : null
    return {
      kind,
      ref,
      category: needsRedeclare ? '需要重新作声明' : '需要常规补试',
      flips: diff.flips,
      openOrderReplan: needsRedeclare ? replanOpenOrders(diff.after.orders) : [],
      channelCorrections: impact ? impact.channelActions.filter(c => c.delivered === 'true' && c.label === label) : [],
    }
  }
  if (kind === '找回样') {
    // 找回的盲评按重新记入评估：可能恢复或新增可声明范围
    const label = event.label ?? tables.labels[0]?.label
    const diff = withdrawalBoundary(tables, ref, label, 'recover')
    const gained = diff.flips.filter(f => !f.wasClaimable && f.nowClaimable)
    return {
      kind,
      ref,
      category: gained.length ? '需要重新作声明（恢复可声明范围）' : '需要常规补试',
      flips: diff.flips,
    }
  }
  if (kind === '新原料') {
    const diff = withdrawalBoundary(tables, ref, event.label ?? tables.labels[0]?.label, 'recover')
    const gained = diff.flips.filter(f => !f.wasClaimable && f.nowClaimable)
    return {
      kind,
      ref,
      category: gained.length ? '需要重新作声明（新增可声明范围）' : '需要常规补试',
      flips: diff.flips,
    }
  }
  if (kind === '换豆') {
    const snap = snapshot(tables)
    const order = snap.orders.find(o => o.order === ref)
    return {
      kind,
      ref,
      category: order && order.evidenceState === '未试到' ? '需要常规补试' : '需要重新作声明',
      order: order ? { order: order.order, evidenceState: order.evidenceState, alternatives: order.alternatives.map(a => a.candidate) } : null,
    }
  }
  if (kind === '重新装包') {
    const trace = traceByBlinds(tables, event.blinds ?? [])
    return {
      kind,
      ref,
      category: '需要常规补试',
      note: '装包拆分不产生新的合格公斤数，合格份额以原成品批为限',
      affectedPackages: trace.packages.map(p => p.package),
    }
  }
  if (kind === '渠道收悉' || kind === '收悉') {
    const channelRow0 = tables.channels.find(c => c.channel === ref)
    const label = event.label ?? channelRow0?.label
    // 由渠道记录的包装/总批反查成品，再沿试烘组成反查盲评
    const finishedSet = new Set()
    if (channelRow0) {
      if (tables.work.some(w => w.finished === channelRow0.package)) finishedSet.add(channelRow0.package)
      for (const s of tables.shipments.filter(s => s.package === channelRow0.package)) finishedSet.add(s.finished)
    }
    const blinds = tables.roasts.filter(r =>
      tables.work.some(w => finishedSet.has(w.finished) &&
        r.lot_a === w.lot_a && r.lot_b === w.lot_b && num(r.ratio_a) === num(w.ratio_a))).map(r => r.blind)
    const baseImpact = reviewImpact(tables, blinds, label)
    const narrowed = event.confirmedPackage
      ? narrowByChannelConfirmation(baseImpact, ref, event.confirmedPackage)
      : baseImpact
    const channelRow = narrowed.channelActions.find(c => c.channel === ref)
    return {
      kind: '渠道收悉',
      ref,
      category: '需给已收到旧版本的确切渠道作更正',
      channel: channelRow ?? { channel: ref, note: '当前证据复核未波及该渠道，维持原标注' },
    }
  }
  return { kind, ref, category: '需要常规补试', note: '未知事件类型，按补试处理' }
}

function replanOpenOrders(orders) {
  return orders
    .filter(o => !o.locked)
    .map(o => ({
      order: o.order,
      label: o.label,
      weight: o.weight,
      instruction: o.reasons.length === 0
        ? '保留未投料量给该可标注订单'
        : o.alternatives.length
          ? `改投 ${o.alternatives[0].candidate}`
          : '未投料量不再承诺该标注，候补试烘优先',
    }))
}

// 重放资料中的 review_actions 历史，输出每个确认发生时改变的指示
export function replayReviewActions(tables) {
  return tables.review_actions.map(a => {
    const event = { kind: a.kind, ref: a.ref, detail: a.detail, at: a.at }
    let result
    try {
      result = triageNewFinding(tables, event)
    } catch (err) {
      result = { category: '需要常规补试', error: err.message }
    }
    return { at: a.at, ...event, result }
  })
}
