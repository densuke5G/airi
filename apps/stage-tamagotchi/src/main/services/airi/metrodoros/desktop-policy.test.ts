import { describe, expect, it, vi } from 'vitest'

import { forgetWhenRememberingDisabled, hasRequiredMemoryHosts, requiresLaunchRegistration, requiresRegistrationAfterAutomaticFailure } from './desktop-policy'

describe('desktop memory registration policy', () => {
  it('waits for both roles and accepts roles registered by separate actors', () => {
    expect(hasRequiredMemoryHosts([new Set(['conversation'])])).toBe(false)
    expect(hasRequiredMemoryHosts([new Set(['conversation']), new Set(['speech'])])).toBe(true)
    expect(hasRequiredMemoryHosts([new Set(['speech'])])).toBe(false)
  })

  it('requires registration after actual authentication or saved identity rejection', () => {
    expect(requiresRegistrationAfterAutomaticFailure('memory.unauthenticated')).toBe(true)
    expect(requiresRegistrationAfterAutomaticFailure('memory.saved_identity_mismatch')).toBe(true)
    expect(requiresRegistrationAfterAutomaticFailure('memory.unavailable')).toBe(false)
  })

  it('removes a remembered credential when storage is disabled', async () => {
    const forget = vi.fn(async () => {})
    expect(await forgetWhenRememberingDisabled(true, false, forget)).toBe(true)
    expect(forget).toHaveBeenCalledOnce()
    expect(await forgetWhenRememberingDisabled(false, false, forget)).toBe(false)
    expect(forget).toHaveBeenCalledOnce()
  })

  it('requires native registration for first enable and changed paths only', () => {
    const registered = { autoStart: true, nodePath: 'C:/node.exe', serverRoot: 'C:/server', dataDir: 'C:/data' }
    expect(requiresLaunchRegistration({ ...registered, autoStart: false }, registered)).toBe(true)
    expect(requiresLaunchRegistration(registered, { ...registered })).toBe(false)
    expect(requiresLaunchRegistration(registered, { ...registered, nodePath: 'C:/other.exe' })).toBe(true)
    expect(requiresLaunchRegistration(registered, { ...registered, autoStart: false })).toBe(false)
  })
})
