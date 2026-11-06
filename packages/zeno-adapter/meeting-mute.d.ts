// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
import type { MeetingMute, NotificationEnvelope } from './contracts.js'

interface MuteClient {
  getMeetingMute: () => Promise<NotificationEnvelope<MeetingMute>>
  updateMeetingMute: (input: {
    enabled: boolean
    until: string | null
  }, expected_revision: number, request_id?: string) => Promise<NotificationEnvelope<MeetingMute>>
}
/** The AIRI integration supplies its real stop-all-audio path. Original mute and microphone settings are never written. */
export declare class MeetingMuteController {
  private readonly client
  private readonly originalSpeechMuted
  private readonly stopAllAudio
  private meetingMuted
  private epoch
  synchronized: boolean
  constructor(client: MuteClient, originalSpeechMuted: () => boolean, stopAllAudio: () => Promise<void> | void)
  get effectiveMuted(): boolean
  disconnected(): void
  synchronize(): Promise<void>
  update(enabled: boolean, until: string | null, expected_revision: number, request_id?: string): Promise<void>
}
export {}
