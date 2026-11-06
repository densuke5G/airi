import type { ZenoCommand, ZenoSnapshot, ZenoSpeechRequest, ZenoSpeechResult } from '@proj-airi/stage-ui/services/zeno/contracts'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const zenoCommand = defineInvokeEventa<ZenoSnapshot, ZenoCommand>('eventa:zeno:command')
export const zenoTool = defineInvokeEventa<unknown, { operation: string, input: Record<string, unknown>, turnId: string }>('eventa:zeno:tool')
export const zenoSnapshot = defineEventa<ZenoSnapshot>('eventa:zeno:snapshot')
export const zenoSpeak = defineInvokeEventa<ZenoSpeechResult, ZenoSpeechRequest>('eventa:zeno:speak')
export const zenoStop = defineInvokeEventa<boolean, { allAssistantAudio: boolean }>('eventa:zeno:stop')
export const zenoAuthorize = defineInvokeEventa<boolean, { attemptId: string, generation: number }>('eventa:zeno:authorize')
