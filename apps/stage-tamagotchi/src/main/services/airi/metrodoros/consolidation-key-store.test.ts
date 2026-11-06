import type { LaunchProfile } from './desktop-launcher'

import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsolidationKeyStore } from './consolidation-key-store'
import { CredentialStore } from './credential-store'

const encryption = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({
  app: { isReady: () => true, whenReady: async () => {} },
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (plain: string) => Buffer.from(plain).reverse(),
    decryptString: (cipher: Buffer) => Buffer.from(cipher).reverse().toString(),
  },
}))

const installationId = '11111111-2222-4333-8444-555555555555'
const credential = { providerId: 'openai', model: 'test-model', baseUrl: 'https://example.com/v1/', apiKey: 'synthetic-private-provider-key' }
let directory: string
let profile: LaunchProfile
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'airi-consolidation-key-'))
  profile = { enabled: true, nodePath: join(directory, 'node.exe'), serverRoot: join(directory, 'server'), dataDir: join(directory, 'data'), endpoint: 'http://127.0.0.1:47831' }
  encryption.available = true
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('consolidation API key ownership', () => {
  it('loads the encrypted key and exposes only source metadata in status', async () => {
    const store = new ConsolidationKeyStore(directory, installationId)
    expect(await store.load(profile)).toBeNull()
    await store.save(profile, credential)
    expect(await store.load(profile)).toEqual(credential)
    const disk = await readFile(join(directory, 'consolidation-key.enc'), 'utf8')
    expect(disk).not.toContain(credential.apiKey)
    expect(disk).not.toContain(credential.baseUrl)
    const status = await store.status(profile)
    expect(status.saved).toBe(true)
    expect(status.targetMatches).toBe(true)
    expect(status.source).toEqual({ providerId: credential.providerId, model: credential.model, baseUrl: credential.baseUrl })
    expect(JSON.stringify(status)).not.toContain(credential.apiKey)
  })

  it.each(['nodePath', 'serverRoot', 'dataDir', 'endpoint'] as const)('refuses a changed %s without disclosing or reusing the key', async (field) => {
    const store = new ConsolidationKeyStore(directory, installationId)
    await store.save(profile, credential)
    const changed = { ...profile, [field]: field === 'endpoint' ? 'http://127.0.0.1:47832' : join(directory, 'different') }
    await expect(store.load(changed)).rejects.toThrow('memory.consolidation_key_target_changed')
    expect((await store.status(changed)).targetMatches).toBe(false)
  })

  it('rejects another installation and permits deleting a corrupt saved record', async () => {
    const store = new ConsolidationKeyStore(directory, installationId)
    await store.save(profile, credential)
    const other = new ConsolidationKeyStore(directory, '22222222-2222-4333-8444-555555555555')
    await expect(other.load(profile)).rejects.toThrow('credential_store.installation_mismatch')
    await writeFile(join(directory, 'consolidation-key.enc'), '{invalid')
    expect((await store.status(profile)).saved).toBe(true)
    await expect(store.load(profile)).rejects.toThrow('credential_store.storage_corrupt')
    await store.forget()
    expect(await store.load(profile)).toBeNull()
  })

  it('fails closed when OS encryption is unavailable', async () => {
    const store = new ConsolidationKeyStore(directory, installationId)
    encryption.available = false
    await expect(store.save(profile, credential)).rejects.toThrow('credential_store.encryption_unavailable')
    expect((await store.status(profile)).saved).toBe(false)
  })

  it.each([
    { ...credential, apiKey: 'key\r\nInjected: header' },
    { ...credential, baseUrl: 'https://secret@example.com/v1/' },
    { ...credential, baseUrl: 'http://remote.example/v1/' },
    { ...credential, baseUrl: 'https://example.com/v1/?secret=value' },
  ])('rejects unsafe provider inputs', async (value) => {
    await expect(new ConsolidationKeyStore(directory, installationId).save(profile, value)).rejects.toThrow('memory.consolidation_key_invalid')
  })

  it('serializes save and deletion without deleting the separate connection token', async () => {
    const tokenStore = new CredentialStore(directory, installationId)
    const token = { installationId, endpoint: profile.endpoint, userId: installationId, clientId: installationId, storeGeneration: installationId, token: 'synthetic-connection-token' }
    await tokenStore.save(token)
    const store = new ConsolidationKeyStore(directory, installationId)
    await Promise.all([store.save(profile, credential), store.forget()])
    expect(await store.load(profile)).toBeNull()
    expect(await tokenStore.load(profile.endpoint)).toEqual(token)
  })
})
