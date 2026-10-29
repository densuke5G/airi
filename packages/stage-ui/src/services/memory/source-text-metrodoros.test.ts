import type { Conversation } from '@proj-airi/core-agent'

import { describe, expect, it } from 'vitest'

import { restoreMemorySourceText } from './source-text'

type UserTurn = Extract<Conversation['turns'][number], { type: 'user' }>

describe('original memory evidence at the AIRI projection boundary', () => {
  it('restores the original statement while keeping image descriptions and runtime content', () => {
    const raw = '紅茶が好きです。覚えておいてください。'
    const turn: UserTurn = { type: 'user', id: 'user', content: [{ type: 'text', text: `[2026-01-01 12:00] [Reply quote] ${raw}` }, { type: 'text', text: '[Image description] a cup' }, { type: 'runtime-context', entries: [{ source: 'test', text: 'current context' }] }] }
    expect(restoreMemorySourceText(turn, [{ type: 'text', text: raw }, { type: 'image_url', image_url: { url: 'image' } }]).content).toEqual([{ type: 'text', text: raw }, ...turn.content.slice(1)])
    expect(turn.content[0]).toMatchObject({ text: expect.stringContaining('[2026-01-01') })
  })

  it('keeps date-like text actually typed by the user', () => {
    const raw = '[2026-01-01 12:00] is part of my message'
    const turn: UserTurn = { type: 'user', id: 'user', content: [{ type: 'text', text: `[2026-02-01 13:00] ${raw}` }] }
    expect(restoreMemorySourceText(turn, raw).content).toEqual([{ type: 'text', text: raw }])
  })

  it('removes only the inserted prefix before an image-first message', () => {
    const turn: UserTurn = { type: 'user', id: 'user', content: [{ type: 'text', text: '[2026-01-01 12:00] ' }, { type: 'text', text: '[Image description] preserved' }, { type: 'text', text: 'original caption' }] }
    expect(restoreMemorySourceText(turn, [{ type: 'image_url', image_url: { url: 'raw-image' } }, { type: 'text', text: 'original caption' }]).content).toEqual(turn.content.slice(1))
  })
})
