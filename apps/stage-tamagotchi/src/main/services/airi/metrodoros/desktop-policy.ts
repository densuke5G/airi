export type MemoryHostRole = 'conversation' | 'speech'

interface LaunchRegistration {
  autoStart: boolean
  nodePath: string
  serverRoot: string
  dataDir: string
}

/** Require native approval before a renderer enables or replaces a launch target. */
export function requiresLaunchRegistration(previous: LaunchRegistration, next: LaunchRegistration): boolean {
  return next.autoStart && (!previous.autoStart
    || previous.nodePath !== next.nodePath
    || previous.serverRoot !== next.serverRoot
    || previous.dataDir !== next.dataDir)
}

export function hasRequiredMemoryHosts(roles: Iterable<ReadonlySet<MemoryHostRole>>): boolean {
  let conversationReady = false
  let speechReady = false
  for (const actorRoles of roles) {
    conversationReady ||= actorRoles.has('conversation')
    speechReady ||= actorRoles.has('speech')
    if (conversationReady && speechReady)
      return true
  }
  return false
}

export function requiresRegistrationAfterAutomaticFailure(code: string): boolean {
  const normalized = code.toLowerCase()
  return normalized.includes('unauthorized')
    || normalized.includes('unauthenticated')
    || normalized.includes('forbidden')
    || normalized.includes('token_invalid')
    || normalized.includes('saved_identity_mismatch')
    || normalized.includes('store_changed')
    || normalized.includes('credential_store.storage_corrupt')
    || normalized.includes('credential_store.installation_mismatch')
}

export async function forgetWhenRememberingDisabled(previous: boolean, next: boolean, forget: () => Promise<void>): Promise<boolean> {
  if (previous && !next) {
    await forget()
    return true
  }
  return false
}
