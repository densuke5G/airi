import type { StoredCredential } from './credential-store'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CredentialStore, isEncryptionBackendSecure } from './credential-store'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
  getSelectedStorageBackend: vi.fn(),
}))

const appMock = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  whenReady: vi.fn(() => Promise.resolve()),
}))

vi.mock('electron', () => ({
  app: appMock,
  safeStorage: safeStorageMock,
}))

describe('credentialStore', () => {
  let tempDir: string
  const validInstallationId = '11111111-2222-4333-8444-555555555555'
  const validEndpoint = 'http://127.0.0.1:47831'

  const sampleCredential: StoredCredential = {
    installationId: validInstallationId,
    endpoint: validEndpoint,
    userId: '11111111-2222-4333-8444-555555555556',
    clientId: '11111111-2222-4333-8444-555555555557',
    storeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    token: 'secret-token-xyz-123',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    appMock.isReady.mockReturnValue(true)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')

    safeStorageMock.encryptString.mockImplementation((plain: string) => {
      return Buffer.from(`mock_enc:${plain}`, 'utf8')
    })

    safeStorageMock.decryptString.mockImplementation((buffer: Buffer) => {
      const text = buffer.toString('utf8')
      if (!text.startsWith('mock_enc:'))
        throw new Error('decryption failed')
      return text.slice('mock_enc:'.length)
    })

    tempDir = await mkdtemp(join(tmpdir(), 'airi-cred-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('saves and loads credential with real temporary directory', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)

    await store.save(sampleCredential)
    const loaded = await store.load(validEndpoint)

    expect(loaded).toEqual(sampleCredential)
    expect(safeStorageMock.encryptString).toHaveBeenCalled()
    expect(safeStorageMock.decryptString).toHaveBeenCalled()
  })

  it('rejects plaintext credential storage on disk', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)
    await store.save(sampleCredential)

    const rawDisk = await readFile(join(tempDir, 'credential.enc'), 'utf8')
    expect(rawDisk).not.toContain(sampleCredential.token)
    expect(rawDisk).not.toContain(sampleCredential.userId)

    const parsed = JSON.parse(rawDisk)
    expect(parsed.version).toBe(1)
    expect(typeof parsed.ciphertext).toBe('string')
  })

  it('exposes presence and readiness in status without leaking secrets', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)

    const initialStatus = await store.status()
    expect(initialStatus).toEqual({ available: true, saved: false })

    await store.save(sampleCredential)
    const afterSave = await store.status()
    expect(afterSave).toEqual({ available: true, saved: true })
    expect(Object.keys(afterSave).sort()).toEqual(['available', 'saved'])
  })

  it('forgets stored credential atomically', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)
    await store.save(sampleCredential)

    await store.forget()
    const loaded = await store.load(validEndpoint)
    expect(loaded).toBeNull()

    const status = await store.status()
    expect(status).toEqual({ available: true, saved: false })

    await expect(store.forget()).resolves.toBeUndefined()
  })

  it('returns null when loading from missing storage', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)
    const loaded = await store.load(validEndpoint)
    expect(loaded).toBeNull()
  })

  it('rejects non-canonical or non-loopback endpoints', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)

    await expect(store.save({ ...sampleCredential, endpoint: 'http://example.com:47831' }))
      .rejects
      .toThrow('credential_store.endpoint_invalid')

    await expect(store.save({ ...sampleCredential, endpoint: 'https://127.0.0.1:47831' }))
      .rejects
      .toThrow('credential_store.endpoint_invalid')

    await expect(store.save({ ...sampleCredential, endpoint: 'http://user:pass@127.0.0.1:47831' }))
      .rejects
      .toThrow('credential_store.endpoint_invalid')

    await expect(store.save({ ...sampleCredential, endpoint: 'http://127.0.0.1:47831?query=1' }))
      .rejects
      .toThrow('credential_store.endpoint_invalid')

    await expect(store.save({ ...sampleCredential, endpoint: 'http://127.0.0.1:47831#frag' }))
      .rejects
      .toThrow('credential_store.endpoint_invalid')

    await expect(store.save({ ...sampleCredential, endpoint: 'http://127.0.0.1:47831/' }))
      .rejects
      .toThrow('credential_store.endpoint_invalid')

    await expect(store.save({ ...sampleCredential, endpoint: 'http://127.0.0.1:47831/path' }))
      .rejects
      .toThrow('credential_store.endpoint_invalid')
  })

  it('does not reuse token across aliases or ports', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)
    await store.save(sampleCredential)

    const aliasLoad = await store.load('http://localhost:47831')
    expect(aliasLoad).toBeNull()

    const portLoad = await store.load('http://127.0.0.1:47832')
    expect(portLoad).toBeNull()
  })

  it('rejects relative directory or invalid installation ID in constructor', () => {
    expect(() => new CredentialStore('relative/dir', validInstallationId))
      .toThrow('credential_store.directory_invalid')

    expect(() => new CredentialStore(tempDir, 'invalid-id'))
      .toThrow('credential_store.installation_invalid')
  })

  it('rejects saving or loading with installation mismatch', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)

    await expect(store.save({ ...sampleCredential, installationId: '99999999-9999-4999-8999-999999999999' }))
      .rejects
      .toThrow('credential_store.installation_mismatch')

    const otherStore = new CredentialStore(tempDir, validInstallationId)
    await otherStore.save(sampleCredential)

    const mismatchStore = new CredentialStore(tempDir, '99999999-9999-4999-8999-999999999999')
    await expect(mismatchStore.load(validEndpoint))
      .rejects
      .toThrow('credential_store.installation_mismatch')
  })

  it('rejects malformed IDs or empty tokens', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)

    await expect(store.save({ ...sampleCredential, userId: '' }))
      .rejects
      .toThrow('credential_store.id_invalid')

    await expect(store.save({ ...sampleCredential, clientId: '' }))
      .rejects
      .toThrow('credential_store.id_invalid')

    await expect(store.save({ ...sampleCredential, storeGeneration: 'not-a-uuid' }))
      .rejects
      .toThrow('credential_store.id_invalid')

    await expect(store.save({ ...sampleCredential, token: '' }))
      .rejects
      .toThrow('credential_store.id_invalid')

    await expect(store.save({ ...sampleCredential, userId: 'user-42' }))
      .rejects
      .toThrow('credential_store.id_invalid')

    await expect(store.save({ ...sampleCredential, extra: 'unknown' } as StoredCredential))
      .rejects
      .toThrow('credential_store.id_invalid')
  })

  it('rejects symlink credential storage file', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)
    const targetFile = join(tempDir, 'real-target.txt')
    await writeFile(targetFile, 'content', 'utf8')

    const linkFile = join(tempDir, 'credential.enc')
    try {
      await symlink(targetFile, linkFile)
    }
    catch {
      // If OS requires admin privileges for symlinks, skip this test assertion.
      return
    }

    await expect(store.load(validEndpoint))
      .rejects
      .toThrow('credential_store.symlink_detected')

    await expect(store.save(sampleCredential))
      .rejects
      .toThrow('credential_store.symlink_detected')

    await expect(store.forget())
      .rejects
      .toThrow('credential_store.symlink_detected')
  })

  it('rejects symlink storage directory', async () => {
    const realDir = join(tempDir, 'real')
    await mkdir(realDir, { recursive: true })
    const linkDir = join(tempDir, 'symlink-dir')
    try {
      await symlink(realDir, linkDir, 'dir')
    }
    catch {
      return
    }

    const store = new CredentialStore(linkDir, validInstallationId)
    await expect(store.save(sampleCredential))
      .rejects
      .toThrow('credential_store.symlink_detected')
  })

  it('rejects symlink ancestors before creating the credential directory', async () => {
    const realParent = join(tempDir, 'real-parent')
    const linkedParent = join(tempDir, 'linked-parent')
    await mkdir(realParent, { recursive: true })
    try {
      await symlink(realParent, linkedParent, 'dir')
    }
    catch {
      return
    }
    const store = new CredentialStore(join(linkedParent, 'credentials'), validInstallationId)

    await expect(store.save(sampleCredential))
      .rejects
      .toThrow('credential_store.symlink_detected')
    await expect(store.load(validEndpoint))
      .rejects
      .toThrow('credential_store.symlink_detected')
    await expect(store.forget())
      .rejects
      .toThrow('credential_store.symlink_detected')
  })

  it('returns a safe encryption error when safeStorage encryption fails', async () => {
    safeStorageMock.encryptString.mockImplementationOnce(() => {
      throw new Error(`failed at ${tempDir}`)
    })
    const store = new CredentialStore(tempDir, validInstallationId)

    await expect(store.save(sampleCredential))
      .rejects
      .toThrow('credential_store.encryption_unavailable')
  })

  it('throws storage_corrupt on corrupted ciphertext or invalid payload schema', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)

    await writeFile(join(tempDir, 'credential.enc'), 'not-valid-json', 'utf8')
    await expect(store.load(validEndpoint))
      .rejects
      .toThrow('credential_store.storage_corrupt')

    await writeFile(join(tempDir, 'credential.enc'), JSON.stringify({ version: 99, ciphertext: 'abc' }), 'utf8')
    await expect(store.load(validEndpoint))
      .rejects
      .toThrow('credential_store.storage_corrupt')

    const badCipher = { version: 1, ciphertext: Buffer.from('unencrypted-garbage').toString('base64') }
    await writeFile(join(tempDir, 'credential.enc'), JSON.stringify(badCipher), 'utf8')
    await expect(store.load(validEndpoint))
      .rejects
      .toThrow('credential_store.storage_corrupt')

    const badInner = { version: 1, ciphertext: Buffer.from('mock_enc:{"version":2}').toString('base64') }
    await writeFile(join(tempDir, 'credential.enc'), JSON.stringify(badInner), 'utf8')
    await expect(store.load(validEndpoint))
      .rejects
      .toThrow('credential_store.storage_corrupt')
  })

  it('throws storage_corrupt if file size exceeds maximum read limit', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)
    const largeContent = 'a'.repeat(70 * 1024)
    await writeFile(join(tempDir, 'credential.enc'), largeContent, 'utf8')

    await expect(store.load(validEndpoint))
      .rejects
      .toThrow('credential_store.storage_corrupt')
  })

  it('rejects save when safeStorage is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = new CredentialStore(tempDir, validInstallationId)

    const status = await store.status()
    expect(status.available).toBe(false)

    await expect(store.save(sampleCredential))
      .rejects
      .toThrow('credential_store.encryption_unavailable')
  })

  it('rejects basic_text storage backend on Linux', async () => {
    expect(isEncryptionBackendSecure('linux', 'basic_text')).toBe(false)
    expect(isEncryptionBackendSecure('linux', 'unknown')).toBe(false)
    expect(isEncryptionBackendSecure('linux', 'gnome_libsecret')).toBe(true)
    expect(isEncryptionBackendSecure('win32', 'basic_text')).toBe(true)
  })

  it('serializes save and forget so a late save cannot resurrect credentials', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)

    const savePromise = store.save(sampleCredential)
    const forgetPromise = store.forget()

    await Promise.all([savePromise, forgetPromise])

    const loaded = await store.load(validEndpoint)
    expect(loaded).toBeNull()

    const status = await store.status()
    expect(status.saved).toBe(false)
  })

  it('never leaks tokens or paths in error messages', async () => {
    const store = new CredentialStore(tempDir, validInstallationId)
    try {
      await store.save({ ...sampleCredential, endpoint: 'http://malicious.org' })
    }
    catch (error) {
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toBe('credential_store.endpoint_invalid')
      expect(message).not.toContain(sampleCredential.token)
      expect(message).not.toContain(tempDir)
    }
  })
})
