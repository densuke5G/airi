import type { MemoryTransport } from '../../../../services/memory/connection'
import type { MemorySnapshot } from '../../../../services/memory/contracts'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import MemorySettingsPanel from './memory-settings-panel.vue'

import { installMemoryConnection, MemoryConnectionClient } from '../../../../services/memory/connection'
import { emptyMemorySnapshot } from '../../../../services/memory/contracts'

import 'virtual:uno.css'

const stores: ReturnType<typeof createPinia>[] = []
let uninstall: (() => void) | undefined

afterEach(() => {
  cleanup()
  uninstall?.()
  uninstall = undefined
  for (const pinia of stores.splice(0))
    disposePinia(pinia)
  localStorage.clear()
})

async function mount(connected = false) {
  localStorage.clear()
  const pinia = createPinia()
  stores.push(pinia)
  pinia.state.value['airi-card'] = {
    cards: new Map([['default', {
      name: 'Test card',
      version: '1.0.0',
      extensions: { airi: { agents: {}, modules: {
        consciousness: { provider: '', model: '' },
        speech: { provider: '', model: '', voice_id: '' },
        vision: { provider: '', model: '' },
      } } },
    }]]),
    activeCardId: 'default',
  }
  let snapshot = { ...emptyMemorySnapshot(), connected }
  const listeners = new Set<(snapshot: MemorySnapshot) => void>()
  const command = vi.fn<MemoryTransport['command']>(async () => structuredClone(snapshot))
  uninstall = installMemoryConnection(new MemoryConnectionClient({
    command,
    prepare: vi.fn(async () => { throw new Error('No conversation in settings') }),
    gate: vi.fn(async () => ({ allow: false })),
    cancel: vi.fn(async () => {}),
    report: vi.fn(async () => {}),
    displayed: vi.fn(async () => {}),
    registerHost: vi.fn(async () => async () => {}),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }))
  const screen = await render(MemorySettingsPanel, {
    props: { mode: 'long-term' },
    global: { plugins: [pinia, PiniaColada, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  const publish = (value: MemorySnapshot) => {
    snapshot = structuredClone(value)
    for (const listener of listeners)
      listener(structuredClone(value))
  }
  return { screen, command, publish, snapshot }
}

describe('memory setup connection prerequisites with real stores', () => {
  it('blocks empty selectors and server creation until the connection is authenticated', async () => {
    const { screen, command } = await mount()
    await screen.getByLabelText('New character name').fill('Mira')
    await screen.getByLabelText('New world name').fill('Garden')
    await expect.element(screen.getByRole('combobox').nth(0)).toBeDisabled()
    await expect.element(screen.getByRole('combobox').nth(1)).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Create character', exact: true })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Create world', exact: true })).toBeDisabled()
    expect(command).toHaveBeenCalledExactlyOnceWith({ kind: 'snapshot' })
  })

  it('shows the configured selector placeholders before a character or world is selected', async () => {
    const { screen } = await mount(true)
    await expect.element(screen.getByRole('combobox').nth(0)).toHaveTextContent('Choose an existing character')
    await expect.element(screen.getByRole('combobox').nth(1)).toHaveTextContent('Choose a world')
  })

  it('moves from the unavailable character form to the existing token input', async () => {
    const { screen } = await mount()
    await expect.element(screen.getByText('Connect to Metrodoros before selecting or creating a character or world.')).toBeVisible()
    await screen.getByRole('button', { name: 'Go to connection', exact: true }).click()
    await expect.element(screen.getByLabelText('Connection token')).toHaveFocus()
  })

  it('enables creation after connection and keeps the name entered while offline', async () => {
    const { screen, publish, snapshot, command } = await mount()
    await screen.getByLabelText('New character name').fill('Mira')
    publish({ ...snapshot, connected: true, tokenRequired: false })
    await expect.element(screen.getByText('No characters are available. Enter a name and pronoun to create one.')).toBeVisible()
    const create = screen.getByRole('button', { name: 'Create character', exact: true })
    await expect.element(create).toBeEnabled()
    await create.click()
    expect(command).toHaveBeenCalledWith({ kind: 'create-character', name: 'Mira', firstPerson: 'I' })
    await expect.element(screen.getByLabelText('New character name')).toHaveValue('')
  })

  it('blocks saved selections again when connection is lost without clearing the draft name', async () => {
    const { screen, publish, snapshot } = await mount(true)
    const characterId = crypto.randomUUID()
    const worldId = crypto.randomUUID()
    publish({ ...snapshot, profile: { ...snapshot.profile, worldId, cardBindings: [{ cardId: 'default', characterId }] }, characters: [{ id: characterId, name: 'Mira' }], worlds: [{ id: worldId, name: 'Earth' }] })
    await expect.element(screen.getByRole('button', { name: 'Bind AIRI Card and world', exact: true })).toBeEnabled()
    await screen.getByLabelText('New character name').fill('Another character')
    publish({ ...snapshot, connected: false })
    await expect.element(screen.getByRole('combobox').nth(0)).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Bind AIRI Card and world', exact: true })).toBeDisabled()
    await expect.element(screen.getByLabelText('New character name')).toHaveValue('Another character')
  })

  it('retains the world name if the server rejects creation', async () => {
    const { screen, command } = await mount(true)
    await screen.getByLabelText('New world name').fill('Garden')
    const create = screen.getByRole('button', { name: 'Create world', exact: true })
    await expect.element(create).toBeEnabled()
    command.mockRejectedValueOnce(new Error('memory.connection_failed'))
    await create.click()
    expect(command).toHaveBeenCalledWith({ kind: 'create-world', name: 'Garden' })
    await expect.element(screen.getByLabelText('New world name')).toHaveValue('Garden')
  })
})
