import type { Lifecycle } from 'injeca'

import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryRegisterHost, memoryUnregisterHost } from '../../../../shared/eventa/metrodoros'
import { createI18n } from '../../../libs/i18n'
import { createDefaultDesktopSettings } from './desktop-startup'
import { setupMetrodorosService } from './index'

const boundary = vi.hoisted(() => ({
  directory: '',
  windows: [] as { id: number, once: EventEmitter['once'], webContents: EventEmitter }[],
  handlers: new Map<number, Map<unknown, (input: unknown) => Promise<unknown>>>(),
  start: vi.fn<(profile: unknown, signal?: AbortSignal) => Promise<{ state: string }>>(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), { getPath: () => boundary.directory, isReady: () => true }),
    BrowserWindow: { getAllWindows: () => boundary.windows },
    ipcMain: new EventEmitter(),
    dialog: { showMessageBox: vi.fn() },
    safeStorage: { isEncryptionAvailable: () => false },
  }
})
vi.mock('@moeru/eventa/adapters/electron/main', () => ({
  createContext: (_ipc: unknown, window: { id: number }) => ({ context: { id: window.id, emit: vi.fn() }, dispose: vi.fn() }),
}))
vi.mock('@moeru/eventa', async importOriginal => ({
  ...await importOriginal<typeof import('@moeru/eventa')>(),
  defineInvoke: () => async () => true,
  defineInvokeHandler: (context: { id: number }, event: unknown, handler: (input: unknown) => Promise<unknown>) => {
    const handlers = boundary.handlers.get(context.id) ?? new Map()
    handlers.set(event, handler)
    boundary.handlers.set(context.id, handlers)
    return () => handlers.delete(event)
  },
}))
vi.mock('./desktop-launcher', () => ({
  DesktopLauncher: class {
    ensureReady = boundary.start
    dispose() {}
  },
}))

let stop: (() => Promise<void>) | undefined
let directory: string | undefined

afterEach(async () => {
  await stop?.()
  stop = undefined
  vi.restoreAllMocks()
  boundary.handlers.clear()
  boundary.windows = []
  boundary.start.mockReset()
  if (directory)
    await rm(directory, { recursive: true, force: true })
})

async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'airi-startup-handover-'))
  boundary.directory = directory
  const memory = join(directory, 'metrodoros')
  await mkdir(memory)
  await writeFile(join(memory, 'desktop-settings.json'), JSON.stringify({ ...createDefaultDesktopSettings(), autoStart: true }))
  await writeFile(join(memory, 'settings.json'), JSON.stringify({ endpoint: 'http://127.0.0.1:47831', enabled: true, worldId: null, cardBindings: [], modelBindings: {} }))
  boundary.windows = [1, 2].map(id => Object.assign(new EventEmitter(), { id, webContents: new EventEmitter() }))
  const lifecycle: Lifecycle = { appHooks: {
    onStart: vi.fn(),
    onStop: (handler) => {
      stop = async () => {
        await handler()
      }
    },
  } }
  const { ipcMain } = await import('electron')
  await setupMetrodorosService({ lifecycle, ipcMain, i18n: createI18n({ locale: 'en', messages: { en: {} } }), startConversation: vi.fn(async () => {}) })
}

async function host(windowId: number, role: 'conversation' | 'speech', registered = true) {
  const handler = boundary.handlers.get(windowId)?.get(registered ? memoryRegisterHost : memoryUnregisterHost)
  if (!handler)
    throw new Error('Missing public host handler')
  await handler({ role })
}

describe('desktop startup during host handover', () => {
  // ROOT CAUSE: An aborted host consumed startup before spawn. Only a current, completed attempt now consumes it.
  it('retains the launch attempt when an old host cancels startup before completion', async () => {
    boundary.start.mockImplementationOnce((_profile, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('launcher.aborted')), { once: true })
    })).mockResolvedValue({ state: 'existing' })
    await setup()
    await host(1, 'conversation')
    await host(1, 'speech')
    await vi.waitFor(() => expect(boundary.start).toHaveBeenCalledTimes(1))
    const firstSignal = boundary.start.mock.calls[0][1]
    await host(1, 'conversation', false)
    expect(firstSignal?.aborted).toBe(true)
    await host(2, 'conversation')
    await host(2, 'speech')
    await vi.waitFor(() => expect(boundary.start).toHaveBeenCalledTimes(2))
    expect(boundary.start.mock.calls[1][1]?.aborted).toBe(false)
  })

  it('consumes a failed attempt when no host cancellation occurred', async () => {
    boundary.start.mockRejectedValue(new Error('launcher.spawn_failed'))
    await setup()
    await host(1, 'conversation')
    await host(1, 'speech')
    await vi.waitFor(() => expect(boundary.start).toHaveBeenCalledTimes(1))
    await host(1, 'speech')
    expect(boundary.start).toHaveBeenCalledTimes(1)
  })
})
