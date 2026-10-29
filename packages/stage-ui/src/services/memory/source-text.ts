import type { Conversation } from '@proj-airi/core-agent'

import { chatContentToInputSegments } from '@proj-airi/core-agent'

type UserTurn = Extract<Conversation['turns'][number], { type: 'user' }>

/** Keep host timestamp/reply decorations out of original evidence without reverting image projections. */
export function restoreMemorySourceText(turn: UserTurn, sourceContent: Parameters<typeof chatContentToInputSegments>[0]): UserTurn {
  const sourceFirst = chatContentToInputSegments(sourceContent)[0]
  if (turn.content[0]?.type !== 'text')
    return turn
  return {
    ...turn,
    content: sourceFirst?.type === 'text'
      ? [{ ...turn.content[0], text: sourceFirst.text }, ...turn.content.slice(1)]
      : turn.content.slice(1),
  }
}
