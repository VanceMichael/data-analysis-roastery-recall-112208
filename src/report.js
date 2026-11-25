// 文本与 JSON 报告组装：CLI 与演示脚本共用，保证屏幕输出和机器可读结果同源。

import { varianceBreakdown } from './evidence.js'

const f = (n, d = 2) => (n === null || n === undefined) ? '?' : Number(n).toFixed(d)

function line(columns, widths) {
  return columns.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ')
}

export function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)))
  return [line(headers, widths), ...rows.map(r => line(r, widths))].join('\n')
}

export function candidatesReport(evaluated) {
  const out = []
  for (const e of evaluated) {
    const c = e.candidate
    out.push(`候选 ${c.key}`)
    out.push(`  豆批 ${c.lot_a}+${c.lot_b}  A 配比 ${f(c.ratio_a, 2)}  烘焙 ${c.profile}  独立试烘日 ${c.dayCount}（${c.days.join(',')}）  盲评 ${c.blinds.join(',')}`)
    out.push(`  果香 均值 ${f(c.fruit.mean)} 跨度 ${f(c.fruit.range)} | 苦感 均值 ${f(c.bitter.mean)} 跨度 ${f(c.bitter.range)}`)
    out.push('  波动分解: ' + varianceBreakdown(c).map(v =>
      `${v.source}(果香 ${f(v.fruit)}, 苦感 ${f(v.bitter)})`).join(' | '))
    for (const r of e.results) {
      const detail = r.failures.length
        ? ' 违反: ' + r.failures.map(x => `${x.name} 实际 ${f(x.actual)} 限值 ${f(x.limit)}`).join('；')
        : ''
      out.push(`  档案 ${r.label}: ${r.status}${detail}`)
    }
    out.push('')
  }
  return out.join('\n')
}

export function ordersReport(orderEvals) {
  const rows = orderEvals.map(o => [
    o.order, o.state, o.label, f(o.weight), o.evidenceState,
    o.reasons.length ? o.reasons.join('+') : '无',
    o.alternatives.length ? o.alternatives.map(a => a.candidate).join(' / ') : '-',
    o.decision,
  ])
  return table(['订单', '状态', '标注', '重量', '证据', '受阻原因', '可替换候选', '指示'], rows)
}

export function ledgerReport(ledger) {
  const rows = [...ledger.values()].map(l => [
    l.lot, l.origin, l.grade, f(l.initial), f(l.split_out), f(l.consumed), f(l.available), f(l.committedOpen),
  ])
  return table(['豆批', '产区', '等级', '期初', '已拆分', '已投料', '实物可用', '未投料待承诺'], rows)
}

export function recallReport(impact) {
  const out = [`标注复核：${impact.label}`, '']
  out.push('证据链: 盲评 ' + impact.trace.blinds.join(',') +
    ' → 试烘 ' + impact.trace.tests.join(',') +
    ' → 订单 ' + impact.trace.orders.join(',') +
    ' → 成品 ' + impact.trace.finished.join(','))
  out.push('')
  out.push(table(['包装', '成品', '重量', '状态', '处置'],
    impact.packageActions.map(p => [p.package, p.finished, f(p.weight), p.state, p.action])))
  if (impact.blendActions.length) {
    out.push('')
    out.push(table(['混配', '包装', '状态', '处置'],
      impact.blendActions.map(b => [b.blend, b.packaging, b.state, b.action])))
  }
  out.push('')
  out.push(table(['渠道', '口径', '范围', '处置'],
    impact.channelActions.map(c => [c.channel, c.declared, c.scope, c.action])))
  out.push('')
  out.push('无关姐妹批放行: ' + impact.unaffected.map(u => u.finished).join(', '))
  return out.join('\n')
}

export function backupReport(rows) {
  return table(['优先级', '订单', '标注', '候选', '现有试烘日', '需补日数', '风味已在限内', '解锁效果'],
    rows.map(r => [
      r.priority, r.order, r.label, r.candidate, r.independentDaysNow,
      r.additionalDaysNeeded, r.flavorAlreadyWithinSpec === null ? '无数据' : String(r.flavorAlreadyWithinSpec), r.unlockEffect,
    ]))
}

export function queryReport(q) {
  if (!q) return '未找到该批次'
  const out = [`${q.type} ${q.id}`]
  if (q.type === '豆批') {
    out.push(`实物: 期初 ${f(q.physical.initial)} 已拆 ${f(q.physical.split_out)} 已投 ${f(q.physical.consumed)} 可用 ${f(q.physical.available)} 待承诺 ${f(q.physical.committedOpen)}`)
    out.push('证据来源: ' + (q.evidenceSources.length ? q.evidenceSources.map(e => `${e.candidate}(${e.blinds.join('+')})`).join('；') : '无'))
  } else {
    out.push(`产量 ${f(q.produced)}kg 标注 ${q.label} 证据状态 ${q.evidenceState}`)
    out.push('包装: ' + q.packages.map(p => `${p.package} ${f(p.weight)}kg ${p.state}`).join('；'))
    out.push('渠道: ' + (q.channels.length ? q.channels.map(c => `${c.channel}/${c.declared}/${c.delivered}`).join('；') : '无记录'))
    out.push('混配: ' + (q.blends.length ? q.blends.map(z => `${z.blend}(${z.state})`).join('；') : '无'))
  }
  out.push('待查范围: ' + Object.entries(q.pendingScope)
    .filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(',')}`).join(' | ') || '无')
  return out.join('\n')
}
