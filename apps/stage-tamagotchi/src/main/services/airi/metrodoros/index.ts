import type { StoragePort } from '@metrodoros/airi-adapter'
import type { MemoryProfile } from '@proj-airi/stage-ui/services/memory/contracts'
import type { IpcMain, BrowserWindow as Window } from 'electron'
import type { Lifecycle } from 'injeca'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { MemoryOwner } from '@proj-airi/stage-ui/services/memory/owner'
import { protectMemoryTraces } from '@proj-airi/stage-ui/services/memory/privacy'
import { app, BrowserWindow } from 'electron'

import { memoryCancel, memoryCommand, memoryDisplayed, memoryGate, memoryPrepare, memoryRegisterHost, memoryReport, memorySnapshotChanged, memorySpeechInput, memoryStop, memoryUnregisterHost } from '../../../../shared/eventa/metrodoros'

/**
 * Own the connection in main and bind each RPC to its actual sender window.
 * setupMetrodorosService -> MemoryOwner -> FileStorage / authenticated HTTP.
 * Per-window Eventa contexts reject cross-window spoofing and close with their window.
 */
export async function setupMetrodorosService(options: { lifecycle: Lifecycle, ipcMain: IpcMain }) {
  const directory = join(app.getPath('userData'), 'metrodoros')
  await mkdir(directory, { recursive: true })
  const profilePath = join(directory, 'settings.json')
  const markersPath = join(directory, 'private-sessions.json')
  const installPath = join(directory, 'installation-id')
  let installationId: string
  try {
    installationId = (await readFile(installPath, 'utf8')).trim()
    if (!/^[0-9a-f-]{36}$/i.test(installationId))
      throw new Error('memory.installation_invalid')
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      throw error
    installationId = crypto.randomUUID()
    await writeFile(installPath, installationId, { mode: 0o600, flag: 'wx' })
  }
  const privateSessions = new Set<string>()
  let markerWrites = Promise.resolve()

  async function loadJson(path: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null
      throw new Error('memory.saved_settings_invalid')
    }
  }

  async function saveJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, path)
  }

  const owner = new MemoryOwner({
    installationId,
    loadProfile: async () => await loadJson(profilePath) as MemoryProfile | null,
    saveProfile: profile => saveJson(profilePath, profile),
    loadPrivateSessions: async () => {
      const value = await loadJson(markersPath)
      if (value === null)
        return []
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
        throw new Error('memory.saved_settings_invalid')
      for (const item of value)
        privateSessions.add(item)
      return [...privateSessions]
    },
    rememberPrivateSession: async (sessionId) => {
      privateSessions.add(sessionId)
      markerWrites = markerWrites.then(() => saveJson(markersPath, [...privateSessions]))
      await markerWrites
    },
    storage: async (namespace): Promise<StoragePort> => {
      try {
        const { FileStorage } = await import('@metrodoros/airi-adapter/desktop')
        const storage = new FileStorage(join(directory, `outbox-${namespace}.sqlite`))
        await storage.read()
        return storage
      }
      catch {
        throw new Error('memory.sqlite_unavailable')
      }
    },
  })
  owner.subscribe((snapshot) => {
    if (snapshot.profile.enabled)
      protectMemoryTraces()
  })
  const cleanups = new Map<number, () => void>()

  function register(window: Window) {
    if (cleanups.has(window.id))
      return
    const eventa = createContext(options.ipcMain, window, { onlySameWindow: true })
    const context = eventa.context
    const actor = String(window.id)
    const stop = defineInvoke(context, memoryStop)
    const feed = defineInvoke(context, memorySpeechInput)
    defineInvokeHandler(context, memoryCommand, command => owner.command(command))
    defineInvokeHandler(context, memoryPrepare, input => owner.prepare(actor, input.referenceId, input.input, input.deadlineAt))
    defineInvokeHandler(context, memoryGate, input => owner.gate(actor, input.referenceId, input.kind))
    defineInvokeHandler(context, memoryCancel, input => owner.cancel(actor, input.referenceId))
    defineInvokeHandler(context, memoryReport, input => owner.report(actor, input.referenceId, input.report))
    defineInvokeHandler(context, memoryDisplayed, input => owner.displayed(input.assistantMessageId))
    defineInvokeHandler(context, memoryRegisterHost, input => owner.registerHost(actor, input.role, request => stop(request), input.role === 'speech' ? input => feed(input) : undefined))
    defineInvokeHandler(context, memoryUnregisterHost, input => owner.unregisterHost(actor, input.role))
    const unsubscribe = owner.subscribe(snapshot => context.emit(memorySnapshotChanged, snapshot))
    const cleanup = () => {
      unsubscribe()
      void Promise.all([owner.unregisterHost(actor, 'conversation'), owner.unregisterHost(actor, 'speech')]).catch(() => undefined)
      eventa.dispose()
      cleanups.delete(window.id)
    }
    window.webContents.once('render-process-gone', () => {
      void owner.unregisterHost(actor, 'conversation').then(() => owner.unregisterHost(actor, 'speech')).catch(() => undefined)
    })
    window.once('closed', cleanup)
    cleanups.set(window.id, cleanup)
  }

  const onWindow = (_event: Electron.Event, window: Window) => register(window)
  app.on('browser-window-created', onWindow)
  for (const window of BrowserWindow.getAllWindows())
    register(window)
  options.lifecycle.appHooks.onStop(async () => {
    app.removeListener('browser-window-created', onWindow)
    // Ask live hosts to stop before disposing their transports.
    await owner.dispose()
    for (const cleanup of [...cleanups.values()])
      cleanup()
  })
  return { owner }
}
