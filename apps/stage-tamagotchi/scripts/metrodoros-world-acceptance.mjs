import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Uses disposable schema-8 data and real HTTP to verify fresh-session failures and world selection.
 *
 * Call stack:
 * metrodoros-world-acceptance
 *   -> server setup and startService
 *   -> MemoryOwner.prepare
 *     -> authenticated session creation and recall
 */
const airi = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const rootIndex = args.indexOf('--metrodoros-root')
const outputIndex = args.indexOf('--output')
if (rootIndex < 0 || !args[rootIndex + 1] || outputIndex < 0 || !args[outputIndex + 1])
  throw new Error('Pass --metrodoros-root and --output')
const metro = resolve(args[rootIndex + 1])
const output = resolve(args[outputIndex + 1])
const directory = join(airi, '.test-data', `world-acceptance-${randomUUID()}`)
const report = { realHttp: true, realSqlite: true, realAiriOwner: true, syntheticData: true, checks: {} }
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
  const adapter = createRequire(join(airi, 'packages/stage-ui/package.json')).resolve('@metrodoros/airi-adapter')
  const [{ runCli }, { loadConfig }, { startService }, { MemoryOwner }, { emptyMemorySnapshot }, { MemoryStorage }] = await Promise.all([
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
  let profile = { ...emptyMemorySnapshot().profile, endpoint, enabled: true }
  const privateSessions = new Set()
  const storage = new MemoryStorage()
  owner = new MemoryOwner({
    installationId: 'world-acceptance',
    loadProfile: async () => profile,
    saveProfile: async (next) => { profile = structuredClone(next) },
    loadPrivateSessions: async () => [...privateSessions],
    rememberPrivateSession: async (id) => { privateSessions.add(id) },
    storage: async () => storage,
    fetch: async (input, options) => {
      const response = await fetch(input, options)
      if (new URL(String(input)).pathname === '/v1/sessions')
        sessionStatuses.push(response.status)
      return response
    },
  })
  await owner.registerHost('conversation', 'conversation', async () => true)
  await owner.registerHost('speech', 'speech', async () => true, async () => true)
  await owner.command({ kind: 'connect', token: credential.token })
  let snapshot = await owner.command({ kind: 'create-character', name: 'Synthetic character', firstPerson: 'I' })
  const characterId = snapshot.characters[0].id
  snapshot = await owner.command({ kind: 'create-world', name: 'real world' })
  const real = snapshot.worlds.find(world => world.realm === 'real')
  const fiction = snapshot.worlds.find(world => world.realm === 'fiction' && world.name === 'real world')
  if (!real || !fiction)
    throw new Error('Fixture worlds missing')
  report.checks.unnamed_real_and_named_fiction_distinguished = real.name === null && fiction.name === 'real world'
  await owner.command({ kind: 'bind-card', cardId: 'test-card', characterId, worldId: fiction.id })
  const sessionId = randomUUID()
  const prepare = async (ids) => {
    const deadlineAt = Date.now() + 1000
    return owner.prepare('conversation', randomUUID(), { sessionId, userMessageId: ids.at(-1), attemptId: randomUUID(), deadlineAt, providerId: 'test-provider', model: 'test-model', cardId: 'test-card', inputKind: 'typed', appInstructionIds: [], conversation: { turns: ids.map(id => ({ type: 'user', id, content: [{ type: 'text', text: 'Synthetic connection test' }] })) } }, deadlineAt)
  }
  const first = await prepare(['first'])
  report.checks.fiction_without_membership_denied = first.mode === 'blocked' && first.reason === 'forbidden' && sessionStatuses.includes(403)
  report.checks.failed_first_attempt_marked_private = privateSessions.has(sessionId)
  const retry = await prepare(['first', 'retry'])
  report.checks.retry_reports_actual_denial = retry.mode === 'blocked' && retry.reason === 'forbidden'
  await owner.command({ kind: 'bind-card', cardId: 'test-card', characterId, worldId: real.id })
  const recovered = await prepare(['first', 'retry', 'recovered'])
  report.checks.real_world_opens_without_membership = sessionStatuses.includes(201)
  report.checks.same_conversation_recovers_after_world_change = recovered.mode === 'memory'
  await owner.command({ kind: 'save', profile: { ...profile, enabled: false } })
  const disabled = await prepare(['first', 'retry', 'recovered', 'disabled'])
  report.checks.private_history_cannot_fall_back = disabled.mode === 'blocked' && disabled.reason === 'new_session_required'
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
