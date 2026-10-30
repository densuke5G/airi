import type { DesktopConsolidationKey, DesktopConsolidationSource } from '@proj-airi/stage-ui/services/memory/desktop-settings'

import type { LaunchProfile } from './desktop-launcher'

import process from 'node:process'

import { isAbsolute, parse, resolve } from 'node:path'

import * as v from 'valibot'

import { EncryptedRecordStore } from './encrypted-record-store'

/** Fixed child-only environment slot referenced by the Metrodoros LLM profile. */
export const CONSOLIDATION_KEY_ENV = 'METRODOROS_LLM_API_KEY'

function safeBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  }
  catch {
    return false
  }
}

/** Validate at the main boundary before any native confirmation or encrypted write. */
export const consolidationKeySchema = v.strictObject({
  providerId: v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.check(value => value.trim().length > 0 && !/[\r\n\0]/.test(value))),
  model: v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.check(value => value.trim().length > 0 && !/[\r\n\0]/.test(value))),
  baseUrl: v.pipe(v.string(), v.maxLength(2048), v.check(safeBaseUrl)),
  apiKey: v.pipe(v.string(), v.minLength(1), v.maxLength(4096), v.check(value => value.trim().length > 0 && !/[\r\n\0]/.test(value))),
})

const targetSchema = v.strictObject({
  nodePath: v.string(),
  serverRoot: v.string(),
  dataDir: v.string(),
  endpoint: v.string(),
})
const payloadSchema = v.strictObject({
  version: v.literal(1),
  installationId: v.pipe(v.string(), v.uuid()),
  target: targetSchema,
  credential: consolidationKeySchema,
})

function target(profile: LaunchProfile) {
  const local = (path: string) => {
    if (!isAbsolute(path) || path.startsWith('\\\\') || path.startsWith('//') || path.split(/[\\/]/).includes('..') || path.includes('\0'))
      throw new Error('memory.consolidation_key_target_invalid')
    const resolved = resolve(path)
    const value = resolved.length > parse(resolved).root.length ? resolved.replace(/[\\/]+$/, '') : resolved
    return process.platform === 'win32' ? value.toLowerCase() : value
  }
  let endpoint: URL
  try {
    endpoint = new URL(profile.endpoint)
  }
  catch {
    throw new Error('memory.consolidation_key_target_invalid')
  }
  if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.origin !== profile.endpoint)
    throw new Error('memory.consolidation_key_target_invalid')
  return { nodePath: local(profile.nodePath), serverRoot: local(profile.serverRoot), dataDir: local(profile.dataDir), endpoint: endpoint.origin }
}

/** Own one encrypted API key bound to this installation and the explicitly registered service paths. */
export class ConsolidationKeyStore {
  private readonly records: EncryptedRecordStore

  constructor(directory: string, private readonly installationId: string) {
    if (!v.safeParse(v.pipe(v.string(), v.uuid()), installationId).success)
      throw new Error('credential_store.installation_invalid')
    this.records = new EncryptedRecordStore(directory, 'consolidation-key')
  }

  async save(profile: LaunchProfile, credential: DesktopConsolidationKey): Promise<void> {
    const parsed = v.safeParse(consolidationKeySchema, credential)
    if (!parsed.success)
      throw new Error('memory.consolidation_key_invalid')
    await this.records.write({ version: 1, installationId: this.installationId, target: target(profile), credential: parsed.output })
  }

  private async read() {
    const value = await this.records.read()
    if (value === null)
      return null
    const parsed = v.safeParse(payloadSchema, value)
    if (!parsed.success)
      throw new Error('credential_store.storage_corrupt')
    if (parsed.output.installationId !== this.installationId)
      throw new Error('credential_store.installation_mismatch')
    return parsed.output
  }

  async load(profile: LaunchProfile): Promise<DesktopConsolidationKey | null> {
    const stored = await this.read()
    if (!stored)
      return null
    if (JSON.stringify(stored.target) !== JSON.stringify(target(profile)))
      throw new Error('memory.consolidation_key_target_changed')
    return stored.credential
  }

  async status(profile: LaunchProfile): Promise<{ saved: boolean, targetMatches: boolean, source: DesktopConsolidationSource | null, error: string | null }> {
    const present = await this.records.status()
    let stored
    try {
      stored = await this.read()
    }
    catch {
      return { saved: present.saved, targetMatches: false, source: null, error: 'memory.consolidation_key_unavailable' }
    }
    if (!stored)
      return { saved: false, targetMatches: false, source: null, error: null }
    let targetMatches = false
    try {
      targetMatches = JSON.stringify(stored.target) === JSON.stringify(target(profile))
    }
    catch {
      targetMatches = false
    }
    const { apiKey: _apiKey, ...source } = stored.credential
    return { saved: true, targetMatches, source, error: null }
  }

  async forget(): Promise<void> {
    await this.records.forget()
  }
}
