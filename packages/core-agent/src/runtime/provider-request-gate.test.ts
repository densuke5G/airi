import type { GenerationProvider } from '@proj-airi/provider-inference'

import type { Conversation } from '../messages/types'
import type { ProviderRequestPolicy } from '../types/llm'

import { describe, expect, it, vi } from 'vitest'

import { streamFrom } from './llm-service'
import { guardProviderFetch } from './provider-request-gate'

const conversation: Conversation = {
  turns: [
    { type: 'system', id: 'app', authority: 'system', content: [{ type: 'text', text: 'App rules' }] },
    { type: 'system', id: 'persona', authority: 'developer', content: [{ type: 'text', text: 'Approved persona' }] },
    { type: 'user', id: 'input', content: [{ type: 'text', text: 'Current question and one memory' }] },
  ],
}

function reply(protocol: 'chat-completions' | 'responses', tool: boolean) {
  if (protocol === 'chat-completions') {
    const delta = tool
      ? { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }
      : { content: 'Done' }
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const output = tool
    ? [{ type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{}' }]
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] }]
  const events = [
    ...output.map(item => ({ type: 'response.output_item.done', item })),
    { type: 'response.completed', response: { output } },
  ]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}

for (const protocol of ['chat-completions', 'responses'] as const) {
  describe(`A81 physical requests: ${protocol}`, () => {
    it('stops a tool continuation at the real SDK fetch boundary', async () => {
      const kinds: string[] = []
      let requests = 0
      const execute = vi.fn(() => 'Tool result')
      const fetch: typeof globalThis.fetch = async () => reply(protocol, ++requests === 1)
      const provider: GenerationProvider = {
        generation: model => protocol === 'responses'
          ? { protocol, webSearch: false, config: { model, baseURL: 'https://fixture.test/', fetch } }
          : { protocol, config: { model, baseURL: 'https://fixture.test/', fetch } },
      }
      const policy: ProviderRequestPolicy = {
        providerId: 'fixture',
        model: 'pinned',
        signal: new AbortController().signal,
        isCurrent: () => true,
        beforeRequest: async (kind) => {
          kinds.push(kind)
          return { allow: kinds.length === 1 }
        },
      }
      await expect(streamFrom({
        model: 'pinned',
        chatProvider: provider,
        conversation,
        options: {
          providerId: 'fixture',
          requestPolicy: policy,
          privateContext: true,
          tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } }, execute }],
        },
      })).rejects.toThrow('no longer authorized')
      expect(requests).toBe(1)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(kinds).toEqual(['initial', 'continuation'])
    })

    it('retains the prepared persona when resolveStep returns the old card prompt', async () => {
      const bodies: string[] = []
      const fetch: typeof globalThis.fetch = async (_url, init) => {
        bodies.push(String(init?.body))
        return reply(protocol, bodies.length === 1)
      }
      const provider: GenerationProvider = {
        generation: model => protocol === 'responses'
          ? { protocol, webSearch: false, config: { model, baseURL: 'https://fixture.test/', fetch } }
          : { protocol, config: { model, baseURL: 'https://fixture.test/', fetch } },
      }
      const tools = [{ type: 'function' as const, function: { name: 'lookup', parameters: { type: 'object', properties: {} } }, execute: () => 'Result' }]
      await streamFrom({
        model: 'pinned',
        chatProvider: provider,
        conversation,
        options: {
          providerId: 'fixture',
          privateContext: true,
          tools,
          requestPolicy: { providerId: 'fixture', model: 'pinned', signal: new AbortController().signal, isCurrent: () => true, beforeRequest: async () => ({ allow: true }) },
          resolveStep: async () => ({ model: 'pinned', providerId: 'fixture', chatProvider: provider, systemPrompt: 'Old card persona', tools }),
        },
      })
      expect(bodies).toHaveLength(2)
      for (const body of bodies) {
        expect(body).not.toContain('Old card persona')
        expect(body.match(/Approved persona/g)).toHaveLength(1)
        expect(body.match(/one memory/g)).toHaveLength(1)
      }
      expect(conversation.turns).toHaveLength(3)
    })
  })
}

it('rechecks selection after a late gate permission and latches the denial', async () => {
  let current = true
  let permit: ((value: { allow: boolean }) => void) | undefined
  const fetch = vi.fn<typeof globalThis.fetch>()
  const policy: ProviderRequestPolicy = {
    providerId: 'fixture',
    model: 'pinned',
    signal: new AbortController().signal,
    isCurrent: () => current,
    beforeRequest: () => new Promise((resolve) => { permit = resolve }),
  }
  const guarded = guardProviderFetch(fetch, { requestPolicy: policy }, () => 0)!
  const pending = guarded(new URL('https://fixture.test/'), {})
  current = false
  permit?.({ allow: true })
  await expect(pending).rejects.toThrow('no longer authorized')
  current = true
  await expect(guarded(new URL('https://fixture.test/'), {})).rejects.toThrow('no longer authorized')
  expect(fetch).not.toHaveBeenCalled()
})

it('gates a temporary HTTP retry with the same attempt', async () => {
  let requests = 0
  const kinds: string[] = []
  const fetch: typeof globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ error: { message: 'Busy' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } })
  }
  await expect(streamFrom({
    model: 'pinned',
    conversation,
    chatProvider: { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://fixture.test/', fetch } }) },
    options: {
      providerId: 'fixture',
      requestPolicy: {
        providerId: 'fixture',
        model: 'pinned',
        signal: new AbortController().signal,
        isCurrent: () => true,
        beforeRequest: async (kind) => {
          kinds.push(kind)
          return { allow: kinds.length === 1 }
        },
      },
    },
  })).rejects.toThrow('no longer authorized')
  expect(requests).toBe(1)
  expect(kinds).toEqual(['initial', 'retry'])
})
