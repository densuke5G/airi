// eslint-disable-next-line no-restricted-syntax -- Node ESM requires explicit file extensions.
import type { AiriAdapterClient } from './index.js'

export interface ToolDefinition {
  id: string
  operation: string
  method: string
  path: string
  parameters: Record<string, unknown>
  pathFields: string[]
  queryFields: string[]
  confirmation?: 'planning' | 'focus'
}
export interface ToolStorage {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
}
/** A user turn owns request identities. Notification generation cannot acquire write tools or user confirmations. */
export declare class ConversationTools {
  private readonly client
  private readonly definitions
  private readonly storage
  private readonly confirm
  private readonly calls
  constructor(client: AiriAdapterClient, definitions: readonly ToolDefinition[], storage: ToolStorage, confirm: (kind: 'planning' | 'focus', value: unknown) => Promise<boolean>)
  execute(operation: string, input: Record<string, unknown>, turnId: string, origin: 'user' | 'zeno_notification'): Promise<unknown>
  private invoke
}
