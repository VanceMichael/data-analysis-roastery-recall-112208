import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadData } from '../src/parse.js'
import { buildLotLedger, canFulfill, conservationCheck } from '../src/availability.js'

const tables = await loadData('./data')
const ledger = buildLotLedger(tables)

test('母批库存先扣除已拆分子批，再扣除事实投料', () => {
  const g1 = ledger.get('G1')
  assert.equal(g1.initial, 40)
  assert.equal(g1.split_out, 16) // G1a 已拆
  assert.equal(g1.consumed, 7.15) // O3: 11 * 0.65
  assert.equal(g1.available, 16.85)
})

test('未投料订单只进待承诺，不扣实物可用量', () => {
  const g1a = ledger.get('G1a')
  assert.equal(g1a.consumed, 5.4) // O1: 12 * 0.45
  assert.equal(g1a.available, 10.6)
  assert.equal(g1a.committedOpen, 4.5) // O2: 10 * 0.45
})

test('可兑现性按配比分别核算两支豆的需求', () => {
  const ok = canFulfill(ledger, 'G1a', 'G2', 0.45, 10)
  assert.equal(ok.feasible, true)
  assert.deepEqual(ok.need, { lot_a: 4.5, lot_b: 5.5 })

  const short = canFulfill(ledger, 'G1a', 'G2', 0.45, 100)
  assert.equal(short.feasible, false)
  assert.equal(short.short.length, 2)
})

test('守恒检查拦截包装累计超过产量的多余合格公斤数', () => {
  const baseline = conservationCheck(tables)
  // 合成资料本身守恒（F3 缺失只在引用核对里警告）
  assert.deepEqual(baseline, [])

  const tampered = {
    ...tables,
    shipments: [...tables.shipments, { finished: 'F1', package: 'X9', weight: '99', label: 'L1', state: '待发' }],
  }
  const issues = conservationCheck(tampered)
  assert.ok(issues.some(i => i.includes('F1') && i.includes('多余合格公斤数')))
})
