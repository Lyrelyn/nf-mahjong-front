// 南丰联机的房间层：复用旧 VibeHub 的建房/加房/座位/准备（`createVibeRoomSession`），
// 开局后把每条消息交给南丰自己的房主/客机实现。
//
// 分工：
//   - 房间/大厅/座位/准备：旧实现（`src/game/online/vibe/**`），一行不改；
//   - 对局同步：`src/game/nanfeng/net/**`（房主权威 + 按座位脱敏）；
//   - 这里只做胶水：把 SDK 的 room 接到 `sendChunked` / `unwrapChunk`。
import { effectScope, onScopeDispose, ref, shallowRef, type Ref } from 'vue'
import { createVibeRoomSession } from '../../game/online/vibe/vibeRoomSession'
import { getVibeClient, initVibeHub } from '../../game/online/vibe/vibeClient'
import { sendChunked, unwrapChunk } from '../../game/online/transport/vibeRoomTransport'
import type { LobbySeat } from '../../game/online/vibe/vibeLobby'
import type { PublicAiSeat } from '../../game/online/vibe/vibeLlm'
import type { MatchType } from '../../game/core/contracts/types'
import type { RuleVariant } from '../../game/core/rules/ruleVariants'
import type { TableThemeName } from '../table/three/tableTheme'
import { useNanfengHost } from '../../game/nanfeng/net/host'
import { useNanfengGuest } from '../../game/nanfeng/net/guest'
import type { NanfengMatchApi } from '../../game/nanfeng/useNanfengMatch'

/** 联机固定 5 人（4 人打 + 1 人轮空买码），所以房间连接位是 5。 */
const ONLINE_CAPACITY = 5

export interface NanfengOnlineOptions {
  /** 人数：4 = 固定四人；5 = 5 人轮换（4 人打 + 1 人轮空买码）。建房时就定，决定房间连接位。 */
  players: () => 4 | 5
  /** 买码张数（5 人局才有；房主可改，开局时读一次）。 */
  maCount: () => number
  themeName: TableThemeName
}

export interface NanfengOnline {
  nickname: Ref<string>
  joinCode: Ref<string>
  seats: Ref<LobbySeat[]>
  roomId: Ref<string>
  mySeat: Ref<number>
  /** 房间真实连接位数（有的后端会给）；面板优先用它，没有才退回本地选择。 */
  capacity?: Ref<number>
  isHost: Ref<boolean>
  status: Ref<string>
  error: Ref<string>
  /** 开局后才有：直接喂给 `NanfengTable`。 */
  game: Ref<NanfengMatchApi | null>
  /**
   * 房间面板能不能让房主"设置人机"。
   *
   * VibeHub 那条路是房主权威、人机是本机 AI，需要房主指定；WS 后端由**服务端**补位，
   * 所以那边是 `false`（面板隐藏按钮，避免"设了别人看不到"）。
   */
  supportsBots?: boolean
  /** 空座位的人机名字（房主可改；键是大厅座位号）。 */
  botNames: Ref<Record<number, string>>
  createRoom: () => Promise<void>
  joinRoom: () => Promise<void>
  toggleReady: () => Promise<void>
  startMatch: () => Promise<void>
  /** 刷新后恢复上次的房间（只有 WS 后端实现；没有存档或失败返回 false）。 */
  resume?: () => Promise<boolean>
  leave: () => Promise<void>
}

const NICKNAME_KEY = 'nanfeng.online.nickname'

function loadNickname(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 人名去重：`seats`/`buyerId` 是用名字当身份的，重名会让换座串人。 */
function uniqueName(raw: string, used: Set<string>): string {
  const base = raw.trim() || '玩家'
  let name = base
  let index = 2
  while (used.has(name)) {
    name = `${base}·${index}`
    index += 1
  }
  used.add(name)
  return name
}

/**
 * 把大厅座位表（0..4）翻成 5 个**人名**：前 4 个坐椅子，第 5 个当买码位。
 * 空位补 AI 名字（少人来时也能开局，空位由本机 AI 代打/代买）。
 */
function peopleOf(
  seats: readonly LobbySeat[],
  botNames: Readonly<Record<number, string>> = {},
): { people: string[]; nameByPeer: Map<string, string> } {
  const used = new Set<string>()
  const nameByPeer = new Map<string, string>()
  const people: string[] = []
  for (let seat = 0; seat < ONLINE_CAPACITY; seat += 1) {
    const found = seats.find((item) => item.seat === seat)
    // 空座位 = 人机：房主可以给人机改名，否则用默认的 `AI N`。
    const raw = found?.nickname ?? botNames[seat] ?? `AI ${seat}`
    const name = uniqueName(raw, used)
    people.push(name)
    if (found !== undefined) nameByPeer.set(found.peerId, name)
  }
  return { people, nameByPeer }
}

export function useNanfengOnline(options: NanfengOnlineOptions): NanfengOnline {
  const roomId = ref('')
  const mySeat = ref(-1)
  const isHost = ref(false)
  const nickname = ref(loadNickname())
  const joinCode = ref('')
  const avatar = ref('')
  const playerId = ref('')
  const seats = ref<LobbySeat[]>([])
  const aiSeats = ref<PublicAiSeat[]>([])
  const status = ref('idle')
  const error = ref('')
  const game = shallowRef<NanfengMatchApi | null>(null)
  /** 空座位的人机名字（房主可改）：键是大厅座位号。 */
  const botNames = ref<Record<number, string>>({})
  const rulesetId = ref<RuleVariant>('lotus-classic' as RuleVariant)
  const matchType = ref<MatchType>('east')
  const tableThemeName = ref<TableThemeName>(options.themeName)
  const phase = ref<string>('lobby')

  let host: ReturnType<typeof useNanfengHost> | null = null
  let guest: ReturnType<typeof useNanfengGuest> | null = null
  /**
   * 对局层的 effect scope：`onStart` 是异步回调，不在 setup 的同步执行期里，
   * 直接在里面调 `useNanfengMatch` 会拿不到作用域（定时器就没人负责清理）。
   * 这里自己开一个，离开房间 / 页面卸载时统一 stop。
   */
  let matchScope = effectScope(true)

  const session = createVibeRoomSession({
    state: {
      roomId, mySeat, nickname, avatar, playerId, roomSeats: seats, aiSeats,
      sessionStatus: status, sessionError: error, rulesetId, matchType, isHost,
      tableThemeName, phase,
    },
    onStart(room, details) {
      tableThemeName.value = details.tableThemeName
      beginOnline(room)
    },
    onClosed() {
      reset()
    },
  })

  /**
   * 正式开打：房主建权威对局并广播，客机只收快照。
   *
   * **人不够就由 AI 补位**：`peopleOf` 会把大厅里空着的座位补成 `AI N`，
   * 房主本机的 AI 直接替它们打（`isRemoteSeat` 只把真实 peer 当远端）。
   */
  function beginOnline(room: VibeHubSDK.Room): void {
    phase.value = 'playing'
    room.onMessage((raw, fromPeerId) => {
      const payload = unwrapChunk(raw)
      if (payload === null) return
      if (host !== null) host.receive(fromPeerId, payload)
      else guest?.receive(payload)
    })

    if (isHost.value) {
      const players = options.players()
      const { people, nameByPeer } = peopleOf(seats.value, botNames.value)
      // SDK 的 PeerInfo 用 `id` 表示对端；房间自己的 peerId 要排除掉，房主不给自己发。
      const peers = () => room.peers()
        .map((peer) => peer.id)
        .filter((peerId) => peerId !== room.peerId)
      matchScope.stop()
      matchScope = effectScope(true)
      matchScope.run(() => {
        host = useNanfengHost({
          seats: people.slice(0, 4),
          // 4 人局没有第 5 个人：不给 buyerId 就不轮换、也不买码。
          buyerId: players === 5 ? people[4] : undefined,
          maCount: players === 4 ? 0 : options.maCount(),
          // 洗牌熵在 UI 层取：净层不许看时钟
          seed: Date.now() % 100000,
          peers,
          personOf: (peerId) => nameByPeer.get(peerId),
          sendTo: (peerId, message) => { sendChunked(room, message, peerId) },
        })
        game.value = host.api
      })
      return
    }

    matchScope.stop()
    matchScope = effectScope(true)
    matchScope.run(() => {
      guest = useNanfengGuest({
        send: (message) => { sendChunked(room, message) },
        nickname: nickname.value,
      })
      game.value = guest.api
    })
  }

  function reset() {
    matchScope.stop()
    matchScope = effectScope(true)
    host = null
    guest = null
    game.value = null
    phase.value = 'lobby'
  }

  /**
   * 联机前必须把 VibeHub 客户端准备好（旧 App.vue 在根 setup 里做这件事，我先前漏了）：
   * 本地 `npm run dev` 拿到的是 mock（BroadcastChannel，同浏览器两个标签页就能联），
   * 部署在平台域才是真 SDK（需要登录）。
   */
  async function ensureClient(): Promise<boolean> {
    // 不再用 `canInitVibeHub` 提前拦：那个判断只认"平台域 / dev / localhost"，
    // 部署在普通静态站（cloudpage 之类）会被它直接否掉，连试都不试。
    // 现在一律先初始化，再按结果给具体原因。
    await initVibeHub()
    if (getVibeClient() === null) {
      error.value = '联机要用 VibeHub SDK：本地 `npm run dev`（mock 房间），线上请部署到 VibeHub 平台并登录。'
        + ' 自己接后端（WS 房间）是下一步。'
      return false
    }
    return true
  }

  async function createRoom() {
    error.value = ''
    if (nickname.value.trim() === '') {
      error.value = '先填个昵称'
      return
    }
    if (!(await ensureClient())) return
    try {
      window.localStorage.setItem(NICKNAME_KEY, nickname.value.trim())
    } catch { /* 存储不可用无所谓 */ }
    try {
      // 连接位 = 打牌人数（4 人局 4 个位置；5 人局多一个轮空买码位）。
      const capacity = options.players() === 5 ? ONLINE_CAPACITY : 4
      await session.createRoom('east', capacity, 'lotus-classic' as RuleVariant, options.themeName)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '创建房间失败'
    }
  }

  async function joinRoom() {
    error.value = ''
    if (nickname.value.trim() === '') {
      error.value = '先填个昵称'
      return
    }
    if (joinCode.value.trim() === '') {
      error.value = '填房间号'
      return
    }
    if (!(await ensureClient())) return
    try {
      window.localStorage.setItem(NICKNAME_KEY, nickname.value.trim())
    } catch { /* 同上 */ }
    try {
      await session.joinRoom(joinCode.value.trim().toUpperCase())
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '加入房间失败'
    }
  }

  async function toggleReady() {
    await session.toggleReady()
  }

  async function startMatch() {
    error.value = ''
    try {
      const room = session.getRoom()
      if (room === null) throw new Error('还没进房间')
      if (seats.value.length <= 1) {
        // 只有房主一个人：旧大厅的"至少两名真人"屏障不该拦住这里，
        // 空位由本机 AI 补（`peopleOf` 已经补了 `AI N`）。直接开。
        beginOnline(room)
        return
      }
      await session.startMatch()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '开局失败'
    }
  }

  async function leave() {
    reset()
    await session.leaveRoom()
  }

  onScopeDispose(() => {
    void leave()
  })

  return {
    nickname, joinCode, seats, roomId, mySeat, isHost, status, error, game, botNames,
    createRoom, joinRoom, toggleReady, startMatch, leave,
  }
}
