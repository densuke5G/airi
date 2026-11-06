// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
import type { DeliveryClaim, DeliveryClaimInput, DeliveryRecord, DeliveryReportInput, DeliveryValidation, GetSettingsResponse, GetSnapshotResponse, HeartbeatData, HeartbeatInput, MeetingMute, NotificationEnvelope, NotificationList, NotificationView, PatchSettingsResponse, SnoozeInput } from './contracts.js'

export interface AiriClientOptions {
  baseUrl?: string
  bearerToken: string
}
export declare class AiriApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string)
}
export declare class AiriAdapterClient {
  private readonly baseUrl
  private readonly bearerToken
  constructor(options: AiriClientOptions)
  private request
  getHealth(): Promise<{
    data: {
      status: string
    }
    revision: number
    server_time: string
  }>
  getSettings(): Promise<GetSettingsResponse>
  patchSettings(params: {
    timezone: string
    expected_revision: number
    request_id?: string
  }): Promise<PatchSettingsResponse>
  getSnapshot(): Promise<GetSnapshotResponse>
  invoke<T>(path: string, method: string, input?: object): Promise<NotificationEnvelope<T>>
  getNotifications(ack_status?: string, offset?: number, limit?: number): Promise<NotificationEnvelope<NotificationList>>
  getMeetingMute(): Promise<NotificationEnvelope<MeetingMute>>
  private notificationWrite
  acknowledgeNotification(id: string, expected_revision: number, request_id?: string): Promise<NotificationEnvelope<NotificationView>>
  snoozeNotification(id: string, input: SnoozeInput, expected_revision: number, request_id?: string): Promise<NotificationEnvelope<NotificationView>>
  updateMeetingMute(input: {
    enabled: boolean
    until: string | null
  }, expected_revision: number, request_id?: string): Promise<NotificationEnvelope<MeetingMute>>
  heartbeat(input: HeartbeatInput, expected_revision: number, request_id?: string): Promise<NotificationEnvelope<HeartbeatData>>
  startHeartbeat(getState: () => HeartbeatInput, onState: (state: HeartbeatData) => void, onError?: (error: unknown) => void): () => void
  claimDelivery(input: DeliveryClaimInput, expected_revision: number, request_id?: string): Promise<NotificationEnvelope<DeliveryClaim>>
  reportDelivery(input: DeliveryReportInput, expected_revision: number, request_id?: string): Promise<NotificationEnvelope<DeliveryRecord>>
  validateDelivery(attempt_id: string, owner_id: string, character_generation: number): Promise<NotificationEnvelope<DeliveryValidation>>
  subscribeEvents(handlers: {
    lastEventId?: number
    onEvent: (event: {
      id: number
      event: string
      data: unknown
    }) => void
    onError?: (err: Error) => void
    onReset?: (resetData: unknown) => void
    onMuteSafety?: () => void
    onDisconnect?: () => void
  }): () => void
}
// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
export { MeetingMuteController } from './meeting-mute.js'
