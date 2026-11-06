import type { ZenoCommand, ZenoHostState, ZenoSnapshot } from '@proj-airi/stage-ui/services/zeno/contracts'
import type { HeartbeatInput } from '@zeno/airi-adapter/contracts'
import type { ToolDefinition } from '@zeno/airi-adapter/conversation-tools'
import type { IpcMain, BrowserWindow as Window } from 'electron'
import type { Lifecycle } from 'injeca'

import type { I18n } from '../../libs/i18n'

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import definitions from '@zeno/airi-adapter/tools'

import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { AiriAdapterClient } from '@zeno/airi-adapter'
import { ConversationTools } from '@zeno/airi-adapter/conversation-tools'
import { NotificationRunner } from '@zeno/airi-adapter/notification-runner'
import { app, BrowserWindow, dialog } from 'electron'

import * as v from 'valibot'

import { zenoAuthorize, zenoCommand, zenoSnapshot, zenoSpeak, zenoStop, zenoTool } from '../../../shared/eventa/zeno'
import { EncryptedRecordStore } from './metrodoros/encrypted-record-store'

const savedConnection = v.strictObject({ endpoint: v.string(), token: v.pipe(v.string(), v.regex(/^zeno_cl_[a-f0-9]{64}$/)), autoConnect: v.boolean() })
const hostSchema = v.strictObject({ active: v.boolean(), characterId: v.pipe(v.string(), v.maxLength(200)), speechState: v.picklist(['idle', 'busy', 'unknown']) })
const id = v.pipe(v.string(), v.uuid())
const commandSchema = v.variant('kind', [
  v.strictObject({ kind: v.picklist(['snapshot', 'refresh', 'disconnect']) }),
  v.strictObject({ kind: v.literal('connect'), endpoint: v.pipe(v.string(), v.maxLength(200)), token: v.pipe(v.string(), v.regex(/^zeno_cl_[a-f0-9]{64}$/)) }),
  v.strictObject({ kind: v.literal('host'), state: hostSchema }),
  v.strictObject({ kind: v.literal('mute'), enabled: v.boolean(), until: v.nullable(v.string()) }),
  v.strictObject({ kind: v.literal('ack'), id }),
  v.strictObject({ kind: v.literal('snooze'), id, minutes: v.picklist([10, 30]) }),
])

/** One main-process owner binds a Stage host, private credentials, SSE and the server speech lease. */
export async function setupZenoService(options: { ipcMain: IpcMain, lifecycle: Lifecycle, i18n: I18n }) {
  const directory = join(app.getPath('userData'), 'zeno')
  const credentials = new EncryptedRecordStore(directory, 'credential')
  const records = new Map<string, EncryptedRecordStore>()
  const contexts = new Map<number, ReturnType<typeof createContext>>()
  const ownerId = randomUUID()
  let generation = 1
  let host: { window: Window, state: ZenoHostState } | undefined
  let client: AiriAdapterClient | undefined
  let runner: NotificationRunner | undefined
  let tools: ConversationTools | undefined
  let stopHeartbeat: (() => void) | undefined
  let stopEvents: (() => void) | undefined
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let connectionGeneration = 0
  let localMuteLatch = false
  let configured: v.InferOutput<typeof savedConnection> | undefined
  let snapshot: ZenoSnapshot = { connected: false, endpoint: 'http://127.0.0.1:47841', paired: false, error: null, mute: null, notifications: [] }

  function publish() {
    for (const transport of contexts.values())
      transport.context.emit(zenoSnapshot, snapshot)
  }

  function state(): HeartbeatInput {
    return { owner_id: ownerId, character_generation: generation, active: !!host?.state.active, speech_state: host?.state.speechState ?? 'unknown' }
  }

  async function stopAudio(allAssistantAudio = true) {
    if (host && !host.window.isDestroyed()) {
      const transport = contexts.get(host.window.id)
      if (transport)
        await defineInvoke(transport.context, zenoStop)({ allAssistantAudio })
    }
  }

  async function synchronize() {
    if (!client)
      return
    const version = connectionGeneration
    const [mute, notifications] = await Promise.all([client.getMeetingMute(), client.getNotifications()])
    if (version !== connectionGeneration)
      return
    if (localMuteLatch)
      mute.data = { ...mute.data, local_inhibited: true, synchronized: false }
    if (mute.data.enabled || mute.data.local_inhibited)
      await stopAudio()
    snapshot = { ...snapshot, connected: true, paired: true, error: null, mute: mute.data, notifications: notifications.data.items }
    publish()
  }

  async function failed() {
    snapshot = { ...snapshot, connected: false, error: 'zeno.connection_failed' }
    await runner?.invalidate()
    publish()
  }

  function subscribe() {
    if (!client)
      return
    stopEvents?.()
    const version = connectionGeneration
    const again = () => {
      if (version !== connectionGeneration || reconnect)
        return
      void failed()
      reconnect = setTimeout(() => {
        reconnect = undefined
        subscribe()
      }, 5000)
    }
    stopEvents = client.subscribeEvents({
      onEvent: () => { void synchronize().then(() => runner?.refresh()).catch(failed) },
      onMuteSafety: () => { void synchronize().catch(failed) },
      onReset: () => { void synchronize().catch(failed) },
      onError: again,
      onDisconnect: again,
    })
  }

  async function close() {
    connectionGeneration++
    stopHeartbeat?.()
    stopEvents?.()
    stopHeartbeat = undefined
    stopEvents = undefined
    if (reconnect)
      clearTimeout(reconnect)
    reconnect = undefined
    await runner?.stop()
    runner = undefined
    client = undefined
    tools = undefined
  }

  async function connect(next: v.InferOutput<typeof savedConnection>) {
    await close()
    configured = next
    client = new AiriAdapterClient({ baseUrl: next.endpoint, bearerToken: next.token })
    await client.getSnapshot()
    await credentials.write(next)
    snapshot = { ...snapshot, endpoint: next.endpoint, paired: true }
    const current = client
    tools = new ConversationTools(current, definitions as ToolDefinition[], {
      get: async (key) => {
        const record = records.get(key) ?? new EncryptedRecordStore(join(directory, 'calls', key), 'credential')
        records.set(key, record)
        const value = await record.read()
        return typeof value === 'string' ? value : null
      },
      set: async (key, value) => {
        const record = records.get(key) ?? new EncryptedRecordStore(join(directory, 'calls', key), 'credential')
        records.set(key, record)
        await record.write(value)
      },
    }, async (_kind, prepared) => {
      if (!host || host.window.isDestroyed())
        return false
      const response = await dialog.showMessageBox(host.window, {
        type: 'question',
        title: options.i18n.t('zeno.confirm-title'),
        message: options.i18n.t('zeno.confirm-message'),
        detail: JSON.stringify(prepared, null, 2).slice(0, 6000),
        buttons: [options.i18n.t('zeno.cancel'), options.i18n.t('zeno.confirm')],
        defaultId: 0,
        cancelId: 0,
      })
      return response.response === 1
    })
    runner = new NotificationRunner(current, {
      state,
      display: async () => { await synchronize() },
      stop: () => stopAudio(false),
      speak: async (claim, authorize) => {
        if (!host || host.state.speechState !== 'idle' || !await authorize())
          return 'suppressed'
        const transport = contexts.get(host.window.id)
        return transport ? defineInvoke(transport.context, zenoSpeak)({ claim, generation }) : 'suppressed'
      },
    })
    await synchronize()
    subscribe()
    stopHeartbeat = current.startHeartbeat(state, (result) => {
      const mute = localMuteLatch
        ? { ...result.meeting_mute, local_inhibited: true, synchronized: false }
        : result.meeting_mute
      snapshot = { ...snapshot, mute, connected: true, error: null }
      publish()
      if (mute.enabled || mute.local_inhibited) {
        void stopAudio()
        void runner?.invalidate()
      }
      else if (result.active) {
        void runner?.refresh().catch(failed)
      }
    }, failed)
  }

  async function command(raw: ZenoCommand, window: Window): Promise<ZenoSnapshot> {
    const input = v.parse(commandSchema, raw)
    if (input.kind === 'connect') {
      await connect({ endpoint: input.endpoint, token: input.token, autoConnect: true })
    }
    else if (input.kind === 'disconnect') {
      if (configured)
        await credentials.write({ ...configured, autoConnect: false })
      await close()
      snapshot = { ...snapshot, connected: false, error: null }
    }
    else if (input.kind === 'host') {
      if (!host || host.window.id === window.id) {
        if (host?.state.characterId !== input.state.characterId) {
          generation++
          await runner?.invalidate()
        }
        host = input.state.active ? { window, state: input.state } : undefined
        if (client) {
          const revision = (await client.getSnapshot()).revision
          await client.heartbeat(state(), revision)
        }
      }
    }
    else if (input.kind !== 'snapshot') {
      if (!client)
        throw new Error('zeno.connection_required')
      if (input.kind === 'mute' && input.enabled) {
        localMuteLatch = true
        snapshot = { ...snapshot, mute: { enabled: true, until: input.until, updated_at: new Date().toISOString(), revision: 0, local_inhibited: true, synchronized: false } }
        publish()
        await stopAudio()
      }
      const revision = (await client.getSnapshot()).revision
      if (input.kind === 'mute') {
        await client.updateMeetingMute({ enabled: input.enabled, until: input.until }, revision)
        const fresh = await client.getMeetingMute()
        localMuteLatch = false
        snapshot = { ...snapshot, mute: fresh.data }
      }
      if (input.kind === 'ack')
        await client.acknowledgeNotification(input.id, revision)
      if (input.kind === 'snooze')
        await client.snoozeNotification(input.id, { delay_minutes: input.minutes }, revision)
      await synchronize()
    }
    return snapshot
  }

  function register(window: Window) {
    if (contexts.has(window.id))
      return
    const transport = createContext(options.ipcMain, window, { onlySameWindow: true })
    contexts.set(window.id, transport)
    defineInvokeHandler(transport.context, zenoCommand, input => command(input, window))
    defineInvokeHandler(transport.context, zenoAuthorize, async (input) => {
      if (!client || !host || localMuteLatch || host.window.id !== window.id || generation !== input.generation)
        return false
      return (await client.validateDelivery(v.parse(id, input.attemptId), ownerId, generation)).data.allowed
    })
    defineInvokeHandler(transport.context, zenoTool, async (input) => {
      if (!tools || JSON.stringify(input).length > 32000 || !input.turnId)
        throw new Error('zeno.tool_unavailable')
      return tools.execute(input.operation, input.input, input.turnId, 'user')
    })
    window.once('closed', () => {
      contexts.delete(window.id)
      transport.dispose()
      if (host?.window.id === window.id) {
        host = undefined
        generation++
        void runner?.invalidate()
      }
    })
    window.webContents.once('render-process-gone', () => {
      if (host?.window.id === window.id) {
        host = undefined
        generation++
        void runner?.invalidate()
      }
    })
  }
  const onWindow = (_event: Electron.Event, window: Window) => register(window)
  app.on('browser-window-created', onWindow)
  for (const window of BrowserWindow.getAllWindows())
    register(window)
  options.lifecycle.appHooks.onStop(async () => {
    app.removeListener('browser-window-created', onWindow)
    await close()
    for (const transport of contexts.values())
      transport.dispose()
    contexts.clear()
  })
  try {
    const saved = v.safeParse(savedConnection, await credentials.read())
    if (saved.success && saved.output.autoConnect)
      await connect(saved.output)
  }
  catch { await failed() }
  return { snapshot: () => snapshot }
}
