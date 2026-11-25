// 试烘与杯测证据聚合。
// 关键边界：
// - 仅 state=记入 的杯测进入统计；撤回杯测（即使数值相同）一律剔除，并通过事件模块处理影响；
// - 同一 blind 号对应一次试烘，评委差异、重复杯差异在 blind 内部度量；
// - 换批/换配比的真实变化在「同一烘焙档案的候选」跨试烘日间度量。

import { num } from './parse.js'

export function recordedCups(cups) {
  return cups.filter(c => c.state === '记入')
}

function mean(xs) {
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function rangeOf(xs) {
  if (!xs.length) return null
  return Math.max(...xs) - Math.min(...xs)
}

// 单个盲评号（一次试烘）的汇总
export function summarizeBlind(blind, roasts, cups) {
  const roast = roasts.find(r => r.blind === blind)
  const used = recordedCups(cups).filter(c => c.blind === blind)
  const fruit = used.map(c => num(c.fruit))
  const bitter = used.map(c => num(c.bitter))
  const judges = [...new Set(used.map(c => c.judge))]
  const repCount = used.length

  // 评委分歧：每位评委均值之间的跨度
  const judgeMeans = judges.map(j => {
    const rows = used.filter(c => c.judge === j)
    return {
      judge: j,
      fruit: mean(rows.map(c => num(c.fruit))),
      bitter: mean(rows.map(c => num(c.bitter))),
    }
  })
  const judgeDisagreement = {
    fruit: rangeOf(judgeMeans.map(j => j.fruit)),
    bitter: rangeOf(judgeMeans.map(j => j.bitter)),
  }

  // 同一试烘重复杯波动：同一评委多次 rep 之间的最大跨度
  const repRanges = []
  for (const j of judges) {
    const rows = used.filter(c => c.judge === j)
    if (rows.length > 1) {
      repRanges.push({
        judge: j,
        fruit: rangeOf(rows.map(c => num(c.fruit))),
        bitter: rangeOf(rows.map(c => num(c.bitter))),
      })
    }
  }
  const repeatNoise = {
    fruit: repRanges.length ? Math.max(...repRanges.map(r => r.fruit)) : 0,
    bitter: repRanges.length ? Math.max(...repRanges.map(r => r.bitter)) : 0,
  }

  return {
    blind,
    test: roast ? roast.test : null,
    day: roast ? roast.day : null,
    lot_a: roast ? roast.lot_a : null,
    lot_b: roast ? roast.lot_b : null,
    ratio_a: roast ? num(roast.ratio_a) : null,
    profile: roast ? roast.profile : null,
    cups: used.length,
    withdrawnCups: cups.filter(c => c.blind === blind && c.state !== '记入').length,
    judges,
    repCount,
    fruit: { mean: mean(fruit), min: fruit.length ? Math.min(...fruit) : null, max: fruit.length ? Math.max(...fruit) : null, range: rangeOf(fruit) },
    bitter: { mean: mean(bitter), min: bitter.length ? Math.min(...bitter) : null, max: bitter.length ? Math.max(...bitter) : null, range: rangeOf(bitter) },
    judgeDisagreement,
    repeatNoise,
  }
}

// 候选键：对生产有意义的候选 = 两支具体豆批 + 配比 + 烘焙档案。
// 同产区同规格的新豆批不是同一候选，证据不得串用。
// 配比统一成字符串归一，避免来源表字符串与计算侧数字拼出不同键。
export function candidateKey(parts) {
  const ratio = typeof parts.ratio_a === 'number' ? String(parts.ratio_a) : parts.ratio_a
  return `${parts.lot_a}|${parts.lot_b}|${ratio}|${parts.profile}`
}

export function buildCandidates(roasts, cups) {
  const map = new Map()
  for (const roast of roasts) {
    const key = candidateKey({ lot_a: roast.lot_a, lot_b: roast.lot_b, ratio_a: num(roast.ratio_a), profile: roast.profile })
    if (!map.has(key)) {
      map.set(key, {
        key,
        lot_a: roast.lot_a,
        lot_b: roast.lot_b,
        ratio_a: num(roast.ratio_a),
        profile: roast.profile,
        tests: [],
        days: [],
        blinds: [],
      })
    }
    const cand = map.get(key)
    const summary = summarizeBlind(roast.blind, roasts, cups)
    cand.tests.push(summary)
    if (!cand.days.includes(roast.day)) cand.days.push(roast.day)
    cand.blinds.push(roast.blind)
  }

  const candidates = [...map.values()].map(c => aggregateCandidate(c, roasts, cups))
  candidates.sort((a, b) => a.key.localeCompare(b.key))
  return candidates
}

function aggregateCandidate(cand) {
  const trials = cand.tests.filter(t => t.cups > 0)
  const allFruit = trials.flatMap(t => t.fruit.mean === null ? [] : [t.fruit.mean])
  const allBitter = trials.flatMap(t => t.bitter.mean === null ? [] : [t.bitter.mean])
  const cupFruit = trials.flatMap(t => t.fruit.mean === null ? [] : [t.fruit.min, t.fruit.max])
  const cupBitter = trials.flatMap(t => t.bitter.mean === null ? [] : [t.bitter.min, t.bitter.max])

  return {
    ...cand,
    days: [...new Set(trials.map(t => t.day))].sort(),
    trialCount: trials.length,
    dayCount: new Set(trials.map(t => t.day)).size,
    fruit: {
      mean: mean(allFruit),
      min: cupFruit.length ? Math.min(...cupFruit) : null,
      max: cupFruit.length ? Math.max(...cupFruit) : null,
      // 档案 range_max 应用于「允许重复条件下每项风味的分数跨度」：全部有效杯测值的跨度
      range: cupFruit.length ? Math.max(...cupFruit) - Math.min(...cupFruit) : null,
    },
    bitter: {
      mean: mean(allBitter),
      min: cupBitter.length ? Math.min(...cupBitter) : null,
      max: cupBitter.length ? Math.max(...cupBitter) : null,
      range: cupBitter.length ? Math.max(...cupBitter) - Math.min(...cupBitter) : null,
    },
    // 评委分歧（取各试烘内最大）与重复杯噪声（取各试烘内最大）
    judgeDisagreement: {
      fruit: trials.length ? Math.max(...trials.map(t => t.judgeDisagreement.fruit ?? 0)) : null,
      bitter: trials.length ? Math.max(...trials.map(t => t.judgeDisagreement.bitter ?? 0)) : null,
    },
    repeatNoise: {
      fruit: trials.length ? Math.max(...trials.map(t => t.repeatNoise.fruit)) : null,
      bitter: trials.length ? Math.max(...trials.map(t => t.repeatNoise.bitter)) : null,
    },
    // 跨独立试烘日的日间漂移（换批后真实变化在对比模块里按同配比计算）
    dayToDay: {
      fruit: rangeOf(allFruit),
      bitter: rangeOf(allBitter),
    },
  }
}

// 同一配比+同一烘焙档案、仅豆批 A 不同的候选之间的换批真实变化
export function substitutionDeltas(candidates) {
  const out = []
  for (const c of candidates) {
    for (const other of candidates) {
      if (other.key === c.key) continue
      if (other.ratio_a === c.ratio_a && other.profile === c.profile && other.lot_b === c.lot_b && other.lot_a !== c.lot_a) {
        out.push({
          from: c.key,
          to: other.key,
          lot_a_from: c.lot_a,
          lot_a_to: other.lot_a,
          ratio_a: c.ratio_a,
          fruit_delta: round(other.fruit.mean - c.fruit.mean),
          bitter_delta: round(other.bitter.mean - c.bitter.mean),
        })
      }
    }
  }
  return out
}

// 同候选内部三类波动的分解说明
export function varianceBreakdown(candidate) {
  return [
    { source: '评委分歧', fruit: candidate.judgeDisagreement.fruit, bitter: candidate.judgeDisagreement.bitter },
    { source: '同试烘重复杯', fruit: candidate.repeatNoise.fruit, bitter: candidate.repeatNoise.bitter },
    { source: '跨试烘日漂移', fruit: candidate.dayToDay.fruit, bitter: candidate.dayToDay.bitter },
  ]
}

function round(n) {
  return n === null ? null : Math.round(n * 1000) / 1000
}
