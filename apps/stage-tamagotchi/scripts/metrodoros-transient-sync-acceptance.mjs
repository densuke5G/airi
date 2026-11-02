import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Uses disposable schema-8 data, file storage, and real HTTP to verify transient synchronization recovery.
 *
 * Call stack:
 * metrodoros-transient-sync-acceptance
 *   -> server setup and startService
 *   -> MemoryOwner.prepare
 *     -> authenticated session creation and recall
 *   -> MemoryOwner.notificationLoop
 *     -> checkpoint acknowledgment and outbox retry
 */
const airi = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const rootIndex = args.indexOf('--metrodoros-root')
const outputIndex = args.indexOf('--output')
if (rootIndex < 0 || !args[rootIndex + 1] || outputIndex < 0 || !args[outputIndex + 1])
  throw new Error('Pass --metrodoros-root and --output')
const metro = resolve(args[rootIndex + 1])
const output = resolve(args[outputIndex + 1])
const directory = join(airi, '.test-data', `transient-sync-${randomUUID()}`)
const report = { realHttp: true, realSqlite: true, realAiriOwner: true, realFileStorage: true, syntheticData: true, realAudio: false, checks: {} }
let service
let owner
try {
  await mkdir(directory, { recursive: true })
  const port = await new Promise((resolvePort, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      if (!address || typeof address === 'string')
        throw new Error('No fixture port')
      socket.close(error => error ? reject(error) : resolvePort(address.port))
    })
  })
  await writeFile(join(directory, 'config.json'), JSON.stringify({ host: '127.0.0.1', port }))
  const adapter = createRequire(join(airi, 'packages/stage-ui/package.json')).resolve('@metrodoros/airi-adapter/desktop')
  const [{ runCli }, { loadConfig }, { startService }, { MemoryOwner }, { emptyMemorySnapshot }, { FileStorage }] = await Promise.all([
    import(pathToFileURL(join(metro, 'apps/server/src/bootstrap/cli.ts')).href),
    import(pathToFileURL(join(metro, 'apps/server/src/bootstrap/config.ts')).href),
    import(pathToFileURL(join(metro, 'apps/server/src/bootstrap/service.ts')).href),
    import(pathToFileURL(join(airi, 'packages/stage-ui/src/services/memory/owner.ts')).href),
    import(pathToFileURL(join(airi, 'packages/stage-ui/src/services/memory/contracts.ts')).href),
    import(pathToFileURL(adapter).href),
  ])
  const lines = []
  const permissions = ['identity:read', 'identity:write', 'identity:admin', 'session:write', 'events:write', 'context:read', 'memory:read', 'outputs:write', 'changes:read', 'changes:ack', 'jobs:read']
  const env = { ...process.env, METRODOROS_DATA_DIR: directory }
  const status = await runCli(['setup', '--target', '8', ...permissions.flatMap(permission => ['--permission', permission])], env, { output: line => lines.push(line), error: () => {} })
  const credential = lines.map((line) => {
    try {
      return JSON.parse(line)
    }
    catch {
      return null
    }
  }).find(value => typeof value?.token === 'string')
  if (status !== 0 || !credential)
    throw new Error('Fixture setup failed')
  service = await startService(await loadConfig(env), { log: () => {} })
  const endpoint = `http://127.0.0.1:${port}`
  const sessionStatuses = []
  const failures = { changesRemaining: 0, eventsRemaining: 0, changesInjected: 0 }
  let failedEventId
  let connectionRequests = 0
  const stops = []
  const timeout = () => Response.json({ error: { code: 'DEADLINE_EXCEEDED', message: 'Synthetic timeout', retryable: true, request_id: randomUUID() } }, { status: 504 })
  const waitFor = async (read, label) => {
    const until = Date.now() + 10000
    while (Date.now() < until) {
      if (await read())
        return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(`Fixture timeout: ${label}`)
  }
  let profile = { ...emptyMemorySnapshot().profile, endpoint, enabled: true }
  const privateSessions = new Set()
  const storage = new FileStorage(join(directory, 'outbox.sqlite'))
  owner = new MemoryOwner({
    installationId: 'transient-sync-acceptance',
    loadProfile: async () => profile,
    saveProfile: async (next) => { profile = structuredClone(next) },
    loadPrivateSessions: async () => [...privateSessions],
    rememberPrivateSession: async (id) => { privateSessions.add(id) },
    storage: async () => storage,
    fetch: async (input, options) => {
      const route = new URL(String(input)).pathname
      if (route === '/v1/airi/connection')
        connectionRequests += 1
      if (route === '/v1/changes' && failures.changesRemaining > 0) {
        failures.changesRemaining -= 1
        failures.changesInjected += 1
        return timeout()
      }
      if (route === '/v1/events' && failures.eventsRemaining > 0) {
        failures.eventsRemaining -= 1
        failedEventId = new Headers(options?.headers).get('idempotency-key')
        return timeout()
      }
      const response = await fetch(input, options)
      if (new URL(String(input)).pathname === '/v1/sessions')
        sessionStatuses.push(response.status)
      return response
    },
  })
  await owner.registerHost('conversation', 'conversation', async (request) => {
    stops.push(request)
    return true
  })
  await owner.registerHost('speech', 'speech', async (request) => {
    stops.push(request)
    return true
  }, async () => true)
  await owner.command({ kind: 'connect', token: credential.token })
  const snapshot = await owner.command({ kind: 'create-character', name: 'Synthetic character', firstPerson: 'I' })
  const characterId = snapshot.characters[0].id
  const real = snapshot.worlds.find(world => world.realm === 'real')
  if (!real)
    throw new Error('Fixture real world missing')
  await owner.command({ kind: 'bind-card', cardId: 'test-card', characterId, worldId: real.id })
  const sessionId = randomUUID()
  const prepare = async (referenceId, ids) => {
    const deadlineAt = Date.now() + 1000
    return owner.prepare('conversation', referenceId, { sessionId, userMessageId: ids.at(-1), attemptId: randomUUID(), deadlineAt, providerId: 'test-provider', model: 'test-model', cardId: 'test-card', inputKind: 'typed', appInstructionIds: [], conversation: { turns: ids.map(id => ({ type: 'user', id, content: [{ type: 'text', text: `Synthetic connection test ${id}` }] })) } }, deadlineAt)
  }
  const first = await prepare('first-ref', ['first'])
  report.checks.established_memory_turn = first.mode === 'memory' && (await owner.gate('conversation', 'first-ref', 'initial')).allow
  if (!report.checks.established_memory_turn)
    throw new Error('Fixture first turn unavailable')
  const requestsBeforeFailure = connectionRequests
  const stopsBeforeFailure = stops.length
  failures.eventsRemaining = 1
  const key = { intentId: 'synthetic-intent', streamId: 'synthetic-stream', segmentId: 'synthetic-segment' }
  await owner.report('speech', 'first-ref', { kind: 'tts-request', key, text: 'Synthetic partial reply' })
  await owner.report('speech', 'first-ref', { kind: 'playback-start', key })
  await waitFor(async () => failedEventId !== undefined && (await storage.read()).outbox[failedEventId]?.state === 'pending', 'event_timeout')
  report.checks.event_timeout_retains_pending_record = (await storage.read()).outbox[failedEventId]?.state === 'pending'
  failures.changesRemaining = 1
  await waitFor(async () => !(await owner.command({ kind: 'snapshot' })).connected, 'notification_timeout')
  report.checks.notification_timeout_injected = failures.changesInjected === 1
  report.checks.output_stopped_before_recovery = stops.slice(stopsBeforeFailure).some(stop => stop.kind === 'speech' && stop.referenceIds.includes('first-ref'))
  report.checks.provider_gate_closed_during_outage = !(await owner.gate('conversation', 'first-ref', 'continuation')).allow
  await waitFor(async () => (await owner.command({ kind: 'snapshot' })).connected, 'automatic_resynchronization')
  report.checks.recovered_without_login_or_refresh = connectionRequests === requestsBeforeFailure
  report.checks.old_output_not_replayed = !(await owner.gate('conversation', 'first-ref', 'retry')).allow
  await waitFor(async () => (await storage.read()).outbox[failedEventId]?.state === 'acked', 'outbox_retry')
  report.checks.same_persisted_event_acknowledged_after_recovery = true
  const next = await prepare('next-ref', ['first', 'next'])
  report.checks.same_conversation_continues = next.mode === 'memory' && (await owner.gate('conversation', 'next-ref', 'initial')).allow
  report.checks.server_session_preserved = sessionStatuses.filter(status => status === 201).length === 1
  report.passed = Object.values(report.checks).every(Boolean)
}
finally {
  await owner?.dispose()
  await service?.close()
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
}
process.stdout.write(`${JSON.stringify(report)}\n`)
if (!report.passed)
  process.exitCode = 1
