import { hash53, MemoryStorage } from '@metrodoros/airi-adapter'
import { describe, expect, it, vi } from 'vitest'

import { emptyMemorySnapshot } from './contracts'
import { MemoryOwner } from './owner'

function setup(fetch: typeof globalThis.fetch, onManualConnection?: (credential: { installationId: string, endpoint: string, userId: string, clientId: string, storeGeneration: string, token: string }) => Promise<void>) {
  const storage = new MemoryStorage()
  const namespaces: string[] = []
  const owner = new MemoryOwner({
    installationId: 'desktop-test-installation',
    loadProfile: async () => ({ ...emptyMemorySnapshot().profile, enabled: true }),
    saveProfile: async () => {},
    loadPrivateSessions: async () => [],
    rememberPrivateSession: async () => {},
    storage: async (namespace) => {
      namespaces.push(namespace)
      return storage
    },
    onManualConnection,
    fetch,
  })
  return { owner, storage, namespaces }
}

function connectionFetch(generation = '10000000-0000-4000-8000-000000000001', onConnection?: () => void): typeof globalThis.fetch {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/v1/airi/connection') {
      onConnection?.()
      return Response.json({ user_id: generation, client_id: '20000000-0000-4000-8000-000000000002', store_generation: generation })
    }
    if (url.pathname === '/v1/airi/capabilities')
      return Response.json({ protocol_version: 1, conversation_profile: true, output_gate: true, change_notifications: true })
    if (url.pathname === '/v1/changes')
      return Response.json({ items: [], next_cursor: 'cursor-1', store_generation: generation, safety_epoch: 0, reset_required: true })
    if (url.pathname === '/v1/changes/ack')
      return Response.json({ applied_sequence: 0, applied_safety_epoch: 0, reset_required: false })
    if (['/v1/characters', '/v1/worlds', '/v1/jobs'].includes(url.pathname))
      return Response.json({ items: [], next_cursor: null })
    throw new Error(`Unexpected endpoint: ${url.pathname}`)
  })
}

describe('desktop credential connection boundary', () => {
  it('rejects a saved identity mismatch before local storage or bridge startup', async () => {
    const fetch = connectionFetch()
    const { owner, storage } = setup(fetch)
    await owner.registerHost('window', 'conversation', async () => true)
    await owner.registerHost('window', 'speech', async () => true, async () => true)

    await expect(owner.command({ kind: 'connect', token: 'stored-token' }, {
      expectedIdentity: {
        endpoint: 'http://127.0.0.1:47831',
        userId: '30000000-0000-4000-8000-000000000003',
        clientId: '20000000-0000-4000-8000-000000000002',
        storeGeneration: '10000000-0000-4000-8000-000000000001',
      },
    })).rejects.toThrow('memory.saved_identity_mismatch')

    expect((await storage.read()).checkpoint).toBeUndefined()
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    await owner.dispose()
  })

  it('rejects a connection whose startup generation became stale during authentication', async () => {
    let current = true
    const authenticatedFetch = connectionFetch()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const response = await authenticatedFetch(input, init)
      if (new URL(String(input)).pathname === '/v1/airi/capabilities')
        current = false
      return response
    })
    const { owner, storage, namespaces } = setup(fetch)
    await owner.registerHost('window', 'conversation', async () => true)
    await owner.registerHost('window', 'speech', async () => true, async () => true)
    await expect(owner.command({ kind: 'connect', token: 'stored-token' }, {
      expectedIdentity: {
        endpoint: 'http://127.0.0.1:47831',
        userId: '10000000-0000-4000-8000-000000000001',
        clientId: '20000000-0000-4000-8000-000000000002',
        storeGeneration: '10000000-0000-4000-8000-000000000001',
      },
      isCurrent: () => current,
    })).rejects.toThrow('memory.owner_lost')

    expect((await storage.read()).checkpoint).toBeUndefined()
    expect(namespaces).toHaveLength(0)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    await owner.dispose()
  })

  it('allows a fresh manual token after restore while isolating the new store generation', async () => {
    const clientId = '20000000-0000-4000-8000-000000000002'
    const userId = '30000000-0000-4000-8000-000000000003'
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/v1/airi/connection')
        return Response.json({ user_id: userId, client_id: clientId, store_generation: '40000000-0000-4000-8000-000000000004' })
      if (url.pathname === '/v1/airi/capabilities')
        return Response.json({ protocol_version: 1, conversation_profile: true, output_gate: true, change_notifications: true })
      if (url.pathname === '/v1/changes')
        return Response.json({ items: [], next_cursor: 'cursor-1', store_generation: '40000000-0000-4000-8000-000000000004', safety_epoch: 0, reset_required: true })
      if (url.pathname === '/v1/changes/ack')
        return Response.json({ applied_sequence: 0, applied_safety_epoch: 0, reset_required: false })
      if (['/v1/characters', '/v1/worlds', '/v1/jobs'].includes(url.pathname))
        return Response.json({ items: [], next_cursor: null })
      throw new Error(`Unexpected endpoint: ${url.pathname}`)
    })
    const { owner, storage, namespaces } = setup(fetch)
    await owner.registerHost('window', 'conversation', async () => true)
    await owner.registerHost('window', 'speech', async () => true, async () => true)

    await expect(owner.command({ kind: 'connect', token: 'old-saved-token' }, {
      expectedIdentity: {
        endpoint: 'http://127.0.0.1:47831',
        userId,
        clientId,
        storeGeneration: '10000000-0000-4000-8000-000000000001',
      },
    })).rejects.toThrow('memory.saved_identity_mismatch')

    expect(namespaces).toHaveLength(0)
    const result = await owner.command({ kind: 'connect', token: 'fresh-rotated-token' })

    expect(result.connected).toBe(true)
    expect(namespaces).toHaveLength(1)
    const newNamespace = hash53(JSON.stringify(['desktop-test-installation', 'http://127.0.0.1:47831', userId, clientId, '40000000-0000-4000-8000-000000000004']))
    const oldNamespace = hash53(JSON.stringify(['desktop-test-installation', 'http://127.0.0.1:47831', userId, clientId, '10000000-0000-4000-8000-000000000001']))
    expect(namespaces[0]).toBe(newNamespace)
    expect(namespaces[0]).not.toBe(oldNamespace)
    expect((await storage.read()).checkpoint?.store_generation).toBe('40000000-0000-4000-8000-000000000004')
    await owner.dispose()
  })

  it('offers the token to desktop storage only after manual authentication succeeds', async () => {
    const save = vi.fn(async () => {})
    const { owner } = setup(connectionFetch(), save)
    await owner.registerHost('window', 'conversation', async () => true)
    await owner.registerHost('window', 'speech', async () => true, async () => true)

    const result = await owner.command({ kind: 'connect', token: 'fresh-token' })

    expect(result.connected).toBe(true)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ token: 'fresh-token' }))
    expect(JSON.stringify(result)).not.toContain('fresh-token')
    await owner.dispose()
  })

  it('disconnects explicitly and clears the in-memory token without reconnecting', async () => {
    let connectionRequestCount = 0
    const fetch = connectionFetch(undefined, () => {
      connectionRequestCount += 1
    })
    const { owner } = setup(fetch)
    await owner.registerHost('window', 'conversation', async () => true)
    await owner.registerHost('window', 'speech', async () => true, async () => true)

    expect((await owner.command({ kind: 'connect', token: 'session-token' })).connected).toBe(true)
    const disconnected = await owner.command({ kind: 'disconnect' })

    expect(disconnected.connected).toBe(false)
    expect(disconnected.tokenRequired).toBe(true)
    expect(connectionRequestCount).toBe(1)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
    expect(connectionRequestCount).toBe(1)
    await owner.dispose()
  })

  it('keeps a successful connection when encrypted token storage fails', async () => {
    const save = vi.fn(async () => {
      throw new Error('credential storage unavailable')
    })
    const { owner } = setup(connectionFetch(), save)
    await owner.registerHost('window', 'conversation', async () => true)
    await owner.registerHost('window', 'speech', async () => true, async () => true)

    const result = await owner.command({ kind: 'connect', token: 'fresh-token' })

    expect(result.connected).toBe(true)
    expect((await owner.command({ kind: 'snapshot' })).connected).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    await owner.dispose()
  })
})
