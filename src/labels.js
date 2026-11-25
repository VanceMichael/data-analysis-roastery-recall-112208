// 档案判定：成品必须同时满足下限、上限、重复跨度、独立试烘日数。
// 单项平均分高不能抵消另一项超限；证据不足与风味超限分别列示。
// 没有足够证据的配比只能进入下一轮试烘候选，不能直接形成销售声明。

import { num } from './parse.js'

export function evaluateAgainstLabel(candidate, label) {
  const failures = []
  const checks = []

  const pushCheck = (code, name, actual, limit, pass) => {
    checks.push({ code, name, actual, limit, pass })
    if (!pass) failures.push({ code, name, actual, limit })
  }

  if (candidate.fruit.mean === null) {
    pushCheck('NO_EVIDENCE', '无有效杯测', null, null, false)
  } else {
    pushCheck('FRUIT_MIN', '果香均值下限', round(candidate.fruit.mean), num(label.fruit_min),
      candidate.fruit.mean >= num(label.fruit_min))
    pushCheck('BITTER_MAX', '苦感均值上限', round(candidate.bitter.mean), num(label.bitter_max),
      candidate.bitter.mean <= num(label.bitter_max))
    pushCheck('FRUIT_RANGE', '果香重复跨度', round(candidate.fruit.range), num(label.range_max),
      candidate.fruit.range <= num(label.range_max))
    pushCheck('BITTER_RANGE', '苦感重复跨度', round(candidate.bitter.range), num(label.range_max),
      candidate.bitter.range <= num(label.range_max))
  }
  pushCheck('MIN_DAYS', '独立试烘日数', candidate.dayCount, num(label.min_days),
    candidate.dayCount >= num(label.min_days))

  const overLimit = failures.some(f => ['FRUIT_MIN', 'BITTER_MAX', 'FRUIT_RANGE', 'BITTER_RANGE', 'NO_EVIDENCE'].includes(f.code))
  const insufficient = failures.some(f => f.code === 'MIN_DAYS')

  let status
  if (failures.length === 0) status = '合格'
  else if (overLimit && insufficient) status = '超限且证据不足'
  else if (overLimit) status = '超限'
  else status = '证据不足'

  return {
    label: label.label,
    candidate: candidate.key,
    status,
    claimable: status === '合格',
    checks,
    failures,
  }
}

export function evaluateCandidates(candidates, labels) {
  return candidates.map(c => ({
    candidate: c,
    results: labels.map(l => evaluateAgainstLabel(c, l)),
  }))
}

// 仅返回可用于销售声明的（候选, 标注）组合
export function claimablePairs(evaluated) {
  const pairs = []
  for (const e of evaluated) {
    for (const r of e.results) {
      if (r.claimable) pairs.push({ key: e.candidate.key, label: r.label })
    }
  }
  return pairs
}

function round(n) {
  return n === null ? null : Math.round(n * 1000) / 1000
}
