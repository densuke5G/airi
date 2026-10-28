import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import OpenAITranscriptionPage from '../../../../../stage-pages/src/pages/settings/providers/transcription/openai-audio-transcription.vue'

import 'virtual:uno.css'

const providerId = 'openai-audio-transcription'
const piniaInstances: ReturnType<typeof createPinia>[] = []
const runtimes: ReturnType<typeof createSyncedPiniaPlugin>[] = []
const apps: App[] = []

async function renderSettings(pinia: ReturnType<typeof createPinia>) {
  await page.viewport(1100, 1000)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  return await render(OpenAITranscriptionPage, {
    global: {
      plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      directives: { motion: {} },
    },
  })
}

function newPinia() {
  const pinia = createPinia()
  piniaInstances.push(pinia)
  return pinia
}

describe('openAI transcription settings and hearing selection', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ object: 'list', data: [{ id: 'whisper-1' }] })))
  })

  afterEach(() => {
    for (const app of apps.splice(0))
      app.unmount()
    for (const runtime of runtimes.splice(0))
      runtime.dispose()
    for (const pinia of piniaInstances.splice(0))
      disposePinia(pinia)
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // Local user report: OpenAI disappeared from Hearing after entry of transcription credentials.
  // ROOT CAUSE:
  // The shared transcription form never validated credentials or marked its provider configured.
  // Hearing lists configured providers. The form now uses the shared validation lifecycle.
  it('makes OpenAI selectable in Hearing after entry of transcription credentials', async () => {
    const pinia = newPinia()
    const screen = await renderSettings(pinia)
    await screen.getByPlaceholder('API Key', { exact: true }).fill('sk-transcription-test')

    await expect.poll(() => useProviderStore(pinia).moduleTranscriptionProvidersMetadata.map(provider => provider.id))
      .toContain(providerId)
    expect(useProviderConfigStore(pinia).getProviderConfig(providerId)?.apiKey).toBe('sk-transcription-test')
    expect(useProviderConfigStore(pinia).providers[providerId]?.status).toBe('configured')

    await screen.getByPlaceholder('API Key', { exact: true }).fill('')
    await expect.poll(() => useProviderStore(pinia).moduleTranscriptionProvidersMetadata.map(provider => provider.id))
      .not
      .toContain(providerId)
    expect(useProviderConfigStore(pinia).providers[providerId]?.status).toBe('unconfigured')
  })

  it('restores a saved OpenAI key and makes the provider selectable without re-entry', async () => {
    localStorage.setItem('settings/providers/configured', JSON.stringify({
      [providerId]: {
        id: providerId,
        definitionId: providerId,
        config: { apiKey: 'sk-saved-transcription-test', baseUrl: 'https://api.openai.com/v1/', model: 'gpt-4o-mini-transcribe' },
        status: 'unconfigured',
        configuredBy: 'user',
      },
    }))
    const pinia = newPinia()
    await renderSettings(pinia)
    await expect.poll(() => useProviderStore(pinia).moduleTranscriptionProvidersMetadata.map(provider => provider.id))
      .toContain(providerId)
    expect(useProviderConfigStore(pinia).getProviderConfig(providerId)?.model).toBe('gpt-4o-mini-transcribe')
  })

  it('reflects transcription settings from a follower into the main-window hearing candidates', async () => {
    const namespace = `transcription-settings:${crypto.randomUUID()}`
    const leaderPinia = newPinia()
    const leaderRuntime = createSyncedPiniaPlugin({ namespace, leadership: 'leader-only', callTimeout: 3000 })
    runtimes.push(leaderRuntime)
    leaderPinia.use(leaderRuntime.plugin)
    const leaderApp = createApp({
      setup() {
        useProviderStore()
        return () => null
      },
    })
    apps.push(leaderApp)
    leaderApp.use(leaderPinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(document.createElement('div'))
    await expect.poll(() => leaderRuntime.isLeader()).toBe(true)

    const followerPinia = newPinia()
    const followerRuntime = createSyncedPiniaPlugin({ namespace, leadership: 'follower-only', callTimeout: 3000 })
    runtimes.push(followerRuntime)
    followerPinia.use(followerRuntime.plugin)
    const screen = await renderSettings(followerPinia)
    await expect.poll(() => followerRuntime.getLeaderId()).toBe(leaderRuntime.participantId)
    await screen.getByPlaceholder('API Key', { exact: true }).fill('sk-follower-transcription-test')

    await expect.poll(() => useProviderStore(leaderPinia).moduleTranscriptionProvidersMetadata.map(provider => provider.id))
      .toContain(providerId)
    await expect.poll(() => useProviderConfigStore(leaderPinia).getProviderConfig(providerId)?.apiKey)
      .toBe('sk-follower-transcription-test')
    await expect.poll(() => useProviderStore(followerPinia).moduleTranscriptionProvidersMetadata.map(provider => provider.id))
      .toContain(providerId)
    await screen.getByPlaceholder('Select a model...', { exact: true }).click()
    await page.getByRole('option', { name: 'GPT-4o Mini Transcribe', exact: true }).click()
    await expect.poll(() => useProviderConfigStore(leaderPinia).getProviderConfig(providerId)?.model)
      .toBe('gpt-4o-mini-transcribe')

    const followerWrites = vi.fn()
    const stop = useProviderConfigStore(followerPinia).$onAction(({ name }) => {
      if (name === 'patchProviderConfig' || name === 'setProviderModel')
        followerWrites(name)
    })
    await useProviderConfigStore(leaderPinia).setProviderModel(providerId, 'whisper-1')
    await expect.element(screen.getByPlaceholder('Select a model...', { exact: true })).toHaveValue('Whisper-1')
    expect(followerWrites).not.toHaveBeenCalled()
    stop()

    await screen.getByRole('button', { name: 'Reset settings', exact: true }).click()
    await expect.poll(() => useProviderStore(leaderPinia).moduleTranscriptionProvidersMetadata.map(provider => provider.id))
      .not
      .toContain(providerId)
    expect(useProviderConfigStore(leaderPinia).getProviderConfig(providerId)?.apiKey).toBe('')
  })
})
