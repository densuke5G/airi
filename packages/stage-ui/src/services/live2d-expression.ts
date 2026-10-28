import type { ExpressionToolResult } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { Tool } from '@xsai/shared-chat'

import { defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/broadcast-channel'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { rawTool } from '@xsai/tool'
import { watch } from 'vue'

import * as v from 'valibot'

import { useLlmStreamingControlStore } from '../stores/ai/chat-llm/streaming-control'

interface ExpressionHostSnapshot {
  ownerId: string
  modelId: string
  names: string[]
}

interface ExpressionRequest {
  ownerId: string
  modelId: string
  name: string
  intensity: number
  duration: number
}

type ExpressionContext = ReturnType<typeof createContext>['context']

const getExpressions = defineInvokeEventa<ExpressionHostSnapshot>('eventa:live2d:expressions:list')
const setExpression = defineInvokeEventa<ExpressionToolResult, ExpressionRequest>('eventa:live2d:expressions:set')
const inputSchema = v.object({
  name: v.string(),
  intensity: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  duration: v.pipe(v.number(), v.minValue(0.1), v.maxValue(30)),
})

// ACT uses standard emotion names. Models can publish a more specific face name.
// Prefer an exact group name, then a related expression when that group is absent.
const emotionExpressionAliases = new Map<string, readonly string[]>([
  ['surprised', ['surprise']],
  ['angry', ['annoyed']],
  ['sad', ['troubled']],
  ['awkward', ['troubled', 'shy']],
  ['question', ['think']],
  ['curious', ['think']],
])

// The channel lives for this renderer's lifetime. Only Stage registers a host.
// Chat renderers discover the host for each request, without copying model state.
let channelContext: ExpressionContext | undefined
let localHost: {
  snapshot: () => ExpressionHostSnapshot
  apply: (request: ExpressionRequest) => ExpressionToolResult
} | undefined

function getContext(): ExpressionContext {
  channelContext ??= createContext(new BroadcastChannel('airi:live2d:expressions')).context
  return channelContext
}

/**
 * Registers the Stage that owns the loaded model and consumes playback ACT emotions.
 * Dispose this host before Stage unmounts.
 * The enabled getter includes renderer selection, pause state, and the expression switch.
 * The speech getter stays true through synthesis gaps and queued audio. It defaults to false.
 * An optional context supplies an isolated transport for browser integration tests.
 */
export function registerLive2DExpressionHost(
  enabled: () => boolean,
  context: ExpressionContext = getContext(),
  speechActive: () => boolean = () => false,
) {
  const store = useExpressionStore()
  const ownerId = crypto.randomUUID()
  let disposed = false
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  // Input generation and queued playback can finish at different times. Stage
  // owns those activities. This host owns only the current face and its release.
  let managedExpression: {
    modelId: string
    expiresAt: number
    followsSpeech: boolean
    heardSpeech: boolean
  } | undefined

  function cancelReset() {
    if (resetTimer != null)
      clearTimeout(resetTimer)
    resetTimer = undefined
  }

  function scheduleReset() {
    cancelReset()
    const current = managedExpression
    if (!current || speechActive())
      return

    const remaining = Math.max(0, current.expiresAt - Date.now())
    // Keep a short pause after speech. Text-only ACTs retain the six-second
    // fallback. Explicit tool durations remain a minimum when speech ends early.
    let delay = remaining
    if (current.heardSpeech)
      delay = current.followsSpeech ? 350 : Math.max(350, remaining)
    resetTimer = setTimeout(() => {
      resetTimer = undefined
      managedExpression = undefined
      // A completed utterance from the previous model cannot reset the new face.
      if (!disposed && current.modelId === store.modelId)
        store.resetAll()
    }, delay)
  }

  const stopSpeech = watch(speechActive, (active) => {
    if (active && managedExpression)
      managedExpression.heardSpeech = true
    scheduleReset()
  }, { flush: 'sync' })
  const host = {
    snapshot(): ExpressionHostSnapshot {
      return {
        ownerId,
        modelId: store.modelId,
        names: !disposed && enabled()
          ? Array.from(store.expressionGroups.keys()).filter(name => store.isExposedToLlm(name))
          : [],
      }
    },
    apply(request: ExpressionRequest, followsSpeech = false): ExpressionToolResult {
      const snapshot = host.snapshot()
      // Recheck identity and exposure after discovery. A model swap or permission
      // change must invalidate a tool already sent to the language model.
      if (request.ownerId !== ownerId || request.modelId !== snapshot.modelId)
        return { success: false, error: 'The Live2D model changed. Request the available expressions again.' }
      const parsed = v.safeParse(inputSchema, request)
      if (!parsed.success || !snapshot.names.includes(request.name))
        return { success: false, error: 'This expression is unavailable or its values are invalid.' }

      // Expressions share parameters. Clear the previous face and its timers
      // before applying the next face, while leaving mouth opening and motions alone.
      cancelReset()
      store.resetAll()
      const result = store.set(request.name, request.intensity)
      managedExpression = {
        modelId: snapshot.modelId,
        expiresAt: Date.now() + request.duration * 1000,
        followsSpeech,
        heardSpeech: speechActive(),
      }
      scheduleReset()
      return result
    },
  }
  localHost = host
  const stopList = defineInvokeHandler(context, getExpressions, host.snapshot)
  const stopSet = defineInvokeHandler(context, setExpression, request => host.apply(request))
  const stopActs = useLlmStreamingControlStore().onSignal((signal) => {
    if (signal.type !== 'act')
      return

    const emotion = signal.payload.emotion
    let name: unknown
    let intensity: unknown = 1
    if (typeof emotion === 'string') {
      name = emotion
    }
    else if (typeof emotion === 'object' && emotion !== null && !Array.isArray(emotion)) {
      const value = emotion as Record<string, unknown>
      name = value.name
      intensity = value.intensity ?? 1
    }
    if (typeof name !== 'string')
      return

    const snapshot = host.snapshot()
    const normalized = name.trim().toLowerCase()
    let group = snapshot.names.find(candidate => candidate.toLowerCase() === normalized)
    if (!group) {
      for (const alias of emotionExpressionAliases.get(normalized) ?? []) {
        group = snapshot.names.find(candidate => candidate.toLowerCase() === alias)
        if (group)
          break
      }
    }
    if (!group)
      return

    // ACT tokens travel with speech playback, so facial changes follow the
    // sentence instead of depending on an optional provider tool call.
    const parsed = v.safeParse(inputSchema, { name: group, intensity, duration: 6 })
    if (parsed.success)
      host.apply({ ...parsed.output, ownerId, modelId: snapshot.modelId }, true)
  })

  return () => {
    disposed = true
    cancelReset()
    stopSpeech()
    stopActs()
    stopList()
    stopSet()
    if (localHost === host)
      localHost = undefined
  }
}

/**
 * Discovers the Stage host and exposes only its permitted expression groups.
 * Commands carry the discovered owner and model IDs and expire after one second.
 * Missing hosts omit the tool. The conversation can continue without a character.
 */
export async function resolveLive2DExpressionTools(options: {
  /** Isolated browser transport. @default the renderer's expression channel */
  context?: ExpressionContext
  /** Bounds host discovery when Stage is absent. @default 250 */
  timeoutMs?: number
} = {}): Promise<Tool[]> {
  if (typeof window === 'undefined')
    return []

  const context = options.context ?? getContext()
  // A host in this renderer can answer directly. BroadcastChannel does not echo
  // a message to the channel object that sent it.
  const host = options.context ? undefined : localHost
  let snapshot: ExpressionHostSnapshot
  try {
    snapshot = host
      ? host.snapshot()
      : await defineInvoke(context, getExpressions)(undefined, { signal: AbortSignal.timeout(options.timeoutMs ?? 250) })
  }
  catch {
    // No model host is a normal state in onboarding and detached chat windows.
    return []
  }
  if (!snapshot.modelId || snapshot.names.length === 0)
    return []

  return [rawTool({
    name: 'expression_set',
    description: 'Choose a facial expression that matches your reply and the conversation. Use this while replying when your feelings change. Return to neutral for an ordinary reply. This changes only the current face and resets automatically. Do not mention this tool in your reply.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: snapshot.names, description: 'An available facial expression.' },
        intensity: { type: 'number', minimum: 0, maximum: 1, description: 'Expression strength. Use 1 for the complete expression.' },
        duration: { type: 'number', minimum: 0.1, maximum: 30, description: 'Seconds before restoring the default face. Use 6 for a typical reply.' },
      },
      required: ['name', 'intensity', 'duration'],
      additionalProperties: false,
    },
    execute: async (input, { abortSignal }) => {
      const parsed = v.safeParse(inputSchema, input)
      if (!parsed.success)
        return JSON.stringify({ success: false, error: 'Invalid expression name, intensity, or duration.' })
      if (abortSignal?.aborted)
        return JSON.stringify({ success: false, error: 'The chat turn was cancelled.' })

      const request: ExpressionRequest = { ...parsed.output, ownerId: snapshot.ownerId, modelId: snapshot.modelId }
      try {
        const result = host
          ? host.apply(request)
          : await defineInvoke(context, setExpression)(request, {
              signal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(1000)]) : AbortSignal.timeout(1000),
            })
        return JSON.stringify(result)
      }
      catch {
        // A closed Stage must report failure instead of claiming a face changed.
        return JSON.stringify({ success: false, error: 'The Live2D expression host did not respond.' })
      }
    },
  })]
}
