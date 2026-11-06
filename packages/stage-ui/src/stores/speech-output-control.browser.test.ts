import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSpeechOutputControlStore } from './speech-output-control'

const piniaInstances: Array<ReturnType<typeof createPinia>> = []

afterEach(() => {
  for (const pinia of piniaInstances.splice(0))
    disposePinia(pinia)
  localStorage.clear()
})

describe('speech output control across windows', () => {
  it('combines meeting and original mute without changing the saved AIRI flag', async () => {
    const pinia = createPinia()
    piniaInstances.push(pinia)
    setActivePinia(pinia)
    const store = useSpeechOutputControlStore()
    store.setMeetingMuted(true)
    expect(store.effectiveSpeechMuted).toBe(true)
    expect(store.speechMuted).toBe(false)
    const request = store.latestStopRequest
    store.setMeetingMuted(true)
    expect(store.latestStopRequest).toEqual(request)
    store.setSpeechMuted(true)
    store.setMeetingMuted(false)
    expect(store.effectiveSpeechMuted).toBe(true)
    expect(store.speechMuted).toBe(true)
    await vi.waitFor(() => expect(localStorage.getItem('settings/speech/output-muted')).toBe('true'))
    store.setSpeechMuted(false)
    expect(store.effectiveSpeechMuted).toBe(false)
  })
  it('delivers stop requests to the Stage output owner', async () => {
    const senderPinia = createPinia()
    piniaInstances.push(senderPinia)
    setActivePinia(senderPinia)
    const sender = useSpeechOutputControlStore()

    const receiverPinia = createPinia()
    piniaInstances.push(receiverPinia)
    setActivePinia(receiverPinia)
    const receiver = useSpeechOutputControlStore()

    sender.requestStopSpeaking('manual-chat')

    await vi.waitFor(() => {
      expect(receiver.latestStopRequest).toEqual({ id: 1, reason: 'manual-chat' })
    })
  })
})
