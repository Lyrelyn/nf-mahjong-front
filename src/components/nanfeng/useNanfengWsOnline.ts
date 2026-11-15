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
}

export interface NanfengWsOnlineOptions {
  /** 后端地址，例如 `http://127.0.0.1:8000`；留空 = 同源（走 vite 代理）。 */
  baseUrl?: string
  players: () => 4 | 5
  maCount: () => number
  matchLength?: 4 | 8 | 16
}

export interface NanfengWsOnline {
  roomId: Ref<string>
  nickname: Ref<string>
  joinCode: Ref<string>
  seats: Ref<WsSeat[]>
  mySeat: Ref<number>
  error: Ref<string>
  status: Ref<string>
  /** 建房的那个人（只在 UI 上决定要不要显示"开始对局"）。 */
  isHost: Ref<boolean>
  /** WS 模式没有人机设置（服务端补位），保留空对象让房间面板复用同一套组件。 */
  botNames: Ref<Record<number, string>>
  game: Ref<NanfengMatchApi | null>
  createRoom: () => Promise<void>
  joinRoom: () => Promise<void>
  toggleReady: () => Promise<void>
  startMatch: () => Promise<void>
  leave: () => Promise<void>
}

const STORAGE_KEY = 'nanfeng.ws.rejoin.v1'
const PLAYER_KEY = 'nanfeng.ws.player.v1'

function baseUrlOf(explicit?: string): string {
  return (explicit ?? '').replace(/\/$/, '')
}

/** 每个浏览器一个稳定 playerId：后端开发旁路拿它当身份（多开窗口才分得清）。 */
function loadPlayerId(): string {
  try {
    const saved = window.localStorage.getItem(PLAYER_KEY)
    if (saved !== null && saved !== '') return saved
    const fresh = `nf-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(PLAYER_KEY, fresh)
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
    const data = await info.json() as { slots?: (Omit<WsSeat, 'seat'> | null)[] }
    // 后端同时给 `seats[].seat` 与 `slots[].slot`；面板按 `seat` 找座位，所以这里补齐两个键。
    seats.value = (data.slots ?? [])
      .filter((slot): slot is Omit<WsSeat, 'seat'> => slot !== null)
      .map((slot) => ({ ...slot, seat: slot.slot }))
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
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '加入失败'
      status.value = 'idle'
    }
  }

  async function toggleReady(): Promise<void> {
    if (roomId.value === '' || rejoinCode === '') return
    const mine = seats.value.find((seat) => seat.slot === mySeat.value)
    const next = !(mine?.ready ?? false)
    try {
      await post(`/api/rooms/${encodeURIComponent(roomId.value)}/ready`,
        { seat: mySeat.value, rejoinCode, ready: next })
      await refreshRoom()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '准备失败'
    }
  }

  async function startMatch(): Promise<void> {
    if (roomId.value === '') return
    error.value = ''
    try {
      // start 只从 body 读 playerId 认房主（漏了就是 403 NOT_CREATOR）
      await post(`/api/rooms/${encodeURIComponent(roomId.value)}/start`, { playerId })
      status.value = 'playing'
      wsGame = useNanfengWsGame({ send: (message) => { socket?.send(JSON.stringify(message)) } })
      game.value = wsGame.api
      connect()
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
    roomId, nickname, joinCode, seats, mySeat, error, status, isHost, botNames, game,
    createRoom, joinRoom, toggleReady, startMatch, leave,
  }
}
