import { describe, expect, it } from 'vitest'

import { protectMemoryTraces, redactMemorySpan } from './privacy'

describe('memory trace privacy acceptance', () => {
  it('removes free-form content while preserving timing and numeric counts', () => {
    protectMemoryTraces()
    const span = {
      traceId: 'trace',
      spanId: 'span',
      parentSpanId: '',
      name: 'memory.operation',
      kind: 1,
      startTimeNano: '100',
      endTimeNano: '250',
      ended: true,
      attributes: {
        duration_ms: 150,
        item_count: 3,
        success: true,
        user_text: 'private conversation',
        token: 'secret-token',
      },
      events: [{ name: 'tts', timeNano: '200', attributes: { text: 'spoken private text', token: 'secret-token' } }],
      status: { code: 2, message: 'SDK returned secret request body' },
    }
    const redacted = redactMemorySpan(span)
    expect(redacted.attributes).toEqual({ duration_ms: 150, item_count: 3, success: true })
    expect(redacted.events).toEqual([])
    expect(redacted.status).toEqual({ code: 2, message: '' })
    expect(JSON.stringify(redacted)).not.toContain('private')
    expect(JSON.stringify(redacted)).not.toContain('secret')
    expect(redacted.startTimeNano).toBe('100')
    expect(redacted.endTimeNano).toBe('250')
  })
})
