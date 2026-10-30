import { shallowRef } from 'vue'

/** Source metadata is public. The API key is accepted only by the explicit save command. */
export interface DesktopConsolidationSource {
  providerId: string
  model: string
  baseUrl: string
}

export interface DesktopConsolidationKey extends DesktopConsolidationSource {
  apiKey: string
}

/** Desktop connection settings exposed to the shared UI without renderer secret access. */
export interface DesktopMemorySettingsSnapshot {
  autoStart: boolean
  rememberToken: boolean
  autoConnect: boolean
  nodePath: string
  serverRoot: string
  dataDir: string
  endpoint: string
  credentialAvailable: boolean
  credentialSaved: boolean
  needsRegistration: boolean
  consolidationKeySaved: boolean
  consolidationKeyTargetMatches: boolean
  consolidationSource: DesktopConsolidationSource | null
  error: string | null
}

/** Desktop-specific options that stay outside the cross-platform memory profile. */
export interface DesktopMemorySettingsUpdate {
  autoStart?: boolean
  rememberToken?: boolean
  autoConnect?: boolean
  nodePath?: string
  serverRoot?: string
  dataDir?: string
}

/** Commands sent over the same-window desktop settings channel. */
export type DesktopMemorySettingsCommand
  = { kind: 'snapshot' }
    | { kind: 'configure', update: DesktopMemorySettingsUpdate }
    | { kind: 'retry' }
    | { kind: 'forget' }
    | { kind: 'save-consolidation-key', credential: DesktopConsolidationKey }
    | { kind: 'forget-consolidation-key' }

/** No secret is returned. Saving forwards an already configured provider key to main once. */
export interface DesktopMemorySettingsFacade {
  snapshot: () => Promise<DesktopMemorySettingsSnapshot>
  configure: (update: DesktopMemorySettingsUpdate) => Promise<DesktopMemorySettingsSnapshot>
  retry: () => Promise<DesktopMemorySettingsSnapshot>
  forget: () => Promise<DesktopMemorySettingsSnapshot>
  saveConsolidationKey: (credential: DesktopConsolidationKey) => Promise<DesktopMemorySettingsSnapshot>
  forgetConsolidationKey: () => Promise<DesktopMemorySettingsSnapshot>
  subscribe: (listener: (snapshot: DesktopMemorySettingsSnapshot) => void) => () => void
}

export const desktopMemorySettingsFacade = shallowRef<DesktopMemorySettingsFacade | null>(null)

/** Registers controls only from a desktop renderer bridge. */
export function registerDesktopMemorySettings(facade: DesktopMemorySettingsFacade): () => void {
  desktopMemorySettingsFacade.value = facade
  return () => {
    if (desktopMemorySettingsFacade.value === facade)
      desktopMemorySettingsFacade.value = null
  }
}

/** Returns null when the renderer has no desktop-only bridge. */
export function getDesktopMemorySettings(): DesktopMemorySettingsFacade | null {
  return desktopMemorySettingsFacade.value
}
