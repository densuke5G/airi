import type { MemoryCommand } from '../../services/memory/contracts'

import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'

import { getMemoryConnection } from '../../services/memory/connection'
import { emptyMemorySnapshot } from '../../services/memory/contracts'

/** Only non-secret snapshots enter Pinia. Main or the browser owner persists settings. */
export const useMemoryStore = defineStore('modules-memory', () => {
  const snapshot = shallowRef(emptyMemorySnapshot())
  const busy = ref(false)
  const error = ref<string | null>(null)
  const configured = computed(() => snapshot.value.configured)
  let unsubscribe: (() => void) | undefined

  function bind() {
    if (!unsubscribe)
      unsubscribe = getMemoryConnection().subscribe((value) => { snapshot.value = value })
  }

  async function run(command: Exclude<MemoryCommand, { kind: 'connect' }>): Promise<void> {
    busy.value = true
    error.value = null
    try {
      bind()
      snapshot.value = await getMemoryConnection().command(command)
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'memory.connection_failed'
      throw cause
    }
    finally {
      busy.value = false
    }
  }

  async function refresh(): Promise<void> {
    await run({ kind: 'snapshot' })
  }

  onScopeDispose(() => unsubscribe?.())
  return { snapshot, busy, error, configured, run, refresh }
})
