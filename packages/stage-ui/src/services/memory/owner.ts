import type { AdapterSettings, HostPorts, StoragePort, TurnHandle } from '@metrodoros/airi-adapter'
import type { JobListResponse } from '@metrodoros/contracts'
import type { Conversation } from '@proj-airi/core-agent'

import type { MemoryCommand, MemoryDeliveryReport, MemoryPrepared, MemoryPrepareInput, MemoryProfile, MemorySnapshot, MemorySpeechInput, MemoryStopRequest } from './contracts'

import { createMetrodorosApi, failureCode, hash53, MemoryBridge, parseSettings, PersonaMigration, TokenHolder } from '@metrodoros/airi-adapter'
import { MetrodorosClient, ShortTermClient } from '@metrodoros/client'
import { IdentityClient } from '@metrodoros/client/identity'
import { jobKinds, jobStates } from '@metrodoros/contracts'

import { emptyMemorySnapshot } from './contracts'

interface HeldTurn {
  actor: string
  generation: number
  selectionGeneration: number
  input: MemoryPrepareInput
  controller: AbortController
  turn?: TurnHandle
  deadlineAt: number
  expiresAt: number
  firstSent: boolean
  assistantMessageId?: string
  appIds: Set<string>
  expiryTimer?: ReturnType<typeof setTimeout>
  displayTimer?: ReturnType<typeof setTimeout>
}

/** The platform owns storage and transport. The owner keeps secrets and real handles. */
export interface MemoryOwnerOptions {
  installationId: string
  loadProfile: () => Promise<MemoryProfile | null>
  saveProfile: (profile: MemoryProfile) => Promise<void>
  loadPrivateSessions: () => Promise<string[]>
  rememberPrivateSession: (sessionId: string) => Promise<void>
  storage: (namespace: string) => Promise<StoragePort>
  fetch?: typeof globalThis.fetch
}

/**
 * One owner controls authentication, writer leases, notification sync, and outbox dispatch.
 * Config commands serialize. Notification sync and outbox sends have separate task loops.
 * A lost host invalidates the lease before cancellation and never acknowledges forgotten output.
 */
export class MemoryOwner {
  private snapshot = emptyMemorySnapshot()
  private readonly token = new TokenHolder()
  private bridge: MemoryBridge | undefined
  private identityClient: IdentityClient | undefined
  private conversationHost: { actor: string, stop: (request: MemoryStopRequest) => Promise<boolean> } | undefined
  private speechHost: { actor: string, stop: (request: MemoryStopRequest) => Promise<boolean>, feed: (input: MemorySpeechInput) => Promise<boolean> } | undefined
  private initializationFailed = false
  private suspended = false
  private readonly pendingCancels = new Set<string>()
  private generation = 0
  private selectionGeneration = 0
  private readonly turns = new Map<string, HeldTurn>()
  private readonly listeners = new Set<(snapshot: MemorySnapshot) => void>()
  private readonly pendingDisplays = new Set<string>()
  private tasks: AbortController | undefined
  private commandTail: Promise<unknown> = Promise.resolve()
  private readonly migration: PersonaMigration
  private readonly initialized: Promise<void>

  constructor(private readonly options: MemoryOwnerOptions) {
    this.initialized = Promise.all([options.loadProfile(), options.loadPrivateSessions()]).then(([profile, sessions]) => {
      if (profile)
        this.snapshot.profile = this.checkedProfile(profile)
      for (const session of sessions)
        this.usedSessions.add(session)
    }).catch(() => {
      this.initializationFailed = true
      this.snapshot.state = 'blocked'
      this.snapshot.reason = 'saved_settings_invalid'
    })
    this.migration = new PersonaMigration(async (candidate) => {
      const binding = this.snapshot.profile.cardBindings.find(item => item.cardId === candidate.cardId)
      if (!binding || !this.identityClient)
        throw new Error('memory.persona_binding_required')
      const character = await this.identityClient.getCharacter(binding.characterId)
      const existing = await this.identityClient.getProfile(binding.characterId)
      if (!existing.profile || existing.redacted)
        throw new Error('memory.persona_unavailable')
      await this.identityClient.setProfile(binding.characterId, {
        expected_revision: character.revision,
        profile: { ...existing.profile, background: candidate.text },
      }, { idempotencyKey: crypto.randomUUID() })
    })
  }

  private checkedProfile(profile: MemoryProfile): MemoryProfile {
    const parsed = parseSettings({ ...profile, serverCapabilities: { conversationProfile: false } })
    const url = new URL(parsed.endpoint)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('memory.loopback_required')
    const { serverCapabilities: _capabilities, ...nonSecret } = parsed
    return nonSecret
  }

  subscribe(listener: (snapshot: MemorySnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async publish(): Promise<MemorySnapshot> {
    if (this.bridge) {
      const status = await this.bridge.status().catch(() => {
        this.suspended = true
        this.snapshot.connected = false
        this.tasks?.abort()
        for (const held of this.turns.values()) {
          held.controller.abort()
          void this.requestStop('speech', { airiSessionId: held.input.sessionId, userMessageId: held.input.userMessageId, attemptId: held.input.attemptId }).catch(() => false)
        }
        return null
      })
      if (status) {
        this.snapshot.state = status.state
        this.snapshot.reason = typeof status.details.blocked_reason === 'string' ? status.details.blocked_reason : null
        this.snapshot.outboxPending = typeof status.details.outbox_pending === 'number' ? status.details.outbox_pending : null
        const metrics = this.bridge.diagnostics.metrics
        for (const key of ['memory_recall_ms', 'memory_validate_ms', 'memory_total_ms'] as const) {
          const value = metrics[key]
          if (value !== null)
            this.snapshot.metrics[key] = value
        }
      }
    }
    if (this.initializationFailed) {
      this.snapshot.state = 'blocked'
      this.snapshot.reason = 'saved_settings_invalid'
    }
    else if (this.suspended) {
      this.snapshot.state = 'blocked'
      this.snapshot.reason = 'stop_unconfirmed'
    }
    this.snapshot.tokenRequired = !this.token.present
    this.snapshot.configured = this.snapshot.profile.enabled
      && this.snapshot.profile.worldId !== null
      && this.snapshot.profile.cardBindings.length > 0
      && this.conversationHost !== undefined && this.speechHost !== undefined
      && this.snapshot.connected
    const snapshot = structuredClone(this.snapshot)
    for (const listener of this.listeners)
      listener(structuredClone(snapshot))
    return snapshot
  }

  async registerHost(actor: string, role: 'conversation' | 'speech', stop: (request: MemoryStopRequest) => Promise<boolean>, feed?: (input: MemorySpeechInput) => Promise<boolean>): Promise<void> {
    await this.initialized
    const current = role === 'conversation' ? this.conversationHost : this.speechHost
    if (current && current.actor !== actor && !this.suspended)
      await this.stopConnection(false)
    if (role === 'conversation') {
      if (current?.actor !== actor)
        this.generation += 1
      this.conversationHost = { actor, stop }
    }
    else {
      if (!feed)
        throw new Error('memory.capability_missing')
      this.speechHost = { actor, stop, feed }
    }
    if (this.suspended) {
      try {
        await this.stopConnection(false)
      }
      catch {
        await this.publish()
        return
      }
    }
    if (!this.initializationFailed && this.token.present && this.snapshot.profile.enabled && this.conversationHost && this.speechHost && !this.bridge)
      await this.connect()
    await this.publish()
  }

  async unregisterHost(actor: string, role: 'conversation' | 'speech'): Promise<void> {
    const current = role === 'conversation' ? this.conversationHost : this.speechHost
    if (current?.actor !== actor)
      return
    this.generation += 1
    try {
      await this.stopConnection(false)
    }
    catch {
      this.suspended = true
      this.snapshot.connected = false
    }
    finally {
      if (role === 'conversation')
        this.conversationHost = undefined
      else
        this.speechHost = undefined
      await this.publish()
    }
  }

  async command(command: MemoryCommand): Promise<MemorySnapshot> {
    const run = this.commandTail.then(async () => {
      await this.initialized
      if (this.initializationFailed && command.kind !== 'snapshot')
        throw new Error('memory.saved_settings_invalid')
      switch (command.kind) {
        case 'snapshot': return this.publish()
        case 'save': {
          const profile = this.checkedProfile(command.profile)
          const changedEndpoint = profile.endpoint !== this.snapshot.profile.endpoint
          await this.stopConnection(changedEndpoint)
          this.snapshot.profile = profile
          await this.options.saveProfile(profile)
          if (this.token.present && profile.enabled)
            await this.connect()
          break
        }
        case 'connect':
          await this.stopConnection(true)
          if (!command.token.trim())
            throw new Error('memory.token_required')
          this.token.set(command.token)
          await this.connect()
          break
        case 'disconnect':
          await this.stopConnection(true)
          break
        case 'refresh':
          if (this.bridge) {
            await this.bridge.syncNotifications()
            this.snapshot.lastSync = Date.now()
            await this.loadMetadata()
          }
          else if (this.token.present) {
            await this.connect()
          }
          break
        case 'create-character':
          await this.requireIdentity().createCharacter({ display_name: command.name, profile: {
            name: command.name,
            first_person: '',
            speaking_style: '',
            background: '',
            values: [],
          } }, { idempotencyKey: crypto.randomUUID() })
          await this.loadMetadata()
          break
        case 'create-world':
          await this.requireIdentity().createWorld({ name: command.name, realm: 'fiction' }, { idempotencyKey: crypto.randomUUID() })
          await this.loadMetadata()
          break
        case 'bind-card': {
          await this.stopConnection(false)
          const profile = this.checkedProfile({ ...this.snapshot.profile, worldId: command.worldId, cardBindings: [
            ...this.snapshot.profile.cardBindings.filter(binding => binding.cardId !== command.cardId),
            { cardId: command.cardId, characterId: command.characterId },
          ] })
          this.snapshot.profile = profile
          await this.options.saveProfile(profile)
          if (this.token.present)
            await this.connect()
          break
        }
        case 'propose-persona':
          this.snapshot.candidate = this.migration.propose(command.card)
          break
        case 'approve-persona':
          await this.migration.approve(command.candidateId, { approvedByUser: true, candidateDigest: command.digest })
          this.snapshot.candidate = null
          await this.bridge?.notificationDisconnected()
          await this.bridge?.syncNotifications()
          break
        case 'bind-model': {
          const key = JSON.stringify([command.providerId, command.model])
          const profile = this.checkedProfile({ ...this.snapshot.profile, modelBindings: {
            ...this.snapshot.profile.modelBindings,
            [key]: { externalProfileId: command.externalProfileId },
          } })
          await this.stopConnection(false)
          this.snapshot.profile = profile
          await this.options.saveProfile(profile)
          if (this.token.present)
            await this.connect()
          break
        }
        case 'new-conversation':
          this.selectionGeneration += 1
          if (this.bridge && this.snapshot.selection) {
            await this.bridge.selectCard('', { airiSessionId: command.airiSessionId })
            this.snapshot.selection = null
          }
          break
      }
      return this.publish()
    })
    this.commandTail = run.catch(() => undefined)
    return run.catch(async (error: unknown) => {
      const ownReason = error instanceof Error && /^memory\.[a-z_]{1,64}$/.test(error.message)
        ? error.message.slice('memory.'.length)
        : failureCode(error).toLowerCase()
      this.snapshot.reason = ownReason
      this.snapshot.state = 'blocked'
      await this.publish()
      // Never forward SDK errors or request objects into an IPC diagnostic.
      throw new Error(`memory.${ownReason}`)
    })
  }

  private requireIdentity(): IdentityClient {
    if (!this.identityClient)
      throw new Error('memory.connection_required')
    return this.identityClient
  }

  private async loadMetadata(): Promise<void> {
    const identity = this.requireIdentity()
    const [characters, worlds] = await Promise.all([identity.listCharacters({ state: 'active', limit: 100 }), identity.listWorlds({ limit: 100 })])
    this.snapshot.characters = characters.items.map(item => ({ id: item.character_id, name: item.display_name ?? item.character_id }))
    this.snapshot.worlds = worlds.items.filter(item => item.state === 'active').map(item => ({ id: item.world_id, name: item.name ?? item.world_id }))
    await this.loadConsolidationCount()
  }

  private async loadConsolidationCount(): Promise<void> {
    const kinds = new Set(['extract_turn', 'summarize_session', 'review_hypotheses', 'resolve_intent'])
    const pending = new Set(['pending', 'running', 'retry_wait', 'paused'])
    const cursors = new Set<string>()
    let cursor: string | null = null
    let count = 0
    try {
      for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
        const query = new URLSearchParams({ limit: '100' })
        if (cursor)
          query.set('cursor', cursor)
        const page = await this.requireIdentity().request<JobListResponse>(`/v1/jobs?${query}`, { budgetMs: 1000 })
        if (!Array.isArray(page.items) || (page.next_cursor !== null && typeof page.next_cursor !== 'string'))
          throw new Error('memory.queue_unavailable')
        for (const job of page.items) {
          if (!jobKinds.includes(job.kind) || !jobStates.includes(job.state))
            throw new Error('memory.queue_unavailable')
          if (kinds.has(job.kind) && pending.has(job.state))
            count += 1
        }
        if (page.next_cursor === null) {
          this.snapshot.consolidationPending = count
          this.bridge?.setConsolidationPending(count)
          return
        }
        if (cursors.has(page.next_cursor))
          throw new Error('memory.queue_unavailable')
        cursors.add(page.next_cursor)
        cursor = page.next_cursor
      }
    }
    catch {
      // Missing permission, failed reads, and incomplete pagination are unknown, never zero.
      this.snapshot.consolidationPending = null
      return
    }
    this.snapshot.consolidationPending = null
  }

  private async requestStop(kind: MemoryStopRequest['kind'], scope: { airiSessionId: string, userMessageId?: string, attemptId?: string }): Promise<boolean> {
    const referenceIds = [...this.turns].filter(([, item]) => item.input.sessionId === scope.airiSessionId
      && (!scope.userMessageId || item.input.userMessageId === scope.userMessageId)
      && (!scope.attemptId || item.input.attemptId === scope.attemptId)).map(([id]) => id)
    for (const id of referenceIds)
      this.turns.get(id)?.controller.abort()
    const host = kind === 'speech' ? this.speechHost : this.conversationHost
    if (!host)
      return false
    const request: MemoryStopRequest = { kind, sessionId: scope.airiSessionId, referenceIds }
    if (scope.userMessageId)
      request.userMessageId = scope.userMessageId
    if (scope.attemptId)
      request.attemptId = scope.attemptId
    try {
      return await Promise.race([
        host.stop(request),
        new Promise<boolean>(resolve => setTimeout(resolve, 1000, false)),
      ])
    }
    catch {
      return false
    }
  }

  private async connect(): Promise<void> {
    if (!this.conversationHost || !this.speechHost) {
      this.snapshot.state = 'blocked'
      this.snapshot.reason = 'capability_missing'
      return
    }
    this.snapshot.state = 'connecting'
    const ownerGeneration = this.generation
    const selectionGeneration = this.selectionGeneration
    const conversationActor = this.conversationHost.actor
    const speechActor = this.speechHost.actor
    const selectionCurrent = () => this.generation === ownerGeneration && this.selectionGeneration === selectionGeneration && this.conversationHost?.actor === conversationActor && this.speechHost?.actor === speechActor
    const api = createMetrodorosApi({ endpoint: this.snapshot.profile.endpoint, token: this.token.reveal(), ...(this.options.fetch ? { fetch: this.options.fetch } : {}) })
    const client = new MetrodorosClient({ baseUrl: this.snapshot.profile.endpoint, token: this.token.reveal(), ...(this.options.fetch ? { fetch: this.options.fetch } : {}) })
    const identity = await new ShortTermClient(client).getConnection({ budgetMs: 1000 })
    const capabilities = await api.getCapabilities?.({ budgetMs: 1000 })
    if (!capabilities?.conversation_profile || !capabilities.output_gate || !capabilities.change_notifications)
      throw new Error('memory.capability_missing')
    const namespace = hash53(JSON.stringify([this.options.installationId, this.snapshot.profile.endpoint, identity.user_id, identity.client_id, identity.store_generation]))
    const storage = await this.options.storage(namespace)
    if (!selectionCurrent())
      throw new Error('memory.owner_lost')
    const assertStore = (generation: string) => {
      if (generation !== identity.store_generation)
        throw new Error('memory.store_changed')
    }
    const boundApi: typeof api = {
      ...api,
      synchronize: options => api.synchronize({
        ...options,
        applyChanges: async (page) => {
          assertStore(page.store_generation)
          return options.applyChanges(page)
        },
        resetCacheAndOutbox: async (page) => {
          assertStore(page.store_generation)
          return options.resetCacheAndOutbox(page)
        },
        saveCheckpoint: async (checkpoint) => {
          assertStore(checkpoint.store_generation)
          await options.saveCheckpoint(checkpoint)
        },
      }),
    }
    const appIds = new Set<string>()
    const host: HostPorts = {
      capabilities: { providerSendGate: true, continuationClearing: true, speechStop: true, notificationSync: true },
      abortGeneration: async (scope) => {
        if (!await this.requestStop('generation', scope))
          throw new Error('memory.stop_unconfirmed')
      },
      excludeContinuations: async (scope) => {
        if (!await this.requestStop('continuations', scope))
          throw new Error('memory.stop_unconfirmed')
      },
      stopSpeech: async (scope) => {
        if (!await this.requestStop('speech', scope))
          throw new Error('memory.stop_unconfirmed')
      },
      isSpeechStopped: scope => this.requestStop('speech', scope),
      isAppInstruction: turn => appIds.has(turn.id),
    }
    const settings: AdapterSettings = { ...this.snapshot.profile, serverCapabilities: { conversationProfile: true } }
    const bridge = new MemoryBridge({ storage, api: boundApi, host, settings, instanceId: `${this.options.installationId}:${this.conversationHost.actor}:${this.generation}` })
    this.identityClient = new IdentityClient({ baseUrl: this.snapshot.profile.endpoint, token: this.token.reveal(), ...(this.options.fetch ? { fetch: this.options.fetch } : {}) })
    this.bridge = bridge
    this.appInstructionIds = appIds
    this.snapshot.identity = identity
    if (settings.enabled)
      await bridge.start()
    else
      await bridge.syncNotifications()
    if (!selectionCurrent()) {
      await bridge.disable().catch(() => undefined)
      if (this.bridge === bridge)
        this.bridge = undefined
      throw new Error('memory.owner_lost')
    }
    if (!bridge.synchronized)
      throw new Error('memory.sync_required')
    this.snapshot.connected = true
    this.snapshot.lastSync = Date.now()
    this.tasks = new AbortController()
    const signal = this.tasks.signal
    void this.notificationLoop(bridge, signal)
    void this.outboxLoop(bridge, signal)
    await this.loadMetadata()
  }

  private appInstructionIds = new Set<string>()

  private async delay(signal: AbortSignal, ms: number): Promise<void> {
    if (signal.aborted)
      return
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
    })
  }

  private async notificationLoop(bridge: MemoryBridge, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.delay(signal, 500)
      if (signal.aborted)
        return
      try {
        await bridge.syncNotifications(signal)
        if (signal.aborted || this.bridge !== bridge)
          return
        this.snapshot.lastSync = Date.now()
        await this.publish()
      }
      catch {
        await bridge.notificationDisconnected().catch(() => undefined)
        this.snapshot.connected = false
        this.snapshot.reason = 'sync_required'
        this.tasks?.abort()
        await this.publish()
        return
      }
    }
  }

  private async outboxLoop(bridge: MemoryBridge, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.delay(signal, 250)
      if (signal.aborted)
        return
      try {
        await bridge.flushOutbox()
      }
      catch {
        if (!signal.aborted)
          await this.publish()
      }
    }
  }

  private async stopConnection(clearToken: boolean): Promise<void> {
    this.tasks?.abort()
    this.tasks = undefined
    this.selectionGeneration += 1
    // disable confirms generation and speech stop before the old authenticated client closes.
    if (this.bridge) {
      try {
        await this.bridge.disable()
      }
      catch {
        this.suspended = true
        this.snapshot.connected = false
        throw new Error('memory.stop_unconfirmed')
      }
    }
    this.suspended = false
    for (const item of this.turns.values()) {
      item.controller.abort()
      clearTimeout(item.expiryTimer)
      clearTimeout(item.displayTimer)
    }
    this.turns.clear()
    this.bridge = undefined
    this.identityClient = undefined
    this.snapshot.connected = false
    this.snapshot.state = 'disabled'
    this.snapshot.identity = null
    this.snapshot.selection = null
    this.snapshot.candidate = null
    if (clearToken)
      this.token.clear()
  }

  async prepare(actor: string, referenceId: string, input: MemoryPrepareInput, deadlineAt: number): Promise<MemoryPrepared> {
    await this.initialized
    if (this.initializationFailed)
      return { mode: 'blocked', reason: 'saved_settings_invalid', ownerGeneration: this.generation, selectionGeneration: this.selectionGeneration, expiresAt: deadlineAt }
    if (this.suspended)
      return { mode: 'blocked', reason: 'stop_unconfirmed', ownerGeneration: this.generation, selectionGeneration: this.selectionGeneration, expiresAt: deadlineAt }
    if (this.conversationHost?.actor !== actor)
      throw new Error('memory.owner_lost')
    if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now() || deadlineAt > Date.now() + 1000)
      throw new Error('memory.deadline_exceeded')
    const bridge = this.bridge
    if (!bridge) {
      if (this.snapshot.profile.enabled)
        return { mode: 'blocked', reason: this.snapshot.reason ?? 'sync_required', ownerGeneration: this.generation, selectionGeneration: this.selectionGeneration, expiresAt: deadlineAt }
      // A session that used memory cannot fall back to its unfiltered durable history.
      const privateSession = this.usedSessions.has(input.sessionId)
      if (privateSession)
        return { mode: 'blocked', reason: 'new_session_required', ownerGeneration: this.generation, selectionGeneration: this.selectionGeneration, expiresAt: deadlineAt }
      return { mode: 'disabled', conversation: input.conversation, ownerGeneration: this.generation, selectionGeneration: this.selectionGeneration, expiresAt: deadlineAt }
    }
    if (!this.usedSessions.has(input.sessionId) && input.conversation.turns.filter(turn => turn.type === 'user').length > 1)
      return { mode: 'blocked', reason: 'new_session_required', ownerGeneration: this.generation, selectionGeneration: this.selectionGeneration, expiresAt: deadlineAt }
    if (this.turns.has(referenceId))
      throw new Error('memory.reference_reused')
    const selection = this.snapshot.selection
    const modelKey = JSON.stringify([input.providerId, input.model])
    if (!selection || selection.cardId !== input.cardId || selection.airiSessionId !== input.sessionId || selection.modelKey !== modelKey) {
      this.selectionGeneration += 1
      await bridge.selectCard(input.cardId, { airiSessionId: input.sessionId })
      this.snapshot.selection = { cardId: input.cardId, airiSessionId: input.sessionId, modelKey }
    }
    if (Date.now() >= deadlineAt || this.pendingCancels.delete(`${actor}:${referenceId}`))
      return { mode: 'blocked', reason: 'deadline_exceeded', ownerGeneration: this.generation, selectionGeneration: this.selectionGeneration, expiresAt: deadlineAt }
    const controller = new AbortController()
    const held: HeldTurn = {
      actor,
      generation: this.generation,
      selectionGeneration: this.selectionGeneration,
      input,
      controller,
      deadlineAt,
      expiresAt: Date.now() + 300000,
      firstSent: false,
      appIds: new Set(input.appInstructionIds),
    }
    this.turns.set(referenceId, held)
    for (const id of input.appInstructionIds)
      this.appInstructionIds.add(id)
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadlineAt - Date.now()))
    const started = performance.now()
    try {
      const result = await bridge.prepareRequestContext({
        airiSessionId: input.sessionId,
        userMessageId: input.userMessageId,
        attemptId: input.attemptId,
        conversation: input.conversation,
        inputKind: input.inputKind,
        modelKey,
        signal: controller.signal,
      })
      if (controller.signal.aborted || !this.current(held)) {
        if ('turn' in result)
          await bridge.cancelTurn(result.turn)
        return { mode: 'blocked', reason: 'deadline_exceeded', ownerGeneration: held.generation, selectionGeneration: held.selectionGeneration, expiresAt: deadlineAt }
      }
      this.snapshot.metrics.memory_total_ms = performance.now() - started
      if (result.mode === 'blocked') {
        this.turns.delete(referenceId)
        return { mode: result.mode, reason: result.reason, ownerGeneration: held.generation, selectionGeneration: held.selectionGeneration, expiresAt: deadlineAt }
      }
      if ('turn' in result) {
        held.turn = result.turn
        const deadlines = result.turn.deadlines
        if (!result.turn.tracked || deadlines.executionExpiresAt === null) {
          await bridge.cancelTurn(result.turn)
          this.retire(referenceId, held)
          return { mode: 'blocked', reason: 'output_untracked', ownerGeneration: held.generation, selectionGeneration: held.selectionGeneration, expiresAt: deadlineAt }
        }
        held.deadlineAt = Math.min(deadlineAt, deadlines.sendBefore ?? deadlineAt)
        held.expiresAt = Math.min(deadlines.executionExpiresAt, deadlines.contextExpiresAt ?? Infinity)
        held.expiryTimer = setTimeout(() => {
          if (this.turns.get(referenceId) !== held)
            return
          held.controller.abort()
          void bridge.cancelTurn(result.turn).catch(async () => {
            this.suspended = true
            await this.publish()
          })
        }, Math.max(1, held.expiresAt - Date.now()))
        await this.options.rememberPrivateSession(input.sessionId)
        this.usedSessions.add(input.sessionId)
      }
      return {
        mode: result.mode,
        conversation: result.conversation as Conversation,
        referenceId,
        ownerGeneration: held.generation,
        selectionGeneration: held.selectionGeneration,
        expiresAt: held.expiresAt,
      }
    }
    finally {
      clearTimeout(timer)
      await this.publish()
    }
  }

  private readonly usedSessions = new Set<string>()

  private current(held: HeldTurn): boolean {
    return !this.suspended && held.generation === this.generation && held.selectionGeneration === this.selectionGeneration
      && !held.controller.signal.aborted && Date.now() < held.expiresAt && (held.turn?.isCurrent() ?? true)
  }

  async gate(actor: string, referenceId: string, kind: 'initial' | 'continuation' | 'retry'): Promise<{ allow: boolean }> {
    const held = this.turns.get(referenceId)
    if (!held || held.actor !== actor || !this.current(held) || (!held.firstSent && Date.now() >= held.deadlineAt))
      return { allow: false }
    if (!held.turn || !this.bridge)
      return { allow: false }
    const result = await this.bridge.beforeProviderRequest(held.turn, kind, held.controller.signal)
    if (result.allow && this.current(held)) {
      held.firstSent = true
      return { allow: true }
    }
    return { allow: false }
  }

  async cancel(actor: string, referenceId: string): Promise<void> {
    const held = this.turns.get(referenceId)
    if (!held) {
      if (this.pendingCancels.size >= 128)
        this.pendingCancels.delete(this.pendingCancels.values().next().value ?? '')
      this.pendingCancels.add(`${actor}:${referenceId}`)
      return
    }
    if (held.actor !== actor)
      return
    held.controller.abort()
    if (held.turn && this.bridge)
      await this.bridge.cancelTurn(held.turn)
  }

  async report(actor: string, referenceId: string, report: MemoryDeliveryReport): Promise<void> {
    const held = this.turns.get(referenceId)
    if (!held || (held.actor !== actor && this.speechHost?.actor !== actor)
      || held.generation !== this.generation || held.selectionGeneration !== this.selectionGeneration) {
      return
    }
    if (report.kind === 'speech-input') {
      if (actor !== held.actor || !this.current(held) || !this.speechHost)
        throw new Error('memory.owner_lost')
      const input: MemorySpeechInput = { referenceId, turnId: held.input.userMessageId, type: report.type }
      if (report.text !== undefined)
        input.text = report.text
      const accepted = await this.speechHost.feed(input).catch(() => false)
      if (!accepted)
        throw new Error('memory.speech_host_unavailable')
      return
    }
    const turn = held.turn
    const delivery = turn?.delivery
    if (!turn || !delivery)
      return
    switch (report.kind) {
      case 'progress': turn.recordProgress(report.text)
        break
      case 'llm-finished':
        held.assistantMessageId = report.assistantMessageId
        if (report.outcome === 'completed') {
          delivery.llmFinished(report.outcome, report.text, report.assistantMessageId)
          // An absent chat surface cannot keep an otherwise finished delivery open forever.
          held.displayTimer = setTimeout(() => {
            if (this.turns.get(referenceId) !== held)
              return
            delivery.displayUnavailable()
            void this.finishDelivery(referenceId, held, turn)
          }, 1500)
        }
        else if (report.outcome === 'failed') {
          turn.recordProgress(report.text)
          const stopped = await this.requestStop('speech', { airiSessionId: held.input.sessionId, userMessageId: held.input.userMessageId, attemptId: held.input.attemptId })
          if (!stopped)
            throw new Error('memory.stop_unconfirmed')
          delivery.abort('failed', report.text)
        }
        else {
          turn.recordProgress(report.text)
          await this.bridge?.cancelTurn(turn)
        }
        if (this.pendingDisplays.delete(report.assistantMessageId))
          delivery.displayed()
        break
      case 'displayed': delivery.displayed()
        break
      case 'display-unavailable': delivery.displayUnavailable()
        break
      case 'speech-complete': delivery.speechRequestsComplete()
        break
      case 'audio-unavailable': delivery.audioUnavailable(report.reason)
        break
      case 'intent-end': delivery.intentEnd(report.intentId)
        break
      case 'intent-interrupted': delivery.intentInterrupted(report.intentId)
        break
      case 'tts-request': delivery.ttsRequest(report.key, report.text)
        break
      case 'tts-result': delivery.ttsResult(report.key, report.elapsedMs)
        break
      case 'playback-start': delivery.playbackStart(report.key)
        break
      case 'playback-end': delivery.playbackEnd(report.key)
        break
      case 'playback-interrupt': delivery.playbackInterrupt(report.key)
        break
      case 'playback-fail': delivery.playbackFail(report.key)
        break
    }
    await this.finishDelivery(referenceId, held, turn)
  }

  private async finishDelivery(referenceId: string, held: HeldTurn, turn: TurnHandle): Promise<void> {
    try {
      await turn.flushLocalWrites()
      if (turn.delivery?.settled) {
        this.bridge?.releaseTurn(turn)
        this.retire(referenceId, held)
      }
      await this.publish()
    }
    catch {
      this.suspended = true
      held.controller.abort()
      await this.publish()
    }
  }

  private retire(referenceId: string, held: HeldTurn): void {
    clearTimeout(held.expiryTimer)
    clearTimeout(held.displayTimer)
    for (const id of held.appIds)
      this.appInstructionIds.delete(id)
    this.turns.delete(referenceId)
  }

  async displayed(assistantMessageId: string): Promise<void> {
    const entry = [...this.turns].find(([, item]) => item.assistantMessageId === assistantMessageId)
    const turn = entry?.[1].turn
    if (entry && turn?.delivery) {
      const [id, held] = entry
      clearTimeout(held.displayTimer)
      turn.delivery.displayed()
      await this.finishDelivery(id, held, turn)
    }
    else {
      if (this.pendingDisplays.size >= 100)
        this.pendingDisplays.delete(this.pendingDisplays.values().next().value ?? '')
      this.pendingDisplays.add(assistantMessageId)
    }
  }

  async dispose(): Promise<void> {
    await this.stopConnection(true)
    this.listeners.clear()
  }
}
