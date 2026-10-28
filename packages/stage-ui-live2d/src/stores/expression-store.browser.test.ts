import { createPinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'

import { useExpressionStore } from './expression-store'

function loadFace(id = 'face-a') {
  const store = useExpressionStore(createPinia())
  store.registerExpressions(id, [{
    name: 'happy',
    parameters: [{ parameterId: 'ParamHappy', blend: 'Add', value: 1 }],
  }], [{
    name: 'ParamHappy',
    parameterId: 'ParamHappy',
    blend: 'Add',
    currentValue: 0,
    defaultValue: 0,
    modelDefault: 0,
    targetValue: 1,
  }])
  return store
}

afterEach(() => localStorage.clear())

describe('expression exposure persistence', () => {
  // ROOT CAUSE:
  // Exposure lived only in Pinia and dispose reset it to none after an app restart.
  it('restores custom exposure after unloading and recreating the model store', () => {
    const first = loadFace()
    first.setLlmMode('custom')
    first.setLlmExposed('happy', true)
    first.dispose()
    const restarted = loadFace()
    expect(restarted.llmMode).toBe('custom')
    expect(restarted.isExposedToLlm('happy')).toBe(true)
    expect(restarted.settingsSnapshot.groups[0].exposedToLlm).toBe(true)
  })

  it('keeps all and none choices across restarts and isolates different models', () => {
    const first = loadFace()
    first.setLlmMode('all')
    const restarted = loadFace()
    expect(restarted.llmMode).toBe('all')
    restarted.registerExpressions('face-b', Array.from(restarted.expressionGroups.values()), Array.from(restarted.expressions.values()))
    expect(restarted.llmMode).toBe('none')
    restarted.setLlmMode('custom')
    restarted.setLlmExposed('happy', true)
    const original = loadFace()
    expect(original.llmMode).toBe('all')
    original.setLlmMode('none')
    expect(loadFace().llmMode).toBe('none')
    expect(loadFace('face-b').isExposedToLlm('happy')).toBe(true)
  })

  it('ignores invalid stored permissions and expression names absent from this model', () => {
    localStorage.setItem('expression-llm-policy:face-a', JSON.stringify({ mode: 'custom', exposed: { happy: 'true' } }))
    expect(loadFace().llmMode).toBe('none')
    localStorage.setItem('expression-llm-policy:face-a', JSON.stringify({ mode: 'custom', exposed: { happy: true, missing: true } }))
    const store = loadFace()
    expect(store.isExposedToLlm('happy')).toBe(true)
    expect(store.llmExposed.has('missing')).toBe(false)
    store.setLlmExposed('missing', true)
    expect(store.llmExposed.has('missing')).toBe(false)
  })
})
