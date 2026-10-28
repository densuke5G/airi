import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { MotionPlugin } from '@vueuse/motion'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import CardEditor from '../../../../stage-pages/src/pages/settings/airi-card/components/CardEditor.vue'

import { useProviderConfigStore } from '../providers/config'
import { useAiriCardStore } from './airi-card'
import { useSpeechStore } from './speech'

// https://github.com/moeru-ai/airi/pull/2490#discussion_r3967236115
// ROOT CAUSE: Unsaved dialog selections loaded into the runtime catalog and
// cleared its selected voice. Preview responses must remain local to the dialog.
it.each(['completed', 'unmounted', 'replaced'])('isolates card preview responses when %s', async (scenario) => {
  localStorage.clear()
  let voice = 'runtime'
  const fetchVoices = vi.fn<typeof fetch>(async () => Response.json({ voices: [{ id: voice, name: voice, languages: [] }], data: [] }))
  vi.stubGlobal('fetch', fetchVoices)
  const deferred = Promise.withResolvers<Response>()
  const pinia = createPinia()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const cardId = ref('')
  const container = document.createElement('div')
  document.body.append(container)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: '/',
      component: {
        setup() {
          useSpeechStore()
          return () => h(CardEditor, { cardId: cardId.value, initialSection: 'modules' })
        },
      },
    }],
  })
  const app = createApp({ render: () => h(RouterView) })
  app.use(pinia).use(PiniaColada).use(MotionPlugin).use(i18n).use(router).mount(container)
  try {
    await router.push('/')
    await router.isReady()
    const speech = useSpeechStore(pinia)
    await useProviderConfigStore(pinia).ensureProvider('microsoft-speech', 'microsoft-speech', {
      apiKey: 'key',
      baseUrl: 'https://voices.invalid/v1/',
      region: 'eastasia',
    })
    await speech.selectProviderModel('microsoft-speech', 'runtime-model')
    await vi.waitFor(() => expect(speech.availableVoices['microsoft-speech']?.[0]?.id).toBe('runtime'))
    speech.activeSpeechVoiceId = 'runtime'
    await speech.ensureActiveSpeechVoice()
    const cards = useAiriCardStore(pinia)
    /** Creates an inactive draft so changing the dialog never activates it. */
    async function draft(model: string) {
      return cards.addCard({
        name: 'Preview',
        version: '1.0',
        description: '',
        extensions: { airi: { modules: { speech: { provider: 'microsoft-speech', model, voice_id: '' } } } },
      }, 'scratch')
    }
    cardId.value = await draft('preview-model')
    voice = 'preview'
    fetchVoices.mockClear()
    if (scenario !== 'completed')
      fetchVoices.mockImplementationOnce(() => deferred.promise)
    await vi.waitFor(() => expect(fetchVoices).toHaveBeenCalled())
    if (scenario === 'unmounted') {
      app.unmount()
    }
    else if (scenario === 'replaced') {
      cardId.value = await draft('newer-model')
      await vi.waitFor(() => expect(fetchVoices.mock.calls.length).toBeGreaterThan(1))
    }
    deferred.resolve(Response.json({ voices: [{ id: 'obsolete', name: 'Obsolete', languages: [] }] }))
    await new Promise(resolve => setTimeout(resolve, 100))
    if (scenario !== 'unmounted') {
      const label = Array.from(document.querySelectorAll('label')).find(element => element.textContent?.trim() === i18n.global.t('settings.pages.card.speech.voice'))
      const trigger = label?.parentElement?.querySelector('button')
      expect(trigger).toBeTruthy()
      trigger!.click()
      await vi.waitFor(() => expect(Array.from(document.querySelectorAll('[role="option"]')).some(element => element.textContent?.includes('preview'))).toBe(true))
      expect(Array.from(document.querySelectorAll('[role="option"]')).some(element => element.textContent?.includes('Obsolete'))).toBe(false)
    }
    expect(speech.activeSpeechModel).toBe('runtime-model')
    expect(speech.activeSpeechVoiceId).toBe('runtime')
    expect(speech.availableVoices['microsoft-speech']?.[0]?.id).toBe('runtime')
  }
  finally {
    deferred.resolve(Response.json({ voices: [] }))
    app.unmount()
    disposePinia(pinia)
    container.remove()
    vi.unstubAllGlobals()
    localStorage.clear()
  }
})

it('saves manual voice IDs and restores them when switching characters and reloading stores', async () => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], data: [] })))
  const pinia = createPinia()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const cardId = ref('')
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ setup() {
    useSpeechStore()
    return () => h(CardEditor, { cardId: cardId.value, initialSection: 'modules' })
  } })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: CardEditor }] })
  app.use(pinia).use(PiniaColada).use(MotionPlugin).use(i18n).use(router).mount(container)
  let reloadedApp: ReturnType<typeof createApp> | undefined
  let reloadedPinia: ReturnType<typeof createPinia> | undefined
  try {
    await router.push('/')
    await router.isReady()
    const provider = 'openai-compatible-audio-speech'
    await useProviderConfigStore(pinia).ensureProvider(provider, provider, { apiKey: 'local-test', baseUrl: 'https://voices.invalid/v1/' })
    const speech = useSpeechStore(pinia)
    await speech.selectProviderModel(provider, 'irodori-tts', 'global-voice')
    const cards = useAiriCardStore(pinia)
    await cards.initialize()
    async function character(name: string, voiceId: string) {
      return cards.addCard({
        name,
        version: '1.0',
        description: 'Test companion',
        extensions: { airi: { modules: { speech: { provider, model: 'irodori-tts', voice_id: voiceId } } } },
      }, 'scratch')
    }
    const first = await character('First', 'KonomiKohara')
    const second = await character('Second', 'second-voice')
    cardId.value = first
    await vi.waitFor(() => expect(container.querySelector<HTMLInputElement>('[data-testid="card-speech-voice-id"] input')?.value).toBe('KonomiKohara'))
    const input = container.querySelector<HTMLInputElement>('[data-testid="card-speech-voice-id"] input')!
    input.value = 'KonomiKoharaWav'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === i18n.global.t('settings.pages.card.save'))!
    save.click()
    await vi.waitFor(() => expect(cards.getCard(first)?.extensions.airi.modules.speech.voice_id).toBe('KonomiKoharaWav'))
    await cards.activateCard(first)
    expect(speech.activeSpeechVoiceId).toBe('KonomiKoharaWav')
    await cards.activateCard(second)
    expect(speech.activeSpeechVoiceId).toBe('second-voice')
    await cards.activateCard(first)
    expect(speech.activeSpeechVoiceId).toBe('KonomiKoharaWav')
    app.unmount()
    disposePinia(pinia)
    reloadedPinia = createPinia()
    reloadedApp = createApp({ setup() {
      useSpeechStore()
      useAiriCardStore()
      return () => null
    } }).use(reloadedPinia).use(PiniaColada).use(i18n)
    reloadedApp.mount(document.createElement('div'))
    const reloadedCards = useAiriCardStore(reloadedPinia)
    await reloadedCards.initialize()
    expect(reloadedCards.activeCardId).toBe(first)
    expect(useSpeechStore(reloadedPinia).activeSpeechVoiceId).toBe('KonomiKoharaWav')
  }
  finally {
    app.unmount()
    disposePinia(pinia)
    reloadedApp?.unmount()
    if (reloadedPinia)
      disposePinia(reloadedPinia)
    container.remove()
    vi.unstubAllGlobals()
    localStorage.clear()
  }
})
