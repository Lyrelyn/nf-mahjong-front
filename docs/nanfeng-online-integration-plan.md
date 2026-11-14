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

## 5. 后端**零改动**；但前端有两处必须做（2026-11 实测更新）

后端自带开发旁路：`.env` 里 `WAKUDEMO_LOGIN_BYPASS=true` 时，`app/api/deps.py` 的
`require_wakudemo_login` 会把**请求体里的 `playerId`** 当身份（缺省 `dev-bypass`），
身份键是 `wakudemo-<playerId>`。已实测通过，所以后端不需要改任何代码 —— 但前端必须做这两处：

### 5.1 `POST /api/rooms/{id}/start` 必须带房主的 `playerId`

后端 `/start` 不声明 body 模型，它按请求体里的 `playerId` 认身份。实测三例：

| 请求体 | 结果 |
|---|---|
| `{}` | **403 `NOT_CREATOR`**（身份退化成 `dev-bypass`，与房主不一致） |
| `{"playerId":"<房主>"}` | 200，`status=playing`、`phase=WAITING_PLAY`、`matchId` 已建 |
| `{"playerId":"<非房主>"}` | 403 `NOT_CREATOR`（反证身份确实按 `playerId` 解析） |

→ `roomApi.ts:153 startRoom(roomId, llmSeats)` 现在发 `{}` 或 `{llmSeats}`，
南丰版必须发 `{ playerId }`。**这是接入时最容易卡住的一条**（其余接口的 body 里本来就带 `playerId`）。

### 5.2 WS 心跳必须发 `{ kind: 'ping' }`

实测（真实 WS 连接）：

| 发送 | 收到 |
|---|---|
| `{"kind":"ping"}` | `{"kind":"pong"}` ✅ |
| `{"type":"ping","t":1}` | `{"kind":"error","code":"ROOM_NOT_PLAYING"}` ❌ 无 pong |

→ `roomSocket.ts:82 startPing()` 现在发 `{type:'ping',t}`，要改成 `{kind:'ping'}`。
不改的后果：每 5 秒一条 error 日志；`postReconnectPongs` 永不递增 →
重连后 `signalQuality` 恒为 1（信号栏永久降级）。

### 5.3 联调注意

- 5 个窗口要 **5 个不同 `playerId`**（同一身份只能在一个房间 → `ALREADY_IN_ROOM`）。
- `ROOM_MAX` 默认 4，几轮测试就满（**对局中的房间不会被 TTL 回收**，只能重启服务或打完）
  → 联调时把 `.env` 的 `ROOM_MAX` 调大。
- `/docs` 默认关闭，要用得在 `.env` 里设 `DOCS_SHOW=True`。

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

---

## 10. `nf-mahjong-backend` 的真实协议（从源码抄的，2026-11）

> 上面 §7 引用的是**旧 Cocos 客户端 + 房主权威 P2P** 的 `JOIN_REQ/SNAPSHOT/seq` 协议，
> **不是这个 FastAPI 后端在跑的协议**。下面这张表才是联调要对着写的东西，
> 出处：`app/api/rooms.py`、`app/ws/game_ws.py`、`app/game/nanfeng_room.py`。

### 10.1 REST（`app/api/rooms.py`）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/rooms` | 建房（返回 roomId 等） |
| GET | `/api/rooms/meta` | 房间元数据 |
| GET | `/api/rooms/{room_id}` | 房间状态 |
| POST | `/api/rooms/{room_id}/join` | 加入（签发 `rejoin_code`） |
| POST | `/api/rooms/{room_id}/leave` | 离开 |
| POST | `/api/rooms/{room_id}/ready` | 准备 |
| POST | `/api/rooms/{room_id}/start` | 开局（房主） |
| DELETE | `/api/rooms/{room_id}` | 关房 |

> 请求/响应字段还没抄（`rooms.py` 135-263 的 pydantic 模型），下一轮补。

### 10.2 WS（`/ws/room/{room_id}?rejoin_code=<code>`）

连接即鉴权：`rejoin_code` 由 REST join 签发，**必须带上**，否则直接拒。

**握手失败**（发完即关）：

```json
{ "kind": "rejoin_err", "code": "ROOM_NOT_FOUND | REJOIN_CODE_REQUIRED | REJOIN_RATE_LIMITED | …" }
```

**握手成功**：先发一条身份帧，再发一份**该连接位的完整快照**：

```json
{ "kind": "rejoin_ok", "seat": 2, "rejoin": true, "roomId": "ABC123",
  "rulesetId": "…", "matchLength": 4, "matchId": "…",
  "nickname": "你", "avatar": "", "rejoinCode": "…", "slots": 5 }
```

**下行 `kind`（已确认）**

| kind | 载荷要点 |
|---|---|
| `state_snapshot` | 该连接位有权看到的全量视图（字段见 `snapshot_for()` 476-517，待抄） |
| `draw` | `{tile, seat}` —— **私有**，只发摸牌者 |
| `discard_bc` | `{seat, tile}` 公开 |
| `meld_bc` | `{seat, meld}` 公开 |
| `hu_result` | 胡牌结果（公开） |
| `settle` | `{deltas, …}` 结算（公开；含买码位） |
| `huang_zhuang` | 荒庄（公开） |
| `seating_changed` | 换座（5 人轮换，公开） |
| `match_finished` | 全场结束，可能带 `forced: true` |
| `pong` | 心跳应答 |
| `error` | `{code}` —— 某条请求失败（**不是**被踢） |

**上行**：客户端只发意图，服务端校验后广播。具体 `kind` 清单在
`nanfeng_room.py` 的 `handle_client_message(slot, message)`（337 行起），下一轮抄进来。

### 10.3 与前端现有实现的对接方式

- **权威方变成服务端**：我们自己的 `useNanfengHost`（房主权威）在这条路上**不用**——
  服务端已经权威了；前端只需要 `useNanfengGuest` 那种"收快照→渲染、动作→发出去"的实现。
- 因此前端要写的只有一个 `wsNanfengClient`：REST 建房/加入/准备/开始 + WS 收帧/发意图，
  然后把 `NanfengOnlinePanel` 的数据源从 VibeHub session 换成它。
- 掉线自动代打是**服务端**做的（`_auto_play_after`），所以不用搬旧的"AI 夺舍"逻辑。
- 重连：带上 `rejoin_code` 重新握手，服务端会补 `state_snapshot`（`RESYNC_REQ` 这类不需要）。

### 10.4 上行只有两种包（`handle_client_message`，337 行）

```jsonc
{ "kind": "ping" }                                        // → {kind:'pong'}
{ "kind": "action", "type": "DISCARD", "tile": 21, "reqId": 7 }
// kind 也可以写 "act"；type 就是引擎的 ActionType：
// DISCARD / PENG / MING_GANG / BU_GANG / AN_GANG / HU / PASS
// 出牌为 null、PASS 为 null
```

**准备、开局、加入、离开都是 REST，不走 WS。** 失败回 `{kind:'error', code}`：
`UNKNOWN_MESSAGE` / `ROOM_NOT_PLAYING` / `SITTING_OUT` / `SEAT_RELEASED` / 引擎校验错误。

### 10.5 快照字段（`snapshot_for` + `project_view`，全部已抄）

房间层：

| 字段 | 含义 |
|---|---|
| `roomId` `rulesetId` `matchLength` `matchFinished` | 房间信息 |
| `maCount` | 本局买几张码牌（公开；牌面只在结算后出现） |
| `seating.table` | 4 个打牌位 → slot（`null` = 空位） |
| `seating.sittingOut` | 本局轮空买码的 slot |
| `slots[]` | `{slot, nickname, avatar, ready, connected}`，`null` = 空位 |
| `totalScores` | `{slot: 累计分}`（按人，不按椅子） |

引擎投影（`project_view`）：

| 字段 | 含义 / 前端映射 |
|---|---|
| `seq` | 单调序号，`<= lastAppliedSeq` 直接丢 |
| `round` `phase` `dealer` `turn` `wallLeft` | 直接映射 |
| `scores` | 4 个**打牌座位**的累计分（服务端已按人重算） |
| `roundGangScore` | 本局杠分台账 |
| `discards` | 4 条牌河 |
| `melds[]` | 4 家的副露 `{kind, tile, fromSeat}` |
| `handSizes[]` | 结构张数（副露算 3 位） |
| `lastDiscard` | `{seat, tile}` |
| `claim` | `{triggerSeat, triggerTile, gangSeat, pending[], deadlineAt, options[]}`；**只有轮到你自己响应时 `options` 才非空** |
| `maCount` `maScore` | 买码张数 / 买码位累计分 |
| `lastSettle` | `{deltas, detail[], maDelta, maDetail[]}`（与前端 `SettleSnapshot` 同形） |
| `lastOutcome` | `{kind, loserSeat, winners[{seat,zimo,gangShang,qiangGang,tags}]}` |
| `viewer` | `{kind:'player'|'spectator', seat}` |
| `hand` | **只有自己**：`{concealed[], drawnTile, melds[], justPeng}`；观战者为 `null` |
| `options[]` | **只有自己**：`{type, priority, distance, tile, huPreview}`（自己的回合/响应） |

映射到前端 `NanfengSnapshot` 的规则：

- `own` ← `hand`（`concealed` 就是整数牌码，不用转换）；`seats[i]` ← `handSizes[i]` + `melds[i]`；
- `pending` ← `claim`（`kind:'claim'`，`seat` = `viewer.seat`，`tile`=`triggerTile`，`from`=`triggerSeat`；`gangSeat !== null` 时按"抢杠"只给胡/过）；
  自己的回合没有 `claim`，用 `options` 合成 `kind:'turn'`；
- `settle` ← `lastSettle`，`outcome` ← `lastOutcome`，`ma` ← `maCount`/`maScore`/`lastSettle.maDetail`，`buyerName` ← `seating.sittingOut` 查 `slots`；
- 3D 牌墙：`wallCount` ← `wallLeft`，`wallHeadDrawn` ← `136 - maCount - wallLeft`；**服务端不发骰点**，`dice` 用 `[1,1]` 兜底（只影响牌山开口的观感）；
- `seatNames` ← `slots` 的昵称（按 `seating.table` 顺序），观战者自己的名字取 `slots[sittingOut]`。

### 10.6 请求体与鉴权（`rooms.py` 106-134 / 135-274）

```jsonc
// POST /api/rooms
{ "mode": "east",        // east | hanchan，默认 east（本作只有一种场制，先用 east）
  "capacity": 5,         // 后端写死 5 个连接位；传 2/3/4 也按 5 处理
  "matchLength": 4,      // 4 | 8 | 16（庄数）
  "maCount": 0,          // 0 | 1 | 2 | 4
  "rulesetId": "nanfeng" // 只接受南丰，其他值 409
}

// POST /api/rooms/{id}/join
{ "nickname": "你", "avatar": "" }        // nickname 1..20

// POST /api/rooms/{id}/ready | leave | DELETE /api/rooms/{id}
{ "seat": 2, "rejoinCode": "…", "ready": true }   // ready 只有 ready 接口用
```

返回：`create` → 房间视图；`join` → `{roomId, seat, rejoinCode, …}`；`ready` → `{roomId, seat, ready}`；
`start` → `{roomId, status}`；`leave` → `{roomId, seat, left}`；`close` → `{roomId, closed}`。

> **⚠ 鉴权**：`create / meta / get / join / start` 都带 `Depends(require_wakudemo_login)`，
> 也就是**必须先有 WakuDemo 登录会话**（HttpOnly cookie）才能建房/加入/开局；
> `ready / leave / close` 只认 `rejoinCode`，不需要登录。
>
> 结论：**后端联机 = WakuDemo 登录 + 本后端**。部署时要配 `WAKUDEMO_CLIENT_ID / BASE_URL /
> REDIRECT_URI / FRONTEND_URL`，前端要有登录入口（独立站那张账号卡片）。如果不想接 WakuDemo，
> 就得改后端把 `require_wakudemo_login` 换成匿名/自定义 token —— 那是后端仓库的改动。

### 10.7 前端已经有一整套 WS 联机栈，别重写（2026-11 复核）

`src/game/online/ws/**` 是**同一个后端**的现成客户端（旧玩法在用，`VITE_ONLINE_BACKEND=ws` 切换），
它跟我们的 §10 协议是同一套。按"原样复用 / 需要南丰化"分开：

| 原样复用 | 理由 |
|---|---|
| `transport/roomSocket.ts` | 只做 URL + 重连 + 心跳 + 卡顿检测，与玩法无关（只需确认心跳包是 `{kind:'ping'}`） |
| `api/roomApi.ts` + `api/httpClient.ts` | 就是 §10.1 那 8 个端点（同一后端 fork），字段一致 |
| `session/remoteSessionStore.ts` | 房号 / `rejoinCode` / 上次座位 的本地持久化，重连要用 |
| `session/remoteRoomLifecycle.ts` | 建房/加入/准备/开始/关闭的时序编排（`rejoinCode` 复位、409 处理） |
| `session/roomPanelSync.ts` | 房间面板与后端状态的同步 |
| `presentation/openingTimeline.ts`、`settlementTimeline.ts` | 纯表现时序 |
| `orchestration/snapshotReconciler.ts` | 三分支缓冲（结算中/开局中挂起），南丰同样需要 |

| 需要南丰化（新写，别改旧的） | 理由 |
|---|---|
| `protocol/messages.ts` 的南丰版 + `decoder` | 下行 `kind` 是南丰的（`state_snapshot` / `draw` / `settle` / `seating_changed` …），旧的是莲花字段 |
| **快照 → `NanfengSnapshot` 的映射** | 见 §10.5，纯函数，放 `src/game/nanfeng/net/wsSnapshot.ts`，可直接单测（输入后端快照 JSON，输出我们投影要的形状） |
| `useNanfengWsGame.ts` | 把上面几块粘成 `NanfengMatchApi`（`snapshot` / `discard` / `submit` / `nextRound` / `canAct` / `setViewSeat`），喂给 `NanfengTable` |

**所以工作量比原计划小很多**：不用写传输层，也不用碰 VibeHub 那套；核心就是一个纯函数映射
（`wsSnapshot.ts`，可单测）+ 一个薄胶水（`useNanfengWsGame`）+ 房间面板换数据源。

> 前提仍是 §10.6 的 WakuDemo 登录：独立站那张账号卡片（`src/account/wakudemo/`）必须接上，
> 否则 `create/join/start` 会 401。

