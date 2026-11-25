import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadData, num } from '../src/parse.js'
import {
  buildCandidates, recordedCups, substitutionDeltas, varianceBreakdown,
} from '../src/evidence.js'

const tables = await loadData('./data')

test('撤回状态的杯测不进入任何统计', () => {
  const used = recordedCups(tables.cups)
  assert.ok(used.every(c => c.state === '记入'))
  assert.equal(used.length, tables.cups.length - 1)
  // V2 的撤回行与记入行数值相同，但撤回行仍被剔除
  const v2 = used.filter(c => c.blind === 'V2')
  assert.equal(v2.length, 1)
})

test('候选按具体豆批+配比+烘焙档案聚合，证据不跨豆批串用', () => {
  const candidates = buildCandidates(tables.roasts, tables.cups)
  const keys = candidates.map(c => c.key)
  assert.deepEqual(keys, [
    'G1a|G2|0.45|中',
    'G1a|G2|0.55|中',
    'G1a|G2|0.65|中',
    'G3|G2|0.45|中',
  ])
  // G1 母批没有任何试烘，不能借用 G1a 拆分批的证据
  assert.ok(!keys.some(k => k.startsWith('G1|')))
})

test('0.45 候选的杯测均值、跨度与独立试烘日', () => {
  const c = buildCandidates(tables.roasts, tables.cups).find(x => x.key === 'G1a|G2|0.45|中')
  assert.equal(c.dayCount, 2)
  assert.deepEqual(c.days, ['D1', 'D2'])
  assert.ok(Math.abs(c.fruit.mean - 7.58) < 0.01)
  assert.ok(Math.abs(c.bitter.mean - 3.15) < 0.01)
  assert.ok(Math.abs(c.fruit.range - 0.5) < 1e-9)
  assert.ok(Math.abs(c.bitter.range - 0.2) < 1e-9)
})

test('波动分解区分评委分歧、重复杯与跨日漂移', () => {
  const c = buildCandidates(tables.roasts, tables.cups).find(x => x.key === 'G1a|G2|0.45|中')
  const breakdown = Object.fromEntries(varianceBreakdown(c).map(v => [v.source, v]))
  assert.ok(Math.abs(breakdown['评委分歧'].fruit - 0.35) < 1e-9) // J1 均值 7.55 vs J2 7.9
  assert.ok(Math.abs(breakdown['同试烘重复杯'].fruit - 0.3) < 1e-9) // J1 的 rep1/rep2
  assert.ok(breakdown['跨试烘日漂移'].fruit > 0)
})

test('换批真实变化只在同配比同档案不同 A 豆批之间计算', () => {
  const candidates = buildCandidates(tables.roasts, tables.cups)
  const deltas = substitutionDeltas(candidates)
  const d = deltas.find(x => x.lot_a_from === 'G1a' && x.lot_a_to === 'G3')
  assert.ok(d)
  assert.equal(d.ratio_a, 0.45)
  assert.ok(Math.abs(d.fruit_delta - (-0.083)) < 0.01)
  assert.ok(Math.abs(d.bitter_delta - 0.15) < 0.01)
})

test('高配比候选苦感上升、果香下降，反映真实配方差异', () => {
  const c = buildCandidates(tables.roasts, tables.cups).find(x => x.key === 'G1a|G2|0.65|中')
  assert.ok(c.bitter.mean > 4)
  assert.ok(c.fruit.mean < 7)
})
