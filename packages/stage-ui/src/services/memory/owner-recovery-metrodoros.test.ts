import { MemoryStorage } from '@metrodoros/airi-adapter'
import { describe, expect, it, vi } from 'vitest'

import { emptyMemorySnapshot } from './contracts'
import { MemoryOwner } from './owner'

describe('memory owner notification recovery', () => {
  // ROOT CAUSE:
  // Failed notification tasks stayed aborted after refresh. Reconnect after confirmed stop restores both background tasks.
  it('reconnects after a notification failure and resumes background synchronization', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    let offline = false
    let cursor = 'cursor-1'
    const generation = '10000000-0000-4000-8000-000000000001'
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/v1/changes') {
        if (offline)
          throw new Error('Network unavailable')
        return Response.json({ items: [], next_cursor: cursor, store_generation: generation, safety_epoch: 0, reset_required: !url.searchParams.has('after') })
      }
      if (url.pathname === '/v1/changes/ack')
        return Response.json({ applied_sequence: 0, applied_safety_epoch: 0, reset_required: false })
      if (url.pathname === '/v1/airi/connection')
        return Response.json({ user_id: generation, client_id: '20000000-0000-4000-8000-000000000002', store_generation: generation })
      if (url.pathname === '/v1/airi/capabilities')
        return Response.json({ protocol_version: 1, conversation_profile: true, output_gate: true, change_notifications: true })
      if (['/v1/characters', '/v1/worlds', '/v1/jobs'].includes(url.pathname))
        return Response.json({ items: [], next_cursor: null })
      throw new Error(`Unexpected endpoint: ${url.pathname}`)
    })
    const owner = new MemoryOwner({
      installationId: 'recovery-test',
      loadProfile: async () => ({ ...emptyMemorySnapshot().profile, enabled: true }),
      saveProfile: async () => {},
      loadPrivateSessions: async () => [],
      rememberPrivateSession: async () => {},
      storage: async () => storage,
      fetch,
    })
    try {
      await owner.registerHost('conversation', 'conversation', async () => true)
      await owner.registerHost('speech', 'speech', async () => true, async () => true)
      expect((await owner.command({ kind: 'connect', token: 'test-token' })).connected).toBe(true)
      offline = true
      await vi.advanceTimersByTimeAsync(500)
      expect((await owner.command({ kind: 'snapshot' })).connected).toBe(false)
      offline = false
      cursor = 'cursor-2'
      expect((await owner.command({ kind: 'refresh' })).connected).toBe(true)
      expect((await storage.read()).checkpoint?.cursor).toBe('cursor-2')
      cursor = 'cursor-3'
      await vi.advanceTimersByTimeAsync(500)
      expect((await storage.read()).checkpoint?.cursor).toBe('cursor-3')
    }
    finally {
      await owner.dispose()
      vi.useRealTimers()
    }
  })
})
