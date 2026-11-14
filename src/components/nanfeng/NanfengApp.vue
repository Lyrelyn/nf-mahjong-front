<script setup lang="ts">
// 南丰麻将：复用旧版的页面骨架（`.game-app` + 顶栏 + `.lobby` 大厅），只把玩法换成南丰。
// 顶栏的五个主题、声音设置、规则按钮都沿用旧组件；大厅与牌桌只是这里的两个状态。
// `?players=4|5&ma=0|1|2|4` 直接开局（自动化/自测用），`&auto=1` 是四家 AI 演示。
import { computed, defineAsyncComponent, ref } from 'vue'
import GameShellHeader from '../shell/GameShellHeader.vue'
import LobbyDialog from '../lobby/LobbyDialog.vue'
import { useAudio } from '../../game/core/presentation/useAudio'
import NanfengLobby from './NanfengLobby.vue'
import type { NanfengLobbySetup } from './lobbySetup'
import { useNanfengOnline } from './useNanfengOnline'
import { MA_COUNT_CHOICES } from '../../game/nanfeng/score/ma'
import type { TableThemeName } from '../table/three/tableTheme'
import { themePresentationByName, themePresentationCssVariables } from '../../theme/themePresentation'
import {
  readTableThemePreference,
  resolveInitialTableTheme,
  saveTableThemePreference,
} from '../table/three/tableThemePreference'

// 牌桌（Three.js + HUD）只在真正开局时加载：大厅本身不需要那套东西。
const NanfengTable = defineAsyncComponent(() => import('./NanfengTable.vue'))

/**
 * 音频层在页面根组件里建立（和旧 App.vue 一样）：顶栏的声音开关 `useAudioControls()` 依赖它，
 * 没有提供者会直接抛错 —— 那会让整个页面挂载失败（表现就是黑屏）。
 * 牌桌那边只注入这里的播放器，避免出现两层 BGM。
 */
useAudio()

const params = new URLSearchParams(window.location.search)
const autoPlay = params.get('auto') === '1'
const seedParam = Number(params.get('seed'))
const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : undefined

/** 5 人轮换的花名册：第一个是真人，其余四个是 AI（谁轮空谁买码）。 */
const ROSTER = ['你', 'AI 一', 'AI 二', 'AI 三', 'AI 四'] as const

/** URL 直接给全了就不停在大厅（自动化/自测用）。 */
function setupFromUrl(): NanfengLobbySetup | null {
  const maRaw = params.get('ma')
  const ma = maRaw === null ? null : Number(maRaw)
  if (ma !== null && (MA_COUNT_CHOICES as readonly number[]).includes(ma)) return { players: 5, ma }
  if (params.get('players') === '4') return { players: 4, ma: 0 }
  if (params.get('players') === '5') return { players: 5, ma: 0 }
  return autoPlay ? { players: 4, ma: 0 } : null
}

const setup = ref<NanfengLobbySetup | null>(setupFromUrl())
/** 上一次开局的配置：返回大厅时回填到大厅的选项里。 */
const lastSetup = ref<NanfengLobbySetup | null>(setup.value)
const rulesOpen = ref(false)

// 主题：URL > 上次的选择 > 墨玉（与旧大厅同一套偏好存储）。
const initialTheme = resolveInitialTableTheme(params.get('theme'), readTableThemePreference())
const themeName = ref<TableThemeName>(initialTheme.theme)
const themeStyle = computed(() => themePresentationCssVariables(themePresentationByName(themeName.value)))
const headingClass = computed(() => themePresentationByName(themeName.value).typography.headingClass)

// 联机：房间会话放在页面根组件，进桌（大厅卸载）时房间不能跟着被关掉。
const onlinePlayers = ref<4 | 5>(5)
const onlineMa = ref(2)
const online = useNanfengOnline({
  players: () => onlinePlayers.value,
  maCount: () => onlineMa.value,
  themeName: themeName.value,
})
const onlineGame = computed(() => online.game.value)
const playing = computed(() => setup.value !== null || onlineGame.value !== null)

function changeTheme(theme: TableThemeName) {
  themeName.value = saveTableThemePreference(theme)
}

function start(next: NanfengLobbySetup) {
  setup.value = next
  lastSetup.value = next
}

/** 牌桌里点「返回大厅」：单机本场作废；联机则离开房间（房间由根组件持有）。 */
function backToLobby() {
  if (onlineGame.value !== null) {
    void online.leave()
    return
  }
  setup.value = null
}
</script>

<template>
  <main
    class="game-app"
    :class="[{ 'is-lobby': !playing }, headingClass]"
    :data-table-theme="themeName"
    :style="themeStyle"
  >
    <GameShellHeader
      game-mode="local"
      :phase="playing ? 'playing' : 'lobby'"
      :has-players="playing"
      match-name="南丰麻将"
      :round-label="playing ? '对局中' : ''"
      :honba="0"
      :base-score="1"
      room-id=""
      :signal-quality="3"
      :theme-name="themeName"
      @change-theme="changeTheme"
      @open-rules="rulesOpen = true"
    />

    <NanfengLobby
      v-if="!playing"
      :theme-name="themeName"
      :players="lastSetup?.players"
      :ma="lastSetup?.ma"
      :online="online"
      :online-players="onlinePlayers"
      :online-ma="onlineMa"
      @update:online-players="onlinePlayers = $event === 4 ? 4 : 5"
      @update:online-ma="onlineMa = $event"
      @start="start"
      @open-rules="rulesOpen = true"
    />

    <NanfengTable
      v-else-if="setup"
      :theme-name="themeName"
      :auto-play="autoPlay"
      :seed="seed"
      :ma-count="setup?.ma ?? 0"
      :roster="setup?.players === 5 ? ROSTER : undefined"
      @return-lobby="backToLobby"
    />

    <!-- 联机：房主/客机的 API 已经由 `useNanfengOnline` 建好，牌桌只负责画 -->
    <NanfengTable
      v-else
      :theme-name="themeName"
      :game="onlineGame ?? undefined"
      @return-lobby="backToLobby"
    />

    <LobbyDialog
      v-if="rulesOpen"
      title="南丰麻将 · 规则要点"
      wide
      :theme-name="themeName"
      variant="rule"
      @close="rulesOpen = false"
    >
      <ul class="nf-rules">
        <li>136 张：万 / 条 / 筒 1-9 各 4 张 + 东南西北 + 中发白，无花牌。</li>
        <li>自摸不翻倍：其余三家各付一份；点炮只由放炮者付，<b>一炮多响都算</b>。</li>
        <li>手牌封顶 8 炮；<b>只有杠分能突破</b>（直杠 2 / 补杠 1 / 暗杠 2，开杠即入账，荒庄也保留）。</li>
        <li>荒庄：庄家赔三家各 1 分，不看听牌。庄家胡了连庄，别人胡了谁胡谁坐庄，流局对家坐庄。</li>
        <li>5 人轮换：每局 1 人轮空买码 —— 点炮者下场，别人自摸则自摸者对家下场，荒庄庄家下场，上一局的买码者回来接管那把椅子。轮空时可以点头像切到任意一家的视角。</li>
        <li>买码：开局从牌墙末尾留出 0/1/2/4 张码牌（谁都不摸，所以牌墙少几张、荒庄也提前几张），局末才翻开；每张按点数指向庄家 / 下家 / 对家 / 上家，买码的人跟着那一家收付，多张叠加也能互相抵消。</li>
      </ul>
    </LobbyDialog>
  </main>
</template>

<style scoped>
.nf-rules { margin: 0; padding-left: 18px; display: grid; gap: 9px; font-size: 13px; line-height: 1.8; color: var(--theme-text-muted); }
.nf-rules b { color: var(--theme-accent-text); font-weight: 600; }
</style>
