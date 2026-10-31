import * as v from 'valibot'

import { EncryptedRecordStore } from './encrypted-record-store'

export { isEncryptionBackendSecure } from './encrypted-record-store'

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const payloadSchema = v.strictObject({
  version: v.literal(1),
  installationId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  endpoint: v.pipe(v.string(), v.minLength(1)),
  userId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  clientId: v.pipe(v.string(), v.regex(UUID_REGEX)),
  storeGeneration: v.pipe(v.string(), v.regex(UUID_REGEX)),
  token: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
})

/** Encrypted connection token bound to one installation and authenticated identity. */
export class CredentialStore {
  private readonly records: EncryptedRecordStore

  constructor(directory: string, private readonly installationId: string) {
    if (!UUID_REGEX.test(installationId))
      throw new Error('credential_store.installation_invalid')
    this.records = new EncryptedRecordStore(directory, 'credential')
  }

  async save(credential: StoredCredential): Promise<void> {
    const parsed = v.safeParse(payloadSchema, { version: 1, ...credential })
    if (!parsed.success)
      throw new Error('credential_store.id_invalid')
    if (parsed.output.installationId !== this.installationId)
      throw new Error('credential_store.installation_mismatch')
    validateLoopbackEndpoint(parsed.output.endpoint)
    await this.records.write(parsed.output)
  }

  async load(endpoint: string): Promise<StoredCredential | null> {
    validateLoopbackEndpoint(endpoint)
    const value = await this.records.read()
    if (value === null)
      return null
    const parsed = v.safeParse(payloadSchema, value)
    if (!parsed.success)
      throw new Error('credential_store.storage_corrupt')
    if (parsed.output.installationId !== this.installationId)
      throw new Error('credential_store.installation_mismatch')
    if (parsed.output.endpoint !== endpoint)
      return null
    const { version: _version, ...credential } = parsed.output
    return credential
  }

  async forget(): Promise<void> {
    await this.records.forget()
  }

  async status(): Promise<CredentialStatus> {
    return await this.records.status()
  }
}
