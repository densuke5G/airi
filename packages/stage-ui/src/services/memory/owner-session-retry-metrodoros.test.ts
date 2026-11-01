import type { MemoryPrepareInput } from './contracts'

import { MemoryStorage } from '@metrodoros/airi-adapter'
import { describe, expect, it, vi } from 'vitest'

import { emptyMemorySnapshot } from './contracts'
import { MemoryOwner } from './owner'

const generation = '10000000-0000-4000-8000-000000000001'
const characterId = '20000000-0000-4000-8000-000000000002'
const worldId = '30000000-0000-4000-8000-000000000003'

function input(ids = ['first']): MemoryPrepareInput {
  return {
    conversation: { turns: ids.map(id => ({ type: 'user', id, content: [{ type: 'text', text: 'Connection test' }] })) },
    sessionId: 'fresh-session',
    userMessageId: ids.at(-1)!,
    attemptId: crypto.randomUUID(),
    deadlineAt: Date.now() + 1000,
    model: 'test-model',
    providerId: 'test-provider',
    cardId: 'test-card',
    inputKind: 'typed',
    appInstructionIds: [],
  }
}

async function fixture(privateSessions: string[] = [], rejectStorage = false) {
  const storage = new MemoryStorage()
  const remember = vi.fn(async (id: string) => {
    if (rejectStorage)
      throw new Error('Private filesystem details')
    privateSessions.push(id)
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (request) => {
    const url = new URL(String(request))
    if (url.pathname === '/v1/airi/connection')
      return Response.json({ user_id: generation, client_id: characterId, store_generation: generation })
    if (url.pathname === '/v1/airi/capabilities')
      return Response.json({ protocol_version: 1, conversation_profile: true, output_gate: true, change_notifications: true })
    if (url.pathname === '/v1/changes')
      return Response.json({ items: [], next_cursor: 'cursor', store_generation: generation, safety_epoch: 0, reset_required: !url.searchParams.has('after') })
    if (url.pathname === '/v1/changes/ack')
      return Response.json({ applied_sequence: 0, applied_safety_epoch: 0, reset_required: false })
    if (url.pathname === '/v1/worlds')
      return Response.json({ items: [{ world_id: worldId, name: null, realm: 'real', state: 'active' }], next_cursor: null })
    if (['/v1/characters', '/v1/jobs'].includes(url.pathname))
      return Response.json({ items: [], next_cursor: null })
    if (url.pathname === '/v1/sessions')
      return Response.json({ error: { code: 'FORBIDDEN', message: 'Private server details', retryable: false, request_id: crypto.randomUUID() } }, { status: 403 })
    throw new Error(`Unexpected endpoint: ${url.pathname}`)
  })
  const owner = new MemoryOwner({
    installationId: 'session-retry-test',
    loadProfile: async () => ({ ...emptyMemorySnapshot().profile, enabled: true, worldId, cardBindings: [{ cardId: 'test-card', characterId }] }),
    saveProfile: async () => {},
    loadPrivateSessions: async () => [...privateSessions],
    rememberPrivateSession: remember,
    storage: async () => storage,
    fetch,
  })
  await owner.registerHost('conversation', 'conversation', async () => true)
  await owner.registerHost('speech', 'speech', async () => true, async () => true)
  await owner.command({ kind: 'connect', token: 'synthetic-token' })
  return { owner, remember, fetch }
}

describe('fresh memory session failures', () => {
  // ROOT CAUSE:
  // Failed first attempts stayed unmarked. Their durable user messages made retries look like pre-existing ordinary history.
  it('keeps a failed first attempt private and retries without requiring another conversation', async () => {
    const { owner, remember } = await fixture()
    try {
      const first = input()
      await expect(owner.prepare('conversation', 'first-ref', first, first.deadlineAt)).resolves.toMatchObject({ mode: 'blocked', reason: 'forbidden' })
      expect(remember).toHaveBeenCalledExactlyOnceWith('fresh-session')
      const retry = input(['first', 'second'])
      await expect(owner.prepare('conversation', 'retry-ref', retry, retry.deadlineAt)).resolves.toMatchObject({ mode: 'blocked', reason: 'forbidden' })
      expect(remember).toHaveBeenCalledTimes(1)
    }
    finally {
      await owner.dispose()
    }
  })

  it('rejects unmarked existing history before creating a memory session', async () => {
    const { owner, remember, fetch } = await fixture()
    try {
      const history = input(['old', 'new'])
      await expect(owner.prepare('conversation', 'old-ref', history, history.deadlineAt)).resolves.toMatchObject({ mode: 'blocked', reason: 'new_session_required' })
      expect(remember).not.toHaveBeenCalled()
      expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === '/v1/sessions')).toBe(false)
    }
    finally {
      await owner.dispose()
    }
  })

  it('restores the failed-attempt marker after restart and blocks ordinary-history fallback', async () => {
    const sessions: string[] = []
    const first = await fixture(sessions)
    try {
      const request = input()
      await first.owner.prepare('conversation', 'first-ref', request, request.deadlineAt).catch(() => undefined)
    }
    finally {
      await first.owner.dispose()
    }
    const restarted = await fixture(sessions)
    try {
      const retry = input(['first', 'second'])
      await expect(restarted.owner.prepare('conversation', 'restart-ref', retry, retry.deadlineAt)).resolves.toMatchObject({ mode: 'blocked', reason: 'forbidden' })
      await restarted.owner.command({ kind: 'save', profile: emptyMemorySnapshot().profile })
      await expect(restarted.owner.prepare('conversation', 'disabled-ref', retry, Date.now() + 1000)).resolves.toMatchObject({ mode: 'blocked', reason: 'new_session_required' })
    }
    finally {
      await restarted.owner.dispose()
    }
  })

  it('blocks before server session creation when the private marker cannot be saved', async () => {
    const { owner, fetch } = await fixture([], true)
    try {
      const request = input()
      await expect(owner.prepare('conversation', 'storage-ref', request, request.deadlineAt)).resolves.toMatchObject({ mode: 'blocked', reason: 'session_storage_failed' })
      expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === '/v1/sessions')).toBe(false)
    }
    finally {
      await owner.dispose()
    }
  })

  it('preserves the world realm and unnamed default in the IPC snapshot', async () => {
    const { owner } = await fixture()
    try {
      expect((await owner.command({ kind: 'snapshot' })).worlds).toEqual([{ id: worldId, name: null, realm: 'real' }])
    }
    finally {
      await owner.dispose()
    }
  })
})
