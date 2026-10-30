import { shallowRef } from 'vue'

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

/** UI-only facade. It contains no method that returns or accepts a token. */
export interface DesktopMemorySettingsFacade {
  snapshot: () => Promise<DesktopMemorySettingsSnapshot>
  configure: (update: DesktopMemorySettingsUpdate) => Promise<DesktopMemorySettingsSnapshot>
  retry: () => Promise<DesktopMemorySettingsSnapshot>
  forget: () => Promise<DesktopMemorySettingsSnapshot>
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
