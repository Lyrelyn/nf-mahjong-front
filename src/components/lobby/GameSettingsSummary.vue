<script setup lang="ts">
interface Props {
  matchName: string
  matchDescription: string
  ruleName: string
  ruleDescription: string
  /** 第一行的标题。默认沿旧玩法的「场次」，南丰大厅传「人数」。 */
  matchLabel?: string
  /** 第二行的标题。默认「玩法」，南丰大厅传「买码」。 */
  ruleLabel?: string
}

withDefaults(defineProps<Props>(), { matchLabel: '场次', ruleLabel: '玩法' })
defineEmits<{ selectMatch: []; selectRule: [] }>()
</script>

<template>
  <section class="game-settings" aria-label="对局设置">
    <p class="game-settings-title">对局设置</p>
    <button type="button" data-action-role="secondary" @click="$emit('selectMatch')">
      <span>{{ matchLabel }}</span>
      <strong>{{ matchName }}</strong>
      <small>{{ matchDescription }}</small>
      <i aria-hidden="true"></i>
    </button>
    <button type="button" data-action-role="secondary" @click="$emit('selectRule')">
      <span>{{ ruleLabel }}</span>
      <strong>{{ ruleName }}</strong>
      <small>{{ ruleDescription }}</small>
      <i aria-hidden="true"></i>
    </button>
  </section>
</template>
