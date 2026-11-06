import type { createContext } from '@moeru/eventa/adapters/electron/renderer'
import type { ZenoSpeechRequest, ZenoSpeechResult } from '@proj-airi/stage-ui/services/zeno/contracts'

import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { installZenoConnection } from '@proj-airi/stage-ui/services/zeno/connection'
import { useSpeechOutputControlStore } from '@proj-airi/stage-ui/stores/speech-output-control'

import { zenoAuthorize, zenoCommand, zenoSnapshot, zenoSpeak, zenoStop, zenoTool } from '../../shared/eventa/zeno'

/** The main process retains credentials. Only the registered Stage accepts playback requests. */
export function initializeZenoConnection(context: ReturnType<typeof createContext>['context']): () => void {
  let speak: ((request: ZenoSpeechRequest) => Promise<ZenoSpeechResult>) | undefined
  let stop: (() => Promise<void>) | undefined
  const control = useSpeechOutputControlStore()
  void defineInvoke(context, zenoCommand)({ kind: 'snapshot' }).then((snapshot) => {
    control.setMeetingMuted(!!snapshot.mute?.enabled || !!snapshot.mute?.local_inhibited)
  }).catch(() => undefined)
  const cleanups = [
    defineInvokeHandler(context, zenoSpeak, request => speak ? speak(request) : 'suppressed'),
    defineInvokeHandler(context, zenoStop, async (request) => {
      if (request.allAssistantAudio)
        control.requestStopSpeaking('muted')
      await stop?.()
      return true
    }),
  ]
  const uninstall = installZenoConnection({
    command: defineInvoke(context, zenoCommand),
    tool: (operation, input, turnId) => defineInvoke(context, zenoTool)({ operation, input, turnId }),
    authorize: (attemptId, generation) => defineInvoke(context, zenoAuthorize)({ attemptId, generation }),
    subscribe: listener => context.on(zenoSnapshot, (event) => {
      if (event.body) {
        control.setMeetingMuted(!!event.body.mute?.enabled || !!event.body.mute?.local_inhibited)
        listener(event.body)
      }
    }),
    registerSpeechHost: (handler, cancel) => {
      speak = handler
      stop = cancel
      return () => {
        speak = undefined
        stop = undefined
      }
    },
  })
  const update = context.on(zenoSnapshot, (event) => {
    if (event.body)
      control.setMeetingMuted(!!event.body.mute?.enabled || !!event.body.mute?.local_inhibited)
  })
  return () => {
    uninstall()
    update()
    for (const dispose of cleanups)
      dispose()
  }
}
