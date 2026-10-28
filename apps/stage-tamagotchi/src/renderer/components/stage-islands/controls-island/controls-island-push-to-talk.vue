<script setup lang="ts">
import type { PushToTalkState } from '../../../utils/push-to-talk'

import { useEventListener } from '@vueuse/core'
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ControlButton from './control-button.vue'

const props = defineProps<{
  state: PushToTalkState
  buttonStyle?: string
  iconClass?: string
}>()
const emit = defineEmits<{
  start: []
  finish: []
  cancel: []
}>()
const { t } = useI18n()
const held = ref(false)
const busy = computed(() => props.state === 'transcribing' || props.state === 'cancelling')
const label = computed(() => t(`tamagotchi.stage.controls-island.push-to-talk.${props.state}`))

function start() {
  if (held.value || props.state !== 'idle')
    return
  held.value = true
  emit('start')
}
function finish() {
  if (!held.value)
    return
  held.value = false
  emit('finish')
}
function cancel() {
  if (!held.value)
    return
  held.value = false
  emit('cancel')
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0)
    return
  const target = event.currentTarget
  if (target instanceof HTMLElement)
    target.setPointerCapture(event.pointerId)
  start()
}
function keyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancel()
    return
  }
  if (event.code !== 'Space' && event.code !== 'Enter')
    return
  event.preventDefault()
  if (!event.repeat)
    start()
}
function keyUp(event: KeyboardEvent) {
  if (event.code !== 'Space' && event.code !== 'Enter')
    return
  event.preventDefault()
  finish()
}
useEventListener(window, 'blur', cancel)
onUnmounted(cancel)
</script>

<template>
  <ControlButton
    data-testid="push-to-talk-button"
    :button-style="buttonStyle"
    :title="label"
    :aria-label="label"
    :aria-pressed="held"
    :aria-busy="busy"
    :disabled="busy"
    :class="[held ? 'ring-2 ring-primary-400' : '', 'touch-none select-none']"
    @pointerdown.prevent="pointerDown"
    @pointerup.prevent="finish"
    @pointercancel="cancel"
    @lostpointercapture="cancel"
    @keydown="keyDown"
    @keyup="keyUp"
    @blur="cancel"
    @contextmenu.prevent
  >
    <span :class="[busy ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:hand-tap', iconClass]" />
  </ControlButton>
</template>
