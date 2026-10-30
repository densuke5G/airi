import type { CredentialIdentity, StoredCredential } from './credential-store'

export interface DesktopSettings {
  version: 1
  autoStart: boolean
  rememberToken: boolean
  autoConnect: boolean
  needsRegistration: boolean
  nodePath: string
  serverRoot: string
  dataDir: string
}

export function createDefaultDesktopSettings(): DesktopSettings {
  return {
    version: 1,
    autoStart: false,
    rememberToken: false,
    autoConnect: false,
    needsRegistration: false,
    nodePath: '',
    serverRoot: '',
    dataDir: '',
  }
}

export interface DesktopStartupOptions {
  profileEnabled: boolean
  autoStart: boolean
  autoConnect: boolean
  rememberToken: boolean
  needsRegistration: boolean
}

export interface DesktopStartupPorts {
  startServer: () => Promise<void>
  loadCredential: () => Promise<StoredCredential | null>
  connect: (credential: StoredCredential, identity: CredentialIdentity, isCurrent: () => boolean) => Promise<void>
}

/** Run the opt-in desktop startup steps in order, with a stale-work guard between each step. */
export async function runDesktopStartup(options: DesktopStartupOptions, ports: DesktopStartupPorts, signal?: AbortSignal): Promise<void> {
  const current = () => !signal?.aborted
  if (!options.profileEnabled || !current())
    return

  if (options.autoStart)
    await ports.startServer()
  if (!current() || !options.autoConnect || !options.rememberToken || options.needsRegistration)
    return

  const credential = await ports.loadCredential()
  if (!credential || !current())
    return

  const identity: CredentialIdentity = {
    endpoint: credential.endpoint,
    userId: credential.userId,
    clientId: credential.clientId,
    storeGeneration: credential.storeGeneration,
  }
  await ports.connect(credential, identity, current)
}
