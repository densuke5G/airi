import type { MemorySnapshot } from '../../../../services/memory/contracts'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { nextTick, reactive, shallowReactive, toRaw } from 'vue'
import { createI18n } from 'vue-i18n'

import MemorySettingsPanel from './memory-settings-panel.vue'

import 'virtual:uno.css'

const state = vi.hoisted(() => ({
  memory: {
    snapshot: {
      profile: { endpoint: 'http://127.0.0.1:47831', enabled: true, worldId: null, cardBindings: [], modelBindings: {} },
      state: 'blocked',
      reason: 'no_character',
      connected: true,
      configured: false,
      tokenRequired: false,
      identity: null,
      outboxPending: null,
      consolidationPending: null,
      lastSync: null,
      characters: [],
      worlds: [],
      candidate: null,
      selection: null,
      metrics: {},
    } as MemorySnapshot,
    error: null,
    busy: false,
    run: vi.fn(),
    refresh: vi.fn(),
  },
  cards: { activeCardId: 'card', activeCard: { name: 'Mira' } },
}))

vi.mock('../../../../stores/modules/memory', () => ({ useMemoryStore: () => shallowReactive(state.memory) }))
vi.mock('../../../../stores/modules/airi-card', () => ({ useAiriCardStore: () => reactive(state.cards) }))
vi.mock('../../../../stores/modules/consciousness', () => ({ useConsciousnessStore: () => ({ activeProvider: '', activeModel: '' }) }))
vi.mock('../../../../stores/chat/session-store', () => ({ useChatSessionStore: () => ({ activeSessionId: 'session' }) }))

function mount() {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: { settings: { pages: { 'memory-panel': {
      'new-character': 'New character name',
      'first-person': 'First-person pronoun',
      'first-person-default': 'I',
      'create-character': 'Create character',
      'character': 'Metrodoros character',
      'world': 'World',
      'bind-card': 'Bind card and world',
      'connection-error': 'Check the connection address.',
      'status': { 'blocked': 'Blocked', 'selection-required': 'Connected, waiting for a character' },
      'reasons': { no_character: 'Map a character, then start a conversation.' },
    } } } } },
  })
  return render(MemorySettingsPanel, { props: { mode: 'long-term' }, global: { plugins: [i18n] } })
}

describe('character setup after authentication', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const memory = shallowReactive(state.memory)
    memory.snapshot.profile.cardBindings = []
    memory.snapshot.profile.worldId = null
    memory.snapshot.characters = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]
    memory.snapshot.worlds = [{ id: 'earth', name: 'Earth' }, { id: 'moon', name: 'Moon' }]
    reactive(state.cards).activeCardId = 'card'
  })
  afterEach(cleanup)

  it('shows authenticated selection guidance instead of an address error', async () => {
    const screen = await mount()
    await expect.element(screen.getByText('Connected, waiting for a character')).toBeVisible()
    await expect.element(screen.getByText('Map a character, then start a conversation.')).toBeVisible()
    await expect.element(screen.getByText('Check the connection address.')).not.toBeInTheDocument()
  })

  it('requires a bounded pronoun and sends its trimmed value with the character name', async () => {
    const screen = await mount()
    const button = screen.getByRole('button', { name: 'Create character', exact: true })
    await screen.getByLabelText('New character name').fill('Mira')
    await screen.getByLabelText('First-person pronoun').fill('   ')
    await expect.element(button).toBeDisabled()
    await screen.getByLabelText('First-person pronoun').fill('x'.repeat(21))
    await expect.element(button).toBeDisabled()
    await screen.getByLabelText('First-person pronoun').fill(' 私 ')
    await button.click()
    expect(state.memory.run).toHaveBeenCalledWith({ kind: 'create-character', name: 'Mira', firstPerson: '私' })
    await expect.element(screen.getByLabelText('New character name')).toHaveValue('')
  })

  it('retains the entered name and pronoun when character creation fails', async () => {
    state.memory.run.mockRejectedValueOnce(new Error('memory.connection_failed'))
    const screen = await mount()
    await screen.getByLabelText('New character name').fill('Mira')
    await screen.getByRole('button', { name: 'Create character', exact: true }).click()
    await expect.element(screen.getByLabelText('New character name')).toHaveValue('Mira')
    await expect.element(screen.getByLabelText('First-person pronoun')).toHaveValue('I')
  })

  it('keeps draft choices through cloned snapshots and changed saved bindings until a successful bind', async () => {
    const screen = await mount()
    const character = screen.getByRole('combobox').nth(0)
    const world = screen.getByRole('combobox').nth(1)
    await character.click()
    await screen.getByRole('option', { name: 'Alpha', exact: true }).click()
    await world.click()
    await screen.getByRole('option', { name: 'Earth', exact: true }).click()
    const memory = shallowReactive(state.memory)
    memory.snapshot = structuredClone(toRaw(memory.snapshot))
    await nextTick()
    await expect.element(character).toHaveTextContent('Alpha')
    await expect.element(world).toHaveTextContent('Earth')
    memory.snapshot = { ...memory.snapshot, profile: { ...memory.snapshot.profile, cardBindings: [{ cardId: 'card', characterId: 'beta' }], worldId: 'moon' } }
    await nextTick()
    await expect.element(character).toHaveTextContent('Alpha')
    await expect.element(world).toHaveTextContent('Earth')
    await screen.getByRole('button', { name: 'Bind card and world', exact: true }).click()
    expect(state.memory.run).toHaveBeenCalledWith({ kind: 'bind-card', cardId: 'card', characterId: 'alpha', worldId: 'earth' })
    memory.snapshot = { ...memory.snapshot, profile: { ...memory.snapshot.profile, cardBindings: [{ cardId: 'card', characterId: 'alpha' }], worldId: 'earth' } }
    await nextTick()
    memory.snapshot = { ...memory.snapshot, profile: { ...memory.snapshot.profile, cardBindings: [{ cardId: 'card', characterId: 'beta' }], worldId: 'moon' } }
    await nextTick()
    await expect.element(character).toHaveTextContent('Beta')
    await expect.element(world).toHaveTextContent('Moon')
  })

  it('retains draft choices after a failed bind and resets them when the active card changes', async () => {
    state.memory.run.mockRejectedValueOnce(new Error('memory.connection_failed'))
    const screen = await mount()
    const character = screen.getByRole('combobox').nth(0)
    const world = screen.getByRole('combobox').nth(1)
    await character.click()
    await screen.getByRole('option', { name: 'Alpha', exact: true }).click()
    await world.click()
    await screen.getByRole('option', { name: 'Earth', exact: true }).click()
    await screen.getByRole('button', { name: 'Bind card and world', exact: true }).click()
    const memory = shallowReactive(state.memory)
    memory.snapshot = structuredClone(toRaw(memory.snapshot))
    await nextTick()
    await expect.element(character).toHaveTextContent('Alpha')
    await expect.element(world).toHaveTextContent('Earth')
    memory.snapshot.profile.cardBindings = [{ cardId: 'other-card', characterId: 'beta' }]
    memory.snapshot.profile.worldId = 'moon'
    reactive(state.cards).activeCardId = 'other-card'
    await nextTick()
    await expect.element(character).toHaveTextContent('Beta')
    await expect.element(world).toHaveTextContent('Moon')
  })
})
