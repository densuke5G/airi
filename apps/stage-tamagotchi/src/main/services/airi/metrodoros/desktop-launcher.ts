import type { ChildProcess } from 'node:child_process'
import type { Stats } from 'node:fs'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'

/**
 * Launch profile specifying local paths and target loopback endpoint.
 */
export interface LaunchProfile {
  enabled: boolean
  nodePath: string
  serverRoot: string
  dataDir: string
  endpoint: string
}

/**
 * Outcome of the launch sequence.
 */
export interface LaunchResult {
  state: 'disabled' | 'existing' | 'started'
}

interface HealthResponse {
  status: 'live' | 'ready' | 'not_ready' | 'draining'
}

type HealthProbe
  = | { kind: 'refused' }
    | { kind: 'ready' }
    | { kind: 'not_ready' }
    | { kind: 'conflict' }

const STARTUP_DEADLINE_MS = 30_000
const POLL_INTERVAL_MS = 100

function isHealthStatus(value: unknown): value is HealthResponse['status'] {
  return value === 'live' || value === 'ready' || value === 'not_ready' || value === 'draining'
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (!value || typeof value !== 'object')
    return false
  return isHealthStatus((value as { status?: unknown }).status)
}

function isConnectionRefused(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { code?: string, cause?: { code?: string } }
    if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED')
      return true
  }
  return false
}

/**
 * Validates a canonical loopback HTTP origin without userinfo, query, fragment, or path.
 */
function validateLoopbackEndpoint(endpoint: string): void {
  if (typeof endpoint !== 'string' || !endpoint.trim())
    throw new Error('launcher.endpoint_invalid')

  let url: URL
  try {
    url = new URL(endpoint)
  }
  catch {
    throw new Error('launcher.endpoint_invalid')
  }

  if (url.protocol !== 'http:')
    throw new Error('launcher.endpoint_invalid')

  const hostname = url.hostname.toLowerCase()
  const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  if (!isLoopback)
    throw new Error('launcher.endpoint_invalid')

  if (url.username || url.password)
    throw new Error('launcher.endpoint_invalid')

  if (url.search || url.hash)
    throw new Error('launcher.endpoint_invalid')

  if (url.pathname !== '/' && url.pathname !== '')
    throw new Error('launcher.endpoint_invalid')

  if (endpoint !== url.origin)
    throw new Error('launcher.endpoint_invalid')
}

function isSameProfile(a: LaunchProfile, b: LaunchProfile): boolean {
  return a.enabled === b.enabled
    && a.nodePath === b.nodePath
    && a.serverRoot === b.serverRoot
    && a.dataDir === b.dataDir
    && a.endpoint === b.endpoint
}

async function probeEndpoint(endpoint: string, signal?: AbortSignal): Promise<HealthProbe> {
  if (signal?.aborted)
    throw new Error('launcher.aborted')

  let liveRes: Response
  try {
    liveRes = await fetch(`${endpoint}/health/live`, { signal, redirect: 'manual' })
  }
  catch (error) {
    if (signal?.aborted)
      throw new Error('launcher.aborted')
    if (isConnectionRefused(error))
      return { kind: 'refused' }
    return { kind: 'conflict' }
  }

  if (liveRes.status !== 200)
    return { kind: 'conflict' }

  let liveBody: unknown
  try {
    liveBody = await liveRes.json()
  }
  catch {
    return { kind: 'conflict' }
  }

  if (!isHealthResponse(liveBody) || (liveBody.status !== 'live' && liveBody.status !== 'ready'))
    return { kind: 'conflict' }

  let readyRes: Response
  try {
    readyRes = await fetch(`${endpoint}/health/ready`, { signal, redirect: 'manual' })
  }
  catch {
    if (signal?.aborted)
      throw new Error('launcher.aborted')
    return { kind: 'conflict' }
  }

  let readyBody: unknown
  try {
    readyBody = await readyRes.json()
  }
  catch {
    return { kind: 'conflict' }
  }

  if (!isHealthResponse(readyBody))
    return { kind: 'conflict' }

  if (readyRes.status === 200 && readyBody.status === 'ready')
    return { kind: 'ready' }

  if (readyBody.status === 'not_ready' || readyBody.status === 'draining')
    return { kind: 'not_ready' }

  return { kind: 'conflict' }
}

async function assertLocalPath(path: string, code: string): Promise<Stats> {
  if (!isAbsolute(path) || path.startsWith('\\\\') || path.includes('\0'))
    throw new Error(code)
  const absolutePath = resolve(path)
  const parsed = parse(absolutePath)
  if (!parsed.root || parsed.root.startsWith('\\\\'))
    throw new Error(code)
  const parts = absolutePath.slice(parsed.root.length).split(sep).filter(Boolean)
  let currentPath = parsed.root
  try {
    for (let index = 0; index < parts.length; index += 1) {
      currentPath = join(currentPath, parts[index]!)
      const stat = await lstat(currentPath)
      if (stat.isSymbolicLink())
        throw new Error('launcher.symlink_detected')
      if (index < parts.length - 1 && !stat.isDirectory())
        throw new Error(code)
      if (index === parts.length - 1)
        return stat
    }
  }
  catch (error) {
    if (error instanceof Error && error.message === 'launcher.symlink_detected')
      throw error
    throw new Error(code)
  }
  throw new Error(code)
}

async function assertDataConfigMatchesEndpoint(dataDir: string, endpoint: string): Promise<void> {
  let settings: unknown = {}
  const configPath = join(dataDir, 'config.json')
  try {
    const stat = await lstat(configPath)
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error('launcher.data_config_invalid')
    settings = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      settings = {}
    }
    else if (error instanceof Error && error.message === 'launcher.data_config_invalid') {
      throw error
    }
    else {
      throw new Error('launcher.data_config_invalid')
    }
  }

  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('launcher.data_config_invalid')
  const config = settings as { host?: unknown, port?: unknown }
  const host = config.host === undefined ? '127.0.0.1' : config.host
  const port = config.port === undefined ? 47831 : config.port
  if ((host !== '127.0.0.1' && host !== '::1') || typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error('launcher.data_config_invalid')

  const url = new URL(endpoint)
  const endpointHost = url.hostname === '[::1]' ? '::1' : url.hostname
  const endpointPort = url.port ? Number(url.port) : 80
  if (endpointHost !== host || endpointPort !== port)
    throw new Error('launcher.endpoint_config_mismatch')
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.resolve()

  return new Promise((res) => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      res()
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      res()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Manages background Metrodoros process lifecycle for the desktop app.
 */
export class DesktopLauncher {
  private disposed = false
  private activeProfile: LaunchProfile | undefined
  private activePromise: Promise<LaunchResult> | undefined
  private activeAbortController: AbortController | undefined
  private serializedTail: Promise<unknown> = Promise.resolve()

  constructor() {}

  async ensureReady(profile: LaunchProfile, signal?: AbortSignal): Promise<LaunchResult> {
    if (this.disposed)
      throw new Error('launcher.disposed')
    if (signal?.aborted)
      throw new Error('launcher.aborted')

    if (!profile.enabled)
      return { state: 'disabled' }

    validateLoopbackEndpoint(profile.endpoint)

    if (this.activePromise && this.activeProfile && isSameProfile(this.activeProfile, profile)) {
      if (!signal)
        return this.activePromise
      return this.waitForSignalOrPromise(this.activePromise, signal)
    }

    if (this.activePromise) {
      this.activeAbortController?.abort()
      this.activePromise = undefined
      this.activeProfile = undefined
      this.activeAbortController = undefined
    }

    const abortController = new AbortController()
    this.activeAbortController = abortController
    this.activeProfile = { ...profile }
    const launchSignal = signal ? AbortSignal.any([abortController.signal, signal]) : abortController.signal

    const cleanup = () => {
      if (this.activeAbortController === abortController) {
        this.activePromise = undefined
        this.activeProfile = undefined
        this.activeAbortController = undefined
      }
    }

    const run = this.serializedTail.then(async () => {
      try {
        if (this.disposed)
          throw new Error('launcher.disposed')
        if (launchSignal.aborted)
          throw new Error('launcher.aborted')

        return await this.doLaunch(profile, launchSignal)
      }
      finally {
        cleanup()
      }
    })

    this.serializedTail = run.catch(() => undefined)
    this.activePromise = run

    if (!signal)
      return run
    return this.waitForSignalOrPromise(run, signal)
  }

  dispose(): void {
    this.disposed = true
    this.activeAbortController?.abort()
    this.activePromise = undefined
    this.activeProfile = undefined
    this.activeAbortController = undefined
  }

  private async waitForSignalOrPromise(promise: Promise<LaunchResult>, signal: AbortSignal): Promise<LaunchResult> {
    if (signal.aborted)
      throw new Error('launcher.aborted')

    return new Promise((resolveResult, rejectResult) => {
      const onAbort = () => {
        rejectResult(new Error('launcher.aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (result) => {
          signal.removeEventListener('abort', onAbort)
          if (this.disposed)
            rejectResult(new Error('launcher.disposed'))
          else
            resolveResult(result)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          rejectResult(error)
        },
      )
    })
  }

  private async doLaunch(profile: LaunchProfile, internalSignal: AbortSignal): Promise<LaunchResult> {
    const deadlineAt = Date.now() + STARTUP_DEADLINE_MS
    const timeoutController = new AbortController()
    const timeoutTimer = setTimeout(() => timeoutController.abort(), STARTUP_DEADLINE_MS)
    const requestSignal = AbortSignal.any([internalSignal, timeoutController.signal])
    try {
      if (this.disposed)
        throw new Error('launcher.disposed')
      if (internalSignal.aborted)
        throw new Error('launcher.aborted')

      const probe = await probeEndpoint(profile.endpoint, requestSignal)
      if (probe.kind === 'ready')
        return { state: 'existing' }
      if (probe.kind === 'not_ready')
        throw new Error('launcher.not_ready')
      if (probe.kind === 'conflict')
        throw new Error('launcher.endpoint_conflict')

      if (!profile.nodePath || resolve(profile.nodePath) === resolve(process.execPath))
        throw new Error('launcher.node_path_invalid')

      const nodeStat = await assertLocalPath(profile.nodePath, 'launcher.node_path_invalid')
      if (!nodeStat.isFile())
        throw new Error('launcher.node_path_invalid')

      if (!profile.serverRoot)
        throw new Error('launcher.server_root_invalid')

      const serverRootStat = await assertLocalPath(profile.serverRoot, 'launcher.server_root_invalid')
      if (!serverRootStat.isDirectory())
        throw new Error('launcher.server_root_invalid')

      const entryPath = join(profile.serverRoot, 'apps/server/src/bootstrap/main.ts')
      const entryStat = await assertLocalPath(entryPath, 'launcher.entry_missing')
      if (!entryStat.isFile())
        throw new Error('launcher.entry_missing')

      if (!profile.dataDir)
        throw new Error('launcher.data_dir_invalid')

      const dataDirStat = await assertLocalPath(profile.dataDir, 'launcher.data_dir_invalid')
      if (!dataDirStat.isDirectory())
        throw new Error('launcher.data_dir_invalid')

      const dbPath = join(profile.dataDir, 'data', 'metrodoros.sqlite')
      const dbStat = await assertLocalPath(dbPath, 'launcher.database_missing')
      if (!dbStat.isFile())
        throw new Error('launcher.database_missing')
      await assertDataConfigMatchesEndpoint(profile.dataDir, profile.endpoint)

      let child: ChildProcess
      try {
        child = spawn(profile.nodePath, [entryPath], {
          cwd: profile.serverRoot,
          env: {
            ...process.env,
            METRODOROS_DATA_DIR: profile.dataDir,
          },
          shell: false,
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
      }
      catch {
        throw new Error('launcher.spawn_failed')
      }

      let childError: Error | undefined
      let childExited = false

      const onError = () => {
        childError = new Error('launcher.spawn_failed')
      }
      const onExit = () => {
        childExited = true
      }

      child.once('error', onError)
      child.once('exit', onExit)

      const cleanupChildListeners = () => {
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
      }

      try {
        while (Date.now() < deadlineAt) {
          if (this.disposed)
            throw new Error('launcher.disposed')
          if (internalSignal.aborted)
            throw new Error('launcher.aborted')
          if (childError)
            throw childError
          if (childExited)
            throw new Error('launcher.child_exited')

          try {
            const pollProbe = await probeEndpoint(profile.endpoint, requestSignal)
            if (pollProbe.kind === 'ready')
              return { state: 'started' }
            if (pollProbe.kind === 'conflict')
              throw new Error('launcher.endpoint_conflict')
          }
          catch (error) {
            if (error instanceof Error && error.message.startsWith('launcher.'))
              throw error
          }

          await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadlineAt - Date.now())), requestSignal)
        }

        throw new Error('launcher.timeout')
      }
      finally {
        cleanupChildListeners()
      }
    }
    catch (error) {
      if (this.disposed)
        throw new Error('launcher.disposed')
      if (internalSignal.aborted)
        throw new Error('launcher.aborted')
      if (timeoutController.signal.aborted)
        throw new Error('launcher.timeout')
      throw error
    }
    finally {
      clearTimeout(timeoutTimer)
    }
  }
}
