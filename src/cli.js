#!/usr/bin/env node
// 命令行入口：所有评估可对同一资料目录反复执行，新原料/返测落盘后重跑即可得到新结论。

import { parseArgs } from 'node:util'
import { loadData, validateRefs } from './parse.js'
import { buildCandidates, substitutionDeltas } from './evidence.js'
import { evaluateCandidates } from './labels.js'
import { buildLotLedger, conservationCheck } from './availability.js'
import { evaluateOrders, allocatableOpenOrders } from './work.js'
import { reviewImpact } from './traceability.js'
import { snapshot, withdrawalBoundary, replayReviewActions, triageNewFinding } from './review.js'
import { backupTrialPlan, queryByLot, queryByFinished } from './procurement.js'
import {
  candidatesReport, ordersReport, ledgerReport, recallReport, backupReport, queryReport, table,
} from './report.js'

const { values, positionals } = parseArgs({
  options: {
    data: { type: 'string', default: './data' },
    json: { type: 'boolean', default: false },
    blind: { type: 'string' },
    label: { type: 'string' },
    kind: { type: 'string' },
    ref: { type: 'string' },
    detail: { type: 'string' },
    package: { type: 'string' },
  },
  allowPositionals: true,
})

const tables = await loadData(values.data)
const warnings = validateRefs(tables)
const snap = snapshot(tables)
const command = positionals[0]

const emit = (text, payload) => {
  if (values.json) console.log(JSON.stringify(payload, null, 2))
  else console.log(text)
}

switch (command) {
  case 'check': {
    const conservation = conservationCheck(tables)
    emit(['引用核对:', ...warnings.map(w => '  警告 ' + w), '守恒核对:', ...conservation.map(w => '  警告 ' + w),
      warnings.length + conservation.length === 0 ? '全部通过' : ''].filter(Boolean).join('\n'),
      { warnings, conservation })
    break
  }
  case 'candidates': {
    const deltas = substitutionDeltas(snap.candidates)
    emit(candidatesReport(snap.evaluated) + '\n换批真实变化（同配比同档案，仅换 A 豆批）:\n' +
      table(['原候选', '替换为', '果香Δ', '苦感Δ'],
        deltas.map(d => [d.lot_a_from, d.lot_a_to, d.fruit_delta, d.bitter_delta])),
      { candidates: snap.evaluated, substitutionDeltas: deltas })
    break
  }
  case 'orders': {
    emit(ordersReport(snap.orders) + '\n\n未投料量分配:\n' +
      table(['订单', '标注', '重量', '指示'],
        allocatableOpenOrders(snap.orders, snap.ledger).map(p => [p.order, p.label, p.weight, p.action])),
      { orders: snap.orders, openPlan: allocatableOpenOrders(snap.orders, snap.ledger) })
    break
  }
  case 'ledger': {
    emit(ledgerReport(snap.ledger), [...snap.ledger.values()])
    break
  }
  case 'recall': {
    if (!values.blind || !values.label) throw new Error('recall 需要 --blind V1 --label L1')
    const impact = reviewImpact(tables, values.blind.split(','), values.label)
    emit(recallReport(impact), impact)
    break
  }
  case 'boundary': {
    if (!values.blind || !values.label) throw new Error('boundary 需要 --blind V2 --label L1')
    const diff = withdrawalBoundary(tables, values.blind, values.label)
    emit(`切换 ${values.blind} 记入/撤回后档案 ${values.label} 的边界变化:\n` +
      table(['候选', '原状态', '新状态', '原可声明', '新可声明'],
        diff.flips.map(x => [x.candidate, x.from, x.to, x.wasClaimable, x.nowClaimable])),
      diff)
    break
  }
  case 'backup': {
    const plan = backupTrialPlan(tables, snap)
    emit(backupReport(plan), plan)
    break
  }
  case 'query': {
    const id = positionals[1]
    const q = queryByFinished(snap, tables, id) ?? queryByLot(snap, tables, id)
    emit(queryReport(q), q)
    break
  }
  case 'events': {
    const events = replayReviewActions(tables)
    emit(table(['时间', '类型', '对象', '分流', '要点'],
      events.map(e => [e.at, e.kind, e.ref, e.result.category, JSON.stringify(e.result.flips ?? e.result.channel ?? e.result.order ?? e.detail ?? '')])),
      events)
    break
  }
  case 'event': {
    if (!values.kind || !values.ref) throw new Error('event 需要 --kind 撤回杯测 --ref V2 --label L1')
    const result = triageNewFinding(tables, {
      kind: values.kind, ref: values.ref, label: values.label,
      detail: values.detail, confirmedPackage: values.package,
      blinds: values.blind ? values.blind.split(',') : undefined,
    })
    emit(JSON.stringify(result, null, 2), result)
    break
  }
  case undefined:
    console.log('命令: check | candidates | orders | ledger | recall | boundary | backup | query <批> | events | event')
    break
  default:
    throw new Error(`未知命令 ${command}`)
}

if (warnings.length && !values.json && command !== 'check') {
  console.error(`\n资料警告 ${warnings.length} 条，运行 check 查看`)
}
