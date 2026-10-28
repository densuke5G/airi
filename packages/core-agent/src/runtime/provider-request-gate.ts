import type { GenerationRequest } from '@proj-airi/provider-inference'

import type { ProviderRequestPolicy, StreamOptions } from '../types/llm'

interface PolicyState {
  denied: boolean
  requests: number
}

// A compatibility retry re-enters streamFrom with the same policy object.
// Keep denial and request identity across SDK and host retry boundaries.
const states = new WeakMap<ProviderRequestPolicy, PolicyState>()

/** A policy refusal ends this attempt across every provider protocol. */
export class ProviderRequestDeniedError extends Error {
  constructor() {
    super('Provider request is no longer authorized')
    this.name = 'ProviderRequestDeniedError'
  }
}

function stateOf(policy: ProviderRequestPolicy): PolicyState {
  let state = states.get(policy)
  if (!state) {
    state = { denied: false, requests: 0 }
    states.set(policy, state)
  }
  return state
}

/** Reject stale selection before tool preparation and immediately before fetch. */
export function assertRequestPolicy(options?: StreamOptions, model?: string, providerId?: string): void {
  const policy = options?.requestPolicy
  if (!policy)
    return
  const state = stateOf(policy)
  if (state.denied || policy.signal.aborted || options?.abortSignal?.aborted
    || !policy.isCurrent()
    || (model !== undefined && model !== policy.model)
    || (providerId !== undefined && providerId !== policy.providerId)) {
    state.denied = true
    throw new ProviderRequestDeniedError()
  }
}

/** Preserve the provider transport while checking every SDK physical request. */
export function guardProviderFetch(transport: GenerationRequest['config']['fetch'], options: StreamOptions | undefined, round: () => number): GenerationRequest['config']['fetch'] {
  const send = transport ?? globalThis.fetch
  if (!options?.requestPolicy)
    return transport
  const policy = options.requestPolicy
  return async (input: URL, init?: RequestInit) => {
    assertRequestPolicy(options)
    const state = stateOf(policy)
    const kind = state.requests === 0 ? 'initial' : round() > 0 ? 'continuation' : 'retry'
    const timeout = AbortSignal.timeout(1000)
    const signals = [timeout, policy.signal]
    if (options.abortSignal)
      signals.push(options.abortSignal)
    if (init?.signal)
      signals.push(init.signal)
    if (input instanceof Request)
      signals.push(input.signal)
    const signal = AbortSignal.any(signals)
    let onAbort: (() => void) | undefined
    try {
      const decision = await Promise.race([
        policy.beforeRequest(kind, signal),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new ProviderRequestDeniedError())
          if (signal.aborted)
            onAbort()
          else
            signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      if (!decision.allow || signal.aborted)
        throw new ProviderRequestDeniedError()
      assertRequestPolicy(options)
    }
    catch {
      state.denied = true
      throw new ProviderRequestDeniedError()
    }
    finally {
      if (onAbort)
        signal.removeEventListener('abort', onAbort)
    }
    state.requests += 1
    // The validation deadline is not the provider generation deadline.
    const sendSignals = [policy.signal]
    if (options.abortSignal)
      sendSignals.push(options.abortSignal)
    if (init?.signal)
      sendSignals.push(init.signal)
    if (input instanceof Request)
      sendSignals.push(input.signal)
    return send(input, { ...init, signal: AbortSignal.any(sendSignals) })
  }
}
