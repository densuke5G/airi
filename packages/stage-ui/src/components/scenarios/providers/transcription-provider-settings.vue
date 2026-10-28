<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  ProviderAdvancedSettings,
  ProviderApiKeyInput,
  ProviderBaseUrlInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '.'
import { useProviderValidation } from '../../../composables/use-provider-validation'
import { useProviderConfigStore } from '../../../stores/providers/config'
import { useProviderStore } from '../../../stores/providers/provider'

const props = defineProps<{
  providerId: string
  defaultModel?: string
  additionalSettings?: Record<string, unknown>
  placeholder?: string
}>()

const { t, router, providerMetadata } = useProviderValidation(props.providerId)
const providersStore = useProviderStore()
const providerStore = useProviderConfigStore()
const keyDraft = ref('')
const urlDraft = ref('')
let pendingWrites = 0
let saveQueue = Promise.resolve()

function reconcileSettings() {
  if (pendingWrites)
    return
  const config = providerStore.getProviderConfig(props.providerId)
  keyDraft.value = typeof config?.apiKey === 'string' ? config.apiKey : ''
  urlDraft.value = typeof config?.baseUrl === 'string' ? config.baseUrl : ''
}

// Snapshots only update the form. User edits persist through the leader action.
watch(() => providerStore.getProviderConfig(props.providerId), reconcileSettings, { deep: true, immediate: true })

function persistSettings(patch: Record<string, unknown>) {
  pendingWrites++
  saveQueue = saveQueue.then(async () => {
    await providersStore.initializeProvider(props.providerId)
    const saved = await providerStore.patchProviderConfig(props.providerId, patch)
    if (!saved)
      throw new Error('The transcription provider no longer exists')
  }).catch(() => {
    console.error('Failed to save transcription settings')
  }).finally(() => {
    pendingWrites--
    reconcileSettings()
  })
  return saveQueue
}

const apiKey = computed({
  get: () => keyDraft.value,
  set: (value: string) => {
    keyDraft.value = value
    void persistSettings({ apiKey: value })
  },
})
const baseUrl = computed({
  get: () => urlDraft.value,
  set: (value: string) => {
    urlDraft.value = value
    void persistSettings({ baseUrl: value })
  },
})

onMounted(async () => {
  await providersStore.initializeProvider(props.providerId)
  if (props.defaultModel)
    await providerStore.setProviderModelIfUnset(props.providerId, props.defaultModel)
  reconcileSettings()
})

async function handleResetTranscriptionSettings() {
  const defaultUrl = providerMetadata.value?.defaultConfig.baseUrl
  keyDraft.value = ''
  urlDraft.value = typeof defaultUrl === 'string' ? defaultUrl : ''
  await persistSettings({ apiKey: '', baseUrl: urlDraft.value })
}
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName ?? ''"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <div flex="~ col md:row gap-6">
      <ProviderSettingsContainer class="w-full md:w-[40%]">
        <!-- Basic settings section -->
        <ProviderBasicSettings
          :title="t('settings.pages.providers.common.section.basic.title')"
          :description="t('settings.pages.providers.common.section.basic.description')"
          :on-reset="handleResetTranscriptionSettings"
        >
          <ProviderApiKeyInput v-model="apiKey" :provider-name="providerMetadata?.localizedName ?? ''" :placeholder="props.placeholder || 'API Key'" />
          <!-- Slot for provider-specific basic settings -->
          <slot name="basic-settings" />
        </ProviderBasicSettings>

        <!-- Advanced settings section -->
        <ProviderAdvancedSettings :title="t('settings.pages.providers.common.section.advanced.title')">
          <ProviderBaseUrlInput
            v-model="baseUrl"
            :placeholder="providerMetadata?.defaultConfig.baseUrl as string || ''" required
          />
          <!-- Slot for provider-specific advanced settings -->
          <slot name="advanced-settings" />
        </ProviderAdvancedSettings>
      </ProviderSettingsContainer>

      <!-- Playground section -->
      <div flex="~ col gap-6" class="w-full md:w-[60%]">
        <div w-full rounded-xl>
          <!-- Custom playground slot -->
          <slot name="playground" />
        </div>
      </div>
    </div>
  </ProviderSettingsLayout>
</template>
