import type { MemoryCommand, MemoryDeliveryReport, MemoryPrepared, MemoryPrepareInput, MemorySnapshot, MemorySpeechInput, MemoryStopRequest } from '@proj-airi/stage-ui/services/memory/contracts'
import type { DesktopMemorySettingsCommand, DesktopMemorySettingsSnapshot } from '@proj-airi/stage-ui/services/memory/desktop-settings'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const memoryCommand = defineInvokeEventa<MemorySnapshot, MemoryCommand>('eventa:memory:command')
export const memoryPrepare = defineInvokeEventa<MemoryPrepared, { referenceId: string, input: MemoryPrepareInput, deadlineAt: number }>('eventa:memory:prepare')
export const memoryGate = defineInvokeEventa<{ allow: boolean }, { referenceId: string, kind: 'initial' | 'continuation' | 'retry' }>('eventa:memory:gate')
export const memoryCancel = defineInvokeEventa<void, { referenceId: string }>('eventa:memory:cancel')
export const memoryReport = defineInvokeEventa<void, { referenceId: string, report: MemoryDeliveryReport }>('eventa:memory:report')
export const memoryDisplayed = defineInvokeEventa<void, { assistantMessageId: string }>('eventa:memory:displayed')
export const memoryRegisterHost = defineInvokeEventa<void, { role: 'conversation' | 'speech' }>('eventa:memory:host:register')
export const memoryUnregisterHost = defineInvokeEventa<void, { role: 'conversation' | 'speech' }>('eventa:memory:host:unregister')
export const memoryStop = defineInvokeEventa<boolean, MemoryStopRequest>('eventa:memory:host:stop')
export const memorySnapshotChanged = defineEventa<MemorySnapshot>('eventa:memory:snapshot')

export const memorySpeechInput = defineInvokeEventa<boolean, MemorySpeechInput>('eventa:memory:host:speech-input')
export const desktopMemorySettingsCommand = defineInvokeEventa<DesktopMemorySettingsSnapshot, DesktopMemorySettingsCommand>('eventa:memory:desktop-settings:command')
export const desktopMemorySettingsSnapshotChanged = defineEventa<DesktopMemorySettingsSnapshot>('eventa:memory:desktop-settings:snapshot-changed')

/** Only the selected chat window creates and activates its new local conversation. */
export interface MemoryConversationStart {
  cardId: string
  deadlineAt: number
}
export const memoryStartConversation = defineInvokeEventa<void, MemoryConversationStart>('eventa:memory:conversation:start')
export const memoryConversationReady = defineInvokeEventa<void>('eventa:memory:conversation:ready')
