import type { MemoryPrepareInput, MemoryProfile } from './contracts'
import type { MemoryOwnerOptions } from './owner'

import { describe, expect, it, vi } from 'vitest'

import { emptyMemorySnapshot } from './contracts'
import { MemoryOwner } from './owner'

function profile(overrides: Partial<MemoryProfile> = {}): MemoryProfile {
  return { ...emptyMemorySnapshot().profile, ...overrides }
}

function options(overrides: Partial<MemoryOwnerOptions> = {}): MemoryOwnerOptions {
  return {
    installationId: 'test-install',
    loadProfile: async () => null,
    saveProfile: vi.fn(async () => {}),
    loadPrivateSessions: async () => [],
    rememberPrivateSession: vi.fn(async () => {}),
    storage: async () => { throw new Error('Storage must remain unused in disabled tests') },
    fetch: vi.fn<typeof globalThis.fetch>(async () => { throw new Error('Network must remain unused in disabled tests') }),
    ...overrides,
  }
}

function prepareInput(sessionId: string): MemoryPrepareInput {
  return {
    conversation: { turns: [] },
    sessionId,
    userMessageId: 'user-1',
    attemptId: 'attempt-1',
    deadlineAt: Date.now() + 500,
    model: 'model-a',
    providerId: 'provider-a',
    cardId: 'card-a',
    inputKind: 'typed',
    appInstructionIds: [],
  }
}

describe('memoryOwner acceptance', () => {
  it('rejects non-loopback saved endpoints and fails closed on invalid persisted settings', async () => {
    const saveProfile = vi.fn(async () => {})
    const owner = new MemoryOwner(options({
      loadProfile: async () => profile({ endpoint: 'https://memory.example' }),
      saveProfile,
    }))
    const snapshot = await owner.command({ kind: 'snapshot' })
    expect(snapshot.state).toBe('blocked')
    expect(snapshot.reason).toBe('saved_settings_invalid')
    await expect(owner.command({ kind: 'save', profile: profile({ endpoint: 'https://memory.example' }) }))
      .rejects
      .toThrow('memory.saved_settings_invalid')
    expect(saveProfile).not.toHaveBeenCalled()
    const result = await owner.prepare('conversation-host', 'ref', prepareInput('new-session'), Date.now() + 500)
    expect(result).toMatchObject({ mode: 'blocked', reason: 'saved_settings_invalid' })
    await owner.dispose()
  })

  it('rejects a non-loopback endpoint before saving it', async () => {
    const saveProfile = vi.fn(async () => {})
    const owner = new MemoryOwner(options({ saveProfile }))
    await expect(owner.command({ kind: 'save', profile: profile({ endpoint: 'https://memory.example' }) }))
      .rejects
      .toThrow('memory.loopback_required')
    expect(saveProfile).not.toHaveBeenCalled()
    await owner.dispose()
  })

  it('keeps connect tokens out of snapshots and persisted profile serialization', async () => {
    let persisted: MemoryProfile | undefined
    const owner = new MemoryOwner(options({
      saveProfile: vi.fn(async (value) => { persisted = structuredClone(value) }),
    }))
    const token = 'sensitive-token-value'
    const snapshot = await owner.command({ kind: 'connect', token })
    expect(snapshot.tokenRequired).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain(token)
    await owner.command({ kind: 'save', profile: profile({ enabled: false }) })
    expect(JSON.stringify(persisted)).not.toContain(token)
    expect(persisted).toEqual(profile({ enabled: false }))
    await owner.dispose()
  })

  it('requires the registered actor and blocks a marked old session while ordinary disabled sessions pass through', async () => {
    const owner = new MemoryOwner(options({ loadPrivateSessions: async () => ['old-private-session'] }))
    await owner.registerHost('conversation-host', 'conversation', async () => true)
    const old = await owner.prepare('conversation-host', 'ref-old', prepareInput('old-private-session'), Date.now() + 500)
    expect(old).toMatchObject({ mode: 'blocked', reason: 'new_session_required' })
    const fresh = await owner.prepare('conversation-host', 'ref-fresh', prepareInput('fresh-session'), Date.now() + 500)
    expect(fresh).toMatchObject({ mode: 'disabled', conversation: { turns: [] } })
    await expect(owner.prepare('different-host', 'ref-wrong-actor', prepareInput('fresh-session'), Date.now() + 500))
      .rejects
      .toThrow('memory.owner_lost')
    await owner.dispose()
  })

  it('does not register a persona proposal or copy permissions before explicit approval', async () => {
    const owner = new MemoryOwner(options())
    const card = {
      cardId: 'card-a',
      name: 'Imported persona',
      description: 'Description',
      personality: 'Kind',
      scenario: 'A private scenario',
      tools: { shell: true, filesystem: true },
    }
    const proposal = await owner.command({ kind: 'propose-persona', card })
    expect(proposal.candidate).toMatchObject({ cardId: 'card-a' })
    expect(JSON.stringify(proposal)).not.toContain('shell')
    expect(JSON.stringify(proposal)).not.toContain('filesystem')
    expect(JSON.stringify(proposal)).not.toContain('tools')
    expect(proposal.profile.cardBindings).toEqual([])
    expect(proposal.profile.modelBindings).toEqual({})
    await owner.dispose()
  })
  it('preserves the explicitly chosen model versions and rejects partial replacement', async () => {
    const owner = new MemoryOwner(options())
    const command = { kind: 'bind-model', providerId: 'provider', model: 'model', externalProfileId: 'profile', bindingRevision: 2, profileId: '10000000-0000-4000-8000-000000000001', profileRevision: 3 } as const
    const saved = await owner.command(command)
    expect(saved.profile.modelBindings[JSON.stringify(['provider', 'model'])]).toEqual({ externalProfileId: command.externalProfileId, bindingRevision: 2, profileId: command.profileId, profileRevision: 3 })
    await expect(owner.command({ ...command, profileRevision: undefined })).rejects.toThrow()
    expect((await owner.command({ kind: 'snapshot' })).profile).toEqual(saved.profile)
    await owner.dispose()
  })
})
