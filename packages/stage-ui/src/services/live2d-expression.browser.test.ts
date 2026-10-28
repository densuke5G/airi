import type { Tool } from '@xsai/shared-chat'

import { createContext } from '@moeru/eventa/adapters/broadcast-channel'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useLlmStreamingControlStore } from '../stores/ai/chat-llm/streaming-control'
import { registerLive2DExpressionHost, resolveLive2DExpressionTools } from './live2d-expression'

const disposers: Array<() => void> = []

function createFace() {
  setActivePinia(createPinia())
  const store = useExpressionStore()
  const entries = ['ParamMouthForm', 'ParamCheek'].map(name => ({
    name,
    parameterId: name,
    blend: 'Overwrite' as const,
    currentValue: 0,
    defaultValue: 0,
    modelDefault: 0,
    targetValue: 1,
  }))
  store.registerExpressions('face-a', [
    { name: 'neutral', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Overwrite', value: 0 }, { parameterId: 'ParamCheek', blend: 'Overwrite', value: 0 }] },
    { name: 'happy', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Overwrite', value: 0.8 }] },
    { name: 'shy', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Overwrite', value: 0.5 }, { parameterId: 'ParamCheek', blend: 'Overwrite', value: 1 }] },
    { name: 'Surprise', parameters: [{ parameterId: 'ParamMouthForm', blend: 'Overwrite', value: -0.3 }] },
  ], entries)
  disposers.push(() => store.dispose())
  return store
}

function remoteContexts() {
  const name = `expressions-test-${crypto.randomUUID()}`
  const owner = createContext(new BroadcastChannel(name), { closeOnDispose: true })
  const client = createContext(new BroadcastChannel(name), { closeOnDispose: true })
  disposers.push(() => owner.dispose(), () => client.dispose())
  return { owner: owner.context, client: client.context }
}

async function execute(tool: Tool, input: Record<string, unknown>) {
  return JSON.parse(String(await tool.execute(input, { messages: [], toolCallId: 'expression-call' })))
}

afterEach(() => {
  for (const dispose of disposers.reverse())
    dispose()
  disposers.length = 0
  localStorage.clear()
  vi.useRealTimers()
})

describe('conversation expressions', () => {
  it('holds the face throughout a long utterance and releases it after speech finishes', async () => {
    const store = createFace()
    store.setLlmMode('all')
    const speechActive = ref(true)
    disposers.push(registerLive2DExpressionHost(() => true, undefined, () => speechActive.value))
    const control = useLlmStreamingControlStore()
    vi.useFakeTimers()
    await control.dispatchWith('<|ACT {"emotion":"shy"}|>')
    await vi.advanceTimersByTimeAsync(12_000)
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(1)
    await control.dispatchWith('<|ACT {"emotion":"happy"}|>')
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.8)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.8)
    speechActive.value = false
    await vi.advanceTimersByTimeAsync(349)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.8)
    await vi.advanceTimersByTimeAsync(1)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
  })

  it('keeps the face until queued audio drains after synthesis finishes', async () => {
    const store = createFace()
    store.setLlmMode('all')
    const inputActive = ref(true)
    const queuedAudio = ref(true)
    disposers.push(registerLive2DExpressionHost(() => true, undefined, () => inputActive.value || queuedAudio.value))
    vi.useFakeTimers()
    await useLlmStreamingControlStore().dispatchWith('<|ACT {"emotion":"happy"}|>')
    inputActive.value = false
    await vi.advanceTimersByTimeAsync(12_000)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.8)
    queuedAudio.value = false
    await vi.advanceTimersByTimeAsync(350)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
  })

  it('cancels a pending timeout when audio starts and leaves a replacement model alone', async () => {
    const store = createFace()
    store.setLlmMode('all')
    const speechActive = ref(false)
    disposers.push(registerLive2DExpressionHost(() => true, undefined, () => speechActive.value))
    vi.useFakeTimers()
    await useLlmStreamingControlStore().dispatchWith('<|ACT {"emotion":"shy"}|>')
    await vi.advanceTimersByTimeAsync(2000)
    speechActive.value = true
    await vi.advanceTimersByTimeAsync(12_000)
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(1)
    store.registerExpressions('face-b', Array.from(store.expressionGroups.values()), Array.from(store.expressions.values()))
    store.set('happy', 0.5)
    speechActive.value = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.4)
  })

  // ROOT CAUSE:
  // The conversation emitted ACT emotions while only provider tool calls changed expressions.
  // An accompanying motion cue also bypassed emotion handling in Stage.
  it('applies the recorded shy ACT during playback even with an unrelated motion cue', async () => {
    const store = createFace()
    store.setLlmMode('all')
    disposers.push(registerLive2DExpressionHost(() => true))
    const control = useLlmStreamingControlStore()
    await control.dispatchWith('<|ACT {"emotion":{"name":"shy","intensity":0.9},"motion":"look down"}|>')
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.45)
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(0.9)
    await control.dispatchWith('<|ACT {"emotion":"neutral"}|>')
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(0)
  })

  it('maps standard ACT names, honors exposure, and restores the face after six seconds', async () => {
    const store = createFace()
    store.setLlmMode('custom')
    store.setLlmExposed('Surprise', true)
    let enabled = true
    const stop = registerLive2DExpressionHost(() => enabled)
    disposers.push(stop)
    const control = useLlmStreamingControlStore()
    await control.dispatchWith('<|ACT {"emotion":"shy"}|>')
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(0)

    vi.useFakeTimers()
    await control.dispatchWith('<|ACT {"emotion":{"name":" SURPRISED ","intensity":0.5}}|>')
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(-0.15)
    await vi.advanceTimersByTimeAsync(5999)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(-0.15)
    await vi.advanceTimersByTimeAsync(1)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)

    enabled = false
    await control.dispatchWith('<|ACT {"emotion":"surprised"}|>')
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
    enabled = true
    store.setLlmMode('none')
    await control.dispatchWith('<|ACT {"emotion":"surprised"}|>')
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
    store.setLlmMode('all')
    stop()
    await control.dispatchWith('<|ACT {"emotion":"shy"}|>')
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(0)
  })

  it('discovers permitted expressions across renderers and changes the model owner store', async () => {
    const store = createFace()
    store.setLlmMode('custom')
    store.setLlmExposed('shy', true)
    const { owner, client } = remoteContexts()
    disposers.push(registerLive2DExpressionHost(() => true, owner))
    // The chat renderer owns a separate, empty store.
    setActivePinia(createPinia())
    const chatStore = useExpressionStore()
    const tools = await resolveLive2DExpressionTools({ context: client, timeoutMs: 1000 })

    expect(tools).toHaveLength(1)
    expect(tools[0].function.parameters).toMatchObject({ properties: { name: { enum: ['shy'] } } })
    expect((await execute(tools[0], { name: 'shy', intensity: 0.5, duration: 0.1 })).success).toBe(true)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.25)
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(0.5)
    expect(chatStore.expressions.size).toBe(0)
    await expect.poll(() => store.expressions.get('ParamCheek')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
  })

  it('preserves an explicit remote tool duration when speech finishes early', async () => {
    const store = createFace()
    store.setLlmMode('all')
    const speechActive = ref(true)
    const { owner, client } = remoteContexts()
    disposers.push(registerLive2DExpressionHost(() => true, owner, () => speechActive.value))
    const [tool] = await resolveLive2DExpressionTools({ context: client, timeoutMs: 1000 })
    vi.useFakeTimers()
    expect((await execute(tool, { name: 'happy', intensity: 1, duration: 4 })).success).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    speechActive.value = false
    await vi.advanceTimersByTimeAsync(1500)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.8)
    await vi.advanceTimersByTimeAsync(1500)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
  })

  it('replaces the previous face and rejects hidden groups, raw parameters, and invalid values', async () => {
    const store = createFace()
    store.setLlmMode('all')
    disposers.push(registerLive2DExpressionHost(() => true))
    const [tool] = await resolveLive2DExpressionTools()
    await execute(tool, { name: 'shy', intensity: 1, duration: 6 })
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(1)
    await execute(tool, { name: 'happy', intensity: 1, duration: 6 })
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.8)
    expect(store.expressions.get('ParamCheek')?.currentValue).toBe(0)

    for (const input of [
      { name: 'ParamCheek', intensity: 1, duration: 6 },
      { name: 'missing', intensity: 1, duration: 6 },
      { name: 'happy', intensity: 2, duration: 6 },
      { name: 'happy', intensity: 1, duration: -1 },
      { name: 'happy', intensity: 1, duration: 60 },
    ]) {
      expect((await execute(tool, input)).success).toBe(false)
      expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0.8)
    }
  })

  it('rechecks exposure, enabled state, model identity, cancellation, and host shutdown', async () => {
    const store = createFace()
    store.setLlmMode('all')
    let enabled = true
    const stop = registerLive2DExpressionHost(() => enabled)
    disposers.push(stop)
    const [tool] = await resolveLive2DExpressionTools()
    const input = { name: 'happy', intensity: 1, duration: 6 }
    store.setLlmMode('none')
    expect((await execute(tool, input)).success).toBe(false)
    expect(await resolveLive2DExpressionTools()).toEqual([])
    store.setLlmMode('all')
    enabled = false
    expect((await execute(tool, input)).success).toBe(false)
    expect(await resolveLive2DExpressionTools()).toEqual([])
    enabled = true
    const controller = new AbortController()
    controller.abort()
    const cancelled = await tool.execute(input, { messages: [], toolCallId: 'cancelled', abortSignal: controller.signal })
    expect(JSON.parse(String(cancelled)).success).toBe(false)
    store.registerExpressions('face-b', Array.from(store.expressionGroups.values()), Array.from(store.expressions.values()))
    expect((await execute(tool, input)).success).toBe(false)
    expect(store.llmMode).toBe('none')
    store.setLlmMode('all')
    const [newTool] = await resolveLive2DExpressionTools()
    stop()
    expect((await execute(newTool, input)).success).toBe(false)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
  })

  it('omits expressions when no Stage host is available', async () => {
    const { client } = remoteContexts()
    expect(await resolveLive2DExpressionTools({ context: client, timeoutMs: 50 })).toEqual([])
  })
})
