import type { RecallPacket } from '@metrodoros/contracts'

import { MemoryStorage } from '@metrodoros/airi-adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyMemorySnapshot } from './contracts'
import { MemoryOwner } from './owner'

const generation = '10000000-0000-4000-8000-000000000001'
const characterId = '20000000-0000-4000-8000-000000000002'
const worldId = '30000000-0000-4000-8000-000000000003'
const scopeId = '40000000-0000-4000-8000-000000000004'
const owners: MemoryOwner[] = []

afterEach(async () => {
  for (const owner of owners.splice(0))
    await owner.dispose()
  vi.useRealTimers()
})

async function fixture() {
  vi.useFakeTimers()
  const storage = new MemoryStorage()
  const control = { conflicts: 1, persona: 'Confirmed persona', nextPersona: 'Confirmed persona', expire: false, cancel: false, persistenceMs: 0 }
  const recalls: Record<string, unknown>[] = []
  const registrations: Record<string, unknown>[] = []
  const scope = { scope_id: scopeId, revision: 1, forget_epoch: 0, access_revision: 0 }
  let owner: MemoryOwner
  const fetch = vi.fn<typeof globalThis.fetch>(async (request, options) => {
    const route = new URL(String(request)).pathname
    const body = options?.body ? JSON.parse(String(options.body)) : null
    if (route === '/v1/airi/connection')
      return Response.json({ user_id: generation, client_id: characterId, store_generation: generation })
    if (route === '/v1/airi/capabilities')
      return Response.json({ protocol_version: 1, conversation_profile: true, output_gate: true, change_notifications: true })
    if (route === '/v1/changes')
      return Response.json({ items: [], next_cursor: 'cursor', store_generation: generation, safety_epoch: 0, reset_required: !new URL(String(request)).searchParams.has('after') })
    if (route === '/v1/changes/ack')
      return Response.json({ applied_sequence: 0, applied_safety_epoch: 0, reset_required: false })
    if (['/v1/characters', '/v1/worlds', '/v1/jobs'].includes(route))
      return Response.json({ items: [], next_cursor: null })
    if (route === '/v1/sessions')
      return Response.json({ session_id: worldId, scope_id: scopeId, revision: 1, server_time: new Date().toISOString(), store_generation: generation })
    if (route.endsWith('/close'))
      return Response.json({ session_id: worldId, status: 'closed', closing_event_seq: 20 })
    if (route === '/v1/events')
      return Response.json({ source_id: crypto.randomUUID(), disposition: 'applied', operation_id: crypto.randomUUID(), scope_versions: [] })
    if (route === '/v1/recall') {
      recalls.push(body)
      const packet: RecallPacket = {
        packet_id: crypto.randomUUID(),
        turn_id: body.turn_id,
        session_id: body.session_id,
        character_id: characterId,
        world_id: worldId,
        store_generation: generation,
        profile_revision: 1,
        scope_versions: [scope],
        safety_epoch: 0,
        persona: { text: control.persona, truncated: false },
        context_items: [],
        short_term: { session_id: worldId, history_mode: 'client', raw_turns: [], summary: null, working_state: { mode: 'unknown', task_text: null }, observations: [], excluded_source_ids: [], store_generation: generation, scope_versions: [], valid_until: new Date(Date.now() + 60000).toISOString(), degraded_reasons: [] },
        valid_until: new Date(Date.now() + 60000).toISOString(),
        excluded_source_ids: [],
        degraded_reasons: [],
        search_limited: false,
        persona_truncated: false,
        context_ticket: `ticket-${recalls.length}`,
      }
      return Response.json(packet)
    }
    if (route === '/v1/outputs') {
      registrations.push(body)
      if (control.conflicts-- > 0) {
        control.persona = control.nextPersona
        if (control.expire)
          vi.setSystemTime(Date.now() + 1001)
        if (control.cancel)
          await owner.cancel('conversation', 'ref')
        return Response.json({ error: { code: 'CONTEXT_INVALIDATED', message: 'Synthetic registration conflict', retryable: false, request_id: crypto.randomUUID() } }, { status: 409 })
      }
      return Response.json({ output_id: body.output_id, state: 'registered', revision: 1, profile_revision: 1, safety_epoch: 0, scope_versions: [scope], send_before: Date.now() + 5000, execution_expires_at: Date.now() + 60000, context_expires_at: null })
    }
    if (route.endsWith('/validate'))
      return Response.json({ valid: true, excluded_source_ids: [], reason_codes: [] })
    if (route.endsWith('/state'))
      return Response.json({ output_id: body.output_id, state: body.state, revision: 2 })
    throw new Error(`Unexpected fixture route: ${route}`)
  })
  owner = new MemoryOwner({
    installationId: 'persona-retry-test',
    loadProfile: async () => ({ ...emptyMemorySnapshot().profile, enabled: true, worldId, cardBindings: [{ cardId: 'test-card', characterId }] }),
    saveProfile: async () => {},
    loadPrivateSessions: async () => [],
    rememberPrivateSession: async () => {
      if (control.persistenceMs)
        await new Promise(resolve => setTimeout(resolve, control.persistenceMs))
    },
    storage: async () => storage,
    fetch,
  })
  owners.push(owner)
  await owner.registerHost('conversation', 'conversation', async () => true)
  await owner.registerHost('speech', 'speech', async () => true, async () => true)
  await owner.command({ kind: 'connect', token: 'synthetic-token' })
  const prepare = (budgetMs = 1000) => {
    const deadlineAt = Date.now() + budgetMs
    return owner.prepare('conversation', 'ref', { conversation: { turns: [{ type: 'user', id: 'user', content: [{ type: 'text', text: 'Synthetic input' }] }] }, sessionId: 'airi-session', userMessageId: 'user', attemptId: 'attempt', deadlineAt, model: 'model', providerId: 'provider', cardId: 'test-card', inputKind: 'typed', appInstructionIds: [] }, deadlineAt)
  }
  return { owner, control, recalls, registrations, fetch, prepare }
}

describe('persona confirmation after a registration conflict', () => {
  // ROOT CAUSE:
  // A content revision can reject output registration after recall. The SDK then reports persona_unconfirmed without a current cache.
  it('takes a fresh context within the same deadline and keeps one input and output identity', async () => {
    const r = await fixture()
    const result = await r.prepare()
    expect(result.mode).toBe('memory')
    expect(r.recalls).toHaveLength(2)
    expect(r.registrations).toHaveLength(2)
    expect(r.registrations[0].output_id).toBe(r.registrations[1].output_id)
    expect(r.registrations[0].context_ticket).not.toBe(r.registrations[1].context_ticket)
    expect(r.recalls[0].input_event_id).toBe(r.recalls[1].input_event_id)
    expect((await r.owner.gate('conversation', 'ref', 'initial')).allow).toBe(true)
    const events = r.fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v1/events')
      .map(([, options]) => JSON.parse(String(options?.body)))
      .filter(event => event.event_type === 'user_input')
    expect(new Set(events.map(event => event.event_id)).size).toBe(1)
  })

  it('uses the newly confirmed persona rather than the rejected packet', async () => {
    const r = await fixture()
    r.control.persona = 'Old persona'
    r.control.nextPersona = 'Updated persona'
    const result = await r.prepare()
    expect(result.mode).toBe('memory')
    expect(JSON.stringify(result.conversation)).toContain('Updated persona')
    expect(JSON.stringify(result.conversation)).not.toContain('Old persona')
  })

  it('stops after one retry when registration keeps failing', async () => {
    const r = await fixture()
    r.control.conflicts = 10
    expect((await r.prepare()).mode).toBe('blocked')
    expect(r.registrations).toHaveLength(2)
    expect((await r.owner.gate('conversation', 'ref', 'initial')).allow).toBe(false)
  })

  it('never substitutes an AIRI persona when the server persona is empty', async () => {
    const r = await fixture()
    r.control.persona = ''
    expect(await r.prepare()).toMatchObject({ mode: 'blocked', reason: 'persona_unconfirmed' })
    expect(r.registrations).toHaveLength(0)
    expect((await r.owner.gate('conversation', 'ref', 'initial')).allow).toBe(false)
  })

  it('does not reset the original deadline to obtain another context', async () => {
    const r = await fixture()
    r.control.expire = true
    expect((await r.prepare()).mode).toBe('blocked')
    expect(r.recalls).toHaveLength(1)
    expect((await r.owner.gate('conversation', 'ref', 'initial')).allow).toBe(false)
  })

  it('does not retry after the user cancels the turn', async () => {
    const r = await fixture()
    r.control.cancel = true
    expect((await r.prepare()).mode).toBe('blocked')
    expect(r.recalls).toHaveLength(1)
    expect((await r.owner.gate('conversation', 'ref', 'initial')).allow).toBe(false)
  })
})

describe('host preparation budget', () => {
  it.each([{ sendDelayMs: 0, allow: true }, { sendDelayMs: 3800, allow: false }])('keeps the original send deadline after slow privacy storage: $sendDelayMs ms', async ({ sendDelayMs, allow }) => {
    const r = await fixture()
    r.control.conflicts = 0
    r.control.persistenceMs = 1200
    const result = r.prepare(5000)
    await vi.advanceTimersByTimeAsync(1200)
    expect((await result).mode).toBe('memory')
    expect(r.recalls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(sendDelayMs)
    expect((await r.owner.gate('conversation', 'ref', 'initial')).allow).toBe(allow)
  })

  it('rejects host deadlines beyond the bounded preparation budget', async () => {
    const r = await fixture()
    await expect(r.prepare(5001)).rejects.toThrow('memory.deadline_exceeded')
    expect(r.recalls).toHaveLength(0)
  })
})
