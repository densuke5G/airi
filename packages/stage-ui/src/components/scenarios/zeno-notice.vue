<script setup lang="ts">
import type { ZenoSnapshot } from '../../services/zeno/contracts'

import { Button } from '@proj-airi/ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { observeZenoConnection } from '../../services/zeno/connection'
import { setPresentedZenoNotice } from '../../services/zeno/presented-notice'

const { t } = useI18n()
const snapshot = ref<ZenoSnapshot>()
const notice = computed(() => snapshot.value?.notifications.find(item => item.ack_status === 'unread'))
let unsubscribe: (() => void) | undefined
const stop = observeZenoConnection((connection) => {
  unsubscribe?.()
  snapshot.value = undefined
  if (!connection)
    return
  const update = (value: ZenoSnapshot) => {
    snapshot.value = value
  }
  unsubscribe = connection.subscribe(update)
  void connection.command({ kind: 'snapshot' }).then(update).catch(() => undefined)
})
watch(notice, value => setPresentedZenoNotice(value), { flush: 'post', immediate: true })
onUnmounted(() => {
  stop()
  unsubscribe?.()
  setPresentedZenoNotice(undefined)
})
</script>

<template>
  <aside
    v-if="notice"
    role="status"
    :aria-label="t('zeno.notifications')"
    :class="['absolute bottom-4 left-4 right-4 z-20 mx-auto max-h-52 max-w-lg overflow-auto rounded-xl border p-4 shadow-lg', 'border-neutral-200 bg-white text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100']"
  >
    <h3 class="font-semibold">
      Zeno · {{ notice.title }}
    </h3>
    <p class="mt-2 whitespace-pre-wrap text-sm">
      {{ notice.body }}
    </p>
    <p class="mt-2 text-xs">
      {{ t('zeno.explicit-ack') }}
    </p>
    <Button class="mt-2" @click="$router.push('/settings/zeno')">
      {{ t('zeno.open-notifications') }}
    </Button>
  </aside>
</template>
