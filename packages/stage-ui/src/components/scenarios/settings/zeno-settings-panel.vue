<script setup lang="ts">
import type { ZenoCommand, ZenoSnapshot } from '../../../services/zeno/contracts'

import { Button, FieldInput } from '@proj-airi/ui'
import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { getZenoConnection, observeZenoConnection } from '../../../services/zeno/connection'

const { t } = useI18n()
const snapshot = ref<ZenoSnapshot>()
const endpoint = ref('http://127.0.0.1:47841')
const token = ref('')
const busy = ref(false)
const error = ref(false)
const available = ref(false)
let unsubscribe: (() => void) | undefined
const stop = observeZenoConnection((connection) => {
  unsubscribe?.()
  available.value = !!connection
  if (!connection)
    return
  const update = (value: ZenoSnapshot) => {
    snapshot.value = value
    endpoint.value = value.endpoint
  }
  unsubscribe = connection.subscribe(update)
  void connection.command({ kind: 'snapshot' }).then(update)
})

async function execute(command: ZenoCommand) {
  const connection = getZenoConnection()
  if (!connection || busy.value)
    return
  busy.value = true
  error.value = false
  try {
    snapshot.value = await connection.command(command)
    if (command.kind === 'connect')
      token.value = ''
  }
  catch { error.value = true }
  finally { busy.value = false }
}

onUnmounted(() => {
  stop()
  unsubscribe?.()
})
</script>

<template>
  <section :class="['flex flex-col gap-5', 'text-neutral-800 dark:text-neutral-100']" aria-labelledby="zeno-heading">
    <h2 id="zeno-heading" class="text-xl font-semibold">
      {{ t('zeno.title') }}
    </h2>
    <p>{{ t('zeno.description') }}</p>
    <p v-if="!available" role="status">
      {{ t('zeno.desktop-only') }}
    </p>
    <template v-else>
      <p role="status">
        {{ t(snapshot?.connected ? 'zeno.connected' : 'zeno.disconnected') }}
      </p>
      <p v-if="error || snapshot?.error" role="alert">
        {{ t('zeno.operation-failed') }}
      </p>
      <form :class="['flex flex-col gap-4', 'max-w-xl']" @submit.prevent="execute({ kind: 'connect', endpoint, token })">
        <FieldInput v-model="endpoint" :single-line="true" :label="t('zeno.endpoint')" :disabled="busy" />
        <FieldInput v-model="token" :single-line="true" type="password" autocomplete="off" :label="t('zeno.token')" :description="t('zeno.pairing-help')" :disabled="busy" />
        <div class="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" color="primary" :disabled="busy || !token">
            {{ t('zeno.connect') }}
          </Button>
          <Button type="button" :disabled="busy || !snapshot?.paired" @click="execute({ kind: 'disconnect' })">
            {{ t('zeno.disconnect') }}
          </Button>
          <Button type="button" :disabled="busy || !snapshot?.paired" @click="execute({ kind: 'refresh' })">
            {{ t('zeno.refresh') }}
          </Button>
        </div>
      </form>
      <section :class="['rounded-xl border p-4', 'border-neutral-200 dark:border-neutral-700']" :aria-label="t('zeno.mute')">
        <h3 class="font-semibold">
          {{ t('zeno.mute') }}
        </h3>
        <template v-if="snapshot?.mute">
          <p>{{ t(snapshot.mute.enabled || snapshot.mute.local_inhibited ? 'zeno.muted' : 'zeno.unmuted') }}</p>
          <p>{{ t(snapshot.mute.synchronized === false ? 'zeno.unsynchronized' : 'zeno.synchronized') }}</p>
        </template>
        <p v-else>
          {{ t('zeno.mute-unavailable') }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button :disabled="busy || !snapshot?.connected" @click="execute({ kind: 'mute', enabled: true, until: null })">
            {{ t('zeno.enable-mute') }}
          </Button>
          <Button :disabled="busy || !snapshot?.connected" @click="execute({ kind: 'mute', enabled: false, until: null })">
            {{ t('zeno.disable-mute') }}
          </Button>
        </div>
        <p class="mt-2 text-sm">
          {{ t('zeno.microphone-unchanged') }}
        </p>
      </section>
      <p class="text-sm">
        {{ t('zeno.tool-model-help') }}
      </p>
      <section :aria-label="t('zeno.notifications')">
        <h3 class="font-semibold">
          {{ t('zeno.notifications') }}
        </h3>
        <p class="text-sm">
          {{ t('zeno.explicit-ack') }}
        </p>
        <ul class="mt-3 flex flex-col gap-4">
          <li v-for="notice in snapshot?.notifications" :key="notice.id" :class="['rounded-xl p-4', 'bg-neutral-100 dark:bg-neutral-900']">
            <h4 class="font-semibold">
              {{ notice.title }}
            </h4>
            <p class="whitespace-pre-wrap">
              {{ notice.body }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <Button :disabled="busy || !snapshot?.connected" @click="execute({ kind: 'ack', id: notice.id })">
                {{ t('zeno.ack') }}
              </Button>
              <Button :disabled="busy || !snapshot?.connected" @click="execute({ kind: 'snooze', id: notice.id, minutes: 10 })">
                {{ t('zeno.snooze-ten') }}
              </Button>
              <Button :disabled="busy || !snapshot?.connected" @click="execute({ kind: 'snooze', id: notice.id, minutes: 30 })">
                {{ t('zeno.snooze-thirty') }}
              </Button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
