// 追溯与召回：证据 → 试烘 → 候选 → 订单 → 成品 → 包装 → 渠道的一条链，
// 以及混配后的不可逆规则。
//
// 渠道口径：
// - 只拿过生产总批号的渠道（总批），在其确认实际子批前，按总批最小可追溯范围整体停用标注；
// - 记录子批的渠道可精确到包装；
// - 与本次证据无关的姐妹批（其他成品批/其他标注）继续交付。
// 混配口径：
// - 已混且不能拆回的库存，不因子批合格而重新获得标注份额；
// - 状态为「可拆」的混配允许拆回，拆回不产生新的合格公斤数（由守恒检查兜底）。

import { isMissing, num, splitRefs } from './parse.js'

// 受一个或多个盲评号影响的完整证据链
export function traceByBlinds(tables, blinds) {
  const blindSet = new Set(blinds)
  const tests = tables.roasts.filter(r => blindSet.has(r.blind)).map(r => r.test)
  const orders = tables.work.filter(w =>
    tables.roasts.some(r => blindSet.has(r.blind) &&
      r.lot_a === w.lot_a && r.lot_b === w.lot_b &&
      num(r.ratio_a) === num(w.ratio_a) && r.profile === '中'))
  const finished = orders.map(w => w.finished).filter(f => !isMissing(f))
  const packages = tables.shipments.filter(s => finished.includes(s.finished))
  const blendLinks = []
  for (const z of tables.blends) {
    const hit = splitRefs(z.uses).filter(f => finished.includes(f))
    if (hit.length) blendLinks.push({ blend: z.blend, state: z.state, packaging: z.packaging, touchedFinished: hit })
  }
  const channelHits = tables.channels.filter(c =>
    packages.some(p => p.package === c.package) ||
    finished.includes(c.package))
  return { blinds: [...blindSet], tests, orders: orders.map(w => w.order), finished, packages, blendLinks, channelHits }}

// 一次标注复核的完整处置面
export function reviewImpact(tables, affectedBlinds, label) {
  const trace = traceByBlinds(tables, affectedBlinds)
  const finishedSet = new Set(trace.finished)

  const packageActions = trace.packages.map(p => {
    const inBlend = trace.blendLinks.some(b => b.packaging === p.package)
    let action
    if (p.label !== label) action = '无关包装，继续出货'
    else if (p.state === '已发') action = '已离厂：纳入渠道更正名单'
    else if (inBlend) action = '已混入不可拆库存：停用标注，不得重新声明'
    else action = '待发：停止使用该标注，留在厂内复核'
    return { package: p.package, finished: p.finished, weight: num(p.weight), state: p.state, label: p.label, action }
  })

  const blendActions = trace.blendLinks.map(b => ({
    blend: b.blend,
    packaging: b.packaging,
    state: b.state,
    action: b.state === '可拆'
      ? '允许拆回复核；拆回不产生新的合格公斤数'
      : '已混不可拆：该份额永久退出该标注，母批其他合格子批不受影响',
  }))

  // 渠道处置：总批口径在确认子批前按最小可追溯范围整体停用
  const channelActions = trace.channelHits.map(c => {
    const relatedPackage = trace.packages.find(p => p.package === c.package)
    let scope
    let action
    if (c.label !== label) {
      scope = '无关标注'
      action = '姐妹批/其他标注不受影响，继续交付'
    } else if (c.declared === '子批') {
      scope = `子批 ${c.package}`
      action = c.delivered === 'true' ? '已交付：发送该子批的标注更正' : '未交付：待发包装停用标注，无需更正'
    } else {
      const f = c.package
      scope = `总批 ${f} 下全部包装`
      action = c.delivered === 'true'
        ? '已交付且仅记录总批号：按总批最小范围停用标注，渠道确认实际子批前均需更正'
        : '未交付：总批待发库存整体停用，待确认子批后缩小范围'
    }
    return { channel: c.channel, declared: c.declared, package: c.package, label: c.label, delivered: c.delivered, scope, action }
  })

  // 无关姐妹成品批：显式放行，便于生产侧对照
  const unaffected = tables.work
    .filter(w => !isMissing(w.finished) && !finishedSet.has(w.finished))
    .map(w => ({ finished: w.finished, order: w.order, label: w.label, action: '与本次证据无关，继续出货' }))

  return { label, trace, packageActions, blendActions, channelActions, unaffected }
}

// 渠道确认实际子批后缩小停用范围
export function narrowByChannelConfirmation(impact, channel, confirmedPackage) {
  const copy = structuredClone(impact)
  const row = copy.channelActions.find(c => c.channel === channel)
  if (!row) throw new Error(`渠道 ${channel} 不在受影响名单内`)
  if (row.declared !== '总批') return copy
  row.scope = `已确认子批 ${confirmedPackage}`
  row.action = row.delivered === 'true'
    ? `仅对子批 ${confirmedPackage} 发送更正，总批下其他包装恢复标注`
    : `仅扣留子批 ${confirmedPackage}，其余待发包装恢复出货`
  for (const p of copy.packageActions) {
    if (p.finished === row.package && p.package !== confirmedPackage && p.state === '待发' && p.label === copy.label) {
      p.action = '渠道确认未拿该子批：恢复出货'
    }
  }
  return copy
}
