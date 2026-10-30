import type { LaunchProfile } from './desktop-launcher'

import process from 'node:process'

import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopLauncher } from './desktop-launcher'

interface MockChild extends EventEmitter {
  unref: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}

function connectionRefusedError(): Error {
  const err = new TypeError('fetch failed')
  Object.assign(err, { code: 'ECONNREFUSED', cause: { code: 'ECONNREFUSED' } })
  return err
}

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

describe('desktopLauncher', () => {
  let tempBase: string
  let serverRoot: string
  let dataDir: string
  let fakeNodePath: string
  let entryPath: string
  let dbPath: string
  let currentChild: MockChild

  const validEndpoint = 'http://127.0.0.1:47831'

  let defaultProfile: LaunchProfile

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()

    tempBase = await mkdtemp(join(tmpdir(), 'airi-launch-test-'))
    serverRoot = join(tempBase, 'server-root')
    dataDir = join(tempBase, 'data-dir')
    fakeNodePath = join(tempBase, 'fake-node.exe')

    await mkdir(join(serverRoot, 'apps/server/src/bootstrap'), { recursive: true })
    await mkdir(join(dataDir, 'data'), { recursive: true })

    entryPath = join(serverRoot, 'apps/server/src/bootstrap/main.ts')
    dbPath = join(dataDir, 'data', 'metrodoros.sqlite')

    await writeFile(fakeNodePath, '#!/bin/sh\n', { mode: 0o755 })
    await writeFile(entryPath, '// entry', 'utf8')
    await writeFile(dbPath, 'sqlite-header', 'utf8')

    defaultProfile = {
      enabled: true,
      nodePath: fakeNodePath,
      serverRoot,
      dataDir,
      endpoint: validEndpoint,
    }

    currentChild = Object.assign(new EventEmitter(), {
      unref: vi.fn(),
      kill: vi.fn(),
    })
    spawnMock.mockReturnValue(currentChild)
  })

  afterEach(async () => {
    await rm(tempBase, { recursive: true, force: true }).catch(() => undefined)
  })

  it('returns disabled without filesystem or process operations when profile is disabled', async () => {
    const launcher = new DesktopLauncher()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await launcher.ensureReady({ ...defaultProfile, enabled: false })

    expect(result).toEqual({ state: 'disabled' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects invalid or non-loopback endpoints', async () => {
    const launcher = new DesktopLauncher()

    await expect(launcher.ensureReady({ ...defaultProfile, endpoint: 'http://example.com:47831' }))
      .rejects
      .toThrow('launcher.endpoint_invalid')

    await expect(launcher.ensureReady({ ...defaultProfile, endpoint: 'https://127.0.0.1:47831' }))
      .rejects
      .toThrow('launcher.endpoint_invalid')

    await expect(launcher.ensureReady({ ...defaultProfile, endpoint: 'http://127.0.0.1:47831/path' }))
      .rejects
      .toThrow('launcher.endpoint_invalid')

    await expect(launcher.ensureReady({ ...defaultProfile, endpoint: 'http://127.0.0.1:47831?query=1' }))
      .rejects
      .toThrow('launcher.endpoint_invalid')
  })

  it('returns existing when endpoint is already live and ready without spawning', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health/live'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'live' }), { status: 200 }))
      if (url.endsWith('/health/ready'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }))
      return Promise.reject(new Error('unmatched'))
    })

    const result = await launcher.ensureReady(defaultProfile)

    expect(result).toEqual({ state: 'existing' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('throws endpoint_conflict when endpoint responds with unrelated content', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return Promise.resolve(new Response('<html>Different Server</html>', { status: 404 }))
    })

    await expect(launcher.ensureReady(defaultProfile))
      .rejects
      .toThrow('launcher.endpoint_conflict')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('does not follow health redirects to another endpoint', async () => {
    const launcher = new DesktopLauncher()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:47832/health/live' } }),
    )

    await expect(launcher.ensureReady(defaultProfile)).rejects.toThrow('launcher.endpoint_conflict')
    expect(fetchSpy).toHaveBeenCalledWith(
      `${validEndpoint}/health/live`,
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('throws not_ready when existing server responds as not ready without spawning', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health/live'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'live' }), { status: 200 }))
      if (url.endsWith('/health/ready'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'not_ready' }), { status: 200 }))
      return Promise.reject(new Error('unmatched'))
    })

    await expect(launcher.ensureReady(defaultProfile))
      .rejects
      .toThrow('launcher.not_ready')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('validates local paths and requires existing database and source entry', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(connectionRefusedError())

    await expect(launcher.ensureReady({ ...defaultProfile, nodePath: 'relative/node.exe' }))
      .rejects
      .toThrow('launcher.node_path_invalid')

    await expect(launcher.ensureReady({ ...defaultProfile, nodePath: process.execPath }))
      .rejects
      .toThrow('launcher.node_path_invalid')

    await expect(launcher.ensureReady({ ...defaultProfile, nodePath: join(tempBase, 'missing.exe') }))
      .rejects
      .toThrow('launcher.node_path_invalid')

    await expect(launcher.ensureReady({ ...defaultProfile, serverRoot: join(tempBase, 'missing-root') }))
      .rejects
      .toThrow('launcher.server_root_invalid')

    await rm(entryPath)
    await expect(launcher.ensureReady(defaultProfile))
      .rejects
      .toThrow('launcher.entry_missing')
    await writeFile(entryPath, '// entry', 'utf8')

    await rm(dbPath)
    await expect(launcher.ensureReady(defaultProfile))
      .rejects
      .toThrow('launcher.database_missing')
    await writeFile(dbPath, 'sqlite-header', 'utf8')
  })

  it('rejects an endpoint that does not match the selected data directory config', async () => {
    const launcher = new DesktopLauncher()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(connectionRefusedError())

    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ host: '127.0.0.1', port: 47832 }), 'utf8')
    await expect(launcher.ensureReady(defaultProfile)).rejects.toThrow('launcher.endpoint_config_mismatch')

    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ host: '::1', port: 47831 }), 'utf8')
    await expect(launcher.ensureReady(defaultProfile)).rejects.toThrow('launcher.endpoint_config_mismatch')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects symlinks in configured local paths', async () => {
    const launcher = new DesktopLauncher()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(connectionRefusedError())

    const symlinkNode = join(tempBase, 'symlink-node.exe')
    try {
      await symlink(fakeNodePath, symlinkNode)
    }
    catch {
      return
    }

    await expect(launcher.ensureReady({ ...defaultProfile, nodePath: symlinkNode }))
      .rejects
      .toThrow('launcher.symlink_detected')
  })

  it('rejects a symlink in an ancestor of a configured local path', async () => {
    const launcher = new DesktopLauncher()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(connectionRefusedError())
    const realParent = join(tempBase, 'real-parent')
    const linkParent = join(tempBase, 'linked-parent')
    await mkdir(realParent, { recursive: true })
    try {
      await symlink(realParent, linkParent, 'dir')
    }
    catch {
      return
    }

    const linkedDataDir = join(linkParent, 'data-dir')
    await mkdir(join(linkedDataDir, 'data'), { recursive: true })
    await writeFile(join(linkedDataDir, 'data', 'metrodoros.sqlite'), 'db', 'utf8')

    await expect(launcher.ensureReady({ ...defaultProfile, dataDir: linkedDataDir }))
      .rejects
      .toThrow('launcher.symlink_detected')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('times out a health request that does not answer', async () => {
    vi.useFakeTimers()
    const launcher = new DesktopLauncher()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const pending = launcher.ensureReady(defaultProfile)
    const rejected = expect(pending).rejects.toThrow('launcher.timeout')
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    expect(spawnMock).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('spawns detached unreferenced Node process and polls health until ready', async () => {
    const launcher = new DesktopLauncher()
    let pollCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      pollCount += 1
      if (pollCount === 1)
        return Promise.reject(connectionRefusedError())

      if (url.endsWith('/health/live'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'live' }), { status: 200 }))
      if (url.endsWith('/health/ready'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }))
      return Promise.reject(new Error('unmatched'))
    })

    const result = await launcher.ensureReady(defaultProfile)

    expect(result).toEqual({ state: 'started' })
    expect(spawnMock).toHaveBeenCalledWith(
      fakeNodePath,
      [entryPath],
      expect.objectContaining({
        cwd: serverRoot,
        env: expect.objectContaining({ METRODOROS_DATA_DIR: dataDir }),
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }),
    )
    expect(currentChild.unref).toHaveBeenCalled()
    expect(currentChild.listenerCount('error')).toBe(0)
    expect(currentChild.listenerCount('exit')).toBe(0)
  })

  it('fails with spawn_failed if child process emits an error during startup', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(connectionRefusedError())

    const launchPromise = launcher.ensureReady(defaultProfile)
    setTimeout(() => {
      currentChild.emit('error', new Error('spawn failure'))
    }, 20)

    await expect(launchPromise).rejects.toThrow('launcher.spawn_failed')
    expect(currentChild.listenerCount('error')).toBe(0)
  })

  it('fails with child_exited if child process terminates before ready', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(connectionRefusedError())

    const launchPromise = launcher.ensureReady(defaultProfile)
    setTimeout(() => {
      currentChild.emit('exit', 1, null)
    }, 20)

    await expect(launchPromise).rejects.toThrow('launcher.child_exited')
    expect(currentChild.listenerCount('exit')).toBe(0)
  })

  it('shares single startup execution among concurrent callers with identical profile', async () => {
    const launcher = new DesktopLauncher()
    let initialCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      initialCount += 1
      if (initialCount === 1)
        return Promise.reject(connectionRefusedError())

      if (url.endsWith('/health/live'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'live' }), { status: 200 }))
      if (url.endsWith('/health/ready'))
        return Promise.resolve(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }))
      return Promise.reject(new Error('unmatched'))
    })

    const [first, second] = await Promise.all([
      launcher.ensureReady(defaultProfile),
      launcher.ensureReady(defaultProfile),
    ])

    expect(first).toEqual({ state: 'started' })
    expect(second).toEqual({ state: 'started' })
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('cancels active launch when callers profile changes', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        }, { once: true })
      })
    })

    const firstPromise = launcher.ensureReady(defaultProfile)

    const otherDataDir = join(tempBase, 'data-dir-2')
    await mkdir(otherDataDir, { recursive: true })
    await mkdir(join(otherDataDir, 'data'), { recursive: true })
    await writeFile(join(otherDataDir, 'data', 'metrodoros.sqlite'), 'db', 'utf8')

    const secondProfile = { ...defaultProfile, dataDir: otherDataDir }
    const secondPromise = launcher.ensureReady(secondProfile)

    await expect(firstPromise).rejects.toThrow('launcher.aborted')
    launcher.dispose()
    await expect(secondPromise).rejects.toThrow('launcher.disposed')
  })

  it('disposes startup waits and releases listeners without killing server process', async () => {
    const launcher = new DesktopLauncher()

    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        }, { once: true })
      })
    })

    const launchPromise = launcher.ensureReady(defaultProfile)
    launcher.dispose()

    await expect(launchPromise).rejects.toThrow('launcher.disposed')
    expect(currentChild.kill).not.toHaveBeenCalled()
    expect(currentChild.listenerCount('error')).toBe(0)
    expect(currentChild.listenerCount('exit')).toBe(0)

    await expect(launcher.ensureReady(defaultProfile)).rejects.toThrow('launcher.disposed')
  })

  it('aborts early when caller signal is triggered without affecting shared launch', async () => {
    const launcher = new DesktopLauncher()

    let initial = true
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (initial) {
        initial = false
        return Promise.reject(connectionRefusedError())
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          if (url.endsWith('/health/live'))
            resolve(new Response(JSON.stringify({ status: 'live' }), { status: 200 }))
          else
            resolve(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }))
        }, 80)
      })
    })

    const controller = new AbortController()
    const sharedPromise = launcher.ensureReady(defaultProfile)
    const abortedPromise = launcher.ensureReady(defaultProfile, controller.signal)

    controller.abort()

    await expect(abortedPromise).rejects.toThrow('launcher.aborted')
    const sharedResult = await sharedPromise
    expect(sharedResult).toEqual({ state: 'started' })
  })
})
