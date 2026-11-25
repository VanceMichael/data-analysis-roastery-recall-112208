import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadData } from '../src/parse.js'
import { withdrawalBoundary, triageNewFinding, replayReviewActions, snapshot } from '../src/review.js'
import { backupTrialPlan, queryByLot, queryByFinished } from '../src/procurement.js'

const tables = await loadData('./data')

test('撤回一个支撑盲评会把候选从合格翻成证据不足', () => {
  const diff = withdrawalBoundary(tables, 'V1', 'L1', 'withdraw')
  assert.equal(diff.flips.length, 1)
  assert.equal(diff.flips[0].candidate, 'G1a|G2|0.45|中')
  assert.equal(diff.flips[0].wasClaimable, true)
  assert.equal(diff.flips[0].nowClaimable, false)
  // 撤回后未投料 O2 失去原候选，但 G3 替代候选仍合格
  const o2 = diff.after.orders.find(o => o.order === 'O2')
  assert.notEqual(o2.evidenceState, '合格')
  assert.ok(o2.alternatives.some(a => a.candidate === 'G3|G2|0.45|中'))
})

test('撤回只作用于该盲评号的最新版本，旧版本保持原状态', () => {
  // V2 已有撤回的 v2；模拟撤回不应再改变 v1 记入行
  const diff = withdrawalBoundary(tables, 'V2', 'L1', 'withdraw')
  assert.deepEqual(diff.flips, [])
})

test('撤回分流为重新作声明并给出未投料重分配与渠道更正', () => {
  const finding = triageNewFinding(tables, { kind: '撤回杯测', ref: 'V1', label: 'L1' })
  assert.equal(finding.category, '需要重新作声明')
  assert.ok(finding.openOrderReplan.some(p => p.order === 'O2'))
  // 已交付的 A、B 在更正名单，未交付的 C 不在
  const corrected = finding.channelCorrections.map(c => c.channel)
  assert.ok(corrected.includes('A'))
  assert.ok(corrected.includes('B'))
  assert.ok(!corrected.includes('C'))
})

test('找回样按重新记入评估，恢复声明范围', () => {
  const withdrawn = {
    ...tables,
    cups: tables.cups.map(c => c.blind === 'V1' ? { ...c, state: '撤回' } : c),
  }
  const finding = triageNewFinding(withdrawn, { kind: '找回样', ref: 'V1', label: 'L1' })
  assert.ok(finding.flips.some(f => f.nowClaimable && !f.wasClaimable))
  assert.ok(finding.category.includes('恢复可声明范围'))
})

test('换豆事件对未试到订单走常规补试，不直接给声明', () => {
  const finding = triageNewFinding(tables, { kind: '换豆', ref: 'O3' })
  assert.equal(finding.category, '需要常规补试')
  assert.equal(finding.order.evidenceState, '未试到')
})

test('重新装包事件不产生新的合格公斤数', () => {
  const finding = triageNewFinding(tables, { kind: '重新装包', ref: 'X2', blinds: ['V1'], label: 'L1' })
  assert.ok(finding.note.includes('不产生新的合格公斤数'))
})

test('渠道收悉归入确切渠道更正分流', () => {
  const finding = triageNewFinding(tables, { kind: '渠道收悉', ref: 'A' })
  assert.equal(finding.category, '需给已收到旧版本的确切渠道作更正')
  assert.equal(finding.channel.channel, 'A')
})

test('历史复评动作可完整重放且结果确定', () => {
  const events = replayReviewActions(tables)
  assert.equal(events.length, tables.review_actions.length)
  const again = replayReviewActions(tables)
  assert.deepEqual(JSON.stringify(events), JSON.stringify(again))
})

test('候补试烘表把事实批 O3 排最高优先级并算出需补日数', () => {
  const plan = backupTrialPlan(tables, snapshot(tables))
  assert.equal(plan[0].order, 'O3')
  assert.equal(plan[0].additionalDaysNeeded, 1)
  assert.equal(plan[0].reason.includes('事实批'), true)
})

test('按豆批查询给出实物可用量、证据来源和三类待查范围', () => {
  const q = queryByLot(snapshot(tables), tables, 'G1')
  assert.equal(q.physical.available, 16.85)
  assert.ok(q.pendingScope['未试到'].includes('O3'))
  const qG1a = queryByLot(snapshot(tables), tables, 'G1a')
  assert.ok(qG1a.evidenceSources.length >= 3)
})

test('按成品批查询展示包装、渠道与混配去向', () => {
  const q = queryByFinished(snapshot(tables), tables, 'F1')
  assert.equal(q.produced, 12)
  assert.deepEqual(q.packages.map(p => p.package), ['X1', 'X2'])
  assert.ok(q.blends.some(z => z.blend === 'Z1'))
  assert.ok(q.channels.some(c => c.channel === 'A' && c.declared === '总批'))
})
