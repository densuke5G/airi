import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import DesktopMemorySettingsPanel from './desktop-memory-settings-panel.vue'

import { getDesktopMemorySettings } from '../../../../services/memory/desktop-settings'

const DesktopSettingsHost = defineComponent(() => () => {
  const facade = getDesktopMemorySettings()
  return facade ? h(DesktopMemorySettingsPanel, { facade }) : null
})

describe('desktop memory settings bridge boundary', () => {
  it('renders no desktop controls when the desktop bridge is absent', async () => {
    expect(getDesktopMemorySettings()).toBeNull()
    const html = await renderToString(h(DesktopSettingsHost))

    expect(html).not.toContain('memory-desktop-heading')
  })
})
