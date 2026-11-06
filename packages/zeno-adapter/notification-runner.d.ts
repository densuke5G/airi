// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
import type { DeliveryClaim, HeartbeatInput, NotificationView } from './contracts.js'
// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
import type { AiriAdapterClient } from './index.js'

export interface NotificationHost {
  state: () => HeartbeatInput
  display: (notification: NotificationView) => Promise<void>
  speak: (claim: DeliveryClaim, authorize: () => Promise<boolean>) => Promise<'spoken' | 'failed' | 'unknown' | 'suppressed'>
  stop: () => Promise<void>
}
/** Only fresh, server-claimed deliveries reach the speech host. Recovery lists never enter ordinary chat or memory. */
export declare class NotificationRunner {
  private readonly client
  private readonly host
  private busy
  private again
  private active
  private generation
  private drained
  constructor(client: AiriAdapterClient, host: NotificationHost)
  refresh(): Promise<void>
  private claim
  private authorize
  private report
  invalidate(): Promise<void>
  stop(): Promise<void>
}
