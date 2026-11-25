// 一次完整的换豆/复评/重装/收悉演练（只读，不改原始资料）。
// 运行：node scripts/scenario.js
// 每一步都打印：分流结论、受影响的待出货指示、需要补的试烘次数、确切渠道更正名单。

import { loadData, validateRefs } from '../src/parse.js'
import { snapshot, withdrawalBoundary, triageNewFinding } from '../src/review.js'
import { reviewImpact, narrowByChannelConfirmation } from '../src/traceability.js'
import { backupTrialPlan } from '../src/procurement.js'
import { recallReport, backupReport } from '../src/report.js'

const tables = await loadData('./data')
const warnings = validateRefs(tables)
console.log('资料引用警告:', warnings.length ? warnings : '无')
const base = snapshot(tables)
console.log(`基线：候选 ${base.candidates.length} 个，可声明组合 ${base.evaluated.flatMap(e => e.results.filter(r => r.claimable).map(r => `${e.candidate.key}→${r.label}`)).length} 个\n`)

// ---- 1. 换豆：O3 实际投了母批 G1，而试烘证据只覆盖拆分子批 G1a ----
console.log('=== 1. 换豆确认（O3 用 G1 替代证据豆批 G1a）===')
console.log(JSON.stringify(triageNewFinding(tables, { kind: '换豆', ref: 'O3' }), null, 2))

// ---- 2. 试烘复评：撤回 V1，观察两个候选边界与未投料量重分配 ----
console.log('\n=== 2. 撤回盲评 V1（风味证据失效演练）===')
const diff = withdrawalBoundary(tables, 'V1', 'L1', 'withdraw')
console.log('边界翻转:', diff.flips)
const impact = reviewImpact(tables, ['V1'], 'L1')
console.log(recallReport(impact))
console.log('\n撤回后未投料指示:')
for (const o of diff.after.orders.filter(o => !o.locked)) {
  console.log(`  ${o.order}: ${o.evidenceState} → ${o.decision}` +
    (o.alternatives.length ? `；可替换 ${o.alternatives.map(a => a.candidate).join(',')}` : ''))
}
console.log('\n撤回后候补试烘表:')
console.log(backupReport(backupTrialPlan(tables, diff.after)))

// ---- 3. 重新装包：把待发 X2 拆成两个小包，合格公斤数守恒 ----
console.log('\n=== 3. 重新装包（X2 拆包，不新增合格公斤）===')
const repack = triageNewFinding(tables, { kind: '重新装包', ref: 'X2', blinds: ['V1'], label: 'L1' })
console.log(JSON.stringify(repack, null, 2))

// ---- 4. 渠道 A 收悉：总批渠道确认实际只拿了 X1，停用范围缩小 ----
console.log('\n=== 4. 渠道 A 收悉并确认子批 ===')
const narrowed = narrowByChannelConfirmation(impact, 'A', 'X1')
const rowA = narrowed.channelActions.find(c => c.channel === 'A')
console.log(`渠道 A 确认后范围：${rowA.scope}`)
console.log(`处置：${rowA.action}`)
console.log('包装级变化:')
for (const p of narrowed.packageActions) console.log(`  ${p.package}: ${p.action}`)

// ---- 5. 新原料返测：在 V1 已撤回的资料上找回历史同杯，恢复声明 ----
console.log('\n=== 5. 找回样 V1 后的重新分流（基于撤回后的资料状态）===')
const withdrawnTables = {
  ...tables,
  cups: tables.cups.map(c => c.blind === 'V1' ? { ...c, state: '撤回' } : c),
}
console.log(JSON.stringify(triageNewFinding(withdrawnTables, { kind: '找回样', ref: 'V1', label: 'L1' }), null, 2))
