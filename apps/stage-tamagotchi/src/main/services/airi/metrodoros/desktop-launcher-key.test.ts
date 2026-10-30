import type { LaunchProfile } from './desktop-launcher'

import process from 'node:process'

import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopLauncher } from './desktop-launcher'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

let directory: string
let profile: LaunchProfile
const key = { providerId: 'openai', model: 'synthetic-model', baseUrl: 'https://provider.example/v1/', apiKey: 'synthetic-child-only-key' }

beforeEach(async () => {
  vi.restoreAllMocks()
  spawn.mockReset()
  spawn.mockReturnValue(Object.assign(new EventEmitter(), { unref: vi.fn() }))
  directory = await mkdtemp(join(tmpdir(), 'airi-key-launch-'))
  profile = { enabled: true, nodePath: join(directory, 'node.exe'), serverRoot: join(directory, 'server'), dataDir: join(directory, 'store'), endpoint: 'http://127.0.0.1:47831' }
  await mkdir(join(profile.serverRoot, 'apps/server/src/bootstrap'), { recursive: true })
  await mkdir(join(profile.dataDir, 'data'), { recursive: true })
  await writeFile(profile.nodePath, 'synthetic executable')
  await writeFile(join(profile.serverRoot, 'apps/server/src/bootstrap/main.ts'), '// synthetic entry')
  await writeFile(join(profile.dataDir, 'data/metrodoros.sqlite'), 'synthetic database')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function serviceAbsentThenReady(): void {
  let requests = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (++requests === 1)
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    return new Response(JSON.stringify({ status: String(input).endsWith('/health/live') ? 'live' : 'ready' }))
  })
}

describe('child-only consolidation key delivery', () => {
  it('passes the decrypted key and destination only in the spawned service environment', async () => {
    serviceAbsentThenReady()
    const readKey = vi.fn(async () => key)
    expect(await new DesktopLauncher(readKey).ensureReady(profile)).toEqual({ state: 'started' })
    expect(readKey).toHaveBeenCalledExactlyOnceWith(profile)
    const [executable, argv, options] = spawn.mock.calls[0]!
    expect(executable).toBe(profile.nodePath)
    expect(argv).not.toContain(key.apiKey)
    expect(options.env.METRODOROS_LLM_API_KEY).toBe(key.apiKey)
    expect(options.env.METRODOROS_LLM_API_KEY_BASE_URL).toBe(key.baseUrl)
    expect(options.env.METRODOROS_DATA_DIR).toBe(profile.dataDir)
    expect(options.shell).toBe(false)
    expect(process.env.METRODOROS_LLM_API_KEY === key.apiKey).toBe(false)
  })

  it('reuses a ready service without decrypting or replacing its environment', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify({ status: String(input).endsWith('/health/live') ? 'live' : 'ready' })))
    const readKey = vi.fn(async () => key)
    expect(await new DesktopLauncher(readKey).ensureReady(profile)).toEqual({ state: 'existing' })
    expect(readKey).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not spawn when decryption or target binding fails', async () => {
    serviceAbsentThenReady()
    const readKey = vi.fn(async () => {
      throw new Error('memory.consolidation_key_target_changed')
    })
    await expect(new DesktopLauncher(readKey).ensureReady(profile)).rejects.toThrow('memory.consolidation_key_target_changed')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('discards a decrypted key if startup was cancelled during the read', async () => {
    serviceAbsentThenReady()
    const controller = new AbortController()
    const readKey = vi.fn(async () => {
      controller.abort()
      return key
    })
    await expect(new DesktopLauncher(readKey).ensureReady(profile, controller.signal)).rejects.toThrow('launcher.aborted')
    expect(spawn).not.toHaveBeenCalled()
  })
})
