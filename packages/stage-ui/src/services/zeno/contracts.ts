import type { DeliveryClaim, MeetingMute, NotificationView } from '@zeno/airi-adapter/contracts'

/** Main owns credentials and leases. Renderers receive public state and scoped playback requests. */
export interface ZenoSnapshot {
  connected: boolean
  endpoint: string
  paired: boolean
  error: string | null
  mute: MeetingMute | null
  notifications: NotificationView[]
}

/** The active Stage reports input activity independently of assistant playback. */
export interface ZenoHostState {
  active: boolean
  characterId: string
  speechState: 'idle' | 'busy' | 'unknown'
}

export type ZenoCommand
  = { kind: 'snapshot' | 'disconnect' | 'refresh' }
    | { kind: 'connect', endpoint: string, token: string }
    | { kind: 'host', state: ZenoHostState }
    | { kind: 'mute', enabled: boolean, until: string | null }
    | { kind: 'ack', id: string }
    | { kind: 'snooze', id: string, minutes: 10 | 30 }

export interface ZenoSpeechRequest {
  claim: DeliveryClaim
  generation: number
}

export type ZenoSpeechResult = 'spoken' | 'failed' | 'unknown' | 'suppressed'

/** The existing preload transports all IPC. No renderer receives an HTTP token. */
export interface ZenoConnection {
  command: (command: ZenoCommand) => Promise<ZenoSnapshot>
  tool: (operation: string, input: Record<string, unknown>, turnId: string) => Promise<unknown>
  authorize: (attemptId: string, generation: number) => Promise<boolean>
  subscribe: (listener: (snapshot: ZenoSnapshot) => void) => () => void
  registerSpeechHost: (handler: (request: ZenoSpeechRequest) => Promise<ZenoSpeechResult>, stop: () => Promise<void>) => () => void
}
