// 生产批可兑现性：试烘证据 + 实物台账一起判断。
// 规则：
// - 标注只认「与订单完全相同的两支豆批 + 配比 + 烘焙档案」的候选证据，
//   同产区同规格的新豆批没有对应证据时按「未试到」处理；
// - 已投料/已包装的实际组成是事实，不可替换，只能复核或召回；
// - 未投料订单允许换批/换配比，可替换项单独给出；
// - 不能兑现分三种：原料不足 / 未试到 / 风味证据失效（超限或撤回后失去支撑）。

import { isMissing, num } from './parse.js'
import { candidateKey } from './evidence.js'
import { canFulfill } from './availability.js'

export function evaluateOrders(tables, candidates, evaluated, ledger) {
  const evalByKey = new Map(evaluated.map(e => [e.candidate.key, e]))

  return tables.work.map(w => {
    const key = candidateKey({ lot_a: w.lot_a, lot_b: w.lot_b, ratio_a: num(w.ratio_a), profile: '中' })
    const cand = candidates.find(c => c.key === key)
    const evidence = cand ? evalByKey.get(key) : null
    const labelResult = evidence ? evidence.results.find(r => r.label === w.label) : null

    const material = canFulfill(ledger, w.lot_a, w.lot_b, num(w.ratio_a), num(w.weight))
    const locked = w.state !== '未投料'

    let evidenceState
    if (!cand || cand.trialCount === 0) evidenceState = '未试到'
    else if (labelResult && labelResult.claimable) evidenceState = '合格'
    else if (labelResult && labelResult.status.includes('超限')) evidenceState = '风味证据失效'
    else evidenceState = '证据不足'

    const reasons = []
    if (!material.feasible) reasons.push('原料不足')
    if (evidenceState === '未试到') reasons.push('未试到')
    if (evidenceState === '风味证据失效' || evidenceState === '证据不足') reasons.push(evidenceState)

    let decision
    if (locked) {
      decision = reasons.length === 0
        ? '可按现标注出货'
        : `事实投料不可替换：${reasons.join('、')}，转复核/召回流程`
    } else {
      decision = reasons.length === 0
        ? '可投料并使用标注'
        : `暂缓投料：${reasons.join('、')}`
    }

    // 未投料订单的可替换方案：证据合格且实物够的其他候选，同标注
    const alternatives = []
    if (!locked) {
      for (const e of evaluated) {
        if (e.candidate.key === key) continue
        const r = e.results.find(x => x.label === w.label)
        if (!r || !r.claimable) continue
        const alt = canFulfill(ledger, e.candidate.lot_a, e.candidate.lot_b, e.candidate.ratio_a, num(w.weight))
        if (alt.feasible) {
          alternatives.push({
            candidate: e.candidate.key,
            lot_a: e.candidate.lot_a,
            lot_b: e.candidate.lot_b,
            ratio_a: e.candidate.ratio_a,
            profile: e.candidate.profile,
            need: alt.need,
          })
        }
      }
    }

    return {
      order: w.order,
      state: w.state,
      locked,
      finished: isMissing(w.finished) ? null : w.finished,
      label: w.label,
      weight: num(w.weight),
      composition: { lot_a: w.lot_a, lot_b: w.lot_b, ratio_a: num(w.ratio_a), profile: '中' },
      candidateKey: key,
      evidenceState,
      labelCheck: labelResult ? {
        status: labelResult.status,
        failures: labelResult.failures,
      } : null,
      material,
      reasons,
      decision,
      alternatives,
    }
  })
}

// 未投料量该留给哪些可标注订单：撤回等事件后重算
export function allocatableOpenOrders(orderEvals, ledger) {
  const plan = []
  for (const o of orderEvals) {
    if (o.locked) continue
    if (o.reasons.length === 0) {
      plan.push({ order: o.order, label: o.label, weight: o.weight, action: '保留库存，可投料' })
    } else if (o.alternatives.length > 0) {
      plan.push({ order: o.order, label: o.label, weight: o.weight, action: '改用合格候选', preferred: o.alternatives[0].candidate })
    } else {
      plan.push({ order: o.order, label: o.label, weight: o.weight, action: '库存不承诺，等待候补试烘或补料' })
    }
  }
  return plan
}
