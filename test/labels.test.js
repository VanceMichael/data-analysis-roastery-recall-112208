import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadData } from '../src/parse.js'
import { buildCandidates } from '../src/evidence.js'
import { evaluateCandidates, claimablePairs } from '../src/labels.js'

const tables = await loadData('./data')
const candidates = buildCandidates(tables.roasts, tables.cups)
const evaluated = evaluateCandidates(candidates, tables.labels)
const byKey = key => evaluated.find(e => e.candidate.key === key)

test('L1 要求下限、上限、跨度、试烘日同时满足', () => {
  const r = byKey('G1a|G2|0.45|中').results.find(x => x.label === 'L1')
  assert.equal(r.status, '合格')
  assert.equal(r.claimable, true)
})

test('单项高分不能抵消另一项超限：0.65 候选 L1 判超限', () => {
  const r = byKey('G1a|G2|0.65|中').results.find(x => x.label === 'L1')
  assert.equal(r.status, '超限')
  const codes = r.failures.map(f => f.code)
  assert.ok(codes.includes('FRUIT_MIN'))
  assert.ok(codes.includes('BITTER_MAX'))
  assert.equal(r.claimable, false)
})

test('同一候选可满足较宽档案 L2 但不能声明 L1', () => {
  const e = byKey('G1a|G2|0.65|中')
  assert.equal(e.results.find(x => x.label === 'L2').claimable, true)
  assert.equal(e.results.find(x => x.label === 'L1').claimable, false)
})

test('风味在限但独立试烘日不足，只能作为下一轮试烘候选', () => {
  const r = byKey('G1a|G2|0.55|中').results.find(x => x.label === 'L1')
  assert.equal(r.status, '证据不足')
  assert.deepEqual(r.failures.map(f => f.code), ['MIN_DAYS'])
})

test('换批候选 G3 同配比有两日证据，可独立声明 L1', () => {
  const r = byKey('G3|G2|0.45|中').results.find(x => x.label === 'L1')
  assert.equal(r.status, '合格')
})

test('可声明组合清单只包含合格判定', () => {
  const pairs = claimablePairs(evaluated)
  const pairIds = pairs.map(p => `${p.key}->${p.label}`)
  assert.ok(pairIds.includes('G1a|G2|0.45|中->L1'))
  assert.ok(pairIds.includes('G3|G2|0.45|中->L1'))
  assert.ok(!pairs.some(p => p.key === 'G1a|G2|0.65|中' && p.label === 'L1'))
  assert.ok(!pairs.some(p => p.key.startsWith('G1|')))
})
