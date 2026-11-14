// 把 AI 的策略翻译成引擎动作（`PlayerAction`）。
//
// 单独一层的理由：`policy.ts` 只回答"想做什么"，不关心 `reqId`、也不关心动作要发给谁；
// 运行时需要的是可以直接 `applyAction` 的东西。翻译逻辑很薄，但集中在这里才好改。
import type { PlayerAction } from '../action/options'
import { chooseClaim, chooseRobKong, chooseTurn } from '../ai/policy'
import type { RuleConfig } from '../ruleConfig'
import type { PendingDecision } from './match'

/** 抢杠窗口只给 HU / PASS —— 用它把"抢杠"和"普通鸣牌"区分开。 */
function isRobKongWindow(pending: PendingDecision): boolean {
  return pending.kind === 'claim' && pending.options.every((o) => o.type === 'HU' || o.type === 'PASS')
}

export function aiActionFor(pending: PendingDecision, cfg: RuleConfig, reqId = 0): PlayerAction {
  const seat = pending.seat

  if (pending.kind === 'turn') {
    const decision = chooseTurn(pending.view, pending.options, cfg)
    switch (decision.kind) {
      case 'hu': return { type: 'HU', seat, tile: null, reqId }
      case 'an-gang': return { type: 'AN_GANG', seat, tile: decision.tile, reqId }
      case 'bu-gang': return { type: 'BU_GANG', seat, tile: decision.tile, reqId }
      case 'discard': return { type: 'DISCARD', seat, tile: decision.tile, reqId }
    }
  }

  if (isRobKongWindow(pending)) {
    return chooseRobKong(pending.options) === 'hu'
      ? { type: 'HU', seat, tile: pending.tile, reqId }
      : { type: 'PASS', seat, tile: null, reqId }
  }

  const claim = chooseClaim(pending.view, pending.options, cfg)
  switch (claim.kind) {
    case 'hu': return { type: 'HU', seat, tile: pending.tile, reqId }
    case 'ming-gang': return { type: 'MING_GANG', seat, tile: pending.tile, reqId }
    case 'peng': return { type: 'PENG', seat, tile: pending.tile, reqId }
    case 'pass': return { type: 'PASS', seat, tile: null, reqId }
  }
}
