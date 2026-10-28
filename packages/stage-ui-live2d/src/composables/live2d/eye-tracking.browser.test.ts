import type { Live2DEyeFocusSource } from './eye-tracking'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useL2dViewControl } from '../../stores/view-control'
import { useLive2DEyeFocusFor } from './eye-tracking'
import { useSettingsLive2d } from './live2d'

let canvas: HTMLCanvasElement

beforeEach(() => {
  setActivePinia(createPinia())
  useSettingsLive2d().resetState()
  useL2dViewControl().set('scale', 1)
  canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;left:10px;top:20px;width:400px;height:300px'
  document.body.append(canvas)
})

afterEach(() => {
  canvas.remove()
  useSettingsLive2d().resetState()
  useL2dViewControl().set('scale', 1)
})

describe('useLive2DEyeFocusFor', () => {
  it('maps a tracking source into canvas render coordinates', () => {
    useSettingsLive2d().live2dRenderScale = 2
    const focus = useLive2DEyeFocusFor({
      canvas,
      model: { normalizedScale: 1, modelWidth: 1000, modelHeight: 1000 },
      source: { x: 110, y: 70 },
    })

    expect(focus.value).toEqual({ x: 200, y: 100 })
  })

  it('releases focus when the cursor source expires and resumes with fresh coordinates', () => {
    // ROOT CAUSE:
    // Missing cursor input became pixel coordinates (1000, 1000).
    // The SDK treated these as a real target and clamped both eyes toward the lower right.
    // An absent target now releases cursor ownership and restores neutral SDK focus.
    const source = ref<Live2DEyeFocusSource | null>({ x: 110, y: 70 })
    const focus = useLive2DEyeFocusFor({
      canvas,
      model: { normalizedScale: 1, modelWidth: 1000, modelHeight: 1000 },
      source,
    })

    expect(focus.value).toEqual({ x: 200, y: 100 })
    source.value = null
    expect(focus.value).toBeUndefined()
    source.value = { x: 210, y: 120 }
    expect(focus.value).toEqual({ x: 400, y: 200 })
  })

  it('leaves focus absent until both the canvas and the cursor source exist', () => {
    const targetCanvas = ref<HTMLCanvasElement>()
    const source = ref<Live2DEyeFocusSource | null>(null)
    const focus = useLive2DEyeFocusFor({
      canvas: targetCanvas,
      model: { normalizedScale: 1, modelWidth: 1000, modelHeight: 1000 },
      source,
    })

    expect(focus.value).toBeUndefined()
    source.value = { x: 110, y: 70 }
    expect(focus.value).toBeUndefined()
    targetCanvas.value = canvas
    expect(focus.value).toEqual({ x: 200, y: 100 })
  })

  it('keeps model offsets, view scale and render scale for active tracking', () => {
    const settings = useSettingsLive2d()
    settings.live2dRenderScale = 2
    settings.live2dModelEyeOffset = { x: 10, y: -5 }
    useL2dViewControl().set('scale', 0.5)
    const focus = useLive2DEyeFocusFor({
      canvas,
      model: { normalizedScale: 0.8, modelWidth: 1000, modelHeight: 1000 },
      source: { x: 110, y: 70 },
    })

    expect(focus.value).toEqual({ x: 280, y: 60 })
  })
})
