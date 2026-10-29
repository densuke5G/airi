<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
</script>

<template>
  <div class="max-w-3xl flex flex-col gap-4">
    <p class="text-sm text-neutral-500 dark:text-neutral-400">
      {{ t('settings.pages.memory-panel.entry-description') }}
    </p>
    <RouterLink class="rounded-xl bg-neutral-50 p-4 font-medium dark:bg-black/30" to="/settings/modules/memory-short-term">
      {{ t('settings.pages.modules.memory-short-term.title') }}
    </RouterLink>
    <RouterLink class="rounded-xl bg-neutral-50 p-4 font-medium dark:bg-black/30" to="/settings/modules/memory-long-term">
      {{ t('settings.pages.modules.memory-long-term.title') }}
    </RouterLink>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
