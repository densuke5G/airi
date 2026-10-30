import type { createContext } from '@moeru/eventa/adapters/electron/renderer'
import type { MemorySpeechInput, MemoryStopRequest } from '@proj-airi/stage-ui/services/memory/contracts'
import type { DesktopMemorySettingsFacade } from '@proj-airi/stage-ui/services/memory/desktop-settings'

import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { installMemoryConnection, MemoryConnectionClient } from '@proj-airi/stage-ui/services/memory/connection'
import { registerDesktopMemorySettings } from '@proj-airi/stage-ui/services/memory/desktop-settings'

import { desktopMemorySettingsCommand, desktopMemorySettingsSnapshotChanged, memoryCancel, memoryCommand, memoryDisplayed, memoryGate, memoryPrepare, memoryRegisterHost, memoryReport, memorySnapshotChanged, memorySpeechInput, memoryStop, memoryUnregisterHost } from '../../shared/eventa/metrodoros'

/** One renderer client uses the existing preload Eventa transport. Tokens stay out of Pinia. */
export function initializeMemoryConnection(context: ReturnType<typeof createContext>['context']): () => void {
  const handlers = new Map<'conversation' | 'speech', (request: MemoryStopRequest) => Promise<boolean>>()
  let speechInput: ((input: MemorySpeechInput) => Promise<boolean>) | undefined
  defineInvokeHandler(context, memorySpeechInput, input => speechInput ? speechInput(input) : false)
  defineInvokeHandler(context, memoryStop, async (request) => {
    const handler = handlers.get(request.kind === 'speech' ? 'speech' : 'conversation')
    return handler ? handler(request) : false
  })
  const client = new MemoryConnectionClient({
    command: defineInvoke(context, memoryCommand),
    prepare: (referenceId, input, deadlineAt) => defineInvoke(context, memoryPrepare)({ referenceId, input, deadlineAt }),
    gate: (referenceId, kind) => defineInvoke(context, memoryGate)({ referenceId, kind }),
    cancel: referenceId => defineInvoke(context, memoryCancel)({ referenceId }),
    report: (referenceId, report) => defineInvoke(context, memoryReport)({ referenceId, report }),
    displayed: assistantMessageId => defineInvoke(context, memoryDisplayed)({ assistantMessageId }),
    subscribe: listener => context.on(memorySnapshotChanged, (event) => {
      if (event.body)
        listener(event.body)
    }),
    registerHost: async (role, handler, feed) => {
      if (role === 'speech')
        speechInput = feed
      handlers.set(role, handler)
      await defineInvoke(context, memoryRegisterHost)({ role })
      return async () => {
        handlers.delete(role)
        if (role === 'speech')
          speechInput = undefined
        await defineInvoke(context, memoryUnregisterHost)({ role })
      }
    },
  })
  const uninstall = installMemoryConnection(client)
  const desktopFacade: DesktopMemorySettingsFacade = {
    snapshot: () => defineInvoke(context, desktopMemorySettingsCommand)({ kind: 'snapshot' }),
    configure: update => defineInvoke(context, desktopMemorySettingsCommand)({ kind: 'configure', update }),
    retry: () => defineInvoke(context, desktopMemorySettingsCommand)({ kind: 'retry' }),
    forget: () => defineInvoke(context, desktopMemorySettingsCommand)({ kind: 'forget' }),
    subscribe: listener => context.on(desktopMemorySettingsSnapshotChanged, (event) => {
      if (event.body)
        listener(event.body)
    }),
  }
  const unregisterDesktopFacade = registerDesktopMemorySettings(desktopFacade)
  return () => {
    client.dispose()
    uninstall()
    unregisterDesktopFacade()
    handlers.clear()
    speechInput = undefined
  }
}
