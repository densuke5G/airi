import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Verify persona recovery and visible long-term memory in an isolated schema 8 store.
 * Set all three METRODOROS_ACCEPTANCE_* variables to use a live model with synthetic text only.
 *
 * Call stack:
 * main -> MemoryOwner -> HTTP / SQLite -> consolidation worker -> model -> viewer API
 */
async function main() {
  const args = process.argv.slice(2)
  const metroArg = args.indexOf('--metrodoros-root')
  const outputArg = args.indexOf('--output')
  if (metroArg < 0 || outputArg < 0)
    throw new Error('Pass --metrodoros-root and --output')
  const metro = resolve(args[metroArg + 1])
  const output = resolve(args[outputArg + 1])
  const airi = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const live = ['KEY', 'BASE_URL', 'MODEL'].every(key => !!process.env[`METRODOROS_ACCEPTANCE_${key}`])
  const report = { schema: '10-persona-memory/v1', realHttp: true, realSqlite: true, realAiriOwner: true, realModel: live, syntheticAudio: true, checks: {} }
  const waitFor = async (read, label) => {
    // Remote work waits until the last conversation activity is more than 30 seconds old.
    const until = Date.now() + (live ? 90000 : 45000)
    while (Date.now() < until) {
      if (await read())
        return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`fixture_timeout_${label}`)
  }
  let service, owner, database, modelServer
  const listen = async (server) => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    return server.address().port
  }
  let stage = 'setup'
  try {
    await mkdir(join(airi, '.test-data'), { recursive: true })
    const directory = await mkdtemp(join(airi, '.test-data/persona-memory-'))
    const portServer = createServer()
    const port = await listen(portServer)
    await new Promise(resolve => portServer.close(resolve))
    modelServer = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request)
        chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (body.response_format?.type === 'json_object' && !body.messages.some(message => /json/i.test(message.content))) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 'validation_failed', param: 'messages' } }))
        return
      }
      const data = JSON.parse(body.messages[1].content)
      const source = data.sources?.find(source => source.speaker === 'user' && source.text.includes('緑茶'))
      const operations = source ? [{ operation: 'propose', kind: 'user_fact', item_key: 'preference.drink', text: '私は緑茶が好きです。', certainty: 'explicit', evidence_type: 'user_statement', evidence: [{ source_id: source.source_id, quote: '私は緑茶が好きです。' }], target_memory_id: null, target_revision: null, change_type: null, valid_until: null, commitment: null }] : []
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schema_version: 1, operations }) } }] }))
    })
    const modelPort = await listen(modelServer)
    process.env.METRODOROS_PIPELINE_TEST_KEY = live ? process.env.METRODOROS_ACCEPTANCE_KEY : 'synthetic-key'
    const baseUrl = live ? process.env.METRODOROS_ACCEPTANCE_BASE_URL : `http://127.0.0.1:${modelPort}/v1`
    process.env.METRODOROS_PIPELINE_TEST_KEY_BASE_URL = baseUrl
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
    const env = { ...process.env, METRODOROS_DATA_DIR: directory }
    const lines = []
    const permissions = ['identity:read', 'identity:write', 'identity:admin', 'session:write', 'events:write', 'context:read', 'memory:read', 'memory:write', 'outputs:write', 'changes:read', 'changes:ack', 'jobs:read', 'jobs:manage', 'llm:manage']
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
      throw new Error('fixture_setup_failed')
    service = await startService(await loadConfig(env), { log: () => {} })
    const endpoint = `http://127.0.0.1:${port}`
    const api = async (route, method = 'GET', body) => {
      const response = await fetch(endpoint + route, { method, headers: { 'authorization': `Bearer ${credential.token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (!response.ok)
        throw new Error(`fixture_http_${response.status}`)
      return response.json()
    }
    let profile = { ...emptyMemorySnapshot().profile, endpoint, enabled: true }
    let characterId
    let changedPersona = false
    const registrations = []
    const storage = new FileStorage(join(directory, 'outbox.sqlite'))
    owner = new MemoryOwner({
      installationId: 'persona-memory-acceptance',
      loadProfile: async () => profile,
      saveProfile: async (next) => { profile = next },
      loadPrivateSessions: async () => [],
      rememberPrivateSession: async () => {},
      storage: async () => storage,
      fetch: async (input, options) => {
        const route = new URL(String(input)).pathname
        if (route === '/v1/outputs' && !changedPersona) {
          changedPersona = true
          const character = await api(`/v1/characters/${characterId}`)
          const existing = await api(`/v1/characters/${characterId}/profile`)
          await api(`/v1/characters/${characterId}/profile`, 'PUT', { expected_revision: character.revision, profile: { ...existing.profile, background: 'Updated synthetic persona.' } })
        }
        const response = await fetch(input, options)
        if (route === '/v1/outputs')
          registrations.push(response.status)
        return response
      },
    })
    await owner.registerHost('conversation', 'conversation', async () => true)
    await owner.registerHost('speech', 'speech', async () => true, async () => true)
    await owner.command({ kind: 'connect', token: credential.token })
    const snapshot = await owner.command({ kind: 'create-character', name: 'Synthetic pipeline character', firstPerson: 'I' })
    characterId = snapshot.characters[0].id
    const worldId = snapshot.worlds.find(world => world.realm === 'real').id
    await owner.command({ kind: 'bind-card', cardId: 'test-card', characterId, worldId })
    const model = live ? process.env.METRODOROS_ACCEPTANCE_MODEL : 'synthetic-model'
    const llm = await api('/v1/llm-profiles', 'POST', { provider: 'openai', model, base_url: baseUrl, secret_ref: 'METRODOROS_PIPELINE_TEST_KEY', capabilities: { structured_output: false, max_input_tokens: 16000, max_output_tokens: 4000, supports_cancel: true, resource_class: 'remote' } })
    await api('/v1/llm-bindings/synthetic-memory', 'PUT', { profile_id: llm.profile_id, expected_revision: 0 })
    await owner.command({ kind: 'bind-model', providerId: 'test-provider', model, externalProfileId: 'synthetic-memory', bindingRevision: 1, profileId: llm.profile_id, profileRevision: llm.revision })
    report.checks.profile_registered_and_pinned = true
    stage = 'probe'
    const probe = await api(`/v1/llm-profiles/${llm.profile_id}/probe`, 'POST', { expected_revision: llm.revision })
    await waitFor(async () => {
      const jobs = await api('/v1/jobs?kind=probe_profile')
      const job = jobs.items.find(item => item.operation_id === probe.operation_id)
      report.checks.canonical_probe_visible = job?.kind === 'probe_profile'
      if (job && ['failed', 'paused', 'canceled'].includes(job.state))
        throw new Error(`fixture_probe_${job.state}`)
      return job?.state === 'succeeded'
    }, 'profile_probe')
    report.checks.probe_completed = true
    stage = 'prepare'
    const sessionId = randomUUID()
    const deadlineAt = Date.now() + 1000
    const prepared = await owner.prepare('conversation', 'ref', { sessionId, userMessageId: 'user', attemptId: 'attempt', deadlineAt, model, providerId: 'test-provider', cardId: 'test-card', inputKind: 'typed', appInstructionIds: [], conversation: { turns: [{ type: 'user', id: 'user', content: '私は緑茶が好きです。' }] } }, deadlineAt)
    report.checks.real_registration_conflict = registrations[0] === 409
    report.checks.same_send_recovers = prepared.mode === 'memory' && registrations.at(-1) === 201
    report.checks.updated_persona_only = JSON.stringify(prepared.conversation).includes('Updated synthetic persona.')
    report.checks.confirmed_output_gate = (await owner.gate('conversation', 'ref', 'initial')).allow
    if (!Object.values(report.checks).every(Boolean))
      throw new Error('preparation_failed')
    stage = 'delivery'
    await owner.report('speech', 'ref', { kind: 'audio-unavailable', reason: 'muted' })
    await owner.report('conversation', 'ref', { kind: 'llm-finished', outcome: 'completed', text: 'Synthetic acknowledgement.', assistantMessageId: 'assistant' })
    await owner.displayed('assistant')
    const Database = createRequire(join(metro, 'package.json'))('better-sqlite3')
    database = new Database(join(directory, 'data/metrodoros.sqlite'), { readonly: true })
    await waitFor(() => database.prepare('SELECT 1 FROM short_turns WHERE state=\'closed\'').get(), 'turn_close')
    report.checks.delivery_closed_at_server = true
    report.checks.input_pinned_to_profile = !!database.prepare('SELECT 1 FROM consolidation_turn_profiles WHERE llm_profile_id=? AND llm_profile_revision=?').get(llm.profile_id, llm.revision)
    stage = 'consolidation'
    await waitFor(() => database.prepare('SELECT 1 FROM memory_items WHERE status=\'active\'').get(), 'active_memory')
    report.checks.long_term_memory_adopted = true
    const listed = await api(`/v1/manage/characters/${characterId}/memories?world_id=${worldId}`)
    report.checks.visible_in_viewer_api = listed.items.some(item => item.status === 'active')
    report.passed = Object.values(report.checks).every(Boolean)
  }
  catch (error) {
    report.stage = stage
    report.failure = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'acceptance_failed'
    report.passed = false
  }
  finally {
    database?.close()
    await owner?.dispose()
    await service?.close()
    if (modelServer)
      await new Promise(resolve => modelServer.close(resolve))
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
  if (!report.passed)
    process.exitCode = 1
}

await main()
