import type { ExpressionEntry, ExpressionGroupDefinition } from './expression-store'

import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { useExpressionStore } from './expression-store'

function registerFace() {
  setActivePinia(createPinia())
  const store = useExpressionStore()
  const definitions: ExpressionGroupDefinition[] = [
    { name: 'Neutral', parameters: [{ parameterId: 'LeftEye', blend: 'Multiply', value: 1 }, { parameterId: 'RightEye', blend: 'Multiply', value: 1 }, { parameterId: 'Mouth', blend: 'Overwrite', value: 0 }] },
    { name: 'Wink', parameters: [{ parameterId: 'LeftEye', blend: 'Multiply', value: 0 }, { parameterId: 'RightEye', blend: 'Multiply', value: 1 }, { parameterId: 'Mouth', blend: 'Overwrite', value: 0.8 }] },
    { name: 'Question', parameters: [{ parameterId: 'LeftEye', blend: 'Multiply', value: 1 }, { parameterId: 'RightEye', blend: 'Multiply', value: 1 }, { parameterId: 'Mouth', blend: 'Overwrite', value: -0.15 }] },
  ]
  const entries: ExpressionEntry[] = ['LeftEye', 'RightEye', 'Mouth'].map(name => ({
    name,
    parameterId: name,
    blend: name === 'Mouth' ? 'Overwrite' : 'Multiply',
    currentValue: name === 'Mouth' ? 0 : 1,
    defaultValue: name === 'Mouth' ? 0 : 1,
    modelDefault: name === 'Mouth' ? 0 : 1,
    targetValue: name === 'Mouth' ? 0.8 : 1,
  }))
  store.registerExpressions('face-test', definitions, entries)
  return store
}

describe('expression groups', () => {
  // ROOT CAUSE:
  // A shared open-eye value marked unrelated groups active.
  // Matching every parameter, including zero, identifies the complete expression.
  it('activates a wink from neutral even when the right eye already matches', () => {
    const store = registerFace()
    expect(store.settingsSnapshot.groups.find(group => group.name === 'Neutral')?.active).toBe(true)
    expect(store.settingsSnapshot.groups.find(group => group.name === 'Wink')?.active).toBe(false)
    expect(store.settingsSnapshot.groups.find(group => group.name === 'Question')?.active).toBe(false)

    expect(store.toggle('Wink').success).toBe(true)
    expect(store.expressions.get('LeftEye')?.currentValue).toBe(0)
    expect(store.expressions.get('RightEye')?.currentValue).toBe(1)
    expect(store.expressions.get('Mouth')?.currentValue).toBe(0.8)
    expect(store.settingsSnapshot.groups.find(group => group.name === 'Wink')?.active).toBe(true)

    store.toggle('Wink')
    expect(store.expressions.get('LeftEye')?.currentValue).toBe(1)
    expect(store.expressions.get('Mouth')?.currentValue).toBe(0)
  })

  // ROOT CAUSE:
  // Setting every parameter to one discarded distinct expression targets.
  // Interpolating each target from its model default preserves the expression at each intensity.
  it('sets a group with its own targets and resets it to model defaults', () => {
    const store = registerFace()
    store.set('Wink', true)
    expect(store.expressions.get('LeftEye')?.currentValue).toBe(0)
    expect(store.expressions.get('RightEye')?.currentValue).toBe(1)
    expect(store.expressions.get('Mouth')?.currentValue).toBe(0.8)

    store.set('Wink', false)
    expect(store.expressions.get('LeftEye')?.currentValue).toBe(1)
    expect(store.expressions.get('RightEye')?.currentValue).toBe(1)
    expect(store.expressions.get('Mouth')?.currentValue).toBe(0)

    store.set('Wink', 0.5)
    expect(store.expressions.get('LeftEye')?.currentValue).toBe(0.5)
    expect(store.expressions.get('RightEye')?.currentValue).toBe(1)
    expect(store.expressions.get('Mouth')?.currentValue).toBe(0.4)
  })
})
