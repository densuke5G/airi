import { describe, expect, it, vi } from 'vitest'

import { createDefaultDesktopSettings, runDesktopStartup } from './desktop-startup'

const credential = {
  installationId: '10000000-0000-4000-8000-000000000001',
  endpoint: 'http://127.0.0.1:47831',
  userId: '20000000-0000-4000-8000-000000000002',
  clientId: '30000000-0000-4000-8000-000000000003',
  storeGeneration: '40000000-0000-4000-8000-000000000004',
  token: 'encrypted-store-output-only',
}

describe('desktop startup options', () => {
  it('keeps launch, credential storage, and automatic connection off by default', async () => {
    const settings = createDefaultDesktopSettings()
    const startServer = vi.fn(async () => {})
    const loadCredential = vi.fn(async () => credential)
    const connect = vi.fn(async () => {})

    expect(settings.autoStart).toBe(false)
    expect(settings.rememberToken).toBe(false)
    expect(settings.autoConnect).toBe(false)
    await runDesktopStartup({
      profileEnabled: true,
      autoStart: settings.autoStart,
      autoConnect: settings.autoConnect,
      rememberToken: settings.rememberToken,
      needsRegistration: false,
    }, { startServer, loadCredential, connect })

    expect(startServer).not.toHaveBeenCalled()
    expect(loadCredential).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('runs launch then verified-identity credential connection after restart', async () => {
    const order: string[] = []
    const ports = {
      startServer: vi.fn(async () => {
        order.push('start')
      }),
      loadCredential: vi.fn(async () => {
        order.push('load')
        return credential
      }),
      connect: vi.fn(async (_credential, identity, isCurrent) => {
        order.push('connect')
        expect(identity).toEqual({ endpoint: credential.endpoint, userId: credential.userId, clientId: credential.clientId, storeGeneration: credential.storeGeneration })
        expect(isCurrent()).toBe(true)
      }),
    }
    const options = { profileEnabled: true, autoStart: true, autoConnect: true, rememberToken: true, needsRegistration: false }

    await runDesktopStartup(options, ports)

    expect(order).toEqual(['start', 'load', 'connect'])
    expect(ports.connect).toHaveBeenCalledWith(credential, expect.any(Object), expect.any(Function))
  })

  it('does not read credentials after launch settings change during startup', async () => {
    const controller = new AbortController()
    const loadCredential = vi.fn(async () => credential)
    const connect = vi.fn(async () => {})

    await runDesktopStartup({
      profileEnabled: true,
      autoStart: true,
      autoConnect: true,
      rememberToken: true,
      needsRegistration: false,
    }, {
      startServer: async () => controller.abort(),
      loadCredential,
      connect,
    }, controller.signal)

    expect(loadCredential).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })
})
