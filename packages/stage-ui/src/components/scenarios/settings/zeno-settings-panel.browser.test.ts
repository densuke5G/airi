import type { ZenoConnection, ZenoSnapshot } from '../../../services/zeno/contracts'

import locales from '@proj-airi/i18n/locales'

import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ZenoSettingsPanel from './zeno-settings-panel.vue'

import { installZenoConnection } from '../../../services/zeno/connection'

import 'virtual:uno.css'

let uninstall: (() => void) | undefined
afterEach(() => {
  cleanup()
  uninstall?.()
  uninstall = undefined
})
const snapshot: ZenoSnapshot = { connected: true, endpoint: 'http://127.0.0.1:47841', paired: true, error: null, mute: { enabled: true, until: null, updated_at: '2026-11-06T00:00:00.000Z', revision: 1, local_inhibited: true, synchronized: false }, notifications: [] }
it('uses a masked token input and shows unsynchronized mute without writing on display', async () => {
  const command = vi.fn<ZenoConnection['command']>(async () => snapshot)
  uninstall = installZenoConnection({ command, tool: vi.fn(), authorize: vi.fn(), subscribe: (listener) => {
    listener(snapshot)
    return () => {}
  }, registerSpeechHost: () => () => {} })
  const screen = render(ZenoSettingsPanel, { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: locales })] } })
  await expect.element(screen.getByText('Synchronization unconfirmed. Audio remains inhibited.')).toBeVisible()
  expect(screen.container.querySelector('input[type="password"]')).not.toBeNull()
  expect(command).toHaveBeenCalledExactlyOnceWith({ kind: 'snapshot' })
  await screen.getByRole('button', { name: 'Disable meeting mute', exact: true }).click()
  expect(command).toHaveBeenLastCalledWith({ kind: 'mute', enabled: false, until: null })
})
it('explains desktop availability without a transport', async () => {
  const screen = render(ZenoSettingsPanel, { global: { plugins: [createI18n({ legacy: false, locale: 'ja', messages: locales })] } })
  await expect.element(screen.getByRole('status')).toBeVisible()
  expect(screen.getByRole('button').elements()).toHaveLength(0)
})
