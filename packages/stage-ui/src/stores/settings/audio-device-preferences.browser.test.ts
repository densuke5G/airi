import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { useSettingsAudioDevice } from './audio-device'

it('persists conversation detection settings and resets them without enabling the microphone', async () => {
  localStorage.clear()
  const firstPinia = createPinia()
  const firstApp = createApp({ setup() {
    useSettingsAudioDevice()
    return () => null
  } }).use(firstPinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
  firstApp.mount(document.createElement('div'))
  const first = useSettingsAudioDevice(firstPinia)
  first.speechThreshold = 0.75
  first.minSilenceDurationMs = 600
  first.volumeFallbackEnabled = false
  await nextTick()
  firstApp.unmount()
  disposePinia(firstPinia)
  const secondPinia = createPinia()
  const secondApp = createApp({ setup() {
    useSettingsAudioDevice()
    return () => null
  } }).use(secondPinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
  secondApp.mount(document.createElement('div'))
  try {
    const second = useSettingsAudioDevice(secondPinia)
    expect(second.speechThreshold).toBe(0.75)
    expect(second.minSilenceDurationMs).toBe(600)
    expect(second.volumeFallbackEnabled).toBe(false)
    expect(second.enabled).toBe(false)
    expect(second.stream).toBeUndefined()
    second.resetState()
    expect(second.speechThreshold).toBe(0.52)
    expect(second.minSilenceDurationMs).toBe(1200)
    expect(second.volumeFallbackEnabled).toBe(true)
    expect(second.enabled).toBe(false)
  }
  finally {
    secondApp.unmount()
    disposePinia(secondPinia)
    localStorage.clear()
  }
})
