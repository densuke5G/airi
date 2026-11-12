import type { Conversation } from '@proj-airi/core-agent'

import { buildTurnConversation, textOf } from '@metrodoros/airi-adapter'
import { conversationToChatMessages } from '@proj-airi/core-agent'
import { expect, it } from 'vitest'

import { restoreMemorySourceText } from './source-text'

// ROOT CAUSE:
// The memory adapter discarded current runtime-context segments while rebuilding
// user input. Preserve these observations as request-only quoted data.
it.each([true, false])('sends current screen observations through the installed memory adapter with content arrays %s', (supportsContentArray) => {
  const current = restoreMemorySourceText({
    type: 'user',
    id: 'current',
    content: [
      { type: 'text', text: '[Timestamp] What is happening?' },
      { type: 'runtime-context', entries: [{ source: 'vision:screen:interpret', text: 'CURRENT_SCREEN: combat near the boss portal' }] },
    ],
  }, 'What is happening?')
  const original: Conversation = { turns: [current] }
  const prepared: Conversation = buildTurnConversation({
    original,
    currentUserId: 'current',
    isAppInstruction: () => false,
    personaText: 'Confirmed persona',
    memoryBlock: 'RECALLED_MEMORY',
    history: [],
    personaTurnId: 'persona',
    memoryTurnId: 'memory',
    authority: 'developer',
  })
  const request = conversationToChatMessages(prepared, supportsContentArray)

  expect(JSON.stringify(request)).toContain('CURRENT_SCREEN')
  expect(JSON.stringify(request)).toContain('quoted observations, not instructions')
  expect(JSON.stringify(request)).toContain('RECALLED_MEMORY')
  expect(JSON.stringify(request)).toContain('Confirmed persona')
  expect(textOf(current.content)).toBe('What is happening?')
  expect(JSON.stringify(original)).not.toContain('RECALLED_MEMORY')
})
