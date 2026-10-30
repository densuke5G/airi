import type { Stats } from 'node:fs'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

import { app, safeStorage } from 'electron'

import * as v from 'valibot'

/**
 * Identity metadata for a stored connection credential.
 */
export interface CredentialIdentity {
  endpoint: string
  userId: string
  clientId: string
  storeGeneration: string
}

/**
 * Encrypted credential record including the installation and auth token.
 */
export interface StoredCredential extends CredentialIdentity {
  installationId: string
  token: string
}

/**
 * Public storage status revealing presence and encryption readiness.
 */
export interface CredentialStatus {
  available: boolean
  saved: boolean
}

const MAX_STORAGE_BYTES = 64 * 1024
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const outerEnvelopeSchema = v.strictObject({
  version: v.literal(1),
  ciphertext: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_STORAGE_BYTES)),
})

const storedCredentialSchema = v.strictObject({
  installationId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  endpoint: v.pipe(v.string(), v.minLength(1)),
  userId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  clientId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  storeGeneration: v.pipe(v.string(), v.regex(UUID_REGEX)),
  token: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
})

const innerPayloadSchema = v.strictObject({
  version: v.literal(1),
  installationId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  endpoint: v.pipe(v.string(), v.minLength(1)),
  userId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  clientId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  storeGeneration: v.pipe(v.string(), v.regex(UUID_REGEX)),
  token: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
})

export function isEncryptionBackendSecure(platform: string, backend?: string): boolean {
  return platform !== 'linux' || (backend !== 'basic_text' && backend !== 'unknown')
}

/**
 * Validates a canonical loopback HTTP origin without userinfo, query, fragment, or path.
 */
function validateLoopbackEndpoint(endpoint: string): void {
  if (typeof endpoint !== 'string' || !endpoint.trim())
    throw new Error('credential_store.endpoint_invalid')

  let url: URL
  try {
    url = new URL(endpoint)
  }
  catch {
    throw new Error('credential_store.endpoint_invalid')
  }

  if (url.protocol !== 'http:')
    throw new Error('credential_store.endpoint_invalid')

  const hostname = url.hostname.toLowerCase()
  const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  if (!isLoopback)
    throw new Error('credential_store.endpoint_invalid')

  if (url.username || url.password)
    throw new Error('credential_store.endpoint_invalid')

  if (url.search || url.hash)
    throw new Error('credential_store.endpoint_invalid')

  if (url.pathname !== '/' && url.pathname !== '')
    throw new Error('credential_store.endpoint_invalid')

  if (endpoint !== url.origin)
    throw new Error('credential_store.endpoint_invalid')
}

/**
 * Encrypted credential storage bound to one installation.
 * Uses Electron safeStorage with OS protection.
 */
export class CredentialStore {
  private readonly directory: string
  private readonly installationId: string
  private readonly credentialPath: string
  private operationTail: Promise<unknown> = Promise.resolve()

  constructor(directory: string, installationId: string) {
    if (typeof directory !== 'string' || !directory.trim() || !isAbsolute(directory))
      throw new Error('credential_store.directory_invalid')

    if (typeof installationId !== 'string' || !UUID_REGEX.test(installationId.trim()))
      throw new Error('credential_store.installation_invalid')

    this.directory = resolve(directory)
    this.installationId = installationId.trim()
    this.credentialPath = join(this.directory, 'credential.enc')
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(async () => {
      try {
        return await operation()
      }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('credential_store.'))
          throw error
        throw new Error('credential_store.storage_unavailable')
      }
    })
    this.operationTail = run.catch(() => undefined)
    return run
  }

  private async checkEncryptionReady(): Promise<boolean> {
    try {
      if (typeof app?.isReady === 'function' && !app.isReady()) {
        if (typeof app?.whenReady === 'function')
          await app.whenReady()
      }

      if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function')
        return false

      if (!safeStorage.isEncryptionAvailable())
        return false

      const backend = safeStorage.getSelectedStorageBackend?.()
      if (!isEncryptionBackendSecure(process.platform, backend))
        return false

      return true
    }
    catch {
      return false
    }
  }

  private async assertNotSymlink(targetPath: string): Promise<Stats | null> {
    try {
      const stat = await lstat(targetPath)
      if (stat.isSymbolicLink())
        throw new Error('credential_store.symlink_detected')
      return stat
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    }
  }

  private assertNoDirectoryEscape(targetPath: string): void {
    const relativePath = relative(this.directory, resolve(targetPath))
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
      throw new Error('credential_store.directory_invalid')
  }

  private async assertNoSymlinkAncestors(targetPath: string, allowMissing = false): Promise<void> {
    const absolutePath = resolve(targetPath)
    const parsed = parse(absolutePath)
    const parts = absolutePath.slice(parsed.root.length).split(sep).filter(Boolean)
    let currentPath = parsed.root
    for (let index = 0; index < parts.length; index += 1) {
      currentPath = join(currentPath, parts[index]!)
      let stat: Stats
      try {
        stat = await lstat(currentPath)
      }
      catch (error) {
        if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT')
          return
        throw error
      }
      if (stat.isSymbolicLink())
        throw new Error('credential_store.symlink_detected')
      if (index < parts.length - 1 && !stat.isDirectory())
        throw new Error('credential_store.directory_invalid')
    }
  }

  async save(credential: StoredCredential): Promise<void> {
    return this.serialize(async () => {
      const parsedCredential = v.safeParse(storedCredentialSchema, credential)
      if (!parsedCredential.success)
        throw new Error('credential_store.id_invalid')

      if (parsedCredential.output.installationId !== this.installationId)
        throw new Error('credential_store.installation_mismatch')

      validateLoopbackEndpoint(parsedCredential.output.endpoint)

      const payloadParse = v.safeParse(innerPayloadSchema, {
        version: 1,
        ...parsedCredential.output,
      })
      if (!payloadParse.success)
        throw new Error('credential_store.id_invalid')

      if (!(await this.checkEncryptionReady()))
        throw new Error('credential_store.encryption_unavailable')

      this.assertNoDirectoryEscape(this.credentialPath)

      await this.assertNoSymlinkAncestors(this.directory, true)
      await mkdir(this.directory, { recursive: true })
      await this.assertNoSymlinkAncestors(this.directory)
      await this.assertNotSymlink(this.credentialPath)

      let ciphertextBuffer: Buffer
      try {
        ciphertextBuffer = safeStorage.encryptString(JSON.stringify(payloadParse.output))
      }
      catch {
        throw new Error('credential_store.encryption_unavailable')
      }

      const envelope = {
        version: 1,
        ciphertext: ciphertextBuffer.toString('base64'),
      }

      const tempPath = join(this.directory, `credential.${randomUUID()}.tmp`)
      this.assertNoDirectoryEscape(tempPath)

      try {
        const handle = await open(tempPath, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify(envelope), 'utf8')
          await handle.sync()
        }
        finally {
          await handle.close()
        }
        await this.assertNotSymlink(this.credentialPath)
        await rename(tempPath, this.credentialPath)
      }
      catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async load(endpoint: string): Promise<StoredCredential | null> {
    return this.serialize(async () => {
      validateLoopbackEndpoint(endpoint)
      this.assertNoDirectoryEscape(this.credentialPath)

      await this.assertNoSymlinkAncestors(this.credentialPath, true)
      const stat = await this.assertNotSymlink(this.credentialPath)
      if (!stat)
        return null

      if (!stat.isFile() || stat.size > MAX_STORAGE_BYTES)
        throw new Error('credential_store.storage_corrupt')

      const raw = await readFile(this.credentialPath, 'utf8')
      let envelopeJson: unknown
      try {
        envelopeJson = JSON.parse(raw)
      }
      catch {
        throw new Error('credential_store.storage_corrupt')
      }

      const envelopeResult = v.safeParse(outerEnvelopeSchema, envelopeJson)
      if (!envelopeResult.success)
        throw new Error('credential_store.storage_corrupt')

      if (!(await this.checkEncryptionReady()))
        throw new Error('credential_store.encryption_unavailable')

      let decrypted: string
      try {
        const cipherBuffer = Buffer.from(envelopeResult.output.ciphertext, 'base64')
        decrypted = safeStorage.decryptString(cipherBuffer)
      }
      catch {
        throw new Error('credential_store.storage_corrupt')
      }

      let payloadJson: unknown
      try {
        payloadJson = JSON.parse(decrypted)
      }
      catch {
        throw new Error('credential_store.storage_corrupt')
      }

      const payloadResult = v.safeParse(innerPayloadSchema, payloadJson)
      if (!payloadResult.success)
        throw new Error('credential_store.storage_corrupt')

      const stored = payloadResult.output
      if (stored.installationId !== this.installationId)
        throw new Error('credential_store.installation_mismatch')

      if (stored.endpoint !== endpoint)
        return null

      return {
        installationId: stored.installationId,
        endpoint: stored.endpoint,
        userId: stored.userId,
        clientId: stored.clientId,
        storeGeneration: stored.storeGeneration,
        token: stored.token,
      }
    })
  }

  async forget(): Promise<void> {
    return this.serialize(async () => {
      this.assertNoDirectoryEscape(this.credentialPath)
      await this.assertNoSymlinkAncestors(this.credentialPath, true)
      const stat = await this.assertNotSymlink(this.credentialPath)
      if (!stat)
        return

      await rm(this.credentialPath, { force: true })
    })
  }

  async status(): Promise<CredentialStatus> {
    const available = await this.checkEncryptionReady()
    let saved = false
    try {
      this.assertNoDirectoryEscape(this.credentialPath)
      await this.assertNoSymlinkAncestors(this.credentialPath, true)
      const stat = await lstat(this.credentialPath)
      saved = stat.isFile() && !stat.isSymbolicLink()
    }
    catch {
      saved = false
    }

    return { available, saved }
  }
}
