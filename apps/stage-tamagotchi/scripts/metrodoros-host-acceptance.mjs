import process from 'node:process'

import { randomUUID } from 'node:crypto'
// Rerunnable host acceptance probe. Run with Node 24 and AIRI's tsx loader.
// This file intentionally emits only redacted assertions and stable error codes.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// pnpm exec tsx apps/stage-tamagotchi/scripts/metrodoros-host-acceptance.mjs --metrodoros-root <checkout> --output <report.json>
const args = process.argv.slice(2)
const rootIndex = args.indexOf('--metrodoros-root')
const outputIndex = args.indexOf('--output')
if (rootIndex < 0 || !args[rootIndex + 1] || outputIndex < 0 || !args[outputIndex + 1])
  throw new Error('Pass --metrodoros-root and --output')
const METRO = resolve(args[rootIndex + 1])
// NOTICE:
// Use the server's SQLite library for probes against its live database.
// Separate SQLite libraries in one process cannot coordinate POSIX locks.
// Source: https://sqlite.org/howtocorrupt.html#multiple_copies_of_sqlite_linked_into_the_same_application
// Remove this boundary when database probes run in a separate process.
const ServerDatabase = createRequire(join(METRO, 'package.json'))('better-sqlite3')
const AIRI = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUTPUT = resolve(args[outputIndex + 1])
const report = { schema: '08.1-host-acceptance/v1', realHttp: true, realSqlite: true, realAiriOwner: true, realModel: false, irodori: false, checks: {}, gaps: [] }
let sandbox
let service
let owner
let stage = 'initializing'
const serviceLogs = []
let fileStorage

function mark(name, ok, detail = undefined) {
  report.checks[name] = detail === undefined ? { ok } : { ok, detail }
}
function safeCode(error) {
  const match = typeof error?.message === 'string' && error.message.match(/(?:memory\.)?([A-Z][A-Z0-9_]{2,}|[a-z][a-z0-9_]{2,})/)
  return match?.[1]?.toLowerCase() ?? 'unexpected_error'
}
async function waitFor(read, predicate, label, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) {
    last = await read()
    if (predicate(last))
      return last
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`acceptance.${label}_timeout`)
}

try {
  sandbox = await mkdtemp(join(tmpdir(), 'metrodoros-081-owner-'))
  const portServer = await import('node:net').then(({ createServer }) => new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  }))
  await mkdir(join(sandbox, 'data'), { recursive: true })
  await writeFile(join(sandbox, 'config.json'), JSON.stringify({ host: '127.0.0.1', port: portServer, recallWaitMs: 100, turnPreparationMs: 100 }))
  const serverUrl = pathToFileURL(join(METRO, 'apps/server/src/bootstrap/cli.ts')).href
  const [{ runCli }, { loadConfig }, { startService }, { MemoryOwner }, { FileStorage }, { emptyMemorySnapshot }] = await Promise.all([
    import(serverUrl),
    import(pathToFileURL(join(METRO, 'apps/server/src/bootstrap/config.ts')).href),
    import(pathToFileURL(join(METRO, 'apps/server/src/bootstrap/service.ts')).href),
    import(pathToFileURL(join(AIRI, 'packages/stage-ui/src/services/memory/owner.ts')).href),
    import('@metrodoros/airi-adapter/desktop'),
    import(pathToFileURL(join(AIRI, 'packages/stage-ui/src/services/memory/contracts.ts')).href),
  ])
  const cliOutput = []
  const cliErrors = []
  const cliEnv = { ...process.env, METRODOROS_DATA_DIR: sandbox }
  const setupStatus = await runCli(['setup', '--target', '6', '--permission', 'identity:read', '--permission', 'identity:write', '--permission', 'memory:read', '--permission', 'memory:write', '--permission', 'events:write', '--permission', 'observations:write', '--permission', 'session:write', '--permission', 'sharing:write', '--permission', 'context:read', '--permission', 'outputs:write', '--permission', 'changes:read', '--permission', 'changes:ack', '--permission', 'operations:read', '--permission', 'jobs:read', '--permission', 'llm:read', '--permission', 'llm:manage'], cliEnv, { output: line => cliOutput.push(line), error: line => cliErrors.push(line) })
  const provisioned = cliOutput.map((line) => {
    try {
      return JSON.parse(line)
    }
    catch { return null }
  }).find(value => value && typeof value.token === 'string')
  mark('setup_target6_custom_io', setupStatus === 0 && !!provisioned && cliErrors.length === 0)
  if (!provisioned)
    throw new Error('acceptance.provision_failed')
  stage = 'service_start'
  const config = await loadConfig(cliEnv)
  service = await startService(config, { watchIntervalMs: 100, notReadyGraceMs: 2000, log: (entry) => {
    serviceLogs.push({ route: entry.route, result_code: entry.result_code })
  } })
  const endpoint = `http://127.0.0.1:${portServer}`
  const identityResponse = await fetch(`${endpoint}/v1/airi/connection`, { headers: { authorization: `Bearer ${provisioned.token}` } })
  const identity = identityResponse.ok ? await identityResponse.json() : null
  mark('authenticated_connection_identity', identityResponse.status === 200 && identity?.user_id === provisioned.user_id && identity?.client_id === provisioned.client_id && typeof identity?.store_generation === 'string')
  const unauthenticated = await fetch(`${endpoint}/v1/airi/connection`)
  mark('unauthenticated_connection_rejected', unauthenticated.status === 401)

  const stopLog = []
  const speechLog = []
  let profile = { ...emptyMemorySnapshot().profile, endpoint, enabled: false }
  const privateSessions = new Set()
  owner = new MemoryOwner({
    installationId: `acceptance-${randomUUID()}`,
    loadProfile: async () => profile,
    saveProfile: async (next) => { profile = structuredClone(next) },
    loadPrivateSessions: async () => [...privateSessions],
    rememberPrivateSession: async (id) => { privateSessions.add(id) },
    storage: async (namespace) => {
      report.storageNamespace = namespace
      fileStorage = new FileStorage(resolve(sandbox, 'airi', `${namespace}.sqlite`))
      return fileStorage
    },
  })
  await owner.registerHost('acceptance-conversation', 'conversation', async (request) => {
    stopLog.push({ actor: 'conversation', kind: request.kind })
    return true
  })
  await owner.registerHost('acceptance-speech', 'speech', async (request) => {
    stopLog.push({ actor: 'speech', kind: request.kind })
    return true
  }, async (input) => {
    speechLog.push(input.type)
    return true
  })
  stage = 'owner_connect'
  let connected = await owner.command({ kind: 'connect', token: provisioned.token })
  mark('owner_connected_to_real_service', connected.connected && connected.identity?.user_id === identity.user_id && connected.identity?.client_id === identity.client_id)

  let wrongActorRejected = false
  try {
    await owner.prepare('other-actor', 'wrong-actor-ref', { conversation: { turns: [] }, sessionId: randomUUID(), userMessageId: randomUUID(), attemptId: randomUUID(), deadlineAt: Date.now() + 500, model: 'acceptance-model', providerId: 'acceptance-provider', cardId: 'acceptance-card', inputKind: 'typed', appInstructionIds: [] }, Date.now() + 500)
  }
  catch (error) { wrongActorRejected = safeCode(error) === 'owner_lost' }
  mark('different_actor_refused', wrongActorRejected)
  stage = 'identity_seed'
  const identityHeaders = { 'authorization': `Bearer ${provisioned.token}`, 'content-type': 'application/json' }
  const [characterResponse, worldResponse] = await Promise.all([
    fetch(`${endpoint}/v1/characters`, { method: 'POST', headers: { ...identityHeaders, 'idempotency-key': `acceptance-character-${randomUUID()}` }, body: JSON.stringify({ display_name: 'Acceptance character', profile: { name: 'Acceptance character', first_person: 'I', speaking_style: '', background: '', values: [] } }) }),
    fetch(`${endpoint}/v1/worlds`, { method: 'POST', headers: { ...identityHeaders, 'idempotency-key': `acceptance-world-${randomUUID()}` }, body: JSON.stringify({ name: 'Acceptance world', realm: 'fiction' }) }),
  ])
  const characterCreated = characterResponse.ok ? await characterResponse.json() : null
  const worldCreated = worldResponse.ok ? await worldResponse.json() : null
  await owner.command({ kind: 'refresh' })
  connected = await owner.command({ kind: 'snapshot' })
  const characterId = characterCreated?.character_id ?? connected.characters[0]?.id
  const worldId = worldCreated?.world_id ?? connected.worlds[0]?.id
  let clientBindingCreated = false
  if (characterId) {
    const bindingResponse = await fetch(`${endpoint}/v1/client-bindings`, { method: 'POST', headers: { ...identityHeaders, 'idempotency-key': `acceptance-binding-${randomUUID()}` }, body: JSON.stringify({ external_character_id: 'acceptance-card', character_id: characterId }) })
    clientBindingCreated = bindingResponse.status === 201
  }
  let worldMembershipCreated = false
  if (worldId && characterId) {
    const membershipResponse = await fetch(`${endpoint}/v1/worlds/${worldId}/members`, { method: 'PUT', headers: { ...identityHeaders, 'idempotency-key': `acceptance-membership-${randomUUID()}` }, body: JSON.stringify({ expected_revision: worldCreated?.revision ?? 1, character_ids: [characterId] }) })
    worldMembershipCreated = membershipResponse.ok
  }
  mark('real_identity_character_world_created', !!characterId && !!worldId && clientBindingCreated && worldMembershipCreated)
  if (!characterId || !worldId)
    throw new Error('acceptance.identity_seed_failed')
  stage = 'owner_configure'
  await owner.command({ kind: 'bind-card', cardId: 'acceptance-card', characterId, worldId })
  profile = { ...profile, enabled: true }
  const withoutModelBinding = await owner.command({ kind: 'save', profile })
  mark('missing_model_binding_not_configured', withoutModelBinding.connected && !withoutModelBinding.configured)
  const unresolved = await owner.command({ kind: 'bind-model', providerId: 'acceptance-provider', model: 'acceptance-model', externalProfileId: 'acceptance-profile' })
  mark('unresolved_model_versions_not_configured', unresolved.connected && !unresolved.configured)
  const profileResponse = await fetch(`${endpoint}/v1/llm-profiles`, { method: 'POST', headers: { ...identityHeaders, 'idempotency-key': `acceptance-profile-${randomUUID()}` }, body: JSON.stringify({ provider: 'acceptance', model: 'acceptance-model', base_url: 'http://127.0.0.1:1', secret_ref: null, capabilities: { structured_output: false, max_input_tokens: 8000, max_output_tokens: 1000, supports_cancel: true, resource_class: 'remote' } }) })
  if (!profileResponse.ok)
    throw new Error('acceptance.model_profile_create_failed')
  const modelProfile = await profileResponse.json()
  const modelBindingResponse = await fetch(`${endpoint}/v1/llm-bindings/acceptance-profile`, { method: 'PUT', headers: { ...identityHeaders, 'idempotency-key': `acceptance-model-binding-${randomUUID()}` }, body: JSON.stringify({ profile_id: modelProfile.profile_id, expected_revision: 0 }) })
  if (!modelBindingResponse.ok)
    throw new Error('acceptance.model_profile_bind_failed')
  connected = await owner.command({ kind: 'bind-model', providerId: 'acceptance-provider', model: 'acceptance-model', externalProfileId: 'acceptance-profile', bindingRevision: 1, profileId: modelProfile.profile_id, profileRevision: modelProfile.revision })
  mark('owner_enabled_and_synchronized', connected.configured && connected.connected && connected.identity?.store_generation === identity.store_generation)

  stage = 'prepare_turn'
  let prepared
  try {
    const sessionId = randomUUID()
    const userMessageId = randomUUID()
    const deadlineAt = Date.now() + 900
    prepared = await owner.prepare('acceptance-conversation', 'acceptance-ref', { conversation: { turns: [{ type: 'user', id: userMessageId, content: [{ type: 'text', text: 'acceptance fixture' }] }] }, sessionId, userMessageId, attemptId: randomUUID(), deadlineAt, model: 'acceptance-model', providerId: 'acceptance-provider', cardId: 'acceptance-card', inputKind: 'typed', appInstructionIds: [] }, deadlineAt)
    mark('real_prepare', prepared.mode === 'memory', prepared.mode === 'memory' ? undefined : prepared.reason ?? prepared.mode)
    if (prepared.mode !== 'memory')
      report.gaps.push({ check: 'real_prepare', result: prepared.reason ?? prepared.mode })
  }
  catch (error) { mark('real_prepare', false, safeCode(error)) }
  if (prepared?.mode === 'memory' && prepared.referenceId) {
    const wrongGate = await owner.gate('other-actor', prepared.referenceId, 'initial')
    const rightGate = await owner.gate('acceptance-conversation', prepared.referenceId, 'initial')
    mark('owner_gate_actor_and_send', !wrongGate.allow && rightGate.allow)
    const database = new ServerDatabase(resolve(sandbox, 'data/metrodoros.sqlite'))
    const pinned = await waitFor(async () => database.prepare('SELECT llm_profile_id,llm_profile_revision FROM consolidation_turn_profiles LIMIT 1').get(), Boolean, 'model_profile_pin')
    mark('server_pinned_exact_model_versions', pinned.llm_profile_id === modelProfile.profile_id && pinned.llm_profile_revision === modelProfile.revision)
    const audioKey = { intentId: 'acceptance-intent', streamId: 'acceptance-stream', segmentId: 'acceptance-segment' }
    await owner.report('acceptance-speech', prepared.referenceId, { kind: 'tts-request', key: audioKey, text: 'synthetic acceptance output' })
    await owner.report('acceptance-speech', prepared.referenceId, { kind: 'playback-start', key: audioKey })
    await owner.report('acceptance-conversation', prepared.referenceId, { kind: 'speech-input', type: 'start' })
    await owner.report('acceptance-conversation', prepared.referenceId, { kind: 'speech-input', type: 'end' })
    await owner.report('acceptance-conversation', prepared.referenceId, { kind: 'llm-finished', outcome: 'completed', text: 'synthetic acceptance output', assistantMessageId: 'acceptance-assistant' })
    await owner.displayed('acceptance-assistant')
    await owner.report('acceptance-speech', prepared.referenceId, { kind: 'speech-complete' })
    await owner.report('acceptance-speech', prepared.referenceId, { kind: 'playback-end', key: audioKey })
    await owner.report('acceptance-speech', prepared.referenceId, { kind: 'intent-end', intentId: audioKey.intentId })
    await waitFor(async () => await owner.command({ kind: 'snapshot' }), snapshot => !!snapshot.connected, 'post_delivery_connection')
    mark('speech_reports_routed', speechLog.join(',') === 'start,end')
    mark('dom_receipt_reported', true)
    const outputLogged = await waitFor(async () => serviceLogs.some(entry => entry.route === '/v1/outputs' && entry.result_code === '201'), Boolean, 'output_registration')
    mark('real_output_endpoint_responded', outputLogged)
    const outputStateLogged = await waitFor(async () => serviceLogs.some(entry => entry.route.endsWith('/state') && entry.route.startsWith('/v1/outputs/') && entry.result_code === '200'), Boolean, 'output_state_commit')
    mark('real_output_commit', outputStateLogged)
    const closed = await waitFor(async () => Number(database.prepare('SELECT COUNT(*) AS count FROM source_events se JOIN source_bodies sb USING(source_id) WHERE se.event_type=\'activity\' AND json_extract(sb.payload_json,\'$.kind\')=\'turn_closed\'').get().count) > 0, Boolean, 'audio_turn_closed')
    mark('audio_delivery_turn_closed_at_server', closed)
    database.close()

    stage = 'display_unavailable_timeout'
    const noDisplaySession = randomUUID()
    await owner.command({ kind: 'new-conversation', airiSessionId: noDisplaySession })
    const noDisplayUser = randomUUID()
    const noDisplayDeadline = Date.now() + 900
    const noDisplayPrepared = await owner.prepare('acceptance-conversation', 'acceptance-no-display-ref', { conversation: { turns: [{ type: 'user', id: noDisplayUser, content: [{ type: 'text', text: 'display timeout fixture' }] }] }, sessionId: noDisplaySession, userMessageId: noDisplayUser, attemptId: randomUUID(), deadlineAt: noDisplayDeadline, model: 'acceptance-model', providerId: 'acceptance-provider', cardId: 'acceptance-card', inputKind: 'typed', appInstructionIds: [] }, noDisplayDeadline)
    if (noDisplayPrepared.mode !== 'memory' || !noDisplayPrepared.referenceId)
      throw new Error('acceptance.no_display_turn_unavailable')
    await owner.gate('acceptance-conversation', noDisplayPrepared.referenceId, 'initial')
    const outputStatesBeforeTimeout = serviceLogs.filter(entry => entry.route.startsWith('/v1/outputs/') && entry.route.endsWith('/state') && entry.result_code === '200').length
    await owner.report('acceptance-conversation', noDisplayPrepared.referenceId, { kind: 'llm-finished', outcome: 'completed', text: 'synthetic timeout output', assistantMessageId: 'acceptance-no-display-assistant' })
    await owner.report('acceptance-speech', noDisplayPrepared.referenceId, { kind: 'speech-complete' })
    const outputStateAfterTimeout = await waitFor(async () => serviceLogs.filter(entry => entry.route.startsWith('/v1/outputs/') && entry.route.endsWith('/state') && entry.result_code === '200').length, count => count > outputStatesBeforeTimeout, 'display_unavailable_commit', 5000)
    mark('display_unavailable_timeout_commits_without_receipt', outputStateAfterTimeout > outputStatesBeforeTimeout)

    stage = 'forget_notification'
    const nextSessionId = randomUUID()
    await owner.command({ kind: 'new-conversation', airiSessionId: nextSessionId })
    const nextUserId = randomUUID()
    const nextDeadline = Date.now() + 900
    const nextPrepared = await owner.prepare('acceptance-conversation', 'acceptance-forget-ref', { conversation: { turns: [{ type: 'user', id: nextUserId, content: [{ type: 'text', text: 'forget fixture' }] }] }, sessionId: nextSessionId, userMessageId: nextUserId, attemptId: randomUUID(), deadlineAt: nextDeadline, model: 'acceptance-model', providerId: 'acceptance-provider', cardId: 'acceptance-card', inputKind: 'typed', appInstructionIds: [] }, nextDeadline)
    if (nextPrepared.mode !== 'memory' || !nextPrepared.referenceId)
      throw new Error('acceptance.forget_turn_unavailable')
    const oldGateAllowed = (await owner.gate('acceptance-conversation', nextPrepared.referenceId, 'initial')).allow
    const stateBeforeForget = await fileStorage.read()
    const inputEvent = Object.values(stateBeforeForget.outbox).find(entry => entry.event_type === 'user_input' && entry.state === 'acked')
    if (!inputEvent)
      throw new Error('acceptance.input_event_missing')
    const forgetBody = { targets: [{ kind: 'event', id: inputEvent.event_id, client_id: identity.client_id }], mode: 'stop_use', include_sources: true }
    const authHeaders = { 'authorization': `Bearer ${provisioned.token}`, 'content-type': 'application/json' }
    const previewResponse = await fetch(`${endpoint}/v1/forget/preview`, { method: 'POST', headers: authHeaders, body: JSON.stringify(forgetBody) })
    const preview = previewResponse.ok ? await previewResponse.json() : null
    if (!preview || !preview.expected_revisions)
      throw new Error('acceptance.forget_preview_failed')
    const stopCountBeforeForget = stopLog.length
    const checkpointBeforeForget = JSON.stringify(stateBeforeForget.checkpoint ?? null)
    const forgetResponse = await fetch(`${endpoint}/v1/forget`, { method: 'POST', headers: { ...authHeaders, 'idempotency-key': `acceptance-forget-${randomUUID()}` }, body: JSON.stringify({ ...forgetBody, expected_revisions: preview.expected_revisions }) })
    mark('real_forget_accepted', forgetResponse.status === 202)
    if (forgetResponse.status !== 202)
      throw new Error('acceptance.forget_execution_failed')
    await waitFor(async () => ({ stopCount: stopLog.length, checkpoint: JSON.stringify((await fileStorage.read()).checkpoint ?? null) }), state => state.stopCount > stopCountBeforeForget && state.checkpoint !== checkpointBeforeForget, 'forget_stop_and_checkpoint')
    const forgetStops = stopLog.slice(stopCountBeforeForget)
    mark('forget_stop_ack_both_hosts', forgetStops.some(item => item.actor === 'conversation') && forgetStops.some(item => item.actor === 'speech'))
    mark('forget_checkpoint_advanced', JSON.stringify((await fileStorage.read()).checkpoint ?? null) !== checkpointBeforeForget)
    mark('forgotten_turn_gate_denied', oldGateAllowed && !(await owner.gate('acceptance-conversation', nextPrepared.referenceId, 'retry')).allow)
  }
  else {
    mark('owner_gate_actor_and_send', false, 'prepare_unavailable')
    mark('speech_reports_routed', false, 'prepare_unavailable')
    mark('dom_receipt_reported', false, 'prepare_unavailable')
    mark('real_output_endpoint_responded', false, 'prepare_unavailable')
    mark('real_output_commit', false, 'prepare_unavailable')
    mark('real_forget_accepted', false, 'prepare_unavailable')
    mark('forget_stop_ack_both_hosts', false, 'prepare_unavailable')
    mark('forget_checkpoint_advanced', false, 'prepare_unavailable')
    mark('forgotten_turn_gate_denied', false, 'prepare_unavailable')
    mark('display_unavailable_timeout_commits_without_receipt', false, 'prepare_unavailable')
  }
  const namespaceBeforeDisconnect = report.storageNamespace ?? null
  await owner.command({ kind: 'disconnect' })
  mark('host_stop_acknowledged_on_disconnect', stopLog.length > 0)
  await owner.command({ kind: 'connect', token: provisioned.token })
  mark('reconnect_identity_namespace_stable', owner && namespaceBeforeDisconnect === (report.storageNamespace ?? null))
  stage = 'revoke_temporary_client'
  const authDb = new ServerDatabase(join(sandbox, 'data', 'metrodoros.sqlite'))
  const revoked = authDb.prepare('UPDATE clients SET revoked=1 WHERE lower(client_id)=lower(?)').run(provisioned.client_id)
  authDb.close()
  const revokedIdentity = await fetch(`${endpoint}/v1/airi/connection`, { headers: { authorization: `Bearer ${provisioned.token}` } })
  mark('revoked_client_auth_rejected', Number(revoked.changes) === 1 && revokedIdentity.status === 401, { status: revokedIdentity.status, rowsChanged: Number(revoked.changes), rowsChangedType: typeof revoked.changes })
  await owner.dispose()
  owner = undefined
  await service.close()
  service = undefined
  report.ok = Object.values(report.checks).every(item => item.ok)
}
catch (error) {
  report.ok = false
  report.failure = safeCode(error)
  report.failureStage = stage
}
finally {
  try {
    await owner?.dispose()
  }
  catch { report.cleanupOwner = false }
  try {
    await service?.close()
  }
  catch { report.cleanupService = false }
  if (sandbox) {
    try {
      const location = relative(resolve(tmpdir()), resolve(sandbox))
      if (isAbsolute(location) || location.startsWith('..') || !location.startsWith('metrodoros-081-owner-') || location.includes('/') || location.includes('\\'))
        throw new Error('acceptance.cleanup_path_rejected')
      await rm(sandbox, { recursive: true, force: true })
    }
    catch { report.cleanupTempData = false }
  }
  if (report.cleanupOwner === false || report.cleanupService === false || report.cleanupTempData === false)
    report.ok = false
  delete report.storageNamespace
  await mkdir(resolve(OUTPUT, '..'), { recursive: true })
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.ok ? 0 : 1
}
