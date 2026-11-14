<script setup lang="ts">
// 联机房间面板：建房/加房/房间号/座位/准备/开局。
// 房间与对局的生命周期都在 `NanfengApp` 里（离开大厅进桌时不能把房间关掉），这里只做界面。
import { computed, ref } from 'vue'
import type { NanfengOnline } from './useNanfengOnline'

const props = defineProps<{
  online: NanfengOnline
  /** 建房人数（4 / 5）：决定房间连接位，建房后不可改。 */
  players: number
  /** 房主选的买码张数（v-model，仅 5 人局有效）。 */
  maCount: number
}>()

const emit = defineEmits<{ openRules: [] }>()

const joinCodeInput = ref('')

const seats = computed(() => props.online.seats.value)
const mySeat = computed(() => props.online.mySeat.value)
/**
 * 座位槽位：`players` 个人数位，坐人的显示昵称+准备态，空位就是人机（房主可改名）。
 * 人少了不用等——空位由本机 AI 补。
 */
const slots = computed(() => Array.from({ length: props.players }, (_, seat) => {
  const human = seats.value.find((item) => item.seat === seat)
  // name === '' 表示**空位**（没设人机）；设了人机就有名字。
  const name = human?.nickname ?? props.online.botNames.value[seat] ?? ''
  return {
    seat,
    name,
    human: human !== undefined,
    ready: human?.ready === true,
    me: seat === mySeat.value,
  }
}))

/** 房主：把空位设成人机（默认名 `AI N`，之后可改）。 */
function addBot(seat: number) {
  props.online.botNames.value[seat] = `AI ${seat}`
}

/** 房主：取消这个座位的人机，恢复成空位。 */
function removeBot(seat: number) {
  delete props.online.botNames.value[seat]
}

/**
 * 开始对局：人机位不参与准备判定（空位/人机由本机 AI 补），
 * 只有"还在场但没准备"的真人会拦住开局 —— 拦住时也要说清楚是谁。
 */
async function startMatch() {
  const waiting = seats.value.filter((seat) => !seat.ready).map((seat) => seat.nickname)
  if (waiting.length > 0) {
    props.online.error.value = `还没准备：${waiting.join('、')}`
    return
  }
  await props.online.startMatch()
}
const myReady = computed(() => seats.value.find((seat) => seat.seat === mySeat.value)?.ready === true)
// 人不够也能开：空位由 AI 补，所以只要求"在场的人都已准备"。
const allReady = computed(() => seats.value.length >= 1 && seats.value.every((seat) => seat.ready))
const busy = computed(() => props.online.status.value === 'creating' || props.online.status.value === 'joining')

async function createRoom() {
  await props.online.createRoom()
  joinCodeInput.value = ''
}

async function joinRoom() {
  props.online.joinCode.value = joinCodeInput.value
  await props.online.joinRoom()
}
</script>

<template>
  <div class="remote-lobby">
    <!-- 还没进房：昵称 + 建房/加房 -->
    <template v-if="online.roomId.value === ''">
      <p class="nf-online-note">
        {{ players === 5 ? '5 人轮换' : '4 人局' }} ·
        {{ players === 5 && maCount > 0 ? `买 ${maCount} 张码` : '不买码' }}
        <small>（人数/买码沿用上面那两行，房主建房时生效）</small>
      </p>
      <label class="remote-field">
        <span>昵称</span>
        <input v-model="online.nickname.value" maxlength="12" placeholder="输入昵称" />
      </label>
      <div class="remote-entry-actions">
        <button class="remote-create" type="button" data-action-role="primary" :disabled="busy" @click="createRoom">
          创建房间
        </button>
        <button class="remote-join-btn" type="button" data-action-role="primary" :disabled="busy" @click="joinRoom">
          加入房间
        </button>
      </div>
      <label class="remote-field">
        <span>房间号</span>
        <input v-model="joinCodeInput" maxlength="6" placeholder="6 位房间号" @keyup.enter="joinRoom" />
      </label>
      <p class="nf-online-note">联机固定 5 人：4 人打牌 + 1 人轮空买码，每局按规矩换人。</p>
    </template>

    <!-- 已在房里：房间号 + 座位 + 准备/开局 -->
    <template v-else>
      <p class="nf-online-room">
        房间号 <b>{{ online.roomId.value }}</b>
        <small>（{{ seats.length }} / {{ players }} 人，空位由 AI 补）</small>
      </p>
      <ul class="nf-online-seats">
        <li
          v-for="slot in slots"
          :key="slot.seat"
          :class="{ me: slot.me, ready: slot.ready, empty: !slot.human && slot.name === '', bot: !slot.human && slot.name !== '' }"
        >
          <!-- 有人坐 -->
          <template v-if="slot.human">
            <span>{{ slot.name }}<template v-if="slot.me">（你）</template></span>
            <em>{{ slot.ready ? '已准备' : '未准备' }}</em>
          </template>
          <!-- 已设人机：房主可改名 / 移除 -->
          <template v-else-if="slot.name !== ''">
            <input
              v-if="online.isHost.value"
              class="nf-bot-name"
              :value="slot.name"
              maxlength="8"
              aria-label="人机名字"
              @input="online.botNames.value[slot.seat] = ($event.target as HTMLInputElement).value"
            />
            <span v-else>{{ slot.name }}</span>
            <button v-if="online.isHost.value" class="nf-slot-action" type="button" @click="removeBot(slot.seat)">移除</button>
            <em v-else>人机</em>
          </template>
          <!-- 空位：只有房主能点成"人机" -->
          <template v-else>
            <span class="nf-empty">空位</span>
            <button v-if="online.isHost.value" class="nf-slot-action" type="button" @click="addBot(slot.seat)">设置人机</button>
          </template>
        </li>
      </ul>

      <p v-if="players === 4" class="nf-online-note">4 人局：不换座、不买码。</p>

      <div class="remote-entry-actions">
        <button class="remote-join-btn" type="button" data-action-role="secondary" @click="online.toggleReady()">
          {{ myReady ? '取消准备' : '准备' }}
        </button>
        <!-- 不做 disabled 门：点了就试，开不了会给出具体原因（人机位不影响） -->
        <button
          v-if="online.isHost.value"
          class="remote-create"
          type="button"
          data-action-role="primary"
          @click="startMatch"
        >
          开始对局
        </button>
      </div>

      <p v-if="online.error.value" class="session-error" role="alert">{{ online.error.value }}</p>
      <button class="text-button" type="button" data-action-role="light" @click="online.leave()">离开房间</button>
    </template>

    <p v-if="online.error.value && online.roomId.value === ''" class="session-error" role="alert">{{ online.error.value }}</p>
  </div>
</template>

<style scoped>
.nf-online-note { margin: 0; color: var(--theme-text-muted); font-size: 12px; line-height: 1.7; text-align: left; }
.nf-online-room { margin: 0; color: var(--theme-text); font-size: 14px; letter-spacing: .08em; }
.nf-online-room b { color: var(--theme-accent-text); letter-spacing: .18em; }
.nf-online-room small { margin-left: 6px; color: var(--theme-text-muted); font-size: 11px; }
.nf-online-seats { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; width: 100%; }
.nf-online-seats li {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 8px; border: 1px solid color-mix(in srgb, var(--theme-border) 28%, transparent);
  border-radius: 6px; background: color-mix(in srgb, var(--theme-panel) 60%, transparent);
  font-size: 12px; color: var(--theme-text-muted);
}
.nf-online-seats li.me { border-color: var(--theme-accent); color: var(--theme-text); }
.nf-online-seats li.ready em { color: var(--theme-positive); }
.nf-online-seats li.bot em { color: var(--theme-accent-text); }
.nf-bot-name {
  flex: 1; min-width: 0; padding: 2px 6px; border: 1px dashed color-mix(in srgb, var(--theme-border) 40%, transparent);
  border-radius: 5px; background: transparent; color: var(--theme-text); font-size: 12px;
}
.nf-bot-name:focus { outline: 1px solid var(--theme-accent); border-style: solid; }
.nf-slot-action {
  flex: 0 0 auto; padding: 2px 8px; border: 1px dashed color-mix(in srgb, var(--theme-border) 45%, transparent);
  border-radius: 5px; background: transparent; color: var(--theme-accent-text); font-size: 11px; cursor: pointer;
}
.nf-slot-action:hover { border-style: solid; border-color: var(--theme-accent); }
.nf-empty { color: var(--theme-text-muted); opacity: .72; }
</style>
