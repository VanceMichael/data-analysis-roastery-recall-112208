import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadData } from '../src/parse.js'
import { reviewImpact, traceByBlinds, narrowByChannelConfirmation } from '../src/traceability.js'

const tables = await loadData('./data')

test('证据链从盲评一路追到成品、包装、混配与渠道', () => {
  const trace = traceByBlinds(tables, ['V1'])
  assert.deepEqual(trace.orders, ['O1', 'O2'])
  assert.deepEqual(trace.finished, ['F1'])
  assert.deepEqual(trace.packages.map(p => p.package), ['X1', 'X2'])
  assert.ok(trace.blendLinks.some(b => b.blend === 'Z1'))
  assert.deepEqual([...new Set(trace.channelHits.map(c => c.channel))], ['A', 'B', 'C'])
})

test('撤回影响面：待发扣留、已发进更正名单、姐妹批放行', () => {
  const impact = reviewImpact(tables, ['V1'], 'L1')
  const x1 = impact.packageActions.find(p => p.package === 'X1')
  const x2 = impact.packageActions.find(p => p.package === 'X2')
  assert.ok(x1.action.includes('渠道更正名单'))
  assert.ok(x2.action.includes('停止使用该标注'))
  assert.deepEqual(impact.unaffected.map(u => u.finished), ['F2'])
})

test('已混不可拆库存不因子批合格而恢复标注份额', () => {
  const impact = reviewImpact(tables, ['V1'], 'L1')
  const z1 = impact.blendActions.find(b => b.blend === 'Z1')
  assert.equal(z1.state, '已混')
  assert.ok(z1.action.includes('永久退出该标注'))
  // 可拆混配给复核路径，不直接作废
  const z2only = reviewImpact(tables, ['V4'], 'L1')
  assert.ok(z2only.blendActions.every(b => b.state !== '已混' || b.action.includes('拆回')))
})

test('总批渠道在确认子批前按最小可追溯范围整体停用', () => {
  const impact = reviewImpact(tables, ['V1'], 'L1')
  const a = impact.channelActions.find(c => c.channel === 'A')
  assert.equal(a.declared, '总批')
  assert.ok(a.scope.includes('总批 F1 下全部包装'))
})

test('渠道确认实际子批后缩小范围，无关待发包装恢复出货', () => {
  const impact = reviewImpact(tables, ['V1'], 'L1')
  const narrowed = narrowByChannelConfirmation(impact, 'A', 'X1')
  const a = narrowed.channelActions.find(c => c.channel === 'A')
  assert.ok(a.scope.includes('X1'))
  const x2 = narrowed.packageActions.find(p => p.package === 'X2')
  assert.ok(x2.action.includes('恢复出货'))
})

test('子批渠道只处理自己那份包装', () => {
  const impact = reviewImpact(tables, ['V1'], 'L1')
  const b = impact.channelActions.find(c => c.channel === 'B')
  const c = impact.channelActions.find(c => c.channel === 'C')
  assert.ok(b.action.includes('标注更正'))
  assert.ok(c.action.includes('无需更正'))
})

test('与证据无关的标注不受影响', () => {
  const impact = reviewImpact(tables, ['V1'], 'L1')
  const d = impact.channelActions.find(c => c.channel === 'D')
  // D 渠道对应 F2/L2，不在 V1 证据链上
  assert.equal(d, undefined)
})
