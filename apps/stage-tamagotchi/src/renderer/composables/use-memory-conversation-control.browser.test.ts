import type { MemoryTransport } from '@proj-airi/stage-ui/services/memory/connection'

import type { MemoryConversationStart } from '../../shared/eventa/metrodoros'

import { PiniaColada } from '@pinia/colada'
import { installMemoryConnection, MemoryConnectionClient } from '@proj-airi/stage-ui/services/memory/connection'
import { emptyMemorySnapshot } from '@proj-airi/stage-ui/services/memory/contracts'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import { useMemoryConversationControl } from './use-memory-conversation-control'

const ipc = vi.hoisted(() => ({
  handler: undefined as ((payload: MemoryConversationStart) => Promise<void>) | undefined,
  ready: vi.fn(async () => {}),
}))

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvokeHandler: (_context: unknown, _event: unknown, handler: typeof ipc.handler) => {
    ipc.handler = handler
    return () => {
      ipc.handler = undefined
    }
  } }
})
vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => ({}),
  useElectronEventaInvoke: () => ipc.ready,
}))

const stores: ReturnType<typeof createPinia>[] = []
let uninstall: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  ipc.handler = undefined
  ipc.ready.mockClear()
})
afterEach(() => {
  cleanup()
  uninstall?.()
  uninstall = undefined
  for (const pinia of stores.splice(0))
    disposePinia(pinia)
  localStorage.clear()
})

async function mount() {
  const pinia = createPinia()
  stores.push(pinia)
  pinia.state.value['airi-card'] = {
    cards: new Map([['default', { name: 'Test card', version: '1.0.0', extensions: { airi: { agents: {}, modules: { consciousness: { provider: '', model: '' }, speech: { provider: '', model: '', voice_id: '' }, vision: { provider: '', model: '' } } } } }]]),
    activeCardId: 'default',
  }
  const command = vi.fn<MemoryTransport['command']>(async () => emptyMemorySnapshot())
  const connection = new MemoryConnectionClient({
    command,
    prepare: vi.fn<MemoryTransport['prepare']>(async () => ({ mode: 'blocked', ownerGeneration: 0, selectionGeneration: 0, expiresAt: 0 })),
    gate: vi.fn(async () => ({ allow: false })),
    cancel: vi.fn(async () => {}),
    report: vi.fn(async () => {}),
    displayed: vi.fn(async () => {}),
    registerHost: vi.fn(async () => async () => {}),
    subscribe: vi.fn(() => () => {}),
  })
  uninstall = installMemoryConnection(connection)
  await render(defineComponent({
    setup() { useMemoryConversationControl() },
    template: '<div />',
  }), { global: { plugins: [pinia, PiniaColada, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })] } })
  const sessions = useChatSessionStore(pinia)
  await sessions.initialize()
  const previousSession = await sessions.createSession('default', { setActive: false })
  await sessions.setActiveSession(previousSession)
  return { sessions, previousSession, command, cards: useAiriCardStore(pinia) }
}

describe('memory conversation control in the real local session store', () => {
  it('creates a new session and activates it in the receiving chat window', async () => {
    const { sessions, previousSession, command } = await mount()
    await ipc.handler!({ cardId: 'default', deadlineAt: Date.now() + 10_000 })
    expect(command).toHaveBeenCalledWith({ kind: 'new-conversation', airiSessionId: previousSession })
    expect(sessions.activeSessionId).not.toBe(previousSession)
    expect(sessions.sessionMetas[previousSession]).toBeDefined()
    expect(ipc.ready).toHaveBeenCalled()
  })

  it('keeps the selected session when memory cannot close the old conversation', async () => {
    const { sessions, previousSession, command } = await mount()
    command.mockRejectedValueOnce(new Error('memory.stop_unconfirmed'))
    await expect(ipc.handler!({ cardId: 'default', deadlineAt: Date.now() + 10_000 })).rejects.toThrow('memory.stop_unconfirmed')
    expect(sessions.activeSessionId).toBe(previousSession)
  })

  it('rejects an expired request before changing the session or memory state', async () => {
    const { sessions, previousSession, command } = await mount()
    await expect(ipc.handler!({ cardId: 'default', deadlineAt: Date.now() - 1 })).rejects.toThrow('memory.owner_lost')
    expect(command).not.toHaveBeenCalled()
    expect(sessions.activeSessionId).toBe(previousSession)
  })

  it('does not activate a late conversation after the card changes during stop acknowledgement', async () => {
    const { sessions, command, cards } = await mount()
    cards.cards.set('another-card', { ...cards.activeCard!, name: 'Another test card' })
    const originalCount = Object.values(sessions.sessionMetas).filter(meta => meta.characterId === 'default').length
    const stopped = Promise.withResolvers<ReturnType<typeof emptyMemorySnapshot>>()
    command.mockReturnValueOnce(stopped.promise)
    const pending = ipc.handler!({ cardId: 'default', deadlineAt: Date.now() + 10_000 })
    await vi.waitFor(() => expect(command).toHaveBeenCalled())
    cards.activeCardId = 'another-card'
    stopped.resolve(emptyMemorySnapshot())
    await expect(pending).rejects.toThrow('memory.owner_lost')
    expect(Object.values(sessions.sessionMetas).filter(meta => meta.characterId === 'default')).toHaveLength(originalCount)
  })
})
