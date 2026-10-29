import type { GenerationProvider } from '@proj-airi/provider-inference'

import type { Conversation } from '../messages/types'
import type { ChatHistoryItem } from '../types/chat'
import type { StreamOptions } from '../types/llm'
import type { ChatOrchestratorRuntimeDeps } from './chat-orchestrator-runtime'

import { expect, it, vi } from 'vitest'

import { createChatOrchestratorRuntime } from './chat-orchestrator-runtime'

const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://fixture.test/' } }) }

function harness(prepare: NonNullable<ChatOrchestratorRuntimeDeps['prepareRequestContext']>) {
  const messages: ChatHistoryItem[] = [{ id: 'system', role: 'system', content: 'Old persona' }]
  const projections: unknown[] = []
  let nextId = 0
  const stream = vi.fn(async (_model: string, _provider: GenerationProvider, _context: Conversation, options?: StreamOptions) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'Visible reply' })
    await options?.onStreamEvent?.({ type: 'finish' })
  })
  const runtime = createChatOrchestratorRuntime({
    session: {
      commitUserMessage: async (_session, message) => {
        messages.push(message)
        return { status: 'inserted', messageId: message.id }
      },
      ensureSession: () => {},
      getSessionMessages: () => messages,
      appendSessionMessage: (_session, message) => { messages.push(message) },
      getSessionGeneration: () => 1,
    },
    context: { ingest: () => ({ accepted: true }), snapshot: () => ({}) },
    foregroundStream: { patch: () => {}, reset: () => {} },
    llm: { stream },
    getActiveSessionId: () => 'session',
    getActiveProvider: () => 'fixture',
    createId: () => `id-${++nextId}`,
    prepareRequestContext: prepare,
    onPromptProjection: value => projections.push(value),
  })
  return { runtime, messages, stream, projections }
}

it('uses the transformed Conversation once and excludes it from durable history and prompt projections', async () => {
  let source: Conversation | undefined
  const settled = vi.fn()
  const test = harness(async (input) => {
    source = input.conversation
    return {
      conversation: { turns: [{ type: 'user', id: 'prepared', content: [{ type: 'text', text: 'Private recalled memory' }] }] },
      privateContext: true,
      settled,
    }
  })
  const pending = test.runtime.submit('Current input', { model: 'model', chatProvider: provider }, 'session')
  await pending.accepted
  await pending.done
  expect(test.stream.mock.calls[0][2].turns[0].id).toBe('prepared')
  expect(JSON.stringify(source)).not.toContain('Private recalled memory')
  expect(JSON.stringify(test.messages)).not.toContain('Private recalled memory')
  expect(JSON.stringify(test.projections)).not.toContain('Private recalled memory')
  expect(settled).toHaveBeenCalledExactlyOnceWith({ outcome: 'completed', text: 'Visible reply', assistantMessageId: 'id-2' })
})

it('reports received partial text when the provider fails', async () => {
  const settled = vi.fn()
  const progress = vi.fn()
  const test = harness(async input => ({ conversation: input.conversation, settled, recordProgress: progress }))
  test.stream.mockImplementation(async (_model, _provider, _context, options) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'Partial reply' })
    throw new Error('Fixture transport failure')
  })
  const pending = test.runtime.submit('Question', { model: 'model', chatProvider: provider }, 'session')
  await pending.accepted
  await expect(pending.done).rejects.toThrow('Fixture transport failure')
  expect(progress).toHaveBeenCalledWith('Partial reply')
  expect(settled).toHaveBeenCalledExactlyOnceWith({ outcome: 'failed', text: 'Partial reply', assistantMessageId: 'id-2' })
})

it('aborts a slow preparation at the host deadline and discards late success', async () => {
  let signal: AbortSignal | undefined
  let release: ((value: { conversation: Conversation }) => void) | undefined
  const test = harness(input => new Promise((resolve) => {
    signal = input.signal
    release = resolve
  }))
  const pending = test.runtime.submit('Question', { model: 'model', chatProvider: provider }, 'session')
  await pending.accepted
  await expect(pending.done).rejects.toThrow('deadline exceeded')
  expect(signal?.aborted).toBe(true)
  release?.({ conversation: { turns: [] } })
  await Promise.resolve()
  expect(test.stream).not.toHaveBeenCalled()
})
