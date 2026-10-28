import en from '@proj-airi/i18n/locales/en'

import { expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import ControlsIslandPushToTalk from './controls-island-push-to-talk.vue'

it('records while Space is held, ignores key repeat, and restores after release', async () => {
  const state = ref<'idle' | 'recording' | 'transcribing'>('idle')
  const start = vi.fn(() => {
    state.value = 'recording'
  })
  const finish = vi.fn(() => {
    state.value = 'transcribing'
  })
  const cancel = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(ControlsIslandPushToTalk, { state: state.value, onStart: start, onFinish: finish, onCancel: cancel }) })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
  try {
    const button = container.querySelector<HTMLButtonElement>('[data-testid="push-to-talk-button"]')!
    button.focus()
    button.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
    button.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true }))
    await nextTick()
    expect(start).toHaveBeenCalledOnce()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.title).toBe('Recording, release to recognize')
    button.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }))
    await nextTick()
    expect(finish).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.disabled).toBe(true)
    state.value = 'idle'
    await nextTick()
    expect(button.disabled).toBe(false)
    expect(button.title).toBe('Hold to talk, release to recognize')
    button.focus()
    button.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }))
    button.blur()
    await nextTick()
    expect(cancel).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledOnce()
  }
  finally {
    app.unmount()
    container.remove()
  }
})
