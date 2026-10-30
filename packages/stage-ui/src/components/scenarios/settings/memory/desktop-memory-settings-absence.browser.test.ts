import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import DesktopMemorySettingsPanel from './desktop-memory-settings-panel.vue'

import { getDesktopMemorySettings } from '../../../../services/memory/desktop-settings'

const DesktopSettingsHost = defineComponent(() => () => {
  const facade = getDesktopMemorySettings()
  return facade ? h(DesktopMemorySettingsPanel, { facade }) : null
})

describe('desktop memory settings bridge boundary', () => {
  afterEach(() => cleanup())

  it('renders no desktop controls when the desktop bridge is absent', async () => {
    const screen = await render(DesktopSettingsHost)

    expect(screen.container.querySelector('#memory-desktop-heading')).toBeNull()
  })
})
