import type { ZenoConnection } from './contracts'

let installed: ZenoConnection | undefined
const listeners = new Set<(value: ZenoConnection | undefined) => void>()

/** App startup installs one transport per renderer. Stage mounts can arrive before or after startup. */
export function installZenoConnection(connection: ZenoConnection): () => void {
  installed = connection
  for (const listener of listeners)
    listener(connection)
  return () => {
    if (installed !== connection)
      return
    installed = undefined
    for (const listener of listeners)
      listener(undefined)
  }
}

export function observeZenoConnection(listener: (value: ZenoConnection | undefined) => void): () => void {
  listeners.add(listener)
  listener(installed)
  return () => listeners.delete(listener)
}

export function getZenoConnection(): ZenoConnection | undefined {
  return installed
}
