import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { executeSherpawStream } from '../../libs/providers/providers/sherpaw'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useHearingSpeechInputPipeline, useHearingStore } from './hearing'

// The inference worker is external IO. Capture real Web Audio PCM without loading a recognition model.
vi.mock('../../libs/providers/providers/sherpaw', { spy: true })

it.each([false, true])('sends PCM only during manual input and finalizes with abort=%s', async (abort) => {
  localStorage.clear()
  vi.mocked(executeSherpawStream).mockClear()
  let capturedBytes = 0
  let framesAtRelease = 0
  vi.mocked(executeSherpawStream).mockImplementation((options) => {
    const text = (async () => {
      const reader = options.inputAudioStream!.getReader()
      options.abortSignal?.addEventListener('abort', () => {
        void reader.cancel()
      }, { once: true })
      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break
        capturedBytes += value.byteLength
      }
      framesAtRelease = capturedBytes
      return options.abortSignal?.aborted ? '' : 'manual transcript'
    })()
    return {
      text,
      fullStream: new ReadableStream({ start(controller) { controller.close() } }),
      textStream: new ReadableStream({ start(controller) { controller.close() } }),
    }
  })
  const context = new AudioContext()
  const pinia = createPinia()
  const app = createApp({
    setup() {
      useHearingSpeechInputPipeline()
      return () => h('button', { onClick: () => context.resume() }, 'Start audio')
    },
  })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(document.body.appendChild(document.createElement('div')))
  const oscillator = context.createOscillator()
  const destination = context.createMediaStreamDestination()
  oscillator.connect(destination)
  oscillator.start()
  await page.getByRole('button', { name: 'Start audio' }).click()
  await context.resume()
  const pipeline = useHearingSpeechInputPipeline(pinia)
  try {
    const provider = 'sherpaw-transcription'
    await useProviderConfigStore(pinia).ensureProvider(provider, provider, { model: 'paraformer-zh-en' })
    await useProviderStore(pinia).forceProviderConfigured(provider)
    const hearing = useHearingStore(pinia)
    hearing.activeTranscriptionProvider = provider
    hearing.activeTranscriptionModel = 'sherpaw'
    await pipeline.transcribeForMediaStream(destination.stream, { consumerId: 'manual-test', manual: true })
    expect(pipeline.error).toBeUndefined()
    await vi.waitFor(() => expect(capturedBytes).toBeGreaterThan(0))
    expect(executeSherpawStream).toHaveBeenCalledOnce()
    const text = await pipeline.stopStreamingTranscription(abort)
    expect(text).toBe(abort ? '' : 'manual transcript')
    expect(framesAtRelease).toBeGreaterThan(0)
    expect(pipeline.error).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(capturedBytes).toBe(framesAtRelease)
    pipeline.removeStreamingTranscriptionConsumer('manual-test')
  }
  finally {
    await pipeline.stopStreamingTranscription(true)
    oscillator.stop()
    for (const track of destination.stream.getTracks())
      track.stop()
    await context.close()
    app.unmount()
    disposePinia(pinia)
    vi.restoreAllMocks()
    localStorage.clear()
  }
})
