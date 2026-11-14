# 南丰规则 → 代码/测试 对照表

规则权威是 `nf-mahjong/docs/rules-confirmed.md`（R-01~R-11、Q-01~Q-06、M6-1~M6-6）。
本表只回答一件事：**每条确认过的规则，落在哪个文件、被哪个测试锁着**。改实现前请先看这张表，改完回来补它。

| 条款 | 规则 | 实现 | 锁定它的测试 |
|---|---|---|---|
| R-01 | 136 张，有字牌、无花牌 | `tiles.ts` `fullWall()` / `WALL_SIZE` | `tiles.test.ts`、`rules-conformance.test.ts` |
| R-02 | 庄家胡连庄；别人点炮胡则胡者坐庄；流局对家坐庄；庄家付款不加倍 | `state/gameState.ts` `nextRoundSeating()` | `rules-conformance.test.ts` |
| R-02 轮换（5 人） | 轮空者买码、每局换座：点炮者下场；别人自摸则自摸者对家下场；荒庄庄家下场；上局的买码者接管下场那把椅子 | `runtime/match.ts` `nextRound()`（换人）+ `state/gameState.ts` `nextRoundSeating()`（谁下场、谁坐庄） | `runtime/match.test.ts`（5 人换座、连换两局不重复）、`useNanfengMatch.test.ts`（整局打完换座） |
| R-09 买码 | 开局选 0/1/2/4 张码牌；牌墙末尾预留、谁都不摸；局末翻开；`(点数−1)%4` 指相对庄家的座位；买码位**复制被指座位的每一笔现金流**（双向、多张叠加/抵消） | `score/ma.ts`（指向）+ `state/gameState.ts` `startRound`（预留）+ `state/apply.ts`（杠分流水 `roundGangFlows`）+ `score/settle.ts`（复制与五家零和） | `score/ma.test.ts`、`rules-conformance.test.ts`、`useNanfengMatch.test.ts`（5 人局整局零和） |
| R-03 | 假胡算胡，自摸与点炮都可 | `hu/jiaHu.ts`（假胡兜底）+ `hu/colors.ts` | `hu/jiaHu.test.ts`、`hu/colors.test.ts` |
| R-04 + R-07 | 归一：该牌 4 张全算（**杠也算**），补杠/暗杠不掉分 | `hu/guiYi.ts` + `melds.ts` `meldTileCount()`（碰 3 / 杠 4） | `hu/guiYi.test.ts` |
| R-05 | 十三烂：跨花色可同点数、间隔 ≥3、字牌 ≥5；5/6 张只能自摸；7 张可点炮 | `hu/shiSanLan.ts`（含 `requiresSelfDraw`） | `hu/shiSanLan.test.ts` |
| R-06 | 漏碰/漏胡都没有限制 | **无需实现**（不存 forbidden 状态，这本身就是实现） | `rules-conformance.test.ts` |
| R-08 | 荒庄：庄家赔每家 1 分（共 3） | `ruleConfig.score.huangZhuang` + `score/settle.ts` | `score/settle.test.ts`、`rules-conformance.test.ts` |
| R-10 | 6 位房号、无口令 | 一期单机不涉及（联机二期） | — |
| R-11 / M6-1 | 手牌炮数封顶 8 | `ruleConfig.score.cap = 8` + `score/settle.ts` | `rules-conformance.test.ts`（`cap == 8` 且计分表自己不取 min） |
| M6-2 | 只有杠分能突破封顶 | `ruleConfig.score.gang` 独立台账 + `state/apply.ts` 即时入账 | `score/settle.test.ts` |
| M6-3 | 字一色真假都是 8（封顶所致） | `score/scoreTable.ts` `COLOR_BONUS` | `score/scoreTable.test.ts` |
| M6-4 | 清一色 假 4 / 真 8 | `score/scoreTable.ts` | `score/scoreTable.test.ts` |
| M6-5 | 七星十三烂 自摸 4 / 其他 2 | `score/scoreTable.ts` `QI_XING_SCORE` | `score/scoreTable.test.ts` |
| M6-6 | 碰碰胡单调 8（对倒仍 4） | `hu/decompose.ts` `isPengPengHuDanDiao` | `hu/decompose.test.ts` |
| Q-01 | 自摸不翻倍（三家各付、单价同点炮） | `ruleConfig.score.zimoDouble = false` | `score/settle.test.ts`、`rules-conformance.test.ts` |
| Q-02 | 直杠 2（点杠者付）/ 补杠 1 / 暗杠 2（三家付）；即时结算；抢杠本次不计 | `ruleConfig.score.gang` + `state/apply.ts` | `score/settle.test.ts`、`state/apply.test.ts` |
| Q-03 | 碰碰胡 4；**无天胡/地胡**；无"绑一炮" | `score/scoreTable.ts` `STRUCTURE_SCORE`；`fanTags.ts` 不含天/地胡 | `score/scoreTable.test.ts`、`fanTags.test.ts` |
| Q-04 | 平胡 1、七对 8、归一 3/5/9、杠上开花 +4 | `score/scoreTable.ts` | `score/scoreTable.test.ts` |
| Q-05 | 一炮多响：两家都算，放炮者分别付 | `ruleConfig.claim.allowMultipleHu = true` + `action/arbiter.ts` `arbitrate()` | `action/arbiter.test.ts` |
| Q-06 | 第一局房主坐庄 | `state/gameState.ts` `startRound({ dealer: hostSeat })` 的调用约定 | `state/lobby.test.ts` |

## 没被这张表覆盖的（二期）

- 买码者中途加入/退出（R-11）
- 联机协议、断线托管、房间座位迁移
- 房号/口令（R-10）

## 偏离确认规则的地方（产品决定，2026-11）

| 项 | 确认文档 | 现在的实现 | 为什么 |
|---|---|---|---|
| 第一局定庄 | Q-06：**房主坐庄** | **两颗骰子定庄**：`(骰点之和 - 1) % 4` 即庄家座位；骰点由对局种子推导，同存档可复现。之后各局仍按 R-02（连庄 / 谁胡谁坐 / 流局对家） | 用户要求"要骰子选庄"，属产品决定覆盖确认文档 |
| 买码的版本 | spec §14 / 确认文档：R-09 未确认，**留到 V1.1** | **一期就落地**（AI 买码位、张数在前厅选），五家零和 | 用户 2026-11 口头确认了口径，提前落地；口径与推导见 `docs/superpowers/specs/2026-11-08-nanfeng-ma-design.md` |
| 买码张数的决定者 | 牌桌上由买码者每局自己决定 | 开局前由真人在界面上选（0/1/2/4），整场沿用 | 单机没有第二个真人；AI 不做"买不买"的决策，避免凭空发明策略 |
| 轮空观战视角 | 文档未定义 | **点头像切视角**：轮空那一局可以点任意一家的头像，从那个座位看出去（包含他的手牌）；在桌上时锁定自己座位 | 用户要求"点击头像和这个人视角同步"；单机不存在作弊问题，且比"四家明牌"更好读牌 |

实现位置：`useNanfengMatch.ts` 的 `rollOpening()` + `runtime/match.ts` 的 `begin(dealerOverride)`（只在第 1 局生效）。
改回文档口径只需让 `begin()` 不传 override —— 引擎本身没有假设庄家是谁。

## 使用纪律

1. 改任何判定前，先在 `rules-confirmed.md` 找到条款；找不到就是**未确认规则**，不要自行发明。
2. 改完必须同时更新本表与对应测试；`rules-conformance.test.ts` 是文档的机械对照，它红了说明代码和文档已经有一个错。
3. `sim.test.ts` 是随机对局 fuzz（同一 seed 必须完全复现），它跑不崩 ≈ 不变量恒成立。
