import { defineInvokeHandler } from '@moeru/eventa'
import { getElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { getMemoryConnection } from '@proj-airi/stage-ui/services/memory/connection'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { onMounted, onScopeDispose } from 'vue'

import { memoryConversationReady, memoryStartConversation } from '../../shared/eventa/metrodoros'

/** Settings asks main to target this chat window. Session selection remains local to this renderer. */
export function useMemoryConversationControl(): void {
  const cards = useAiriCardStore()
  const sessions = useChatSessionStore()
  const ready = useElectronEventaInvoke(memoryConversationReady)
  onScopeDispose(defineInvokeHandler(getElectronEventaContext(), memoryStartConversation, async ({ cardId, deadlineAt }) => {
    const assertCurrent = () => {
      if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt || cards.activeCardId !== cardId || !cards.activeCard)
        throw new Error('memory.owner_lost')
    }
    assertCurrent()
    if (!sessions.activeSessionId) {
      const currentSession = await sessions.ensureCurrentSession()
      assertCurrent()
      if (currentSession)
        await sessions.setActiveSession(currentSession)
    }
    assertCurrent()
    if (!sessions.activeSessionId)
      throw new Error('memory.conversation_host_unavailable')
    await getMemoryConnection().command({ kind: 'new-conversation', airiSessionId: sessions.activeSessionId })
    assertCurrent()
    const sessionId = await sessions.createSession(cardId, { setActive: false })
    assertCurrent()
    await sessions.setActiveSession(sessionId)
  }))
  onMounted(async () => {
    await ready()
  })
}
