import type { Stats } from 'node:fs'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

import { app, safeStorage } from 'electron'

import * as v from 'valibot'

const MAX_STORAGE_BYTES = 64 * 1024
const envelopeSchema = v.strictObject({
  version: v.literal(1),
  ciphertext: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_STORAGE_BYTES)),
})

export function isEncryptionBackendSecure(platform: string, backend?: string): boolean {
  return platform !== 'linux' || (backend !== 'basic_text' && backend !== 'unknown')
}

/** Main-only encrypted records. Writes and deletion share one queue for each owned file. */
export class EncryptedRecordStore {
  private readonly directory: string
  private readonly path: string
  private operationTail: Promise<unknown> = Promise.resolve()

  constructor(directory: string, private readonly name: 'credential' | 'consolidation-key') {
    if (!directory.trim() || !isAbsolute(directory))
      throw new Error('credential_store.directory_invalid')
    this.directory = resolve(directory)
    this.path = join(this.directory, `${name}.enc`)
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith('credential_store.'))
        throw error
      throw new Error('credential_store.storage_unavailable')
    })
    this.operationTail = run.catch(() => undefined)
    return run
  }

  private async encryptionReady(): Promise<boolean> {
    try {
      if (!app.isReady())
        await app.whenReady()
      return safeStorage.isEncryptionAvailable()
        && isEncryptionBackendSecure(process.platform, safeStorage.getSelectedStorageBackend?.())
    }
    catch {
      return false
    }
  }

  private async inspect(target: string, allowMissing = false): Promise<Stats | null> {
    const owned = relative(this.directory, resolve(target))
    if (owned === '..' || owned.startsWith(`..${sep}`) || isAbsolute(owned))
      throw new Error('credential_store.directory_invalid')
    const absolute = resolve(target)
    const root = parse(absolute).root
    const parts = absolute.slice(root.length).split(sep).filter(Boolean)
    let current = root
    let stat: Stats | null = null
    for (const [index, part] of parts.entries()) {
      current = join(current, part)
      try {
        stat = await lstat(current)
      }
      catch (error) {
        if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT')
          return null
        throw error
      }
      if (stat.isSymbolicLink())
        throw new Error('credential_store.symlink_detected')
      if (index < parts.length - 1 && !stat.isDirectory())
        throw new Error('credential_store.directory_invalid')
    }
    return stat
  }

  async write(value: unknown): Promise<void> {
    await this.serialize(async () => {
      if (!await this.encryptionReady())
        throw new Error('credential_store.encryption_unavailable')
      const plain = JSON.stringify(value)
      if (Buffer.byteLength(plain, 'utf8') > 48 * 1024)
        throw new Error('credential_store.id_invalid')
      await this.inspect(this.directory, true)
      await mkdir(this.directory, { recursive: true })
      await this.inspect(this.directory)
      await this.inspect(this.path, true)
      let ciphertext: Buffer
      try {
        ciphertext = safeStorage.encryptString(plain)
      }
      catch {
        throw new Error('credential_store.encryption_unavailable')
      }
      const envelope = JSON.stringify({ version: 1, ciphertext: ciphertext.toString('base64') })
      if (Buffer.byteLength(envelope, 'utf8') > MAX_STORAGE_BYTES)
        throw new Error('credential_store.id_invalid')
      const temporary = join(this.directory, `${this.name}.${randomUUID()}.tmp`)
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try {
          await handle.writeFile(envelope, 'utf8')
          await handle.sync()
        }
        finally {
          await handle.close()
        }
        await this.inspect(this.path, true)
        await rename(temporary, this.path)
      }
      finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    })
  }

  async read(): Promise<unknown> {
    return await this.serialize(async () => {
      const stat = await this.inspect(this.path, true)
      if (!stat)
        return null
      if (!stat.isFile() || stat.size > MAX_STORAGE_BYTES)
        throw new Error('credential_store.storage_corrupt')
      if (!await this.encryptionReady())
        throw new Error('credential_store.encryption_unavailable')
      try {
        const envelope = v.parse(envelopeSchema, JSON.parse(await readFile(this.path, 'utf8')))
        return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64')))
      }
      catch {
        throw new Error('credential_store.storage_corrupt')
      }
    })
  }

  async forget(): Promise<void> {
    await this.serialize(async () => {
      if (await this.inspect(this.path, true))
        await rm(this.path, { force: true })
    })
  }

  async status(): Promise<{ available: boolean, saved: boolean }> {
    const available = await this.encryptionReady()
    let saved = false
    try {
      const stat = await this.inspect(this.path, true)
      saved = !!stat?.isFile()
    }
    catch {
      saved = false
    }
    return { available, saved }
  }
}
