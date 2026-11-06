import type { HeartbeatData } from '@zeno/airi-adapter/contracts'
import type { Lifecycle } from 'injeca'

import { afterEach, expect, it, vi } from 'vitest'

import { zenoAuthorize, zenoCommand, zenoTool } from '../../../shared/eventa/zeno'
import { createI18n } from '../../libs/i18n'
import { setupZenoService } from './zeno'

const boundary = vi.hoisted(() => ({
  handlers: new Map<unknown, (input: unknown) => Promise<unknown>>(),
  heartbeat: undefined as ((data: HeartbeatData) => void) | undefined,
  failHeartbeat: undefined as (() => void) | undefined,
  updateMute: vi.fn<() => Promise<void>>(),
  stop: vi.fn(async () => true),
  records: new Map<string, unknown>(),
  mute: { enabled: false, until: null, updated_at: '2026-11-06T00:00:00.000Z', revision: 0, local_inhibited: false, synchronized: true },
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), { getPath: () => 'unused-encrypted-storage-boundary' }),
    BrowserWindow: { getAllWindows: () => [Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, webContents: new EventEmitter() })] },
    ipcMain: new EventEmitter(),
    dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
  }
})
vi.mock('@moeru/eventa/adapters/electron/main', () => ({
  createContext: () => ({ context: { emit: vi.fn() }, dispose: vi.fn() }),
}))
vi.mock('@moeru/eventa', async importOriginal => ({
  ...await importOriginal<typeof import('@moeru/eventa')>(),
  defineInvoke: () => boundary.stop,
  defineInvokeHandler: (_context: unknown, event: unknown, handler: (input: unknown) => Promise<unknown>) => {
    boundary.handlers.set(event, handler)
    return () => boundary.handlers.delete(event)
  },
}))
vi.mock('./metrodoros/encrypted-record-store', () => ({
  EncryptedRecordStore: class {
    constructor(private directory: string) {}
    async read() { return boundary.records.get(this.directory) }
    async write(value: unknown) { boundary.records.set(this.directory, value) }
  },
}))
vi.mock('@zeno/airi-adapter', () => ({
  AiriAdapterClient: class {
    getSnapshot = async () => ({ revision: 0 })
    getMeetingMute = async () => ({ data: { ...boundary.mute } })
    getNotifications = async () => ({ data: { items: [] } })
    updateMeetingMute = boundary.updateMute
    subscribeEvents = () => () => {}
    heartbeat = async () => ({ data: { active: false } })
    startHeartbeat = (_state: unknown, listener: (data: HeartbeatData) => void, fail: () => void) => {
      boundary.heartbeat = listener
      boundary.failHeartbeat = fail
      return () => {}
    }
  },
}))
let stop: (() => Promise<void>) | undefined
afterEach(async () => {
  await stop?.()
  stop = undefined
  boundary.handlers.clear()
  boundary.records.clear()
  boundary.updateMute.mockReset()
  boundary.stop.mockClear()
})
async function setup() {
  const lifecycle: Lifecycle = {
    appHooks: {
      onStart: vi.fn(),
      onStop: (handler) => {
        stop = async () => {
          await handler()
        }
      },
    },
  }
  const { ipcMain } = await import('electron')
  return setupZenoService({ lifecycle, ipcMain, i18n: createI18n({ locale: 'en', messages: { en: {} } }) })
}
async function invoke(event: unknown, input: unknown) {
  const handler = boundary.handlers.get(event)
  if (!handler)
    throw new Error('Missing IPC handler')
  return handler(input)
}
async function connect() {
  await invoke(zenoCommand, { kind: 'connect', endpoint: 'http://127.0.0.1:47841', token: `zeno_cl_${'1'.repeat(64)}` })
  await invoke(zenoCommand, { kind: 'host', state: { active: true, characterId: 'card-1', speechState: 'idle' } })
}
it('retains failed local mute across heartbeats and blocks playback authorization until a confirmed update', async () => {
  const service = await setup()
  await connect()
  boundary.updateMute.mockRejectedValueOnce(new Error('network lost'))
  await expect(invoke(zenoCommand, { kind: 'mute', enabled: true, until: null })).rejects.toThrow('network lost')
  boundary.heartbeat?.({ active: false, owner_id: null, character_generation: null, lease_until: null, meeting_mute: { ...boundary.mute } })
  expect(service.snapshot().mute?.local_inhibited).toBe(true)
  expect(service.snapshot().mute?.synchronized).toBe(false)
  expect(boundary.stop).toHaveBeenCalled()
  expect(await invoke(zenoAuthorize, { attemptId: '00000000-0000-4000-8000-000000000000', generation: 2 })).toBe(false)
  boundary.updateMute.mockResolvedValueOnce()
  await invoke(zenoCommand, { kind: 'mute', enabled: false, until: null })
  expect(service.snapshot().mute?.local_inhibited).toBe(false)
  expect(service.snapshot().mute?.synchronized).toBe(true)
  expect(JSON.stringify(service.snapshot())).not.toContain('zeno_cl_')
})
it('rejects arbitrary commands and model-created confirmation calls at the main boundary', async () => {
  await setup()
  await connect()
  await expect(invoke(zenoCommand, { kind: 'run', path: '/operations/restore/confirm' })).rejects.toThrow()
  await expect(invoke(zenoTool, { operation: 'ConfirmPlanningChanges', input: { approved: true }, turnId: 'turn-1' })).rejects.toThrow()
})

it('cancels notification output without cancelling ordinary speech after a connection failure', async () => {
  await setup()
  await connect()
  boundary.stop.mockClear()
  boundary.failHeartbeat?.()
  await vi.waitFor(() => expect(boundary.stop).toHaveBeenLastCalledWith({ allAssistantAudio: false }))
})
