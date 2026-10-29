import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import MemorySettingsPanel from './memory-settings-panel.vue'

import 'virtual:uno.css'

const testState = vi.hoisted(() => ({
  connect: vi.fn(),
  memory: {
    snapshot: {
      profile: { endpoint: 'http://127.0.0.1:47831', enabled: false, worldId: null, cardBindings: [], modelBindings: {} },
      state: 'disabled',
      reason: null,
      connected: false,
      configured: false,
      tokenRequired: true,
      identity: null,
      outboxPending: null,
      consolidationPending: null,
      lastSync: null,
      characters: [],
      worlds: [],
      candidate: { candidateId: 'candidate-1', cardId: 'card-1', text: 'A kind guide.', digest: 'sha256:sample' },
      selection: null,
      metrics: {},
    },
    error: null,
    run: vi.fn(),
    refresh: vi.fn(),
  },
  cards: {
    activeCardId: 'card-1',
    activeCard: {
      name: 'Mira',
      description: 'A curious guide',
      personality: 'Kind',
      scenario: 'At home',
      extensions: { airi: { modules: { consciousness: { provider: 'provider-1' } } } },
    },
  },
  consciousness: { activeProvider: 'inherited-provider', activeModel: 'inherited-model' },
  sessions: { activeSessionId: 'session-1', createSession: vi.fn() },
}))

vi.mock('../../../../services/memory/connection', () => ({ connectMemoryToken: testState.connect }))

vi.mock('../../../../stores/modules/memory', () => ({ useMemoryStore: () => testState.memory }))
vi.mock('../../../../stores/modules/airi-card', () => ({ useAiriCardStore: () => testState.cards }))
vi.mock('../../../../stores/modules/consciousness', () => ({ useConsciousnessStore: () => testState.consciousness }))
vi.mock('../../../../stores/chat/session-store', () => ({ useChatSessionStore: () => testState.sessions }))

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        settings: {
          pages: {
            'memory-panel': {
              'connection': 'Metrodoros connection',
              'endpoint': 'Connection address',
              'token': 'Connection token',
              'replacement': 'Changing the connection stops the old one.',
              'enabled': 'Use memory',
              'status': { 'disabled': 'Memory is off', 'token-required': 'Re-enter token' },
              'status-label': 'Connection status',
              'connection-error': 'The connection needs attention.',
              'save': 'Save settings',
              'connect': 'Connect and verify',
              'disconnect': 'Disconnect',
              'refresh': 'Refresh status',
              'pending': 'Unsent items: {count}',
              'consolidation': 'Items awaiting organization: {count}',
              'current': 'Current conversation',
              'card': 'AIRI Card',
              'session': 'Conversation session',
              'world': 'World',
              'none': 'Not selected',
              'sync-state': 'Sync state',
              'current-character': 'Metrodoros character mapping',
              'current-world': 'Connected world',
              'last-sync': 'Last successful sync',
              'never': 'Not synced yet',
              'connected': 'Connected',
              'not-connected': 'Not connected',
              'retention': 'Current short-term memory limits',
              'limits': 'History is limited to 8 turns and 6,000 characters. Original conversation text is kept for 7 days.',
              'observation': 'Observations use a 60-second interval.',
              'conversation-actions': 'Conversation actions',
              'new-conversation-note': 'This does not delete long-term memory.',
              'new-conversation': 'Start a new conversation',
              'character-world': 'AIRI Card and character',
              'active-card': 'Active AIRI Card: {name}',
              'character': 'Metrodoros character',
              'choose-character': 'Choose a character',
              'new-character': 'New character name',
              'create-character': 'Create character',
              'new-world': 'New world name',
              'choose-world': 'Choose a world',
              'create-world': 'Create world',
              'bind-card': 'Bind AIRI Card and world',
              'persona': 'Persona migration',
              'persona-note': 'Review before approval.',
              'propose': 'Propose persona migration',
              'digest': 'Candidate digest: {digest}',
              'approve': 'Approve and register persona',
              'model-binding': 'Conversation model binding',
              'model-note': 'Bind external profile.',
              'active-model': 'Current AIRI model: {provider} / {model}',
              'external-profile': 'External profile ID',
              'binding-revision': 'Binding revision',
              'profile-id': 'Metrodoros profile ID',
              'profile-revision': 'Profile revision',
              'pin-note': 'Pin exact versions for consolidation.',
              'bind-model': 'Save model binding',
              'management-unavailable': 'Memory management is not available here.',
              'error': 'Memory action failed.',
            },
          },
        },
      },
    },
  })
}

describe('memory settings panel', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps the token in the password field only until connect finishes', async () => {
    const screen = await render(MemorySettingsPanel, {
      props: { mode: 'short-term' },
      global: { plugins: [createTestI18n()] },
    })
    expect(testState.memory.refresh).toHaveBeenCalled()
    const tokenInput = screen.getByLabelText('Connection token')
    await tokenInput.fill('secret-token')
    await screen.getByRole('button', { name: 'Connect and verify' }).click()
    await expect.element(tokenInput).toHaveValue('')
    expect(testState.connect).toHaveBeenCalledWith('secret-token')
    expect(testState.memory.run).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'connect' }))
    expect(testState.memory.run).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'save', profile: expect.objectContaining({ token: 'secret-token' }) }))
    await screen.getByRole('button', { name: 'Refresh status' }).click()
    expect(testState.memory.run).toHaveBeenLastCalledWith({ kind: 'refresh' })
  })

  it('shows a translated connection error when the mount snapshot refresh rejects', async () => {
    testState.memory.refresh.mockRejectedValueOnce(new Error('memory.connection_failed'))
    const screen = await render(MemorySettingsPanel, {
      props: { mode: 'short-term' },
      global: { plugins: [createTestI18n()] },
    })
    await expect.element(screen.getByText('The connection needs attention.')).toBeVisible()
  })

  it('waits for a separate approval action before registering a persona proposal', async () => {
    const screen = await render(MemorySettingsPanel, {
      props: { mode: 'long-term' },
      global: { plugins: [createTestI18n()] },
    })
    await expect.element(screen.getByText('A kind guide.')).toBeVisible()
    expect(testState.memory.run).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'Approve and register persona' }).click()
    expect(testState.memory.run).toHaveBeenCalledWith({ kind: 'approve-persona', candidateId: 'candidate-1', digest: 'sha256:sample' })
  })

  it('binds the active runtime provider and model, including inherited card selections', async () => {
    const screen = await render(MemorySettingsPanel, {
      props: { mode: 'long-term' },
      global: { plugins: [createTestI18n()] },
    })
    await screen.getByLabelText('External profile ID').fill('external-profile-2')
    await screen.getByRole('button', { name: 'Save model binding' }).click()
    expect(testState.memory.run).toHaveBeenCalledWith({
      kind: 'bind-model',
      providerId: 'inherited-provider',
      model: 'inherited-model',
      externalProfileId: 'external-profile-2',
    })
  })

  it('does not create a replacement chat session when memory cannot close the current one', async () => {
    testState.memory.run.mockRejectedValueOnce(new Error('memory.close_failed'))
    const screen = await render(MemorySettingsPanel, {
      props: { mode: 'short-term' },
      global: { plugins: [createTestI18n()] },
    })
    await screen.getByRole('button', { name: 'Start a new conversation' }).click()
    expect(testState.memory.run).toHaveBeenCalledWith({ kind: 'new-conversation', airiSessionId: 'session-1' })
    expect(testState.sessions.createSession).not.toHaveBeenCalled()
  })
  it('saves explicit server versions for the inherited provider and model', async () => {
    const screen = await render(MemorySettingsPanel, { props: { mode: 'long-term' }, global: { plugins: [createTestI18n()] } })
    await screen.getByLabelText('External profile ID').fill('external-profile-2')
    await screen.getByLabelText('Binding revision', { exact: true }).fill('2')
    await screen.getByLabelText('Metrodoros profile ID').fill('10000000-0000-4000-8000-000000000001')
    await screen.getByLabelText('Profile revision', { exact: true }).fill('3')
    await screen.getByRole('button', { name: 'Save model binding' }).click()
    expect(testState.memory.run).toHaveBeenCalledWith({ kind: 'bind-model', providerId: 'inherited-provider', model: 'inherited-model', externalProfileId: 'external-profile-2', bindingRevision: 2, profileId: '10000000-0000-4000-8000-000000000001', profileRevision: 3 })
  })

  it('keeps a partial model version out of saved settings', async () => {
    const screen = await render(MemorySettingsPanel, { props: { mode: 'long-term' }, global: { plugins: [createTestI18n()] } })
    await screen.getByLabelText('External profile ID').fill('external-profile-2')
    await screen.getByLabelText('Binding revision', { exact: true }).fill('2')
    await screen.getByRole('button', { name: 'Save model binding' }).click()
    expect(testState.memory.run.mock.calls.some(([command]) => command.kind === 'bind-model')).toBe(false)
  })
})
