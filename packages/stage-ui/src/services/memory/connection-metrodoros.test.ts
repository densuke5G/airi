import type { MemoryTransport } from './connection'
import type { MemoryPrepared, MemoryPrepareInput } from './contracts'

import { describe, expect, it, vi } from 'vitest'

import { MemoryConnectionClient } from './connection'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function input(overrides: Partial<MemoryPrepareInput> = {}): MemoryPrepareInput {
  return {
    conversation: { turns: [] },
    sessionId: 'session-a',
    userMessageId: 'user-a',
    attemptId: 'attempt-a',
    deadlineAt: Date.now() + 500,
    model: 'model-a',
    providerId: 'provider-a',
    cardId: 'card-a',
    inputKind: 'typed',
    appInstructionIds: [],
    ...overrides,
  }
}

function prepared(overrides: Partial<MemoryPrepared> = {}): MemoryPrepared {
  return {
    mode: 'memory',
    conversation: { turns: [] },
    ownerGeneration: 1,
    selectionGeneration: 1,
    expiresAt: Date.now() + 5000,
    ...overrides,
  }
}

function transport(overrides: Partial<MemoryTransport> = {}): MemoryTransport {
  return {
    command: vi.fn(async () => { throw new Error('unused') }),
    prepare: vi.fn(async () => prepared()),
    gate: vi.fn(async () => ({ allow: true })),
    cancel: vi.fn(async () => {}),
    report: vi.fn(async () => {}),
    displayed: vi.fn(async () => {}),
    registerHost: vi.fn(async () => async () => {}),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }
}

describe('memoryConnectionClient acceptance', () => {
  it('cancels an ignored-abort prepare and discards its late success', async () => {
    const pending = deferred<MemoryPrepared>()
    const wire = transport({ prepare: vi.fn(() => pending.promise) })
    const client = new MemoryConnectionClient(wire)
    const controller = new AbortController()
    const result = client.prepare(input(), controller.signal)
    const referenceId = vi.mocked(wire.prepare).mock.calls[0]![0]
    controller.abort()
    await expect(result).rejects.toThrow('memory.prepare_cancelled')
    expect(wire.cancel).toHaveBeenCalledWith(referenceId)
    pending.resolve(prepared({ referenceId }))
    await Promise.resolve()
    expect(wire.report).not.toHaveBeenCalled()
  })

  it('keeps all dedicated speech input reports on one opaque reference', async () => {
    const wire = transport()
    const client = new MemoryConnectionClient(wire)
    const context = await client.prepare(input(), new AbortController().signal)
    const referenceId = vi.mocked(wire.prepare).mock.calls[0]![0]
    expect(referenceId).toMatch(/^[0-9a-f-]{36}$/i)
    await context.onOutputStart?.()
    await context.onLiteral?.('literal words')
    await context.onSpecial?.('special words')
    await context.onInputEnd?.()
    expect(wire.report).toHaveBeenNthCalledWith(1, referenceId, { kind: 'speech-input', type: 'start' })
    expect(wire.report).toHaveBeenNthCalledWith(2, referenceId, { kind: 'speech-input', type: 'literal', text: 'literal words' })
    expect(wire.report).toHaveBeenNthCalledWith(3, referenceId, { kind: 'speech-input', type: 'special', text: 'special words' })
    expect(wire.report).toHaveBeenNthCalledWith(4, referenceId, { kind: 'speech-input', type: 'end' })
  })

  it('aborts only the matching session, message, and attempt on host stop', async () => {
    const wire = transport()
    const client = new MemoryConnectionClient(wire)
    const first = await client.prepare(input(), new AbortController().signal)
    const second = await client.prepare(input({ sessionId: 'session-b', userMessageId: 'user-b', attemptId: 'attempt-b' }), new AbortController().signal)
    await client.registerConversationHost(async () => true)
    // Capture the callback passed to the transport: it performs reference cancellation before host stop.
    const registered = vi.mocked(wire.registerHost).mock.calls[0]![1]
    await registered({ kind: 'generation', sessionId: 'session-a', userMessageId: 'user-a', attemptId: 'attempt-a', referenceIds: [] })
    expect(first.signal?.aborted).toBe(true)
    expect(second.signal?.aborted).toBe(false)
  })

  it('retires a settled request so provider policy cannot send again', async () => {
    const wire = transport()
    const client = new MemoryConnectionClient(wire)
    const context = await client.prepare(input(), new AbortController().signal)
    await context.settled?.({ outcome: 'completed', text: 'done', assistantMessageId: 'assistant-a' })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(context.requestPolicy?.isCurrent()).toBe(false)
    expect(await context.requestPolicy?.beforeRequest('retry', new AbortController().signal)).toEqual({ allow: false })
    expect(wire.gate).not.toHaveBeenCalled()
  })

  it('revokes provider permission and cancels the reference when its renderer is disposed', async () => {
    const wire = transport()
    const client = new MemoryConnectionClient(wire)
    const context = await client.prepare(input(), new AbortController().signal)
    const referenceId = vi.mocked(wire.prepare).mock.calls[0]![0]
    expect(await context.requestPolicy?.beforeRequest('initial', new AbortController().signal)).toEqual({ allow: true })
    client.dispose()
    expect(context.signal?.aborted).toBe(true)
    expect(context.requestPolicy?.isCurrent()).toBe(false)
    expect(await context.requestPolicy?.beforeRequest('retry', new AbortController().signal)).toEqual({ allow: false })
    expect(wire.gate).toHaveBeenCalledTimes(1)
    expect(wire.cancel).toHaveBeenCalledWith(referenceId)
  })
})
