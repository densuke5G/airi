import type { StoragePort } from '@metrodoros/airi-adapter'
import type { MemoryProfile } from '@proj-airi/stage-ui/services/memory/contracts'
import type { DesktopMemorySettingsCommand, DesktopMemorySettingsSnapshot } from '@proj-airi/stage-ui/services/memory/desktop-settings'
import type { IpcMain, BrowserWindow as Window } from 'electron'
import type { Lifecycle } from 'injeca'

import type { I18n } from '../../../libs/i18n'
import type { LaunchProfile } from './desktop-launcher'
import type { MemoryHostRole } from './desktop-policy'

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { MemoryOwner } from '@proj-airi/stage-ui/services/memory/owner'
import { protectMemoryTraces } from '@proj-airi/stage-ui/services/memory/privacy'
import { app, BrowserWindow, dialog } from 'electron'

import * as v from 'valibot'

import { desktopMemorySettingsCommand, desktopMemorySettingsSnapshotChanged, memoryCancel, memoryCommand, memoryDisplayed, memoryGate, memoryPrepare, memoryRegisterHost, memoryReport, memorySnapshotChanged, memorySpeechInput, memoryStop, memoryUnregisterHost } from '../../../../shared/eventa/metrodoros'
import { CredentialStore } from './credential-store'
import { DesktopLauncher } from './desktop-launcher'
import { forgetWhenRememberingDisabled, hasRequiredMemoryHosts, requiresLaunchRegistration, requiresRegistrationAfterAutomaticFailure } from './desktop-policy'
import { createDefaultDesktopSettings, runDesktopStartup } from './desktop-startup'

type DesktopSettings = ReturnType<typeof createDefaultDesktopSettings>

const desktopSettingsSchema = v.strictObject({
  version: v.literal(1),
  autoStart: v.boolean(),
  rememberToken: v.boolean(),
  autoConnect: v.boolean(),
  needsRegistration: v.boolean(),
  nodePath: v.pipe(v.string(), v.maxLength(32768)),
  serverRoot: v.pipe(v.string(), v.maxLength(32768)),
  dataDir: v.pipe(v.string(), v.maxLength(32768)),
})

const desktopSettingsUpdateSchema = v.strictObject({
  autoStart: v.optional(v.boolean()),
  rememberToken: v.optional(v.boolean()),
  autoConnect: v.optional(v.boolean()),
  nodePath: v.optional(v.pipe(v.string(), v.maxLength(32768))),
  serverRoot: v.optional(v.pipe(v.string(), v.maxLength(32768))),
  dataDir: v.optional(v.pipe(v.string(), v.maxLength(32768))),
})

const defaultDesktopSettings = createDefaultDesktopSettings()

const installationIdSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))

async function loadInstallationId(path: string): Promise<string> {
  try {
    const stored = (await readFile(path, 'utf8')).trim()
    const parsed = v.safeParse(installationIdSchema, stored)
    if (!parsed.success)
      throw new Error('memory.installation_invalid')
    return parsed.output.toLowerCase()
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      const created = randomUUID()
      await writeFile(path, created, { mode: 0o600, flag: 'wx' }).catch(() => {
        throw new Error('memory.installation_unavailable')
      })
      return created
    }
    if (error instanceof Error && error.message.startsWith('memory.'))
      throw error
    throw new Error('memory.installation_unavailable')
  }
}

async function loadDesktopSettings(path: string): Promise<DesktopSettings> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    const parsed = v.safeParse(desktopSettingsSchema, value)
    if (!parsed.success)
      throw new Error('memory.desktop_settings_invalid')
    return parsed.output
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { ...defaultDesktopSettings }
    if (error instanceof Error && error.message.startsWith('memory.'))
      throw error
    throw new Error('memory.desktop_settings_invalid')
  }
}

async function saveDesktopSettings(path: string, settings: DesktopSettings): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(settings), { mode: 0o600, flag: 'wx' })
    await rename(temporaryPath, path)
  }
  catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw new Error('memory.desktop_settings_unavailable')
  }
}

/**
 * Own the connection in main and bind each RPC to its actual sender window.
 * setupMetrodorosService -> MemoryOwner -> FileStorage / authenticated HTTP.
 * Per-window Eventa contexts reject cross-window spoofing and close with their window.
 */
export async function setupMetrodorosService(options: { lifecycle: Lifecycle, ipcMain: IpcMain, i18n: I18n }) {
  const directory = join(app.getPath('userData'), 'metrodoros')
  await mkdir(directory, { recursive: true })
  const profilePath = join(directory, 'settings.json')
  const markersPath = join(directory, 'private-sessions.json')
  const installPath = join(directory, 'installation-id')
  const desktopSettingsPath = join(directory, 'desktop-settings.json')
  const installationId = await loadInstallationId(installPath)
  const credentialStore = new CredentialStore(join(directory, 'credentials'), installationId)
  const launcher = new DesktopLauncher()
  let owner: MemoryOwner
  let desktopSettings = await loadDesktopSettings(desktopSettingsPath)
  let memoryEndpoint = 'http://127.0.0.1:47831'
  let credentialAvailable = false
  let credentialSaved = false
  let desktopError: string | null = null
  let desktopGeneration = 0
  let startupLaunchAttempted = false
  let automaticConnectionSuppressed = false
  let automaticController: AbortController | undefined
  let automaticTask: Promise<void> | undefined
  const hostRoles = new Map<string, Set<MemoryHostRole>>()
  const desktopContexts = new Map<number, ReturnType<typeof createContext>['context']>()
  const privateSessions = new Set<string>()
  let markerWrites = Promise.resolve()
  let desktopCommandTail: Promise<unknown> = Promise.resolve()

  function getOwner(): MemoryOwner {
    return owner
  }

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

  function safeDesktopError(error: unknown): string {
    if (error instanceof Error && /^(?:memory|launcher|credential_store)\.[a-z_]{1,64}$/.test(error.message))
      return error.message
    return 'memory.desktop_settings_unavailable'
  }

  function desktopAvailableFromError(error: unknown): void {
    desktopError = safeDesktopError(error)
    if (desktopError === 'credential_store.encryption_unavailable')
      credentialAvailable = false
  }

  function desktopSettingsSnapshot(): DesktopMemorySettingsSnapshot {
    return {
      autoStart: desktopSettings.autoStart,
      rememberToken: desktopSettings.rememberToken,
      autoConnect: desktopSettings.autoConnect,
      nodePath: desktopSettings.nodePath,
      serverRoot: desktopSettings.serverRoot,
      dataDir: desktopSettings.dataDir,
      endpoint: memoryEndpoint,
      credentialAvailable,
      credentialSaved,
      needsRegistration: desktopSettings.needsRegistration,
      error: desktopError,
    }
  }

  function publishDesktopSettings(): void {
    const snapshot = desktopSettingsSnapshot()
    for (const context of desktopContexts.values())
      context.emit(desktopMemorySettingsSnapshotChanged, snapshot)
  }

  function invalidateAutomaticWork(suppress: boolean): void {
    desktopGeneration += 1
    automaticController?.abort()
    automaticController = undefined
    automaticTask = undefined
    if (suppress)
      automaticConnectionSuppressed = true
  }

  function launchProfile(enabled: boolean): LaunchProfile {
    return {
      enabled,
      nodePath: desktopSettings.nodePath,
      serverRoot: desktopSettings.serverRoot,
      dataDir: desktopSettings.dataDir,
      endpoint: memoryEndpoint,
    }
  }

  function hasRegisteredHosts(): boolean {
    return hasRequiredMemoryHosts(hostRoles.values())
  }

  async function persistDesktopSettings(): Promise<void> {
    try {
      await saveDesktopSettings(desktopSettingsPath, desktopSettings)
    }
    catch (error) {
      desktopError = safeDesktopError(error)
      publishDesktopSettings()
      throw new Error('memory.desktop_settings_unavailable')
    }
  }

  async function maybeConnectAutomatically(): Promise<void> {
    if (!hasRegisteredHosts() || automaticTask || automaticConnectionSuppressed)
      return

    const generation = desktopGeneration
    const controller = new AbortController()
    automaticController = controller
    const run = (async () => {
      const memorySnapshot = await getOwner().command({ kind: 'snapshot' })
      if (generation !== desktopGeneration || controller.signal.aborted || !memorySnapshot.profile.enabled)
        return
      memoryEndpoint = memorySnapshot.profile.endpoint

      const autoStart = desktopSettings.autoStart && !startupLaunchAttempted
      if (autoStart)
        startupLaunchAttempted = true
      await runDesktopStartup({
        profileEnabled: memorySnapshot.profile.enabled,
        autoStart,
        autoConnect: desktopSettings.autoConnect,
        rememberToken: desktopSettings.rememberToken,
        needsRegistration: desktopSettings.needsRegistration,
      }, {
        startServer: async () => { await launcher.ensureReady(launchProfile(true), controller.signal) },
        loadCredential: async () => await credentialStore.load(memorySnapshot.profile.endpoint),
        connect: async (stored, expectedIdentity, isCurrent) => {
          if (generation !== desktopGeneration || controller.signal.aborted)
            return
          const connected = await getOwner().command({ kind: 'connect', token: stored.token }, {
            expectedIdentity,
            isCurrent: () => isCurrent() && generation === desktopGeneration,
          })
          if (generation !== desktopGeneration || controller.signal.aborted)
            return
          if (!connected.connected)
            throw new Error(connected.reason ? `memory.${connected.reason}` : 'memory.connection_failed')
          desktopSettings = { ...desktopSettings, needsRegistration: false }
          desktopError = null
          publishDesktopSettings()
        },
      }, controller.signal)
    })()
    automaticTask = run
    try {
      await run
    }
    catch (error) {
      if (generation !== desktopGeneration || controller.signal.aborted)
        return
      desktopError = safeDesktopError(error)
      const code = desktopError.toLowerCase()
      if (requiresRegistrationAfterAutomaticFailure(code)) {
        desktopSettings = { ...desktopSettings, autoConnect: false, needsRegistration: true }
        await saveDesktopSettings(desktopSettingsPath, desktopSettings).catch(() => {
          desktopError = 'memory.desktop_settings_unavailable'
        })
      }
      publishDesktopSettings()
    }
    finally {
      if (generation === desktopGeneration) {
        automaticController = undefined
        automaticTask = undefined
      }
    }
  }

  async function getDesktopSettingsSnapshot(): Promise<DesktopMemorySettingsSnapshot> {
    try {
      const status = await credentialStore.status()
      credentialAvailable = status.available
      credentialSaved = status.saved
    }
    catch (error) {
      desktopAvailableFromError(error)
    }
    return desktopSettingsSnapshot()
  }

  async function handleDesktopSettingsCommand(command: DesktopMemorySettingsCommand, window: Window): Promise<DesktopMemorySettingsSnapshot> {
    if (!command || typeof command !== 'object')
      throw new Error('memory.desktop_command_invalid')
    if (command.kind === 'snapshot') {
      if (!v.safeParse(v.strictObject({ kind: v.literal('snapshot') }), command).success)
        throw new Error('memory.desktop_command_invalid')
      return await getDesktopSettingsSnapshot()
    }
    if (command.kind === 'configure') {
      const parsed = v.safeParse(v.strictObject({
        kind: v.literal('configure'),
        update: desktopSettingsUpdateSchema,
      }), command)
      if (!parsed.success)
        throw new Error('memory.desktop_command_invalid')
      const previous = desktopSettings
      const next = { ...desktopSettings, ...parsed.output.update }
      if (!next.rememberToken)
        next.autoConnect = false
      if (requiresLaunchRegistration(previous, next)) {
        if (window.isDestroyed())
          throw new Error('memory.registration_cancelled')
        const key = 'settings.pages.memory-panel.desktop.'
        const confirmation = await dialog.showMessageBox(window, {
          type: 'question',
          title: options.i18n.t(`${key}launch-confirm-title`),
          message: options.i18n.t(`${key}launch-confirm-message`),
          detail: `${options.i18n.t(`${key}node-path`)}: ${next.nodePath}\n${options.i18n.t(`${key}server-root`)}: ${next.serverRoot}\n${options.i18n.t(`${key}data-directory`)}: ${next.dataDir}\n${memoryEndpoint}`,
          buttons: [options.i18n.t(`${key}launch-confirm-cancel`), options.i18n.t(`${key}launch-confirm-allow`)],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        if (confirmation.response !== 1 || window.isDestroyed())
          throw new Error('memory.registration_cancelled')
      }
      const forgotCredential = await forgetWhenRememberingDisabled(previous.rememberToken, next.rememberToken, async () => await credentialStore.forget())
      desktopSettings = next
      if (forgotCredential)
        credentialSaved = false
      await persistDesktopSettings()
      const launchChanged = previous.autoStart !== desktopSettings.autoStart
        || previous.nodePath !== desktopSettings.nodePath
        || previous.serverRoot !== desktopSettings.serverRoot
        || previous.dataDir !== desktopSettings.dataDir
      if (launchChanged)
        startupLaunchAttempted = false
      if (previous.autoConnect !== desktopSettings.autoConnect || previous.rememberToken !== desktopSettings.rememberToken || launchChanged)
        invalidateAutomaticWork(false)
      publishDesktopSettings()
      void maybeConnectAutomatically()
      return await getDesktopSettingsSnapshot()
    }
    if (command.kind === 'retry') {
      if (!v.safeParse(v.strictObject({ kind: v.literal('retry') }), command).success)
        throw new Error('memory.desktop_command_invalid')
      automaticConnectionSuppressed = false
      startupLaunchAttempted = false
      invalidateAutomaticWork(false)
      void maybeConnectAutomatically()
      return await getDesktopSettingsSnapshot()
    }
    if (command.kind === 'forget') {
      if (!v.safeParse(v.strictObject({ kind: v.literal('forget') }), command).success)
        throw new Error('memory.desktop_command_invalid')
      invalidateAutomaticWork(true)
      await credentialStore.forget()
      credentialSaved = false
      desktopSettings = { ...desktopSettings, rememberToken: false, autoConnect: false, needsRegistration: false }
      await persistDesktopSettings()
      desktopError = null
      publishDesktopSettings()
      return await getDesktopSettingsSnapshot()
    }
    throw new Error('memory.desktop_command_invalid')
  }

  async function handleMemoryCommand(command: Parameters<MemoryOwner['command']>[0]): Promise<Awaited<ReturnType<MemoryOwner['command']>>> {
    if (command.kind === 'connect') {
      invalidateAutomaticWork(false)
      desktopError = null
    }
    else if (command.kind === 'disconnect') {
      invalidateAutomaticWork(true)
    }
    else if (command.kind === 'save') {
      const endpointChanged = command.profile.endpoint !== memoryEndpoint
      if (endpointChanged || !command.profile.enabled)
        invalidateAutomaticWork(true)
      if (endpointChanged) {
        desktopSettings = { ...desktopSettings, autoConnect: false, needsRegistration: credentialSaved }
        await persistDesktopSettings()
      }
    }

    const snapshot = await getOwner().command(command)
    memoryEndpoint = snapshot.profile.endpoint
    if (command.kind === 'save' && snapshot.profile.enabled)
      automaticConnectionSuppressed = false
    publishDesktopSettings()
    return snapshot
  }

  owner = new MemoryOwner({
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
    onManualConnection: async (credential) => {
      desktopSettings = { ...desktopSettings, needsRegistration: false }
      desktopError = null
      if (!desktopSettings.rememberToken) {
        publishDesktopSettings()
        return
      }
      try {
        await credentialStore.save(credential)
        credentialSaved = true
        credentialAvailable = true
        desktopSettings = { ...desktopSettings, needsRegistration: false }
        desktopError = null
      }
      catch (error) {
        credentialSaved = false
        desktopSettings = { ...desktopSettings, autoConnect: false, needsRegistration: true }
        await credentialStore.forget().catch(() => undefined)
        desktopAvailableFromError(error)
      }
      await persistDesktopSettings()
      publishDesktopSettings()
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
  const initialSnapshot = await owner.command({ kind: 'snapshot' })
  memoryEndpoint = initialSnapshot.profile.endpoint
  try {
    const status = await credentialStore.status()
    credentialAvailable = status.available
    credentialSaved = status.saved
  }
  catch {
    credentialAvailable = false
    credentialSaved = false
  }
  owner.subscribe((snapshot) => {
    if (snapshot.profile.enabled)
      protectMemoryTraces()
    if (snapshot.profile.endpoint !== memoryEndpoint) {
      memoryEndpoint = snapshot.profile.endpoint
      publishDesktopSettings()
    }
  })
  const cleanups = new Map<number, () => void>()

  function register(window: Window) {
    if (cleanups.has(window.id))
      return
    const eventa = createContext(options.ipcMain, window, { onlySameWindow: true })
    const context = eventa.context
    desktopContexts.set(window.id, context)
    const actor = String(window.id)
    const stop = defineInvoke(context, memoryStop)
    const feed = defineInvoke(context, memorySpeechInput)
    defineInvokeHandler(context, memoryCommand, handleMemoryCommand)
    defineInvokeHandler(context, desktopMemorySettingsCommand, (command) => {
      const result = desktopCommandTail.then(async () => await handleDesktopSettingsCommand(command, window))
      desktopCommandTail = result.catch(() => undefined)
      return result
    })
    defineInvokeHandler(context, memoryPrepare, input => owner.prepare(actor, input.referenceId, input.input, input.deadlineAt))
    defineInvokeHandler(context, memoryGate, input => owner.gate(actor, input.referenceId, input.kind))
    defineInvokeHandler(context, memoryCancel, input => owner.cancel(actor, input.referenceId))
    defineInvokeHandler(context, memoryReport, input => owner.report(actor, input.referenceId, input.report))
    defineInvokeHandler(context, memoryDisplayed, input => owner.displayed(input.assistantMessageId))
    defineInvokeHandler(context, memoryRegisterHost, async (input) => {
      await owner.registerHost(actor, input.role, request => stop(request), input.role === 'speech' ? input => feed(input) : undefined)
      const roles = hostRoles.get(actor) ?? new Set<MemoryHostRole>()
      roles.add(input.role)
      hostRoles.set(actor, roles)
      void maybeConnectAutomatically()
    })
    defineInvokeHandler(context, memoryUnregisterHost, async (input) => {
      hostRoles.get(actor)?.delete(input.role)
      if (!hostRoles.get(actor)?.size)
        hostRoles.delete(actor)
      invalidateAutomaticWork(false)
      await owner.unregisterHost(actor, input.role)
    })
    const unsubscribe = owner.subscribe(snapshot => context.emit(memorySnapshotChanged, snapshot))
    const cleanup = () => {
      unsubscribe()
      desktopContexts.delete(window.id)
      hostRoles.delete(actor)
      invalidateAutomaticWork(false)
      void Promise.all([owner.unregisterHost(actor, 'conversation'), owner.unregisterHost(actor, 'speech')]).catch(() => undefined)
      eventa.dispose()
      cleanups.delete(window.id)
    }
    window.webContents.once('render-process-gone', () => {
      hostRoles.delete(actor)
      invalidateAutomaticWork(false)
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
    invalidateAutomaticWork(true)
    launcher.dispose()
    // Ask live hosts to stop before disposing their transports.
    await owner.dispose()
    for (const cleanup of [...cleanups.values()])
      cleanup()
  })
  return { owner }
}
