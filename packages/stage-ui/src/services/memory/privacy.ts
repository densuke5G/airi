import type { SerializedIOSpan } from '@proj-airi/stage-shared/types/io-trace'

let protectedTrace = false
const privateTurns = new Set<string>()

/** Protection remains active for this process after memory output can reach a trace. */
export function protectMemoryTraces(): void {
  protectedTrace = true
}
export function memoryTracesProtected(): boolean {
  return protectedTrace
}

export function markPrivateSpeechTurn(turnId: string): void {
  protectMemoryTraces()
  privateTurns.add(turnId)
}

export function isPrivateSpeechTurn(turnId?: string): boolean {
  return turnId !== undefined && privateTurns.has(turnId)
}

/** Keep timing and counts. Free-form attributes, events, and exception messages are excluded. */
export function redactMemorySpan(span: SerializedIOSpan): SerializedIOSpan {
  if (!protectedTrace)
    return span
  const attributes = Object.fromEntries(Object.entries(span.attributes).filter(([, value]) => typeof value === 'number' || typeof value === 'boolean'))
  return { ...span, attributes, events: [], status: { code: span.status.code, message: '' } }
}
