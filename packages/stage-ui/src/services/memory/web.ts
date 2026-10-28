import type { MemoryProfile } from './contracts'

import { IndexedDbStorage } from '@metrodoros/airi-adapter'

import { installMemoryConnection, MemoryConnectionClient } from './connection'
import { MemoryOwner } from './owner'

/** The conversation owner shares one bridge with both settings pages in this tab. */
export function initializeWebMemoryConnection(): void {
  let installationId = localStorage.getItem('metrodoros:installation')
  if (!installationId) {
    installationId = crypto.randomUUID()
    localStorage.setItem('metrodoros:installation', installationId)
  }
  const actor = crypto.randomUUID()
  const owner = new MemoryOwner({
    installationId,
    loadProfile: async () => JSON.parse(localStorage.getItem('metrodoros:settings') ?? 'null') as MemoryProfile | null,
    saveProfile: async (profile) => { localStorage.setItem('metrodoros:settings', JSON.stringify(profile)) },
    loadPrivateSessions: async () => {
      const value: unknown = JSON.parse(localStorage.getItem('metrodoros:private-sessions') ?? '[]')
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
        throw new Error('memory.saved_settings_invalid')
      return value
    },
    rememberPrivateSession: async (sessionId) => {
      const value: unknown = JSON.parse(localStorage.getItem('metrodoros:private-sessions') ?? '[]')
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
        throw new Error('memory.saved_settings_invalid')
      if (!value.includes(sessionId))
        localStorage.setItem('metrodoros:private-sessions', JSON.stringify([...value, sessionId]))
    },
    storage: async namespace => new IndexedDbStorage(`airi-metrodoros:${namespace}`),
  })
  const client = new MemoryConnectionClient({
    command: command => owner.command(command),
    prepare: (referenceId, input, deadlineAt) => owner.prepare(actor, referenceId, input, deadlineAt),
    gate: (referenceId, kind) => owner.gate(actor, referenceId, kind),
    cancel: referenceId => owner.cancel(actor, referenceId),
    report: (referenceId, report) => owner.report(actor, referenceId, report),
    displayed: assistantMessageId => owner.displayed(assistantMessageId),
    registerHost: async (role, stop, feed) => {
      await owner.registerHost(actor, role, stop, feed)
      return () => owner.unregisterHost(actor, role)
    },
    subscribe: listener => owner.subscribe(listener),
  })
  const uninstall = installMemoryConnection(client)
  addEventListener('pagehide', () => {
    client.dispose()
    uninstall()
    void owner.dispose().catch(() => undefined)
  }, { once: true })
}
