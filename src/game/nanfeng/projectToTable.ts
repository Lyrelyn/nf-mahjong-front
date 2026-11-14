// 南丰状态 → 现有牌桌 HUD 的视图投影。
//
// 这是"复用莲花 UI"的全部代价所在：把南丰的 GameState（整数牌码、`{kind,tile}` 副露）
// 翻成 HUD 认识的 `GamePlayer[] / ActionPrompt / GamePhase`（字符串牌、`{type,tiles}` 副露）。
//
// **所有座位下标在这里都要换成"本家视角"**：HUD 与 3D 约定 `players[0]` 是屏幕下方那家
// （`tableTilePresenter` 把 index 0 当本家、跳过它的暗手渲染，靠 DOM 手牌区画出来），
// `currentPlayer` / `dealer` / `lastDiscard.from` / `tableActionEvent.actorIndex` 也都是
// **相对**下标。南丰引擎用的是绝对座位，所以每个都要 `(seat - viewSeat + 4) % 4` 转一次。
// 5 人换座之后 `viewSeat` 不再恒等于 0 —— 漏转一次就是"牌在别人那儿"。
//
// 规则一行都不在这里：投影只做形状转换 + 提示语义映射，任何判定都回引擎。
import type { ActionPrompt, GamePhase, LastDiscard, OpeningStage } from '../core/contracts/gamePort'
import type { GamePlayer, Meld as ViewMeld, TableActionEvent, TileType } from '../core/contracts/types'
import type { Meld } from './melds'
import type { Tile } from './tiles'
import { toCode, fromCode } from './tileCodec'
import { sortTiles } from '../core/rules/tiles'
import type { NanfengSnapshot } from './useNanfengMatch'

const AVATARS = ['lotus.svg', 'ah-lok.svg', 'shisan.svg', 'young-master.svg'] as const

export interface NanfengTableProjection {
  players: GamePlayer[]
  user: GamePlayer
  phase: GamePhase
  wall: TileType[]
  wallHeadDrawn: number
  /** 牌山断点（由骰点 + 庄家算出）：3D 用它在开口处抽牌。**绝对**坐标，3D 会按 localSeat 再旋转。 */
  wallBreakIndex: number
  wallCount: number
  currentPlayer: number
  selectedIndex: number
  turnSeconds: number
  lastDiscard: LastDiscard | null
  actionPrompt: ActionPrompt | null
  announcement: null
  tableActionEvent: TableActionEvent | null
  scoreFlowEvent: null
  result: null
  winEffect: null
  winPresentation: null
  revealHands: boolean
  matchFinished: boolean
  winningPlayerIndex: number
  dealer: number
  isUserTurn: boolean
  userCanHu: boolean
  matchName: string
  roundLabel: string
  dealAnimation: { playerIndex: number; count: number; serial: number }
  openingStage: OpeningStage | null
  diceValues: number[]
  diceThrowerIndex: number
  userCurrentWaits: null
  userTingOptions: []
  userDiscardWaits: null
  userKongs: TileType[]
  userHasWindKong: boolean
}

/**
 * 南丰副露 → HUD 的副露结构（`tiles` 里要摊出真实张数，3D 靠它摆牌）。
 *
 * `from` 也要换成**相对座位**：3D 用 `(meld.from - playerIndex + 4) % 4` 判断这张副露的牌
 * 是从谁那儿来的（左边/对面/右边），那个公式里两个数都必须是相对下标
 * （`online/protocol/mapper.ts` 的 `mapMeldToLocal` 也是这么转的）。
 */
export function projectionMeld(meld: Meld, relative: (seat: number) => number): ViewMeld {
  const tile = fromCode(meld.tile)
  const repeat = meld.kind === 'PENG' ? 3 : 4
  const tiles = Array.from({ length: repeat }, () => tile)
  if (meld.kind === 'PENG') {
    return { type: 'peng', tile, tiles, from: meld.fromSeat === null ? undefined : relative(meld.fromSeat) }
  }
  if (meld.kind === 'AN_GANG') return { type: 'angang', tile, tiles }
  if (meld.kind === 'BU_GANG') return { type: 'gang', tile, tiles, added: true }
  return { type: 'gang', tile, tiles, from: meld.fromSeat === null ? undefined : relative(meld.fromSeat) }
}

function avatarOf(seat: number): string {
  const file = AVATARS[seat % AVATARS.length] ?? AVATARS[0]
  return `${import.meta.env.BASE_URL}avatars/${file}`
}

/**
 * 屏幕下方那家的手牌：暗牌按升序 + 刚摸到的那张放最后（HUD 用 `drawnTileIndex` 单独摆开）。
 *
 * 在桌上时这就是你自己的手，所以"摸牌位只在轮到你出牌时存在"的那条规则照旧：
 * 引擎的 `drawnTile` 要到下次摸牌才并回暗牌（杠上开花要用它），但界面上你打完一张之后，
 * 那张牌就该回到手牌里重新排序 —— 否则会一直单挂在最右边，看着像"手牌永远是 14 张"。
 * 轮空观战时（`humanSeat === -1`）不会有待决点，所以走的是"并回去排序"的分支。
 */
function localHand(snapshot: NanfengSnapshot): { hand: TileType[]; drawnTileIndex: number } {
  const tiles = (snapshot.own.tiles ?? []).map(fromCode)
  // 发牌演出期间：只露出已经"发到"的几张，摸牌位不存在 —— 开局时就是空手。
  if (snapshot.dealtCount !== null) {
    return { hand: sortTiles(tiles.slice(0, snapshot.dealtCount)), drawnTileIndex: -1 }
  }
  const pending = snapshot.pending
  const onTurn = snapshot.humanSeat >= 0
    && snapshot.viewSeat === snapshot.humanSeat
    && pending?.kind === 'turn'
    && pending.seat === snapshot.humanSeat
  if (snapshot.own.drawn === null || snapshot.own.drawn === undefined) {
    return { hand: sortTiles(tiles), drawnTileIndex: -1 }
  }
  if (!onTurn) return { hand: sortTiles([...tiles, fromCode(snapshot.own.drawn)]), drawnTileIndex: -1 }
  tiles.push(fromCode(snapshot.own.drawn))
  return { hand: tiles, drawnTileIndex: tiles.length - 1 }
}

function playerOf(
  snapshot: NanfengSnapshot,
  seat: number,
  relative: (seat: number) => number,
): GamePlayer {
  // `isLocal`：屏幕下方那家（手牌走 DOM）；`isHuman`：这个座位坐的是不是真人。
  // 轮空观战时两者不是同一个人 —— 下方是你看的那个人，真人在买码席上。
  const isLocal = seat === snapshot.viewSeat
  const isHuman = seat === snapshot.humanSeat
  const local = localHand(snapshot)
  const melds = (snapshot.seats[seat]?.melds ?? []).map((meld) => projectionMeld(meld, relative))
  return {
    name: snapshot.seatNames[seat] ?? `座位 ${seat}`,
    avatar: avatarOf(seat),
    playerKind: isHuman ? 'human' : 'bot',
    score: snapshot.scores[seat] ?? 0,
    seat,
    hand: isLocal ? local.hand : [],
    concealedTileCount: isLocal
      ? undefined
      : snapshot.dealtCount !== null
        ? Math.min(snapshot.seats[seat]?.count ?? 0, snapshot.dealtCount)
        : (snapshot.seats[seat]?.count ?? 0),
    discards: (snapshot.discards[seat] ?? []).map(fromCode),
    melds,
    redCount: 0,
    drawnTileIndex: isLocal ? local.drawnTileIndex : -1,
  }
}

function phaseOf(snapshot: NanfengSnapshot): GamePhase {
  // 开局演出期间一律按 dealing 交给 HUD：手牌先不显示，等发牌动画把它们一张张摆出来。
  if (snapshot.opening !== null) return 'dealing'
  if (snapshot.status === 'round-over') return 'settled'
  const pending = snapshot.pending
  if (pending === null) return 'playing'
  if (pending.kind === 'claim') return 'prompt'
  return pending.seat === snapshot.humanSeat ? 'discard' : 'thinking'
}

function promptOf(snapshot: NanfengSnapshot, relative: (seat: number) => number): ActionPrompt | null {
  const pending = snapshot.pending
  if (pending === null || pending.kind !== 'claim') return null
  if (snapshot.humanSeat < 0 || pending.seat !== snapshot.humanSeat) return null
  const types = new Set(pending.options.map((option) => option.type))
  const tile = pending.tile === null ? ('m1' as TileType) : fromCode(pending.tile)
  const from = relative(pending.from ?? 0)
  // 抢杠窗口只有 HU / PASS：用 type='rob'，HUD 只渲染「胡 / 过」两个按钮。
  if (!types.has('PENG') && !types.has('MING_GANG')) {
    return { type: 'rob', tile, from, canHu: types.has('HU') }
  }
  return {
    type: 'claim',
    tile,
    from,
    canHu: types.has('HU'),
    canPeng: types.has('PENG'),
    canGang: types.has('MING_GANG'),
  }
}

/** 本家可以暗杠/补杠的牌（HUD 的杠按钮要用具体牌码）。 */
function userKongsOf(snapshot: NanfengSnapshot): TileType[] {
  const pending = snapshot.pending
  if (pending === null || snapshot.humanSeat < 0) return []
  if (pending.seat !== snapshot.humanSeat || pending.kind !== 'turn') return []
  return pending.options
    .filter((option) => (option.type === 'AN_GANG' || option.type === 'BU_GANG') && option.tile !== null)
    .map((option) => fromCode(option.tile as Tile))
}

/** 桌面动作字里的座位下标也要换成相对下标（否则 3D 会把动作字放到别人头上）。 */
function shiftAction(
  event: TableActionEvent | null,
  relative: (seat: number) => number,
): TableActionEvent | null {
  if (event === null) return null
  return {
    ...event,
    actorIndex: relative(event.actorIndex),
    sourceIndex: event.sourceIndex === null ? null : relative(event.sourceIndex),
  }
}

export function projectToTable(snapshot: NanfengSnapshot): NanfengTableProjection {
  const view = snapshot.viewSeat
  const relative = (seat: number): number => (seat - view + 4) % 4
  const players = Array.from({ length: 4 }, (_, index) => playerOf(snapshot, (view + index) % 4, relative))
  const user = players[0]!
  const lastDiscard: LastDiscard | null = snapshot.lastDiscard === null
    ? null
    : {
        tile: fromCode(snapshot.lastDiscard.tile),
        from: relative(snapshot.lastDiscard.seat),
        id: snapshot.discards[snapshot.lastDiscard.seat]?.length ?? 0,
      }

  // 发牌演出期间让牌墙跟着"被发走"而变短：136 − 预留码牌 − 4×已发张数（纯视觉，真实余牌在引擎里）。
  // 码牌从牌墙末尾留出、谁都不摸，所以起点就要减去它们，否则演出一结束牌墙会多出 N 张。
  const dealt = snapshot.dealtCount
  const maReserved = snapshot.ma.count
  const wallCount = dealt === null ? snapshot.wallCount : Math.max(0, 136 - maReserved - 4 * dealt)
  // 开口位置同理：演出时从断点处一张张往回走，别一上来就显示"已经摸了 53 张"。
  const wallHeadDrawn = dealt === null ? snapshot.wallHeadDrawn : 4 * dealt

  const pending = snapshot.pending
  const humanOnTurn = snapshot.humanSeat >= 0
    && snapshot.viewSeat === snapshot.humanSeat
    && pending !== null
    && pending.kind === 'turn'
    && pending.seat === snapshot.humanSeat

  return {
    players,
    user,
    phase: phaseOf(snapshot),
    // 牌墙只影响"还剩几墩"的视觉：用同一种牌码填满，HUD/3D 只按数量摆牌背。
    wall: Array.from({ length: wallCount }, () => 'm1' as TileType),
    wallHeadDrawn,
    wallBreakIndex: snapshot.wallBreakIndex,
    wallCount,
    currentPlayer: relative(snapshot.turn),
    selectedIndex: -1,
    turnSeconds: 0,
    lastDiscard,
    actionPrompt: promptOf(snapshot, relative),
    announcement: null,
    tableActionEvent: shiftAction(snapshot.tableActionEvent, relative),
    scoreFlowEvent: null,
    result: null,
    winEffect: null,
    winPresentation: null,
    // 轮空观战时不亮别人的牌：想看谁就点头像切过去（切过去之后那家就是"本家"）。
    revealHands: false,
    matchFinished: false,
    winningPlayerIndex: -1,
    dealer: relative(snapshot.dealer),
    isUserTurn: humanOnTurn,
    userCanHu: humanOnTurn
      && (pending?.options.some((option) => option.type === 'HU') ?? false),
    matchName: '南丰麻将',
    roundLabel: `第 ${snapshot.round} 局`,
    // `playerIndex: -1` 表示"没有正在进行发牌动画"。填 0 会被 3D 当成"座位 0 正在发牌、
    // 已发 0 张"，于是把自己那手牌整个隐藏 —— 表现就是"别人有牌，我没有"。
    dealAnimation: {
      ...snapshot.dealAnimation,
      playerIndex: snapshot.dealAnimation.playerIndex < 0
        ? -1
        : relative(snapshot.dealAnimation.playerIndex),
    },
    openingStage: snapshot.opening?.stage ?? null,
    diceValues: [...snapshot.dice],
    diceThrowerIndex: relative(snapshot.dealer),
    userCurrentWaits: null,
    userTingOptions: [],
    userDiscardWaits: null,
    userKongs: userKongsOf(snapshot),
    userHasWindKong: false,
  }
}

/** 出牌：HUD 给的是"本家手牌数组的下标"，这里翻回牌码。 */
export function tileOfHandIndex(snapshot: NanfengSnapshot, index: number): Tile | null {
  const { hand } = localHand(snapshot)
  const tile = hand[index]
  return tile === undefined ? null : toCode(tile)
}
