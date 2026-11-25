import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadData } from '../src/parse.js'
import { buildCandidates } from '../src/evidence.js'
import { evaluateCandidates } from '../src/labels.js'
import { buildLotLedger } from '../src/availability.js'
import { evaluateOrders, allocatableOpenOrders } from '../src/work.js'
import { snapshot } from '../src/review.js'

const tables = await loadData('./data')
const snap = snapshot(tables)
const orders = evaluateOrders(tables, snap.candidates, snap.evaluated, snap.ledger)
const byOrder = id => orders.find(o => o.order === id)

test('已包装订单证据与实物均满足时可按现标注出货', () => {
  const o1 = byOrder('O1')
  assert.equal(o1.evidenceState, '合格')
  assert.equal(o1.material.feasible, true)
  assert.equal(o1.decision, '可按现标注出货')
})

test('O3 用母批 G1 而试烘只覆盖 G1a，判未试到且事实投料不可替换', () => {
  const o3 = byOrder('O3')
  assert.equal(o3.locked, true)
  assert.equal(o3.evidenceState, '未试到')
  assert.deepEqual(o3.reasons, ['未试到'])
  assert.equal(o3.alternatives.length, 0)
  assert.ok(o3.decision.includes('事实投料不可替换'))
})

test('同产区同规格的新豆批不串证据：G3 订单有自己的两日试烘才合格', () => {
  const o4 = byOrder('O4')
  assert.equal(o4.composition.lot_a, 'G3')
  assert.equal(o4.evidenceState, '合格')
})

test('未投料订单给出证据合格且实物充足的替换候选', () => {
  const o2 = byOrder('O2')
  assert.equal(o2.locked, false)
  assert.ok(o2.alternatives.some(a => a.candidate === 'G3|G2|0.45|中'))
})

test('原料不足独立于证据状态：改大需求后出现原料不足原因', () => {
  const big = {
    ...tables,
    work: tables.work.map(w => w.order === 'O4' ? { ...w, weight: '900' } : w),
  }
  const s = snapshot(big)
  const o4 = s.orders.find(o => o.order === 'O4')
  assert.ok(o4.reasons.includes('原料不足'))
})

test('未投料量分配在撤回事件后可重算', () => {
  const plan = allocatableOpenOrders(orders, snap.ledger)
  assert.deepEqual(plan.map(p => p.order), ['O2', 'O4'])
  assert.ok(plan.every(p => p.action.includes('保留库存')))
})
