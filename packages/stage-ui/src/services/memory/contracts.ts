import type { Conversation, PreparedRequestContext } from '@proj-airi/core-agent'

/** Non-secret settings shared by the two memory pages. Capabilities come from the host. */
export interface MemoryProfile {
  endpoint: string
  enabled: boolean
  worldId: string | null
  cardBindings: { cardId: string, characterId: string }[]
  modelBindings: Record<string, {
    externalProfileId: string
    bindingRevision?: number | null
    profileId?: string | null
    profileRevision?: number | null
  }>
}

/** A connection snapshot never contains a token or recalled conversation content. */
export interface MemorySnapshot {
  profile: MemoryProfile
  state: 'disabled' | 'connecting' | 'syncing' | 'ready' | 'degraded' | 'blocked'
  reason: string | null
  connected: boolean
  configured: boolean
  tokenRequired: boolean
  identity: { user_id: string, client_id: string, store_generation: string } | null
  outboxPending: number | null
  consolidationPending: number | null
  lastSync: number | null
  characters: { id: string, name: string }[]
  worlds: { id: string, name: string }[]
  candidate: { candidateId: string, cardId: string, text: string, digest: string } | null
  selection: { cardId: string, airiSessionId: string, modelKey: string | null } | null
  metrics: Record<string, number>
}

/** Finite commands cross IPC. No caller supplies code, storage paths, or HTTP routes. */
export type MemoryCommand
  = { kind: 'snapshot' | 'refresh' | 'disconnect' }
    | { kind: 'save', profile: MemoryProfile }
    | { kind: 'connect', token: string }
    | { kind: 'new-conversation', airiSessionId: string }
    | { kind: 'create-character', name: string }
    | { kind: 'create-world', name: string }
    | { kind: 'bind-card', cardId: string, characterId: string, worldId: string }
    | { kind: 'propose-persona', card: { cardId: string, name?: string, description?: string, personality?: string, scenario?: string } }
    | { kind: 'approve-persona', candidateId: string, digest: string }
    | { kind: 'bind-model', providerId: string, model: string, externalProfileId: string }

/** All identities belong to the actor and selection captured before preparation. */
export interface MemoryPrepareInput {
  conversation: Conversation
  sessionId: string
  userMessageId: string
  attemptId: string
  deadlineAt: number
  model: string
  providerId: string
  cardId: string
  inputKind: 'typed' | 'transcribed'
  appInstructionIds: string[]
}

export interface MemorySpeechInput {
  referenceId: string
  turnId: string
  type: 'start' | 'literal' | 'special' | 'end'
  text?: string
}

export type MemoryDeliveryReport
  = { kind: 'speech-input', type: 'start' | 'literal' | 'special' | 'end', text?: string }
    | { kind: 'progress', text: string }
    | { kind: 'llm-finished', outcome: 'completed' | 'interrupted' | 'failed', text: string, assistantMessageId: string }
    | { kind: 'displayed' | 'display-unavailable' | 'speech-complete' }
    | { kind: 'audio-unavailable', reason: 'muted' | 'noop' | 'streaming_unsupported' | 'synthesis_failed' }
    | { kind: 'intent-end' | 'intent-interrupted', intentId: string }
    | { kind: 'tts-request', key: MemorySpeechKey, text: string }
    | { kind: 'tts-result', key: MemorySpeechKey, elapsedMs: number }
    | { kind: 'playback-start' | 'playback-end' | 'playback-interrupt' | 'playback-fail', key: MemorySpeechKey }

export interface MemorySpeechKey { intentId: string, streamId: string, segmentId: string }

/** The main process retains real handles. Renderers receive only this expiring reference. */
export interface MemoryPrepared {
  mode: 'disabled' | 'memory' | 'degraded' | 'blocked'
  conversation?: Conversation
  referenceId?: string
  ownerGeneration: number
  selectionGeneration: number
  expiresAt: number
  reason?: string
}

export interface MemoryStopRequest {
  kind: 'generation' | 'continuations' | 'speech'
  sessionId: string
  userMessageId?: string
  attemptId?: string
  referenceIds: string[]
}

/** Platform registration supplies the transport. Store state contains no runtime clients. */
export interface MemoryConnection {
  command: (command: MemoryCommand) => Promise<MemorySnapshot>
  prepare: (input: MemoryPrepareInput, signal: AbortSignal) => Promise<PreparedRequestContext>
  report: (referenceId: string, report: MemoryDeliveryReport) => Promise<void>
  displayed: (assistantMessageId: string) => Promise<void>
  registerConversationHost: (stop: (request: MemoryStopRequest) => Promise<boolean>) => Promise<() => Promise<void>>
  registerSpeechHost: (stop: (request: MemoryStopRequest) => Promise<boolean>, feed: (input: MemorySpeechInput) => Promise<boolean>) => Promise<() => Promise<void>>
  subscribe: (listener: (snapshot: MemorySnapshot) => void) => () => void
}

export function emptyMemorySnapshot(): MemorySnapshot {
  return {
    profile: { endpoint: 'http://127.0.0.1:47831', enabled: false, worldId: null, cardBindings: [], modelBindings: {} },
    state: 'disabled',
    reason: null,
    connected: false,
    configured: false,
    tokenRequired: true,
    identity: null,
    outboxPending: null,
    consolidationPending: null,
    lastSync: null,
    characters: [],
    worlds: [],
    candidate: null,
    selection: null,
    metrics: {},
  }
}
