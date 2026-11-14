# 南丰联机接入 · 改动清单（nf-mahjong-front）

> 状态：待评审。**本文不写代码**，只列"改哪些文件、每处改什么、为什么"。
> 后端已就绪：南丰规则内核 + 5 连接位房间 + 买码 + REST/WS，见 `F:\projects\nf-mahjong-backend`。

## 0. 结论先行

前端其实已经具备两半：

- **南丰本地对局**：`src/game/nanfeng/`（规则内核 + AI + `useNanfengMatch`），入口是**根地址的南丰大厅**
  （旧的莲花大厅退到 `?game=lotus`）→ `NanfengApp.vue` → `NanfengTable.vue`（纯 DOM 牌桌 + 复用 `GameTableHud`）。
- **通用联机基础设施**：`src/game/online/ws/transport/roomSocket.ts`（重连 / 心跳 / 卡顿检测）
  与 `src/game/online/ws/api/roomApi.ts`（REST 房间），都是**与玩法无关**的。

所以接入方式很省：**给已有的 `NanfengMatchApi` 写第二个实现**，UI 只换一行。

| 方案 | 判断 |
|---|---|
| 复用 `online/ws/useRemoteGame.ts`(600 行) + `protocol/*` + `snapshotReconciler.ts`(481 行) | ❌ 全是**旧莲花/血流协议**（`turn_request`/`claim_request`/`table_action`/`score_flow`/`joker`/`flipTile`/`honba`/`dice`/LLM 台词），南丰一个都用不上 |
| 新写 `nanfeng/remote/`（3-4 个文件）+ 复用 `roomSocket` + `roomApi` | ✅ 建议 |
| 把南丰塞进 `remoteGameState`(110 行 ref 大杂烩) | ❌ 会把灵牌/翻精/庄番这些死字段拖进南丰链路 |

## 1. 唯一的接口决策：同一份 `NanfengMatchApi`，两种实现

`src/game/nanfeng/useNanfengMatch.ts:60-72` 定义的契约：

```ts
export interface NanfengMatchApi {
  snapshot: ShallowRef<NanfengSnapshot>
  start: () => void
  nextRound: () => void
  discard: (tile: Tile) => void
  submit: (type: ActionOption['type']) => void
  canAct: () => boolean
}
```

联机版返回**同一个接口**，语义映射如下：

| 接口 | 本地（现在） | 联机（新） |
|---|---|---|
| `start()` | `match.begin()` | 房主 `startRoom()`；其他人等快照 |
| `nextRound()` | `match.nextRound()` | **空操作**（服务端自动开下一局） |
| `discard(tile)` | `match.act(...)` | 发 `{kind:'action', type:'DISCARD', tile, reqId}` |
| `submit(type)` | `match.act(...)` | 发 `{kind:'action', type, tile}`（tile 从 `options` 里取） |
| `canAct()` | `pending.seat === humanSeat && kind === 'turn'` | `snapshot.viewer.seat === snapshot.turn && phase === 'WAITING_PLAY'` |

### `NanfengSnapshot` 需要补的字段（新增，本地实现给默认值即可，向后兼容）

| 字段 | 为什么需要 |
|---|---|
| `viewer: { kind: 'player' \| 'spectator', seat: number \| null }` | 南丰有**第 5 人轮空**，他的 `seat` 是 null，UI 不能按"我有座位"来渲染 |
| `seating: { table: (number\|null)[], sittingOut: number \| null }` | 换座后"谁是谁"变了，牌桌要按它摆人 |
| `totalScores: Record<number, number>` | **按人**累计分（引擎的 `scores` 每局从 0 开始，换座会在座位上跳） |
| `ma: { count: number; delta: number; detail: Array<{ tile: number; seat: number; delta: number }> }` | 买码：局中只显示"买了几张"，结算才亮牌 |
| `claimDeadlineAt: number \| null` | 鸣牌窗口倒计时（服务端给的是绝对时间） |
| `connection: 'idle' \| 'connecting' \| 'connected' \| 'reconnecting' \| 'closed'` | 断线提示；`roomSocket` 已有这个 status，直接透出 |

## 2. 新增文件（4 个）

| 文件 | 职责 | 规模估计 |
|---|---|---|
| `src/game/nanfeng/remote/protocol.ts` | 上行动作编码 + 下行消息类型 + `decodeSnapshot(raw) → NanfengSnapshot`。**纯函数，好测** | ~150 行 |
| `src/game/nanfeng/remote/useNanfengRemoteMatch.ts` | 实现 `NanfengMatchApi`：REST（建房/加入/准备/开局）+ `createRoomSocketTransport` + 快照落位 + 动作上行（`reqId` 幂等） | ~250 行 |
| `src/game/nanfeng/remote/roomSessionStore.ts` | `{roomId, rejoinCode, seat}` 存 `localStorage`，刷新/换标签页走 `rejoin_code` 重连 | ~60 行 |
| `src/components/nanfeng/NanfengOnlinePanel.vue` | 极简房间面板：建房（选 `maCount` 0/1/2/4）、输入 6 位房号加入、准备、房主开局、5 个座位状态、"你轮空"提示 | ~150 行 |

## 3. 要改的现有文件（5 个，改动都很小）

| 文件 | 改什么 |
|---|---|
| `src/game/core/rules/ruleVariants.ts:1` | `RuleVariant` 联合加 `'nanfeng'`；`RULE_VARIANTS` 加一项（名称/描述/`rulesetId: 'nanfeng'`） |
| `src/game/online/ws/api/roomApi.ts:101` | `createRoom(...)` 增加 `maCount`；`RoomInfo` 增加 `maCount`、`sittingOutSeat`；`JoinResult` 增加 `avatar`。其余（`characterId`/`llmSeats`/`reserveLlmSeat`）**保留不动**，南丰不调用即可 |
| `src/game/online/ws/transport/roomSocket.ts:82` | 心跳载荷 `{ type: 'ping', t }` → `{ kind: 'ping' }`（见 §5，也可由后端兼容） |
| `src/components/nanfeng/NanfengTable.vue:8-17` | 加 `props.mode?: 'local' \| 'online'`；online 时改用 `useNanfengRemoteMatch`；**轮空时**隐藏自己的手牌区、显示"本局轮空 · 观战中"；动作按钮文案不变（`ACTION_LABEL` 已覆盖 DISCARD/PASS/HU/PENG/GANG） |
| `src/main.ts:6-10` | 增加 `?game=nanfeng&online=1`（或 `/nanfeng/online`）分支挂载 `NanfengOnlinePanel` → `NanfengTable` |

## 4. 明确**不复用**的部分

`src/game/online/ws/` 下这些是按旧后端协议写的，南丰不接：

- `useRemoteGame.ts`（600 行）、`useBloodFlowRemoteGame.ts`（408 行）
- `protocol/{messages,dto,decoder,mapper}.ts`（消息词汇是 `round_start`/`turn_request`/`claim_request`/`hand_result`…）
- `orchestration/snapshotReconciler.ts`（481 行，把莲花快照映射成 `remoteGameState` 那堆 ref）
- `orchestration/remoteActionController.ts`、`state/remoteGameState.ts`

**可以借鉴思路但建议重写**：`session/remoteRoomLifecycle.ts`（404 行）。它把"建房→加入→准备→开局→离开→恢复"的时序做全了，但里面掺着 `updateCharacter` / `reserveLlmSeat` / `llm*` / 默认 `'lotus-classic'`，且绑在 `remoteGameState` 的 ref 上。南丰版约 120 行就够。

## 5. 后端要配合的两处小改（我来改，各 3 行）

1. **`POST /api/rooms/{id}/start` 接受可选的 `playerId` 请求体**。
   现在 `start` 没有 body，`WAKUDEMO_LOGIN_BYPASS=true` 本地联调时 bypass 身份是固定的
   `dev-bypass`，与房主不一致 → 前端一点"开局"就 `403 NOT_CREATOR`。
   （冒烟脚本里我已经是靠在 start body 里塞 `playerId` 绕过的，正式接口应该支持。）
2. **WS 心跳兼容 `{type:'ping'}`**：前端现网约定是 `{type:'ping',t}`，后端认 `{kind:'ping'}`。
   两个都收最省事（也方便以后接别的客户端）。

## 6. 联调怎么跑（路径已经通了大半）

- 后端：`uvicorn app.main:app --port 8000`，本地设 `WAKUDEMO_LOGIN_BYPASS=true`。
- 前端：`npm run dev`（4173）。`vite.config.ts:42-50` 已把 `/api`、`/ws` 代理到
  `http://127.0.0.1:8000`，同源直连，不需要改 CORS。
- 验收：开 5 个标签页 `?game=nanfeng&online=1`，同房号加入 → 4 人准备 → 房主开局 →
  打满 4 局，检查**换座**、**买码翻开**、**一炮多响**、**轮空者看不到手牌**。

## 7. 测试

| 测试 | 内容 |
|---|---|
| `src/game/nanfeng/remote/protocol.test.ts` | `decodeSnapshot` 的三种视角（打牌者 / 轮空 / 未开局）+ 动作编码 + 未知 kind 容错 |
| `src/game/nanfeng/remote/useNanfengRemoteMatch.test.ts` | 用假 socket + 假 `fetch` 喂消息，断言 `snapshot` 落位与 `canAct()` |
| 现有 `npm test` | `vitest` 只扫 `src`，新目录自动纳入，不需要改配置 |

## 8. 落地顺序与风险

1. `protocol.ts` + 它的测试（纯函数，不依赖网络）
2. `useNanfengRemoteMatch.ts` + 假 socket 测试
3. `roomApi` / `ruleVariants` / `roomSocket` 三处小改
4. `NanfengOnlinePanel.vue` + `NanfengTable.vue` 接线
5. 5 标签页真机验收

**主要风险**：轮空者视角。`NanfengTable.vue` 现在默认 `snap.own.tiles` 一定存在，
联机下轮空者是 `viewer.kind === 'spectator'`、`own` 为空 —— 必须在 UI 层显式处理，
否则会渲染成"手牌 0 张"而不是"你在观战"。

## 9. 复核补充（读完 600 行 `useRemoteGame.ts` 及同链路后）

### 9.1 三条修正

1. **`decoder.ts` 不可救，必须整写**（原清单只写"不复用"，这里给出证据）：
   - `decoder.ts:53` `isTile` 只认 `'m1'/'east'` 这类字符串，南丰是整数牌码 11..；
   - `decoder.ts:184` `rejoin_ok` **强制要求 `mode`**，而南丰 rejoin_ok 发的是
     `matchLength/matchId/avatar/slots`、没有 `mode` → 若复用，连接会"静默无响应"；
   - `decoder.ts:145` `rulesetId` 白名单只有 lotus 三种，南丰会被直接丢弃；
   - `decoder.ts:142` `isSnapshot` 要求 20+ 莲花字段（`wallCount/headDrawn/players/result/jokers/...`）。
2. **交互模型不兼容，确认了"新写实现"而不是"改字段"**：莲花让服务端**单独推**
   `turn_request`/`claim_request`/`rob_kong_request` 来驱动按钮（`useRemoteGame.ts:459-461`
   + `requestCoordinator`），而南丰把可操作项塞在 `state_snapshot.options/claim` 里、从不单独推。
   任何"复用莲花分派表"的路线都要把按钮来源整体改写。
   → 我们的 `NanfengMatchApi` 双实现天然规避：`snap.pending` 直接由快照派生。
3. **换座让"本家固定 0 号位"不再成立**（新增的 UI 必改点）：
   `NanfengTable.vue` 现在用 `opponents = 所有座位 except humanSeat` 摆人，
   而南丰每局换座后**本家所在桌位会变**（`viewer.seat` 每局可能不同）。
   → 每一局都要按 `seating.table` 重算"谁在哪"，不能缓存。

### 9.2 两条实现决策（已定，写进代码注释）

- **只用快照，忽略事件**：`discard_bc`/`meld_bc`/`settle`/`hu_result` 一律不驱动状态，
  只做动画/音效（一期甚至可以先不接）。后端本来就是"先广播事件、随后必然补发快照"
  （`nanfeng_room.py` 的 `_broadcast_events`），所以丢事件不会丢状态。
- **`seq` 单调，客户端只认更新**：快照带 `seq`，客户端保存 `lastAppliedSeq`，
  收到 `seq <= lastAppliedSeq` 直接丢 —— 防重连/重放导致的回退。

### 9.3 复核后确认"可以留"的东西（比原清单多两处）

| 可留 | 说明 |
|---|---|
| `transport/roomSocket.ts` | 与协议无关（URL + 重连 + 心跳 + 卡顿检测），只改心跳载荷 |
| `orchestration/snapshotReconciler.ts` 的**三分支缓冲**（结算中挂起 / 开局中挂起 / 直接应用） | 南丰结算后也会"立刻开下一局"，同样存在"结算动画期间来了新快照"的问题；这套缓冲思路值得照搬（字段落地层全换） |
| `presentation/settlementTimeline.ts` | 纯表现时序（胡牌动画→亮牌→结算面板 + 音效），与协议无关，只需要换入参 |

