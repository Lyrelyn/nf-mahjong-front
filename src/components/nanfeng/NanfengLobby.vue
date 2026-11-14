<script setup lang="ts">
// 南丰麻将大厅：**复用旧大厅的画面**（`.lobby` 布局 + LobbyThemeVisual + GameSettingsSummary + LobbyDialog），
// 只把玩法名换成南丰、行标题换成「人数 / 买码」。旧大厅的联机、场制、AI 座位、回放都不在这里出现。
import { computed, ref, watch } from 'vue'
import LobbyThemeVisual from '../lobby/LobbyThemeVisual.vue'
import GameSettingsSummary from '../lobby/GameSettingsSummary.vue'
import LobbyDialog from '../lobby/LobbyDialog.vue'
import { DEFAULT_ANIME_CHARACTER_ID } from '../../game/llm/animeCharacters'
import type { TableThemeName } from '../table/three/tableTheme'
import { MA_COUNT_CHOICES } from '../../game/nanfeng/score/ma'
import type { NanfengLobbySetup } from './lobbySetup'
import NanfengOnlinePanel from './NanfengOnlinePanel.vue'
import type { NanfengOnline } from './useNanfengOnline'

const props = defineProps<{
  themeName: TableThemeName
  /** 上一次的选择（从牌桌返回大厅时带回来）。 */
  players?: 4 | 5
  ma?: number
  /** 联机房间会话（由页面根组件持有，离开大厅进桌时不能把房间关掉）。 */
  online?: NanfengOnline
  /** 联机建房人数（4 / 5）。 */
  onlinePlayers?: number
  /** 联机用买码张数（只有房主能改）。 */
  onlineMa?: number
}>()

const emit = defineEmits<{
  start: [setup: NanfengLobbySetup]
  openRules: []
  'update:onlinePlayers': [value: number]
  'update:onlineMa': [value: number]
}>()

const STORE_KEY = 'nanfeng.lobby.v1'

function readStored(): Partial<NanfengLobbySetup> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as Partial<NanfengLobbySetup>
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const stored = readStored()
const pickedPlayers = ref<4 | 5>(props.players ?? (stored.players === 4 ? 4 : 5))
const pickedMa = ref<number>(
  props.ma ?? ((MA_COUNT_CHOICES as readonly number[]).includes(Number(stored.ma)) ? Number(stored.ma) : 2),
)

const dialog = ref<'players' | 'ma' | null>(null)
/** 与旧大厅一致：单机 / 联机两个模式。 */
const mode = ref<'local' | 'remote'>('local')

// 人数/买码是同一份设置：联机建房要用它，所以每次改动都同步给页面根组件。
watch([pickedPlayers, pickedMa], () => {
  emit('update:onlinePlayers', pickedPlayers.value)
  emit('update:onlineMa', pickedPlayers.value === 4 ? 0 : pickedMa.value)
}, { immediate: true })

const playersName = computed(() => (pickedPlayers.value === 5 ? '5 人轮换' : '4 人局'))
const playersHint = computed(() => (pickedPlayers.value === 5
  ? '每局 4 人打、1 人轮空买码，每局按规矩换人'
  : '固定四人，不换座也不买码'))
const maName = computed(() => (pickedPlayers.value === 5 && pickedMa.value > 0 ? `买 ${pickedMa.value} 张` : '不买码'))
const maHint = computed(() => (pickedPlayers.value === 4
  ? '4 人局没有第 5 个人，买码自动关闭'
  : '牌墙末尾留出，局末翻开，跟着被指的座位收付'))

const playerOptions = [
  { id: 5 as const, name: '5 人轮换', description: '每局换 1 人下场买码，你也会轮空观战' },
  { id: 4 as const, name: '4 人局', description: '固定四人，不换座、不买码' },
]
const maOptions = MA_COUNT_CHOICES.map((count) => ({
  id: count,
  name: count === 0 ? '不买码' : `买 ${count} 张`,
  description: count === 0
    ? '轮空的人只观战'
    : `牌墙末尾留 ${count} 张码牌，局末翻开，多张叠加也能互相抵消`,
}))

/** 4 人局把买码关掉；切回 5 人时还原上一次选的张数。 */
const lastMa = ref(pickedMa.value > 0 ? pickedMa.value : 2)

function choosePlayers(players: 4 | 5) {
  if (pickedPlayers.value === 5 && pickedMa.value > 0) lastMa.value = pickedMa.value
  pickedPlayers.value = players
  pickedMa.value = players === 4 ? 0 : lastMa.value
  dialog.value = null
}

function chooseMa(ma: number) {
  if (pickedPlayers.value === 4 && ma !== 0) return
  pickedMa.value = ma
  if (ma > 0) lastMa.value = ma
  dialog.value = null
}

function start() {
  const setup: NanfengLobbySetup = {
    players: pickedPlayers.value,
    ma: pickedPlayers.value === 4 ? 0 : pickedMa.value,
  }
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(setup))
  } catch {
    // 存储不可用：记不住就算了，不影响开局
  }
  emit('start', setup)
}
</script>

<template>
  <section class="lobby" data-nanfeng-lobby>
    <div class="lobby-layout">
      <LobbyThemeVisual
        :theme-name="themeName"
        :character-id="DEFAULT_ANIME_CHARACTER_ID"
        brand-eyebrow="NANFENG MAHJONG"
        brand-title="南丰"
        brand-title-accent="麻将"
        brand-subtitle="江西南丰的地方麻将 · 136 张 · 假胡 / 归一 / 十三烂"
      />

      <section class="lobby-actions" aria-label="对局操作">
        <div class="mode-selector" role="radiogroup" aria-label="游戏模式">
          <button
            type="button"
            data-action-role="secondary"
            role="radio"
            :class="{ active: mode === 'local' }"
            :aria-checked="mode === 'local'"
            @click="mode = 'local'"
          >
            <b>单机对战</b><span>与 AI 同桌</span>
          </button>
          <button
            type="button"
            data-action-role="secondary"
            role="radio"
            :class="{ active: mode === 'remote' }"
            :aria-checked="mode === 'remote'"
            @click="mode = 'remote'"
          >
            <b>联机对战</b><span>创建或加入房间</span>
          </button>
        </div>

        <!-- 人数/买码是两种模式共用的设置：联机只在房主建房时生效，单机点开始就生效 -->
        <GameSettingsSummary
          match-label="人数"
          rule-label="买码"
          :match-name="playersName"
          :match-description="playersHint"
          :rule-name="maName"
          :rule-description="maHint"
          @select-match="dialog = 'players'"
          @select-rule="dialog = 'ma'"
        />

        <template v-if="mode === 'local'">
          <button class="start-button" type="button" data-action-role="primary" @click="start">
            <b>开始对局</b><span>{{ playersName }} · {{ maName }}</span>
          </button>
        </template>

        <div v-else class="remote-lobby">
          <NanfengOnlinePanel
            v-if="online"
            :online="online"
            :players="onlinePlayers ?? 5"
            :ma-count="onlineMa ?? 2"
            @update:players="emit('update:onlinePlayers', $event)"
            @update:ma-count="emit('update:onlineMa', $event)"
            @open-rules="emit('openRules')"
          />
          <p v-else class="nf-online-note">联机需要先初始化 VibeHub（当前环境不可用）。</p>
        </div>

        <div class="lobby-links">
          <button class="text-button" type="button" data-action-role="light" @click="emit('openRules')">游戏规则 →</button>
        </div>
      </section>
    </div>

    <LobbyDialog
      v-if="dialog !== null"
      :title="dialog === 'players' ? '人数' : '买码'"
      :theme-name="themeName"
      variant="match"
      @close="dialog = null"
    >
      <div v-if="dialog === 'players'" class="picker-options">
        <button
          v-for="option in playerOptions"
          :key="option.id"
          type="button"
          data-action-role="secondary"
          :class="{ active: pickedPlayers === option.id }"
          @click="choosePlayers(option.id)"
        >
          <i aria-hidden="true"></i>
          <span><b>{{ option.name }}</b><small>{{ option.description }}</small></span>
        </button>
      </div>
      <div v-else class="picker-options">
        <button
          v-for="option in maOptions"
          :key="option.id"
          type="button"
          data-action-role="secondary"
          :disabled="pickedPlayers === 4 && option.id !== 0"
          :class="{ active: pickedPlayers === 4 ? option.id === 0 : pickedMa === option.id }"
          @click="chooseMa(option.id)"
        >
          <i aria-hidden="true"></i>
          <span><b>{{ option.name }}</b><small>{{ option.description }}</small></span>
        </button>
      </div>
    </LobbyDialog>
  </section>
</template>

<style scoped>
/* 联机那栏的说明：沿用旧大厅的暗色排版，但明确写出"还没接完"。 */
.nf-online-note { margin: 0 0 10px; color: var(--theme-text-muted); font-size: 12px; line-height: 1.7; text-align: left; }
</style>
