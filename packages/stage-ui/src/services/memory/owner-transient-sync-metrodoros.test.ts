import type { AckChangesInput } from '@metrodoros/client'

import { MemoryStorage } from '@metrodoros/airi-adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyMemorySnapshot } from './contracts'
import { MemoryOwner } from './owner'

const generation = '10000000-0000-4000-8000-000000000001'
const otherGeneration = '10000000-0000-4000-8000-000000000002'
const owners: MemoryOwner[] = []

afterEach(async () => {
  for (const owner of owners.splice(0))
    await owner.dispose()
  vi.useRealTimers()
})

async function fixture() {
  vi.useFakeTimers()
  const storage = new MemoryStorage()
  const control = {
    failure: null as { status: number, code: string } | 'network' | null,
    generation,
    cursor: 'cursor-1',
    stopConfirmed: true,
    pendingPoll: null as Promise<Response> | null,
    invalidateAck: false,
    safetyEpoch: 0,
  }
  const requests: { route: string, at: number }[] = []
  const acknowledgments: AckChangesInput[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, options) => {
    const url = new URL(String(input))
    requests.push({ route: url.pathname, at: Date.now() })
    if (url.pathname === '/v1/changes') {
      if (control.pendingPoll) {
        const pending = control.pendingPoll
        control.pendingPoll = null
        return pending
      }
      if (control.failure === 'network')
        throw new TypeError('Network unavailable')
      if (control.failure)
        return Response.json({ error: { code: control.failure.code, message: 'Synthetic failure', retryable: control.failure.status >= 500 || control.failure.status === 429, request_id: crypto.randomUUID() } }, { status: control.failure.status })
      return Response.json({ items: [], next_cursor: control.cursor, store_generation: control.generation, safety_epoch: control.safetyEpoch, reset_required: !url.searchParams.has('after') || control.generation !== generation || control.safetyEpoch > 0 })
    }
    if (url.pathname === '/v1/changes/ack') {
      acknowledgments.push(JSON.parse(String(options?.body)) as AckChangesInput)
      if (control.invalidateAck) {
        control.invalidateAck = false
        control.safetyEpoch = 1
        control.cursor = 'cursor-after-forget'
        return Response.json({ error: { code: 'CONTEXT_INVALIDATED', message: 'Synthetic epoch race', retryable: false, request_id: crypto.randomUUID() } }, { status: 409 })
      }
      return Response.json({ applied_sequence: 0, applied_safety_epoch: control.safetyEpoch, reset_required: false })
    }
    if (url.pathname === '/v1/airi/connection')
      return Response.json({ user_id: generation, client_id: '20000000-0000-4000-8000-000000000002', store_generation: generation })
    if (url.pathname === '/v1/airi/capabilities')
      return Response.json({ protocol_version: 1, conversation_profile: true, output_gate: true, change_notifications: true })
    if (['/v1/characters', '/v1/worlds', '/v1/jobs'].includes(url.pathname))
      return Response.json({ items: [], next_cursor: null })
    throw new Error(`Unexpected endpoint: ${url.pathname}`)
  })
  const owner = new MemoryOwner({
    installationId: 'transient-sync-test',
    loadProfile: async () => ({ ...emptyMemorySnapshot().profile, enabled: true }),
    saveProfile: async () => {},
    loadPrivateSessions: async () => [],
    rememberPrivateSession: async () => {},
    storage: async () => storage,
    fetch,
  })
  owners.push(owner)
  await owner.registerHost('conversation', 'conversation', async () => control.stopConfirmed)
  await owner.registerHost('speech', 'speech', async () => control.stopConfirmed, async () => true)
  expect((await owner.command({ kind: 'connect', token: 'synthetic-token' })).connected).toBe(true)
  return { owner, control, requests, storage, acknowledgments }
}

describe('notification failures during an established conversation', () => {
  // ROOT CAUSE:
  // One transient poll failure aborted both background loops permanently. Retry the same authenticated bridge after confirmed output stop.
  it.each([
    { status: 429, code: 'RATE_LIMITED' },
    { status: 503, code: 'NOT_READY' },
    { status: 504, code: 'DEADLINE_EXCEEDED' },
  ])('resynchronizes after $status without refresh, a new conversation, or another login', async (failure) => {
    const { owner, control, storage, requests } = await fixture()
    control.failure = failure
    await vi.advanceTimersByTimeAsync(500)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    control.failure = null
    control.cursor = 'cursor-2'
    await vi.advanceTimersByTimeAsync(1500)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(true)
    expect((await storage.read()).checkpoint?.cursor).toBe('cursor-2')
    expect(requests.filter(request => request.route === '/v1/airi/connection')).toHaveLength(1)
    control.cursor = 'cursor-3'
    await vi.advanceTimersByTimeAsync(500)
    expect((await storage.read()).checkpoint?.cursor).toBe('cursor-3')
  })

  it('recovers from a temporary network exception', async () => {
    const { owner, control } = await fixture()
    control.failure = 'network'
    await vi.advanceTimersByTimeAsync(500)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    control.failure = null
    await vi.advanceTimersByTimeAsync(1500)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(true)
  })

  it('backs off repeated failures instead of polling the unavailable service twice per second', async () => {
    const { owner, control, requests } = await fixture()
    const count = requests.length
    control.failure = { status: 504, code: 'DEADLINE_EXCEEDED' }
    await vi.advanceTimersByTimeAsync(5000)
    const failures = requests.slice(count).filter(request => request.route === '/v1/changes')
    expect(failures.length).toBeGreaterThan(1)
    expect(failures.length).toBeLessThanOrEqual(4)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    control.failure = null
    await vi.advanceTimersByTimeAsync(10000)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(true)
  })

  it.each([
    { status: 401, code: 'UNAUTHENTICATED' },
    { status: 403, code: 'FORBIDDEN' },
    { status: 422, code: 'VALIDATION_FAILED' },
    { status: 409, code: 'IDEMPOTENCY_CONFLICT' },
  ])('requires explicit recovery after a permanent $status failure', async (failure) => {
    const { owner, control, requests } = await fixture()
    control.failure = failure
    await vi.advanceTimersByTimeAsync(500)
    const count = requests.length
    control.failure = null
    await vi.advanceTimersByTimeAsync(20000)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    expect(requests).toHaveLength(count)
  })

  it('does not reconnect to a changed store generation', async () => {
    const { owner, control, requests, storage } = await fixture()
    control.generation = otherGeneration
    control.cursor = 'other-store-cursor'
    await vi.advanceTimersByTimeAsync(500)
    const count = requests.length
    control.generation = generation
    await vi.advanceTimersByTimeAsync(20000)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    expect(requests).toHaveLength(count)
    expect((await storage.read()).checkpoint?.store_generation).toBe(generation)
  })

  it('applies a fresh forget reset after an acknowledgment races with a safety-epoch change', async () => {
    const { owner, control, storage, acknowledgments } = await fixture()
    control.cursor = 'cursor-before-forget'
    control.invalidateAck = true
    await vi.advanceTimersByTimeAsync(500)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    expect((await storage.read()).checkpoint?.safety_epoch).toBe(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(true)
    expect((await storage.read()).checkpoint?.safety_epoch).toBe(1)
    expect(acknowledgments.at(-1)?.safety_epoch).toBe(1)
    expect(acknowledgments.at(-1)?.reset_applied).toBe(true)
  })

  it('cancels a pending recovery when the user disconnects', async () => {
    const { owner, control, requests } = await fixture()
    control.failure = 'network'
    await vi.advanceTimersByTimeAsync(500)
    await owner.command({ kind: 'disconnect' })
    const count = requests.length
    control.failure = null
    await vi.advanceTimersByTimeAsync(20000)
    const snapshot = await owner.command({ kind: 'snapshot' })
    expect(snapshot.connected).toBe(false)
    expect(snapshot.tokenRequired).toBe(true)
    expect(requests).toHaveLength(count)
  })

  it('stays suspended when speech or generation stop cannot be confirmed', async () => {
    const { owner, control, requests } = await fixture()
    control.stopConfirmed = false
    control.failure = 'network'
    await vi.advanceTimersByTimeAsync(500)
    const count = requests.length
    control.stopConfirmed = true
    control.failure = null
    await vi.advanceTimersByTimeAsync(20000)
    const snapshot = await owner.command({ kind: 'snapshot' })
    expect(snapshot.connected).toBe(false)
    expect(snapshot.reason).toBe('stop_unconfirmed')
    expect(requests).toHaveLength(count)
  })

  it('ignores a late failed poll from the previous authenticated bridge after manual reconnect', async () => {
    const { owner, control, requests } = await fixture()
    const pending = Promise.withResolvers<Response>()
    control.pendingPoll = pending.promise
    await vi.advanceTimersByTimeAsync(500)
    expect((await owner.command({ kind: 'connect', token: 'synthetic-replacement-token' })).connected).toBe(true)
    pending.reject(new TypeError('Late network failure'))
    await vi.advanceTimersByTimeAsync(10000)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(true)
    expect(requests.filter(request => request.route === '/v1/airi/connection')).toHaveLength(2)
  })

  it('keeps a disconnected owner stopped when an in-flight poll completes later', async () => {
    const { owner, control, requests } = await fixture()
    const pending = Promise.withResolvers<Response>()
    control.pendingPoll = pending.promise
    await vi.advanceTimersByTimeAsync(500)
    await owner.command({ kind: 'disconnect' })
    const count = requests.length
    pending.reject(new TypeError('Late network failure'))
    await vi.advanceTimersByTimeAsync(10000)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    expect(requests).toHaveLength(count)
  })
})
