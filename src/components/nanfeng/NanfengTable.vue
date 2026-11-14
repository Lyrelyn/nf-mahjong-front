<script setup lang="ts">
// 南丰牌桌：复用现有 `GameTableHud`（含 Three.js 牌桌、主题、动作表现），
// 只做两件事——把南丰状态投影成 HUD 要的视图、把 HUD 的事件翻成引擎动作。
//
// 规则判定、合法动作集合都由运行时提供；这里不判断任何牌型。
import { computed, onMounted } from 'vue'
import GameTableHud from '../table/GameTableHud.vue'
import { useAudio, useEffectPlayer } from '../../game/core/presentation/useAudio'
import { toCode } from '../../game/nanfeng/tileCodec'
import { projectToTable, tileOfHandIndex } from '../../game/nanfeng/projectToTable'
import { seatText, tileText } from '../../game/nanfeng/tileText'
import { useNanfengMatch, type NanfengMatchApi } from '../../game/nanfeng/useNanfengMatch'
import { fanText } from './fanText'
import type { TableThemeName } from '../table/three/tableTheme'

const props = withDefaults(defineProps<{
  autoPlay?: boolean
  seed?: number
  maCount?: number
  /** 5 人轮换的花名册（5 个名字，第一个是你）；不给就是固定 4 人局。 */
  roster?: readonly string[]
  /** 牌桌主题（由大厅顶栏切换，五个主题都沿用旧表现）。 */
  themeName?: TableThemeName
  /**
   * 由外部提供的对局 API：联机时是房主/客机的实现，为 `undefined` 时自己开一局单机。
   * 两边实现的是同一个 `NanfengMatchApi`，所以牌桌本身不区分单机与联机。
   */
  game?: NanfengMatchApi
}>(), { themeName: 'jade' })

/** 回大厅：本场作废（单机没有"座位保留"这回事，重进就是新的一场）。 */
const emit = defineEmits<{ returnLobby: [] }>()

// 洗牌的熵放在 UI 层：`src/game/nanfeng/**` 是纯净层，不许取时钟。
const seed = props.seed ?? Date.now() % 100000
// 音频层由 NanfengApp（页面根）建立 —— 顶栏的声音开关要用它。这里只取它提供的播放器；
// 万一牌桌被单独挂载（没有上层音频层）才自己建一套，否则会出现两层 BGM。
const injectedPlayer = useEffectPlayer()
const localAudio = injectedPlayer === null ? useAudio() : null
const playEffect = injectedPlayer ?? localAudio?.playEffect ?? (() => {})
// 联机时对局 API 由外部注入；只有单机才自己开一局。
const localGame = props.game === undefined
  ? useNanfengMatch({
      autoPlay: props.autoPlay,
      seed,
      maCount: props.maCount,
      roster: props.roster,
      playSound: playEffect,
    })
  : null
const game: NanfengMatchApi = props.game ?? localGame!
const snap = game.snapshot

const view = computed(() => projectToTable(snap.value))

// `?debug=1` 时显示投影/状态的关键数字：判断"没牌"是投影没给，还是 3D 没画。
const showDebug = new URLSearchParams(window.location.search).get('debug') === '1'
const debugText = computed(() => {
  const s = snap.value
  const projected = view.value
  return [
    `humanSeat=${s.humanSeat}`,
    `view=${s.viewSeat}`,
    `own.tiles=${s.own.tiles.length}`,
    `own.drawn=${s.own.drawn ?? '-'}`,
    `players[0].hand=${projected.players[0]?.hand.length ?? -1}`,
    `players[0].ctc=${projected.players[0]?.concealedTileCount ?? '-'}`,
    `phase=${projected.phase}`,
    `opening=${s.opening?.stage ?? '-'}`,
    `dealt=${s.dealtCount === null ? 'full' : s.dealtCount}`,
    `anim=${s.dealAnimation.playerIndex}/${s.dealAnimation.count}`,
    `isUserTurn=${projected.isUserTurn}`,
    `pending=${s.pending ? `${s.pending.kind}@${s.pending.seat}` : '-'}`,
    `outcome=${s.outcome?.kind ?? '-'}`,
    `dealer=${s.dealer}`,
    `deltas=${s.settle ? s.settle.deltas.join(',') : '-'}`,
    `detail=${s.settle ? s.settle.detail.length : '-'}`,
    `wall=${s.wallCount}`,
    `ma=${s.ma.count}/${s.ma.delta}/${s.ma.score}`,
  ].join(' | ')
})

// 进桌即开局。漏了这一行就是"牌桌渲染出来了但没有任何牌"——快照停在初始状态，
// 手牌/牌墙/弃牌全是空的。
onMounted(() => game.start())

function onDiscard(index: number) {
  const tile = tileOfHandIndex(snap.value, index)
  if (tile !== null) game.discard(tile)
}

/** HUD 的杠按钮只给"哪张牌"，具体是暗杠还是补杠由运行时的选项决定。 */
function onGang(tile: string) {
  const code = toCode(tile as never)
  const pending = snap.value.pending
  const option = pending?.options.find(
    (item) => (item.type === 'AN_GANG' || item.type === 'BU_GANG') && item.tile === code,
  )
  if (option !== undefined) game.submit(option.type)
}

function onHu() { game.submit('HU') }
function onPeng() { game.submit('PENG') }
function onGangFromDiscard() { game.submit('MING_GANG') }
function onPass() { game.submit('PASS') }

const outcomeTitle = computed(() => {
  if (snap.value.outcome?.kind === 'HUANG_ZHUANG') return '荒庄（庄家赔每家 1 分）'
  const winners = snap.value.outcome?.kind === 'HU' ? snap.value.outcome.winners : []
  if (winners.length === 0) return '本局结束'
  const names = winners.map((winner) => nameOf(winner.seat))
  return `${names.join('、')} 胡牌`
})

/** 座位显示名：5 人换座之后名字才是稳定身份（"本家/下家"会随换座变）。 */
function nameOf(seat: number): string {
  return snap.value.seatNames[seat] ?? seatText(seat, snap.value.humanSeat, snap.value.seats.length)
}

/** 轮空观战时点头像 → 视角切到那一家。 */
function onSelectSeat(seat: number) {
  game.setViewSeat(seat)
}

/** 买码席上"指向谁"的文字：码牌方位是相对庄家算的，所以庄家额外标一下。 */
function maTargetText(seat: number): string {
  const name = nameOf(seat)
  return seat === snap.value.dealer ? `${name}（庄）` : name
}

/** 带符号的分数：`+3` / `-2` / `0`。 */
function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

/** 码牌局中不公开，`tiles === null` 表示还没到结算。 */
const maRevealed = computed(() => snap.value.ma.tiles !== null)
</script>

<template>
  <div class="nf-hud">
    <div class="has-three-scene">
      <GameTableHud
        v-bind="view"
        :theme-name="themeName"
        :seats-selectable="snap.humanSeat < 0"
        @discard="onDiscard"
        @gang="onGang"
        @hu="onHu"
        @peng="onPeng"
        @gang-from-discard="onGangFromDiscard"
        @pass="onPass"
        @select-seat="onSelectSeat"
      />
    </div>

    <div v-if="snap.lastError" class="nf-error">
      <strong>对局已停止</strong>
      <span>{{ snap.lastError }}</span>
      <button class="nf-next" @click="game.start()">重开一局</button>
    </div>

    <!-- 第 5 个参与者：买码位（5 人换座时就是本局轮空的那个人）。码牌局中不公开，局末才翻面。 -->
    <section v-if="snap.ma.count > 0 || snap.ma.buyerName" class="nf-ma">
      <header class="nf-ma-head">
        <span class="nf-ma-badge">码</span>
        <span class="nf-ma-name">
          {{ snap.ma.isHumanBuyer ? '你' : snap.ma.buyerName || '买码位' }}
          <small v-if="snap.ma.isHumanBuyer">· 本局轮空，买码观战</small>
        </span>
        <span class="nf-ma-count">{{ snap.ma.count }} 张</span>
      </header>
      <div v-if="snap.ma.count > 0" class="nf-ma-tiles">
        <template v-if="maRevealed">
          <span
            v-for="(item, index) in snap.ma.detail"
            :key="index"
            class="nf-ma-tile"
            :class="{ 'is-plus': item.delta > 0, 'is-minus': item.delta < 0 }"
          >
            <b>{{ tileText(item.tile) }}</b>
            <i>{{ maTargetText(item.seat) }}</i>
            <em>{{ signed(item.delta) }}</em>
          </span>
        </template>
        <template v-else>
          <span v-for="n in snap.ma.count" :key="n" class="nf-ma-back" aria-label="码牌（未翻开）"></span>
        </template>
      </div>
      <footer class="nf-ma-foot">
        <template v-if="snap.ma.count === 0">本局不买码</template>
        <template v-else-if="maRevealed">本局 {{ signed(snap.ma.delta) }}</template>
        <template v-else>局末翻开</template>
        <em v-if="snap.ma.isHumanBuyer" class="nf-ma-hint">· 点头像可切视角</em>
      </footer>
    </section>

    <div v-if="showDebug" class="nf-debug">{{ debugText }}</div>

    <section v-if="snap.status === 'round-over'" class="nf-settle">
      <h3>{{ outcomeTitle }}</h3>
      <ul v-if="snap.settle" class="nf-detail">
        <li v-for="(item, index) in snap.settle.detail" :key="index">
          <span>{{ nameOf(item.seat) }} · {{ fanText(item.tags) }}</span>
          <span>
            {{ item.zimo ? '自摸' : '点炮' }} · {{ item.fan }} 炮（单家 {{ item.unit }}）→ +{{ item.income }}
          </span>
        </li>
      </ul>
      <div class="nf-deltas">
        <span v-for="(delta, seat) in snap.settle?.deltas ?? []" :key="seat">
          {{ nameOf(seat) }}：{{ signed(delta) }}
        </span>
        <span v-if="snap.ma.buyerName || snap.ma.count > 0" class="nf-ma-total">
          {{ snap.ma.isHumanBuyer ? '你（买码）' : (snap.ma.buyerName || '买码位') }}：{{ signed(snap.ma.delta) }}
        </span>
      </div>
      <ul v-if="snap.ma.count > 0 && snap.ma.detail.length > 0" class="nf-detail nf-ma-detail">
        <li v-for="(item, index) in snap.ma.detail" :key="`ma-${index}`">
          <span>码牌 {{ tileText(item.tile) }} → {{ maTargetText(item.seat) }}</span>
          <span>{{ signed(item.delta) }}</span>
        </li>
      </ul>
      <p class="nf-note">牌墙剩余 {{ snap.wallCount }} 张 · 本局最后一打：{{ snap.lastDiscard ? tileText(snap.lastDiscard.tile) : '—' }}</p>
      <div class="nf-settle-actions">
        <button class="nf-next" @click="game.nextRound()">下一局</button>
        <button class="nf-back" @click="emit('returnLobby')">返回大厅</button>
      </div>
    </section>

    <!-- 对局中也能回大厅（本场作废，单机没有座位保留这回事）。 -->
    <button class="nf-lobby-link" type="button" @click="emit('returnLobby')">← 大厅</button>
  </div>
</template>

<style scoped>
.nf-hud { position: absolute; inset: 0; }
.nf-error {
  position: fixed; left: 50%; top: calc(var(--safe-top) + var(--topbar-height) + 10px); transform: translateX(-50%); z-index: 70;
  display: flex; gap: 12px; align-items: center; max-width: calc(100vw - 32px);
  padding: 10px 14px; border-radius: 10px; font-size: 13px;
  background: rgba(120, 24, 24, 0.94); border: 1px solid rgba(255, 160, 160, 0.6); color: #ffe8e8;
}
.nf-debug {
  position: fixed; left: 8px; top: calc(var(--safe-top) + var(--topbar-height) + 8px); z-index: 60; max-width: calc(100vw - 16px);
  font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #d9f2e6;
  background: rgba(0, 0, 0, 0.72); border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px; padding: 6px 8px; pointer-events: none; white-space: normal;
}
.nf-settle {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 40;
  width: min(560px, calc(100vw - 32px)); padding: 16px 18px; border-radius: 12px;
  background: rgba(8, 24, 20, 0.94); color: #e9f4ef; border: 1px solid rgba(255, 212, 121, 0.4);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.nf-settle h3 { margin: 0 0 10px; font-size: 16px; color: #ffe6ad; }
.nf-detail { margin: 0; padding-left: 18px; font-size: 13px; }
.nf-detail li { display: flex; justify-content: space-between; gap: 16px; }
.nf-deltas { display: flex; flex-wrap: wrap; gap: 14px; margin: 12px 0; font-size: 14px; }
.nf-note { margin: 0 0 10px; font-size: 12px; color: #9fc0b3; }
.nf-next {
  min-width: 96px; min-height: 40px; padding: 8px 18px; border-radius: 8px; cursor: pointer; font-size: 15px;
  border: 1px solid #ffd479; background: rgba(255, 212, 121, 0.16); color: #ffe6ad;
}
.nf-settle-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.nf-back {
  min-width: 96px; min-height: 40px; padding: 8px 18px; border-radius: 8px; cursor: pointer; font-size: 14px;
  border: 1px solid rgba(255, 255, 255, 0.28); background: rgba(255, 255, 255, 0.06); color: #cfe6dc;
}
.nf-back:hover { background: rgba(255, 255, 255, 0.14); }
/* 对局中的"回大厅"：低调放在左下角，别抢牌桌的视觉重心 */
.nf-lobby-link {
  position: fixed; left: 12px; bottom: 12px; z-index: 46;
  padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(8, 24, 20, 0.62); color: #9fc0b3;
}
.nf-lobby-link:hover { color: #ffe6ad; border-color: rgba(255, 212, 121, 0.5); }
/* 买码席（第 5 个参与者）：浮在右上角，不动 HUD 的 4 座布局 */
.nf-ma {
  /* 顶栏（主题/声音/规则）占了顶部一条，买码席让开它 */
  position: fixed; right: 16px; top: calc(var(--safe-top) + var(--topbar-height) + 10px); z-index: 45;
  /* 纯展示：不吃点击，避免挡住牌桌/HUD 上的按钮 */
  pointer-events: none;
  width: min(216px, calc(100vw - 32px)); padding: 10px 12px; border-radius: 10px;
  background: rgba(8, 24, 20, 0.86); color: #e9f4ef; font-size: 12px;
  border: 1px solid rgba(255, 212, 121, 0.28); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.nf-ma-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.nf-ma-badge {
  width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255, 212, 121, 0.18); border: 1px solid rgba(255, 212, 121, 0.45);
  color: #ffe6ad; font-size: 12px; font-weight: 700;
}
.nf-ma-name { flex: 1; font-size: 13px; color: #ffe6ad; }
.nf-ma-count { color: #9fc0b3; }
.nf-ma-tiles { display: flex; flex-wrap: wrap; gap: 6px; min-height: 36px; }
.nf-ma-back {
  width: 26px; height: 36px; border-radius: 4px;
  background: linear-gradient(160deg, #2d5b4a, #16352c);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.06);
}
.nf-ma-tile {
  display: grid; place-items: center; gap: 1px; padding: 3px 6px; border-radius: 6px; min-width: 46px;
  background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16);
}
.nf-ma-tile b { font-size: 13px; font-weight: 600; }
.nf-ma-tile i { font-style: normal; font-size: 10px; color: #9fc0b3; }
.nf-ma-tile em { font-style: normal; font-size: 11px; }
.nf-ma-tile.is-plus em { color: #8fe0a8; }
.nf-ma-tile.is-minus em { color: #ff9b9b; }
.nf-ma-foot { margin-top: 8px; color: #9fc0b3; }
.nf-ma-hint { font-style: normal; color: #ffe6ad; }
.nf-ma-name small { margin-left: 4px; font-size: 10px; color: #9fc0b3; font-weight: 400; }
.nf-ma-total { color: #ffe6ad; }
.nf-ma-detail li span:last-child { color: #ffe6ad; }
</style>
