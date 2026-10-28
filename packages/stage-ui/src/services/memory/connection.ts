import type { PreparedRequestContext } from '@proj-airi/core-agent'

import type { MemoryCommand, MemoryConnection, MemoryDeliveryReport, MemoryPrepared, MemoryPrepareInput, MemorySnapshot, MemorySpeechInput, MemoryStopRequest } from './contracts'

import { protectMemoryTraces } from './privacy'

/** The platform binds these operations to Eventa IPC or the local browser owner. */
export interface MemoryTransport {
  command: (command: MemoryCommand) => Promise<MemorySnapshot>
  prepare: (referenceId: string, input: MemoryPrepareInput, deadlineAt: number) => Promise<MemoryPrepared>
  gate: (referenceId: string, kind: 'initial' | 'continuation' | 'retry') => Promise<{ allow: boolean }>
  cancel: (referenceId: string) => Promise<void>
  report: (referenceId: string, report: MemoryDeliveryReport) => Promise<void>
  displayed: (assistantMessageId: string) => Promise<void>
  registerHost: (role: 'conversation' | 'speech', stop: (request: MemoryStopRequest) => Promise<boolean>, feed?: (input: MemorySpeechInput) => Promise<boolean>) => Promise<() => Promise<void>>
  subscribe: (listener: (snapshot: MemorySnapshot) => void) => () => void
}

/** Keeps abort signals local and forwards only opaque references across the transport. */
export class MemoryConnectionClient implements MemoryConnection {
  private readonly requests = new Map<string, { input: MemoryPrepareInput, controller: AbortController }>()

  constructor(private readonly transport: MemoryTransport) {}

  command(command: MemoryCommand): Promise<MemorySnapshot> { return this.transport.command(command) }
  report(referenceId: string, report: MemoryDeliveryReport): Promise<void> { return this.transport.report(referenceId, report) }
  displayed(assistantMessageId: string): Promise<void> { return this.transport.displayed(assistantMessageId) }
  subscribe(listener: (snapshot: MemorySnapshot) => void): () => void { return this.transport.subscribe(listener) }

  async prepare(input: MemoryPrepareInput, signal: AbortSignal): Promise<PreparedRequestContext> {
    signal.throwIfAborted()
    const referenceId = crypto.randomUUID()
    const controller = new AbortController()
    this.requests.set(referenceId, { input, controller })
    const combined = AbortSignal.any([signal, controller.signal])
    const cancel = () => {
      void this.transport.cancel(referenceId).catch(() => undefined)
    }
    combined.addEventListener('abort', cancel, { once: true })
    let onAbort: (() => void) | undefined
    const started = performance.now()
    try {
      const prepared = await Promise.race([
        this.transport.prepare(referenceId, input, input.deadlineAt),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error('memory.prepare_cancelled'))
          if (combined.aborted)
            onAbort()
          else
            combined.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      if (combined.aborted || performance.now() - started >= 1000) {
        controller.abort()
        throw new Error('memory.deadline_exceeded')
      }
      if (prepared.mode === 'blocked' || !prepared.conversation)
        throw new Error(`memory.${prepared.reason ?? 'blocked'}`)
      if (prepared.mode === 'disabled') {
        this.requests.delete(referenceId)
        combined.removeEventListener('abort', cancel)
        return { conversation: prepared.conversation }
      }
      protectMemoryTraces()
      return {
        conversation: prepared.conversation,
        contextId: referenceId,
        onOutputStart: () => this.transport.report(referenceId, { kind: 'speech-input', type: 'start' }),
        onLiteral: text => this.transport.report(referenceId, { kind: 'speech-input', type: 'literal', text }),
        onSpecial: text => this.transport.report(referenceId, { kind: 'speech-input', type: 'special', text }),
        onInputEnd: () => this.transport.report(referenceId, { kind: 'speech-input', type: 'end' }),
        privateContext: true,
        signal: combined,
        requestPolicy: {
          providerId: input.providerId,
          model: input.model,
          signal: combined,
          isCurrent: () => !combined.aborted && this.requests.has(referenceId),
          beforeRequest: async (kind, gateSignal) => {
            if (gateSignal.aborted || combined.aborted || !this.requests.has(referenceId))
              return { allow: false }
            const decision = await this.transport.gate(referenceId, kind)
            if (!decision.allow || gateSignal.aborted || combined.aborted || !this.requests.has(referenceId)) {
              controller.abort()
              return { allow: false }
            }
            return decision
          },
        },
        recordProgress: (text) => { void this.transport.report(referenceId, { kind: 'progress', text }).catch(() => controller.abort()) },
        settled: async (event) => {
          try {
            await this.transport.report(referenceId, { kind: 'llm-finished', ...event })
          }
          finally {
            combined.removeEventListener('abort', cancel)
            setTimeout(() => this.requests.delete(referenceId), 0)
          }
        },
      }
    }
    catch (error) {
      controller.abort()
      this.requests.delete(referenceId)
      throw error
    }
    finally {
      if (onAbort)
        combined.removeEventListener('abort', onAbort)
    }
  }

  registerConversationHost(stop: (request: MemoryStopRequest) => Promise<boolean>): Promise<() => Promise<void>> {
    return this.transport.registerHost('conversation', async (request) => {
      for (const [id, held] of this.requests) {
        if (request.referenceIds.includes(id)
          || (held.input.sessionId === request.sessionId
            && (!request.userMessageId || request.userMessageId === held.input.userMessageId)
            && (!request.attemptId || request.attemptId === held.input.attemptId))) {
          held.controller.abort()
        }
      }
      return stop(request)
    })
  }

  registerSpeechHost(stop: (request: MemoryStopRequest) => Promise<boolean>, feed: (input: MemorySpeechInput) => Promise<boolean>): Promise<() => Promise<void>> {
    return this.transport.registerHost('speech', stop, feed)
  }
}

let connection: MemoryConnection | undefined

/** Each application installs exactly one platform connection before mounting its stores. */
export function installMemoryConnection(value: MemoryConnection): void {
  if (connection && connection !== value)
    throw new Error('memory.connection_already_installed')
  connection = value
}

export function getMemoryConnection(): MemoryConnection {
  if (!connection)
    throw new Error('memory.connection_unavailable')
  return connection
}

/** Unsupported application targets keep ordinary chat without creating a memory bridge. */
export function getOptionalMemoryConnection(): MemoryConnection | undefined {
  return connection
}

/** Keep token arguments outside Pinia actions and their development tracing hooks. */
export function connectMemoryToken(token: string): Promise<MemorySnapshot> {
  return getMemoryConnection().command({ kind: 'connect', token })
}
