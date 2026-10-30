<script setup lang="ts">
import type { DesktopMemorySettingsFacade, DesktopMemorySettingsSnapshot, DesktopMemorySettingsUpdate } from '../../../../services/memory/desktop-settings'

import { BasicButton, FieldCheckbox, FieldInput } from '@proj-airi/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'

const props = defineProps<{ facade: DesktopMemorySettingsFacade }>()
const { t } = useI18n()
const consciousness = useConsciousnessStore()
const providerConfig = useProviderConfigStore()
const providers = useProviderStore()
const snapshot = ref<DesktopMemorySettingsSnapshot | null>(null)
const nodePath = ref('')
const serverRoot = ref('')
const dataDir = ref('')
const pending = ref(false)
const localError = ref<string | null>(null)
let unsubscribe: (() => void) | undefined

const consolidationSource = computed(() => {
  const providerId = consciousness.activeProvider
  const model = consciousness.activeModel
  if (!providerId || !model)
    return null
  const config = providerConfig.getProviderConfig(providerId)
  if (!config)
    return null
  try {
    const definition = providers.getProviderDefinition(providerId)
    if (!definition.capabilities?.chat?.generation?.supportedProtocols.includes('chat-completions'))
      return null
    const defaults = providers.getDefaultProviderConfig(providerId)
    const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : defaults.baseUrl
    if (typeof config.apiKey !== 'string' || !config.apiKey.trim() || typeof baseUrl !== 'string' || !baseUrl.trim())
      return null
    const url = new URL(baseUrl)
    const safeProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    if (url.username || url.password || url.search || url.hash || !safeProtocol)
      return null
    return { providerId, model, baseUrl }
  }
  catch {
    return null
  }
})

const canSaveConsolidation = computed(() => !!consolidationSource.value && !!snapshot.value?.nodePath && !!snapshot.value?.serverRoot && !!snapshot.value?.dataDir
  && nodePath.value === snapshot.value.nodePath && serverRoot.value === snapshot.value.serverRoot && dataDir.value === snapshot.value.dataDir)

async function saveConsolidationKey(): Promise<void> {
  const source = consolidationSource.value
  if (!source || !canSaveConsolidation.value)
    return
  const apiKey = providerConfig.getProviderConfig(source.providerId)?.apiKey
  if (typeof apiKey !== 'string' || !apiKey.trim())
    return
  pending.value = true
  localError.value = null
  try {
    applySnapshot(await props.facade.saveConsolidationKey({ ...source, apiKey }))
  }
  catch {
    localError.value = 'desktop-settings-unavailable'
  }
  finally {
    pending.value = false
  }
}

async function forgetConsolidationKey(): Promise<void> {
  pending.value = true
  localError.value = null
  try {
    applySnapshot(await props.facade.forgetConsolidationKey())
  }
  catch {
    localError.value = 'desktop-settings-unavailable'
  }
  finally {
    pending.value = false
  }
}

function applySnapshot(value: DesktopMemorySettingsSnapshot): void {
  snapshot.value = value
  nodePath.value = value.nodePath
  serverRoot.value = value.serverRoot
  dataDir.value = value.dataDir
}

onMounted(async () => {
  unsubscribe = props.facade.subscribe(applySnapshot)
  try {
    applySnapshot(await props.facade.snapshot())
  }
  catch {
    localError.value = 'desktop-settings-unavailable'
  }
})

onUnmounted(() => unsubscribe?.())

async function configure(update: DesktopMemorySettingsUpdate): Promise<void> {
  pending.value = true
  localError.value = null
  try {
    applySnapshot(await props.facade.configure(update))
  }
  catch {
    localError.value = 'desktop-settings-unavailable'
  }
  finally {
    pending.value = false
  }
}

async function savePaths(): Promise<void> {
  await configure({ nodePath: nodePath.value, serverRoot: serverRoot.value, dataDir: dataDir.value })
}

async function retry(): Promise<void> {
  pending.value = true
  localError.value = null
  try {
    applySnapshot(await props.facade.retry())
  }
  catch {
    localError.value = 'desktop-settings-unavailable'
  }
  finally {
    pending.value = false
  }
}

async function forget(): Promise<void> {
  pending.value = true
  localError.value = null
  try {
    applySnapshot(await props.facade.forget())
  }
  catch {
    localError.value = 'desktop-settings-unavailable'
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']" aria-labelledby="memory-desktop-heading">
    <h2 id="memory-desktop-heading" :class="['mb-2 text-lg font-semibold']">
      {{ t('settings.pages.memory-panel.desktop.title') }}
    </h2>
    <p :class="['mb-4 text-sm text-neutral-600 dark:text-neutral-300']">
      {{ t('settings.pages.memory-panel.desktop.description') }}
    </p>
    <div v-if="snapshot" :class="['flex flex-col gap-3']">
      <FieldCheckbox
        :model-value="snapshot.autoStart"
        :label="t('settings.pages.memory-panel.desktop.auto-start')"
        :disabled="pending"
        @update:model-value="configure({ autoStart: $event })"
      />
      <FieldCheckbox
        :model-value="snapshot.rememberToken"
        :label="t('settings.pages.memory-panel.desktop.remember-token')"
        :disabled="pending || !snapshot.credentialAvailable"
        @update:model-value="configure({ rememberToken: $event })"
      />
      <FieldCheckbox
        :model-value="snapshot.autoConnect"
        :label="t('settings.pages.memory-panel.desktop.auto-connect')"
        :disabled="pending || !snapshot.rememberToken"
        @update:model-value="configure({ autoConnect: $event })"
      />
      <p v-if="snapshot.rememberToken && !snapshot.credentialSaved" role="status" :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.pages.memory-panel.desktop.fresh-token-required') }}
      </p>
      <p role="status" :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.pages.memory-panel.desktop.credential-status', { available: snapshot.credentialAvailable ? t('settings.pages.memory-panel.desktop.available') : t('settings.pages.memory-panel.desktop.unavailable'), saved: snapshot.credentialSaved ? t('settings.pages.memory-panel.desktop.saved') : t('settings.pages.memory-panel.desktop.not-saved') }) }}
      </p>
      <p v-if="snapshot.needsRegistration" role="alert" :class="['text-sm text-orange-700 dark:text-orange-300']">
        {{ t('settings.pages.memory-panel.desktop.registration-required') }}
      </p>
      <div :class="['grid gap-3']">
        <FieldInput v-model="nodePath" :label="t('settings.pages.memory-panel.desktop.node-path')" autocomplete="off" />
        <FieldInput v-model="serverRoot" :label="t('settings.pages.memory-panel.desktop.server-root')" autocomplete="off" />
        <FieldInput v-model="dataDir" :label="t('settings.pages.memory-panel.desktop.data-directory')" autocomplete="off" />
      </div>
      <div :class="['flex flex-wrap gap-2']">
        <BasicButton :disabled="pending" @click="savePaths">
          {{ t('settings.pages.memory-panel.desktop.save-paths') }}
        </BasicButton>
        <BasicButton :disabled="pending || (!snapshot.autoStart && !snapshot.autoConnect)" @click="retry">
          {{ t('settings.pages.memory-panel.desktop.retry') }}
        </BasicButton>
        <BasicButton :disabled="pending || !snapshot.credentialSaved" @click="forget">
          {{ t('settings.pages.memory-panel.desktop.forget') }}
        </BasicButton>
      </div>
      <div :class="['mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-700']" aria-labelledby="memory-consolidation-key-heading">
        <h3 id="memory-consolidation-key-heading" :class="['mb-2 font-medium']">
          {{ t('settings.pages.memory-panel.desktop.key-title') }}
        </h3>
        <p :class="['mb-3 text-sm text-neutral-600 dark:text-neutral-300']">
          {{ t('settings.pages.memory-panel.desktop.key-description') }}
        </p>
        <p v-if="consolidationSource" :class="['mb-2 break-all text-sm']">
          {{ consolidationSource.providerId }} / {{ consolidationSource.model }} · {{ consolidationSource.baseUrl }}
        </p>
        <p v-else :class="['mb-2 text-sm text-neutral-600 dark:text-neutral-300']">
          {{ t('settings.pages.memory-panel.desktop.key-provider-required') }}
        </p>
        <p role="status" :class="['mb-2 break-all text-sm']">
          {{ t('settings.pages.memory-panel.desktop.key-status', { saved: snapshot.consolidationKeySaved ? t('settings.pages.memory-panel.desktop.saved') : t('settings.pages.memory-panel.desktop.not-saved') }) }}
          <span v-if="snapshot.consolidationSource"> · {{ snapshot.consolidationSource.providerId }} / {{ snapshot.consolidationSource.model }}</span>
        </p>
        <p v-if="snapshot.consolidationKeySaved && !snapshot.consolidationKeyTargetMatches" role="alert" :class="['mb-2 text-sm text-orange-700 dark:text-orange-300']">
          {{ t('settings.pages.memory-panel.desktop.key-target-changed') }}
        </p>
        <div :class="['flex flex-wrap gap-2']">
          <BasicButton :disabled="pending || !snapshot.credentialAvailable || !canSaveConsolidation" @click="saveConsolidationKey">
            {{ t('settings.pages.memory-panel.desktop.key-save') }}
          </BasicButton>
          <BasicButton :disabled="pending || !snapshot.consolidationKeySaved" @click="forgetConsolidationKey">
            {{ t('settings.pages.memory-panel.desktop.key-forget') }}
          </BasicButton>
        </div>
      </div>
      <p v-if="localError || snapshot.error" role="alert" :class="['text-sm text-red-700 dark:text-red-300']">
        {{ t('settings.pages.memory-panel.desktop.error') }}
      </p>
    </div>
  </section>
</template>
