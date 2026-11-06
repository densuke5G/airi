<script setup lang="ts">
import ZenoSettingsPanel from '@proj-airi/stage-ui/components/scenarios/settings/zeno-settings-panel.vue'
</script>

<template>
  <ZenoSettingsPanel />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: zeno.title
  descriptionKey: zeno.description
  subtitleKey: settings.title
  icon: i-solar:calendar-mark-bold-duotone
  settingsEntry: true
  order: 9
</route>
