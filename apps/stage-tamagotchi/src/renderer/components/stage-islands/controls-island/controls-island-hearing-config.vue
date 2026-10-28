<script setup lang="ts">
import { HearingConfigDialog } from '@proj-airi/stage-ui/components'
import { useAudioAnalyzer, useAudioContextFromStream } from '@proj-airi/stage-ui/composables'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const show = defineModel('show', { type: Boolean, default: false })

const hearingStore = useHearingStore()
const settingsAudioDeviceStore = useSettingsAudioDevice()
const { autoSendEnabled } = storeToRefs(hearingStore)
const { enabled, stream, speechThreshold, minSilenceDurationMs, volumeFallbackEnabled } = storeToRefs(settingsAudioDeviceStore)
const { t } = useI18n()

const { audioContext, initialize, dispose, pause } = useAudioContextFromStream(stream)
const { volumeLevel, startAnalyzer, stopAnalyzer } = useAudioAnalyzer()

// NOTICE: Do not call `startStream()` / `stopStream()` from this component.
//
// `useSettingsAudioDevice()` already owns the mic stream lifecycle via the persisted `enabled` state.
// We previously toggled the stream here as well, which introduced a second lifecycle controller: the
// dialog could recreate the MediaStream while the page-level transcription pipeline still believed
// the old session was active.
//
// That produced the "VAD still works, but no transcript arrives" failure after retoggling the mic.
//
// This component should only react to the current stream to drive analyzer UI state.
watch([enabled, stream], ([isEnabled, currentStream]) => {
  if (isEnabled && currentStream) {
    initialize().then(() => {
      if (audioContext.value)
        return startAnalyzer(audioContext.value)
    })
  }
  else {
    stopAnalyzer()
    pause()
  }
}, { immediate: true })

onMounted(async () => {
  if (audioContext.value) {
    await startAnalyzer(audioContext.value)
  }
})

onUnmounted(async () => {
  await stopAnalyzer()
  await dispose()
})
</script>

<template>
  <HearingConfigDialog
    v-model:show="show"
    v-model:auto-send="autoSendEnabled"
    :volume-level="volumeLevel"
  >
    <slot />
    <template #extra>
      <div :class="['mt-4 flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-700']">
        <FieldRange
          v-model="speechThreshold"
          :min="0.1" :max="0.9" :step="0.01"
          :label="t('tamagotchi.stage.controls-island.input-detection.threshold')"
          :description="t('tamagotchi.stage.controls-island.input-detection.threshold-description')"
          :format-value="value => value.toFixed(2)"
        />
        <FieldRange
          v-model="minSilenceDurationMs"
          :min="300" :max="2000" :step="100"
          :label="t('tamagotchi.stage.controls-island.input-detection.silence')"
          :format-value="value => `${value} ms`"
        />
        <FieldCheckbox
          v-model="volumeFallbackEnabled"
          :label="t('tamagotchi.stage.controls-island.input-detection.volume-fallback')"
          :description="t('tamagotchi.stage.controls-island.input-detection.volume-fallback-description')"
        />
      </div>
    </template>
  </HearingConfigDialog>
</template>
