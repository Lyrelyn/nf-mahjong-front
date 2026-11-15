// 南丰 × 自有 WS 后端的**房间层**（REST 建房/加入/准备/开始 + WS 收帧）。
//
// 只依赖 HTTP 与 WebSocket，不碰 VibeHub、不碰旧的 `online/ws/**` 编排（那套绑着莲花引擎）。
// 协议出处：`docs/nanfeng-online-integration-plan.md` §10（全部经过实测）。
//
// 与 VibeHub 那条路的区别：权威在服务端，所以前端没有"房主/客机"之分，所有人都用
// `useNanfengWsGame`；房间面板只关 心房间号、座位、准备状态。
import { onScopeDispose, ref, shallowRef, type Ref } from 'vue'
import { useNanfengWsGame, type NanfengWsGame } from '../../game/nanfeng/net/useNanfengWsGame'
import type { NanfengMatchApi } from '../../game/nanfeng/useNanfengMatch'

export interface WsSeat {
  /** 后端 REST 的历史键名（房间面板按 `seat` 找座位）。 */
  seat: number
  /** WS 快照里的同名键；与 `seat` 是同一个值。 */
  slot: number
  nickname: string
  avatar: string
  ready: boolean
  connected: boolean
  /** 服务端 AI 补位的座位：`ready`/`connected` 恒真，昵称形如 `AI 1`。 */
  isAi?: boolean
}

export interface NanfengWsOnlineOptions {
  /** 后端地址，例如 `http://127.0.0.1:8000`；留空 = 同源（走 vite 代理）。 */
  baseUrl?: string
  players: () => 4 | 5
  maCount: () => number
  matchLength?: 4 | 8 | 16
  /** 音效出口（页面根组件从音频层取，透传给对局客户端）。 */
  playSound?: (name: string, volume?: number) => void
}

export interface NanfengWsOnline {
  roomId: Ref<string>
  nickname: Ref<string>
  joinCode: Ref<string>
  seats: Ref<WsSeat[]>
  mySeat: Ref<number>
  /** 房间真实的连接位数（4 / 5），由后端返回，**不要用本地大厅的选择**。 */
  capacity: Ref<number>
  error: Ref<string>
  status: Ref<string>
  /** 建房的那个人（只在 UI 上决定要不要显示"开始对局"）。 */
  isHost: Ref<boolean>
  /** WS 模式没有人机设置（服务端补位），保留空对象让房间面板复用同一套组件。 */
  botNames: Ref<Record<number, string>>
  /** 服务端自动补位，面板不显示"设置人机"。 */
  supportsBots: false
  game: Ref<NanfengMatchApi | null>
  createRoom: () => Promise<void>
  joinRoom: () => Promise<void>
  toggleReady: () => Promise<void>
  startMatch: () => Promise<void>
  /** 刷新后恢复上次的房间（没有存档时返回 false）。 */
  resume: () => Promise<boolean>
  leave: () => Promise<void>
}

const STORAGE_KEY = 'nanfeng.ws.rejoin.v1'
const PLAYER_KEY = 'nanfeng.ws.player.v1'

function baseUrlOf(explicit?: string): string {
  return (explicit ?? '').replace(/\/$/, '')
}

/**
 * 每个**标签页**一个 playerId。
 *
 * 后端开发旁路把 `playerId` 当身份，而 `localStorage` 是整站共享的 —— 用它的话
 * 同一浏览器开两个标签页会拿到同一个 id，第二个"墙"其实是同一个人重新入座（rejoin），
 * 于是永远凑不齐两个人。改用 `sessionStorage`：同一标签页刷新不变，不同标签页互不影响。
 */
function loadPlayerId(): string {
  try {
    const saved = window.sessionStorage.getItem(PLAYER_KEY)
    if (saved !== null && saved !== '') return saved
    const fresh = `nf-${Math.random().toString(36).slice(2, 10)}`
    window.sessionStorage.setItem(PLAYER_KEY, fresh)
    return fresh
  } catch {
    return 'nf-anon'
  }
}

export function useNanfengWsOnline(options: NanfengWsOnlineOptions): NanfengWsOnline {
  const base = baseUrlOf(options.baseUrl)
  const roomId = ref('')
  const nickname = ref('')
  const joinCode = ref('')
  const seats = ref<WsSeat[]>([])
  const mySeat = ref(-1)
  /** 房间真实连接位数：加入别人的房间时要按**房主建房时**的来，不能用本地大厅的选择。 */
  const capacity = ref(5)
  const error = ref('')
  const status = ref<string>('idle')
  const isHost = ref(false)
  const botNames = ref<Record<number, string>>({})
  const game = shallowRef<NanfengMatchApi | null>(null)
  const playerId = loadPlayerId()

  let socket: WebSocket | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let wsGame: NanfengWsGame | null = null
  /** 重连凭据：`rejoin_code` 由 REST join 签发，WS 握手必须带上。 */
  let rejoinCode = ''

  function url(path: string): string {
    return `${base}${path}`
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    })
    const text = await response.text()
    const parsed = text === '' ? null : JSON.parse(text) as unknown
    if (!response.ok) {
      const detail = (parsed as { detail?: { code?: string } } | null)?.detail
      throw new Error(detail?.code ?? `HTTP ${response.status}`)
    }
    return parsed as T
  }

  function saveRejoin(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        roomId: roomId.value,
        rejoinCode,
        seat: mySeat.value,
      }))
    } catch { /* 存不了就算了 */ }
  }

  /**
   * 清掉上一次留下的房间。
   *
   * 后端的身份是"一个 playerId 同时只能在一个房间里"（防占房）：如果上一次建房后直接
   * 关页面/换页面，座位还挂在那儿，下一次创建就会 409 `ALREADY_IN_ROOM`。
   * 所以建房/加房前先用存下来的 `rejoinCode` 礼貌地 leave 一次，失败也无所谓。
   */
  async function clearPreviousRoom(): Promise<void> {
    let saved: { roomId?: string; rejoinCode?: string; seat?: number } | null = null
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      saved = raw === null ? null : JSON.parse(raw) as typeof saved
    } catch {
      saved = null
    }
    if (saved?.roomId && saved.rejoinCode) {
      try {
        await post(`/api/rooms/${encodeURIComponent(saved.roomId)}/leave`, {
          seat: saved.seat ?? 0,
          rejoinCode: saved.rejoinCode,
        })
      } catch {
        // 房间早没了 / 码过期：忽略
      }
    }
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch { /* 忽略 */ }
  }

  function closeSocket(): void {
    if (pingTimer !== null) clearInterval(pingTimer)
    pingTimer = null
    socket?.close()
    socket = null
  }

  /** 连 WS：先 `rejoin_ok` 再 `state_snapshot`；心跳必须是 `{kind:'ping'}`。 */
  function connect(): void {
    if (rejoinCode === '' || roomId.value === '') return
    closeSocket()
    const scheme = base === '' ? (window.location.protocol === 'https:' ? 'wss' : 'ws') : base.replace(/^http/, 'ws')
    const ws = new WebSocket(`${scheme}/ws/room/${encodeURIComponent(roomId.value)}?rejoin_code=${encodeURIComponent(rejoinCode)}`)
    socket = ws
    ws.onmessage = (event) => {
      wsGame?.receive(event.data)
      // 大厅阶段服务端给的是 `phase: 'LOBBY'` 的空快照；一旦变成真牌局就切进牌桌。
      // 这样**所有已成连接的人**都会自动进桌 —— 不只是点「开始对局」的房主。
      if (wsGame !== null && game.value === null && wsGame.api.snapshot.value.phase !== 'LOBBY') {
        game.value = wsGame.api
        status.value = 'playing'
      }
    }
    ws.onopen = () => {
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: 'ping' }))
      }, 5000)
    }
    ws.onclose = () => {
      if (pingTimer !== null) clearInterval(pingTimer)
      pingTimer = null
    }
  }

  /** 用 REST 返回的座位表刷新面板（WS 快照里也有，但大厅阶段还没有快照）。 */
  async function refreshRoom(): Promise<void> {
    const info = await fetch(url(`/api/rooms/${encodeURIComponent(roomId.value)}`), { credentials: 'include' })
    if (!info.ok) return
    const data = await info.json() as { capacity?: number; slots?: (Omit<WsSeat, 'seat'> | null)[] }
    if (typeof data.capacity === 'number' && data.capacity > 0) capacity.value = data.capacity
    // 后端同时给 `seats[].seat` 与 `slots[].slot`；面板按 `seat` 找座位，所以这里补齐两个键。
    seats.value = (data.slots ?? [])
      .filter((slot): slot is Omit<WsSeat, 'seat'> => slot !== null)
      .map((slot) => ({ ...slot, seat: slot.slot }))
  }

  /**
   * 进房就连 WS（大厅阶段也连）。
   *
   * 之前是"房主点开始时才连"，结果只有房主连上了，别人还在大厅干等。
   * 服务端在开局后会把快照推给**所有已连接的座位**，所以连接必须提前建立；
   * 大厅阶段的快照是 `phase: 'LOBBY'`，`game` 要等真牌局才暴露，避免误进牌桌。
   */
  function enterLobbySocket(): void {
    const created = useNanfengWsGame({
      send: (message) => { socket?.send(JSON.stringify(message)) },
      playSound: options.playSound,
    })
    wsGame = created
    // 「下一局」在服务端权威下不是本地动作：点它 = 自己准备，凑齐后房主自动开局。
    created.api.nextRound = () => { void readyForNextRound() }
    connect()
  }

  /** 读上次的存档（房间号 + 重连码 + 座位）。 */
  function loadSaved(): { roomId: string; rejoinCode: string; seat: number } | null {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return null
      const parsed = JSON.parse(raw) as { roomId?: unknown; rejoinCode?: unknown; seat?: unknown }
      if (typeof parsed.roomId !== 'string' || typeof parsed.rejoinCode !== 'string') return null
      return {
        roomId: parsed.roomId,
        rejoinCode: parsed.rejoinCode,
        seat: typeof parsed.seat === 'number' ? parsed.seat : 0,
      }
    } catch {
      return null
    }
  }

  /**
   * 刷新 / 切回页面时恢复上次的房间。
   *
   * 用存下来的 `rejoin_code` 直接握手：服务端回 `rejoin_ok` + 全量快照，
   * 座位、手牌、牌河都回来，**不会再撞 `ALREADY_IN_ROOM`**（那个错就是"人还在房里又去建房"）。
   * 房间已经不存在（过期/被关）时清掉存档，回到大厅。
   */
  async function resume(): Promise<boolean> {
    const saved = loadSaved()
    if (saved === null) return false
    roomId.value = saved.roomId
    rejoinCode = saved.rejoinCode
    mySeat.value = saved.seat
    status.value = 'lobby'
    enterLobbySocket()
    try {
      const info = await fetch(url(`/api/rooms/${encodeURIComponent(saved.roomId)}`), { credentials: 'include' })
      if (!info.ok) throw new Error('ROOM_NOT_FOUND')
      await refreshRoom()
      return true
    } catch {
      await clearPreviousRoom()
      closeSocket()
      roomId.value = ''
      mySeat.value = -1
      rejoinCode = ''
      status.value = 'idle'
      return false
    }
  }

  async function createRoom(): Promise<void> {
    error.value = ''
    if (nickname.value.trim() === '') {
      error.value = '先填个昵称'
      return
    }
    status.value = 'joining'
    try {
      // 上一次的房间可能还占着这个 playerId → 先退掉，否则 409 ALREADY_IN_ROOM
      await clearPreviousRoom()
      const created = await post<{ roomId: string }>('/api/rooms', {
        mode: 'east',
        // 4 或 5，后端只认这两个值（3 / 6 直接 422）：决定连接位数与有无轮空买码位。
        capacity: options.players(),
        matchLength: options.matchLength ?? 4,
        // 4 人房没有轮空位，后端会忽略 maCount；显式传 0 更清楚。
        maCount: options.players() === 4 ? 0 : options.maCount(),
        rulesetId: 'nanfeng',
        playerId,
      })
      roomId.value = created.roomId
      const joined = await post<{ seat: number; rejoinCode: string }>(
        `/api/rooms/${encodeURIComponent(created.roomId)}/join`,
        { nickname: nickname.value.trim(), playerId },
      )
      mySeat.value = joined.seat
      rejoinCode = joined.rejoinCode
      isHost.value = true
      saveRejoin()
      status.value = 'lobby'
      await refreshRoom()
      enterLobbySocket()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '建房失败'
      status.value = 'idle'
    }
  }

  async function joinRoom(): Promise<void> {
    error.value = ''
    if (nickname.value.trim() === '') {
      error.value = '先填个昵称'
      return
    }
    if (joinCode.value.trim() === '') {
      error.value = '填房间号'
      return
    }
    status.value = 'joining'
    try {
      const code = joinCode.value.trim().toUpperCase()
      const joined = await post<{ seat: number; rejoinCode: string }>(
        `/api/rooms/${encodeURIComponent(code)}/join`,
        { nickname: nickname.value.trim(), playerId },
      )
      roomId.value = code
      mySeat.value = joined.seat
      rejoinCode = joined.rejoinCode
      saveRejoin()
      status.value = 'lobby'
      await refreshRoom()
      enterLobbySocket()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '加入失败'
      status.value = 'idle'
    }
  }

  /** 显式设置自己的准备状态（开局/下一局都靠它）。 */
  async function setReady(ready: boolean): Promise<void> {
    if (roomId.value === '' || rejoinCode === '') return
    try {
      await post(`/api/rooms/${encodeURIComponent(roomId.value)}/ready`,
        { seat: mySeat.value, rejoinCode, ready })
      await refreshRoom()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '准备失败'
    }
  }

  async function toggleReady(): Promise<void> {
    const mine = seats.value.find((seat) => seat.slot === mySeat.value)
    await setReady(!(mine?.ready ?? false))
  }

  /**
   * 「下一局」= 自己准备；全房都准备好了，由房主自动开局。
   *
   * 服务端没有"回合自动继续"：每一局都要再走一次 `POST /start`（只有建房者能调），
   * 所以这里把它做成"点下一局就是准备，凑齐了房主自动开"。
   */
  async function readyForNextRound(): Promise<void> {
    if (roomId.value === '') return
    game.value = null          // 先把结算面板收掉，等新快照再进桌
    status.value = 'lobby'
    await setReady(true)
    if (!isHost.value) return
    const humans = seats.value.filter((seat) => seat.isAi !== true)
    if (humans.length === 0 || humans.some((seat) => !seat.ready)) return
    await startMatch()
  }

  async function startMatch(): Promise<void> {
    if (roomId.value === '') return
    error.value = ''
    try {
      // start 只从 body 读 playerId 认房主（漏了就是 403 NOT_CREATOR）。
      // 进桌**不在这里**：所有人都已经连着 WS，服务端开局后会把快照推给每个座位。
      await post(`/api/rooms/${encodeURIComponent(roomId.value)}/start`, { playerId })
      status.value = 'playing'
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '开局失败'
    }
  }

  async function leave(): Promise<void> {
    closeSocket()
    if (roomId.value !== '' && rejoinCode !== '') {
      // 离开失败不影响本地清理
      void post(`/api/rooms/${encodeURIComponent(roomId.value)}/leave`,
        { seat: mySeat.value, rejoinCode }).catch(() => undefined)
    }
    status.value = 'idle'
    game.value = null
    wsGame = null
    roomId.value = ''
    seats.value = []
    mySeat.value = -1
    rejoinCode = ''
  }

  onScopeDispose(() => {
    closeSocket()
  })

  return {
    roomId, nickname, joinCode, seats, mySeat, capacity, error, status, isHost, botNames, game,
    supportsBots: false as const,
    createRoom, joinRoom, toggleReady, startMatch, resume, leave,
  }
}
