// 南丰麻将 · 大厅（根地址进来就是这里）：
// 选人数与买码张数 → 进桌；牌桌里「返回大厅」回到这一页，选择会被记住。
// `?players=4|5&ma=0|1|2|4` 直接开局（自动化/自测用），`&auto=1` 是四家 AI 演示。
<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { MA_COUNT_CHOICES } from '../../game/nanfeng/score/ma'

// 牌桌（Three.js + HUD）只在真正开局时才加载：大厅本身不需要那套东西。
const NanfengTable = defineAsyncComponent(() => import('./NanfengTable.vue'))

const params = new URLSearchParams(window.location.search)
const autoPlay = params.get('auto') === '1'
const seedParam = Number(params.get('seed'))
const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : undefined

/** 5 人轮换的花名册：第一个是真人，其余四个是 AI（谁轮空谁买码）。 */
const ROSTER = ['你', 'AI 一', 'AI 二', 'AI 三', 'AI 四'] as const

interface Setup {
  /** 4 = 固定 4 人局；5 = 5 人轮换（每局换一个人下场买码）。 */
  players: 4 | 5
  /** 买码张数（只有 5 人局才有第 5 个人来买）。 */
  ma: number
}

const STORE_KEY = 'nanfeng.lobby.v1'

/** 上次选过的配置：下次进大厅还是它（localStorage 不可用时静默跳过）。 */
function readStored(): Partial<Setup> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as Partial<Setup>
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveStored(setup: Setup): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(setup))
  } catch {
    // 隐身模式 / 存储配额用满：记不住就算了，不影响开局。
  }
}

/** URL 直接给全了就不停在大厅（自动化/自测用）。 */
function setupFromUrl(): Setup | null {
  const maRaw = params.get('ma')
  const ma = maRaw === null ? null : Number(maRaw)
  if (ma !== null && (MA_COUNT_CHOICES as readonly number[]).includes(ma)) return { players: 5, ma }
  if (params.get('players') === '4') return { players: 4, ma: 0 }
  if (params.get('players') === '5') return { players: 5, ma: ma ?? 0 }
  return autoPlay ? { players: 4, ma: 0 } : null
}

const stored = readStored()
const setup = ref<Setup | null>(setupFromUrl())
const pickedPlayers = ref<4 | 5>(stored.players === 4 ? 4 : 5)
const pickedMa = ref<number>(
  typeof stored.ma === 'number' && (MA_COUNT_CHOICES as readonly number[]).includes(stored.ma)
    ? stored.ma
    : 2,
)

function begin() {
  const next: Setup = { players: pickedPlayers.value, ma: pickedPlayers.value === 4 ? 0 : pickedMa.value }
  saveStored(next)
  setup.value = next
}

/** 牌桌里点「返回大厅」：回到这一页，保留刚才的选择。 */
function backToLobby() {
  if (setup.value !== null) {
    pickedPlayers.value = setup.value.players
    if (setup.value.ma > 0) pickedMa.value = setup.value.ma
  }
  setup.value = null
}
</script>

<template>
  <NanfengTable
    v-if="setup"
    :auto-play="autoPlay"
    :seed="seed"
    :ma-count="setup?.ma ?? 0"
    :roster="setup?.players === 5 ? ROSTER : undefined"
    @return-lobby="backToLobby"
  />

  <main v-else class="nf-lobby">
    <header class="nf-lobby-brand">
      <h1>南丰麻将</h1>
      <p>136 张 · 假胡 / 归一 / 十三烂 · 封顶 8 炮 · 5 人轮换买码</p>
    </header>

    <ul class="nf-lobby-rules">
      <li>自摸不翻倍，三家各付一份；点炮只由放炮者付，<b>一炮多响都算</b>。</li>
      <li>手牌封顶 8 炮，<b>只有杠分能突破</b>：直杠 2 / 补杠 1 / 暗杠 2，开杠即入账，荒庄也保留。</li>
      <li>荒庄：庄家赔三家各 1 分；庄家胡了连庄，别人胡了谁胡谁坐庄。</li>
      <li>5 人轮换时每局 1 人轮空买码：点炮者下场，别人自摸则自摸者对家下场，荒庄庄家下场，上一局的买码者回来接管那把椅子。</li>
    </ul>

    <div class="nf-lobby-group">
      <span class="nf-lobby-label">人数</span>
      <div class="nf-lobby-choices">
        <button type="button" :class="{ on: pickedPlayers === 5 }" @click="pickedPlayers = 5">
          5 人轮换
        </button>
        <button type="button" :class="{ on: pickedPlayers === 4 }" @click="pickedPlayers = 4">
          4 人局
        </button>
      </div>
      <span class="nf-lobby-hint">
        {{ pickedPlayers === 5 ? '每局换一个人轮空买码，你也会轮空（那一局观战）' : '固定四人，不换座也不买码' }}
      </span>
    </div>

    <div class="nf-lobby-group">
      <span class="nf-lobby-label">买码</span>
      <div class="nf-lobby-choices">
        <button
          v-for="count in MA_COUNT_CHOICES"
          :key="count"
          type="button"
          :disabled="pickedPlayers === 4"
          :class="{ on: pickedPlayers === 5 && pickedMa === count }"
          @click="pickedMa = count"
        >
          {{ count === 0 ? '不买码' : `${count} 张` }}
        </button>
      </div>
      <span class="nf-lobby-hint">
        码牌从牌墙末尾留出、谁都不摸，局末才翻开；按点数指向庄家 / 下家 / 对家 / 上家，买码的人跟着那一家收付。
      </span>
    </div>

    <button type="button" class="nf-lobby-start" @click="begin">开始对局</button>
    <p class="nf-lobby-foot">
      轮空观战时点头像可以切到任意一家的视角（看到他的手牌）；在桌上时视角锁在自己座位。
    </p>
  </main>
</template>

<style scoped>
.nf-lobby {
  display: grid; align-content: center; justify-items: start; gap: 16px;
  min-height: 100vh; padding: clamp(24px, 6vh, 64px) clamp(20px, 8vw, 96px);
  background: radial-gradient(circle at 50% 12%, #14352c, #06110e 72%); color: #e9f4ef;
}
.nf-lobby-brand h1 { margin: 0 0 6px; font-size: clamp(24px, 4vw, 34px); color: #ffe6ad; letter-spacing: 3px; }
.nf-lobby-brand p { margin: 0; font-size: 13px; color: #9fc0b3; letter-spacing: 1px; }
.nf-lobby-rules { margin: 4px 0; padding-left: 18px; max-width: 48em; font-size: 13px; line-height: 1.9; color: #cfe6dc; }
.nf-lobby-rules b { color: #ffe6ad; font-weight: 600; }
.nf-lobby-group { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; }
.nf-lobby-label { min-width: 2.6em; font-size: 13px; color: #ffe6ad; }
.nf-lobby-choices { display: flex; flex-wrap: wrap; gap: 10px; }
.nf-lobby-choices button {
  min-width: 92px; min-height: 40px; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px;
  border: 1px solid rgba(255, 212, 121, 0.45); background: rgba(255, 212, 121, 0.08); color: #cfe6dc;
}
.nf-lobby-choices button.on { border-color: #ffd479; background: rgba(255, 212, 121, 0.24); color: #ffe6ad; }
.nf-lobby-choices button:disabled { opacity: 0.35; cursor: not-allowed; }
.nf-lobby-hint { flex: 1 1 100%; font-size: 12px; color: #7fa295; }
.nf-lobby-start {
  min-width: 168px; min-height: 46px; padding: 10px 24px; border-radius: 8px; cursor: pointer;
  font-size: 15px; letter-spacing: 2px; border: 1px solid #ffd479;
  background: rgba(255, 212, 121, 0.2); color: #ffe6ad;
}
.nf-lobby-start:hover { background: rgba(255, 212, 121, 0.32); }
.nf-lobby-foot { margin: 0; max-width: 48em; font-size: 12px; line-height: 1.8; color: #6f9285; }
</style>
