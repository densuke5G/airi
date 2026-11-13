import type { GenerationProvider } from '@proj-airi/provider-inference'

import type { MemoryConnection } from '../services/memory/contracts'

import en from '@proj-airi/i18n/locales/en'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { installMemoryConnection } from '../services/memory/connection'
import { emptyMemorySnapshot } from '../services/memory/contracts'
import { useLLM } from './ai/chat-llm/llm'
import { useChatStore } from './chat'
import { useChatContextStore } from './chat/context-store'
import { useChatSessionStore } from './chat/session-store'
import { useModsServerChannelStore } from './mods/api/channel-server'
import { useConsciousnessStore } from './modules/consciousness'
import { useVisionStore } from './modules/vision'

async function createMemoryChat() {
  const pinia = createPinia()
  const view = render(defineComponent({
    setup() {
      useChatStore()
      return () => h('div')
    },
  }), { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] } })
  const chat = useChatStore(pinia)
  const sessions = useChatSessionStore(pinia)
  const consciousness = useConsciousnessStore(pinia)
  const vision = useVisionStore(pinia)
  const previous = {
    provider: consciousness.activeProvider,
    model: consciousness.activeModel,
    visionProvider: vision.activeProvider,
    visionModel: vision.activeModel,
    useForChat: vision.useForChat,
  }
  const snapshot = emptyMemorySnapshot()
  snapshot.profile.enabled = true
  snapshot.state = 'ready'
  snapshot.connected = true
  snapshot.configured = true
  const gate = vi.fn(async () => ({ allow: true }))
  const prepare = vi.fn<MemoryConnection['prepare']>(async (input, signal) => ({
    conversation: { turns: [
      { type: 'system', id: 'memory', authority: 'system', content: [{ type: 'text', text: 'RECALLED_MEMORY: The user enjoys baseball.' }] },
      ...input.conversation.turns,
    ] },
    privateContext: true,
    signal,
    requestPolicy: { providerId: input.providerId, model: input.model, signal, isCurrent: () => !signal.aborted, beforeRequest: gate },
  }))
  const uninstall = installMemoryConnection({
    command: async () => snapshot,
    prepare,
    report: async () => {},
    displayed: async () => {},
    registerConversationHost: async () => async () => {},
    registerSpeechHost: async () => async () => {},
    subscribe: () => () => {},
  })
  const provider: GenerationProvider = {
    generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.test/' } }),
  }
  const getProvider = vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
  const stream = vi.spyOn(useLLM(pinia), 'stream').mockImplementation(async (_model, _provider, _context, options) => {
    const decision = await options?.requestPolicy?.beforeRequest('initial', options.abortSignal ?? new AbortController().signal)
    if (!decision?.allow)
      throw new Error('The memory request was not authorized.')
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'Text chat still works.' })
    await options?.onStreamEvent?.({ type: 'finish' })
  })
  await sessions.initialize()
  const sessionId = sessions.activeSessionId
  consciousness.activeProvider = 'openai'
  consciousness.activeModel = 'text-chat'
  vision.activeProvider = 'openai'
  vision.activeModel = 'auxiliary-vision'
  vision.useForChat = true
  useChatContextStore(pinia).ingestContextMessage({
    id: 'screen',
    contextId: 'vision:screen:interpret',
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: 'CURRENT_SCREEN: A baseball scoreboard.',
    createdAt: Date.now(),
  })
  return {
    chat,
    sessions,
    sessionId,
    vision,
    stream,
    gate,
    prepare,
    async dispose() {
      getProvider.mockRestore()
      stream.mockRestore()
      consciousness.activeProvider = previous.provider
      consciousness.activeModel = previous.model
      vision.activeProvider = previous.visionProvider
      vision.activeModel = previous.visionModel
      vision.useForChat = previous.useForChat
      await sessions.deleteSession(sessionId)
      useModsServerChannelStore(pinia).dispose()
      chat.dispose()
      uninstall()
      view.unmount()
      disposePinia(pinia)
    },
  }
}

// ROOT CAUSE:
// A private request rejected every turn with an image anywhere in its history.
// An earlier unsupported attachment therefore also blocked later text messages.
// The provider projection now reuses a cached description or an unavailable-image
// note. The original attachment and the private request policy stay unchanged.
it.each([undefined, 'CACHED_DESCRIPTION: Japan and Korea before the game.'])(
  'continues a private text turn after an older attachment with cached description %s',
  async (description) => {
    const fixture = await createMemoryChat()
    try {
      await fixture.sessions.appendSessionMessage(fixture.sessionId, {
        role: 'user',
        id: 'earlier-image',
        createdAt: Date.now(),
        content: [{ type: 'text', text: 'I am watching baseball.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,EARLIER_IMAGE' } }],
        imageDescriptions: description ? [{ imageIndex: 0, description }] : undefined,
      })
      await fixture.chat.send({ sessionId: fixture.sessionId, text: 'Can we keep chatting?' })
      expect(fixture.stream).toHaveBeenCalledOnce()
      expect(fixture.stream.mock.calls[0][0]).toBe('text-chat')
      expect(fixture.stream.mock.calls[0][3]?.privateContext).toBe(true)
      expect(fixture.gate).toHaveBeenCalledOnce()
      const prompt = JSON.stringify(fixture.stream.mock.calls[0][2])
      expect(prompt).toContain('RECALLED_MEMORY')
      expect(prompt).toContain('CURRENT_SCREEN')
      expect(prompt).toContain(description ?? 'unavailable in this memory-enabled request')
      expect(prompt).not.toContain('EARLIER_IMAGE')
      expect(JSON.stringify(fixture.sessions.getSessionMessages(fixture.sessionId))).toContain('EARLIER_IMAGE')
    }
    finally {
      await fixture.dispose()
    }
  },
)

it('keeps the auxiliary image restriction on a new private attachment', async () => {
  const fixture = await createMemoryChat()
  try {
    await expect(fixture.chat.send({
      sessionId: fixture.sessionId,
      text: 'Read this image.',
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'CURRENT_IMAGE' }],
    })).rejects.toThrow('Memory chat cannot send attached images to a separate vision model.')
    expect(fixture.stream).not.toHaveBeenCalled()
    expect(fixture.gate).not.toHaveBeenCalled()
  }
  finally {
    await fixture.dispose()
  }
})

it('keeps direct private image input on the bound chat model when auxiliary reading is off', async () => {
  const fixture = await createMemoryChat()
  try {
    fixture.vision.useForChat = false
    await fixture.chat.send({ sessionId: fixture.sessionId, text: 'Read directly.', attachments: [{ type: 'image', mimeType: 'image/png', data: 'CURRENT_IMAGE' }] })
    expect(fixture.stream).toHaveBeenCalledOnce()
    expect(JSON.stringify(fixture.stream.mock.calls[0][2])).toContain('CURRENT_IMAGE')
    expect(fixture.stream.mock.calls[0][3]?.privateContext).toBe(true)
    expect(fixture.gate).toHaveBeenCalledOnce()
  }
  finally {
    await fixture.dispose()
  }
})
