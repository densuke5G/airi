<script setup lang="ts">
import type { MemoryCommand, MemoryProfile } from '../../../../services/memory/contracts'

import { errorMessageFrom } from '@moeru/std'
import { BasicButton, FieldCheckbox, FieldInput, FieldSelect } from '@proj-airi/ui'
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import DesktopMemorySettingsPanel from './desktop-memory-settings-panel.vue'

import { connectMemoryToken } from '../../../../services/memory/connection'
import { desktopMemorySettingsFacade } from '../../../../services/memory/desktop-settings'
import { useChatSessionStore } from '../../../../stores/chat/session-store'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useMemoryStore } from '../../../../stores/modules/memory'

const props = defineProps<{ mode: 'short-term' | 'long-term' }>()
const { t, te } = useI18n()
const memory = useMemoryStore()
const desktopFacade = desktopMemorySettingsFacade
const cards = useAiriCardStore()
const consciousness = useConsciousnessStore()
const sessions = useChatSessionStore()
const snapshot = computed(() => memory.snapshot)
const profile = ref<MemoryProfile>(structuredClone(memory.snapshot.profile))
const token = ref('')
const characterName = ref('')
const worldName = ref('')
const externalProfileId = ref('')
const bindingRevision = ref<number>()
const modelProfileId = ref('')
const modelProfileRevision = ref<number>()
const characterId = ref(memory.snapshot.profile.cardBindings.find(binding => binding.cardId === cards.activeCardId)?.characterId ?? '')
const worldId = ref(memory.snapshot.profile.worldId ?? '')
const error = ref<string | null>(null)
const pending = ref(false)
const busy = computed(() => pending.value || memory.busy)
const characterOptions = computed(() => snapshot.value.characters.map(character => ({ value: character.id, label: character.name })))
const worldOptions = computed(() => snapshot.value.worlds.map(world => ({ value: world.id, label: world.name })))
const currentCharacter = computed(() => {
  const binding = profile.value.cardBindings.find(item => item.cardId === cards.activeCardId)
  return snapshot.value.characters.find(character => character.id === binding?.characterId)?.name
    ?? (binding ? t('settings.pages.memory-panel.unknown') : t('settings.pages.memory-panel.none'))
})
const currentWorld = computed(() => snapshot.value.worlds.find(world => world.id === profile.value.worldId)?.name
  ?? profile.value.worldId
  ?? t('settings.pages.memory-panel.none'))
const lastSync = computed(() => snapshot.value.lastSync === null
  ? t('settings.pages.memory-panel.never')
  : new Date(snapshot.value.lastSync).toLocaleString())

function translatedReason(reason: string | null | undefined) {
  if (!reason)
    return null
  const key = `settings.pages.memory-panel.reasons.${reason.replace(/^memory\./, '')}`
  return te(key) ? t(key) : t('settings.pages.memory-panel.connection-error')
}

watch(() => memory.snapshot.profile, value => profile.value = structuredClone(value), { deep: true })
watch(() => memory.snapshot.profile.worldId, value => worldId.value = value ?? '')
watch(() => memory.snapshot.profile.cardBindings, (bindings) => {
  characterId.value = bindings.find(binding => binding.cardId === cards.activeCardId)?.characterId ?? ''
}, { deep: true })

const statusText = computed(() => {
  if (snapshot.value.tokenRequired && profile.value.enabled)
    return t('settings.pages.memory-panel.status.token-required')
  return t(`settings.pages.memory-panel.status.${snapshot.value.state}`)
})

const reasonText = computed(() => translatedReason(snapshot.value.reason))
const errorText = computed(() => translatedReason(error.value ?? memory.error))

onMounted(async () => {
  try {
    await memory.refresh()
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? 'memory.connection_failed'
  }
})

async function run(command: Exclude<MemoryCommand, { kind: 'connect' }>) {
  pending.value = true
  error.value = null
  try {
    await memory.run(command)
    return true
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? 'memory.connection_failed'
    return false
  }
  finally {
    pending.value = false
  }
}

async function connect() {
  const secret = token.value
  if (!secret)
    return
  try {
    pending.value = true
    error.value = null
    await connectMemoryToken(secret)
    await memory.refresh()
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? 'memory.connection_failed'
  }
  finally {
    pending.value = false
    token.value = ''
  }
}

async function saveProfile() {
  await run({ kind: 'save', profile: structuredClone(toRaw(profile.value)) })
}

async function createCharacter() {
  const name = characterName.value.trim()
  if (!name)
    return
  await run({ kind: 'create-character', name })
  characterName.value = ''
}

async function createWorld() {
  const name = worldName.value.trim()
  if (!name)
    return
  await run({ kind: 'create-world', name })
  worldName.value = ''
}

async function startNewConversation() {
  if (!sessions.activeSessionId)
    return
  const closed = await run({ kind: 'new-conversation', airiSessionId: sessions.activeSessionId })
  if (closed && cards.activeCard)
    await sessions.createSession(cards.activeCardId)
}

async function bindCard() {
  if (!cards.activeCard || !characterId.value || !worldId.value)
    return
  await run({ kind: 'bind-card', cardId: cards.activeCardId, characterId: characterId.value, worldId: worldId.value })
}

async function proposePersona() {
  if (!cards.activeCard)
    return
  await run({
    kind: 'propose-persona',
    card: {
      cardId: cards.activeCardId,
      name: cards.activeCard.name,
      description: cards.activeCard.description,
      personality: cards.activeCard.personality,
      scenario: cards.activeCard.scenario,
    },
  })
}

async function bindModel() {
  const providerId = consciousness.activeProvider
  const model = consciousness.activeModel
  if (!model || !providerId || !externalProfileId.value.trim())
    return
  const hasVersions = bindingRevision.value !== undefined || modelProfileId.value.trim() !== '' || modelProfileRevision.value !== undefined
  if (hasVersions && (!Number.isSafeInteger(bindingRevision.value) || (bindingRevision.value ?? 0) < 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(modelProfileId.value.trim()) || !Number.isSafeInteger(modelProfileRevision.value) || (modelProfileRevision.value ?? 0) < 1)) {
    error.value = 'memory.model_binding_invalid'
    return
  }
  await run({ kind: 'bind-model', providerId, model, externalProfileId: externalProfileId.value.trim(), ...(hasVersions ? { bindingRevision: bindingRevision.value, profileId: modelProfileId.value.trim(), profileRevision: modelProfileRevision.value } : {}) })
}
</script>

<template>
  <div :class="['max-w-4xl flex flex-col gap-5', 'pb-8']">
    <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']" aria-labelledby="memory-connection-heading">
      <h2 id="memory-connection-heading" :class="['mb-3 text-lg font-semibold']">
        {{ t('settings.pages.memory-panel.connection') }}
      </h2>
      <div :class="['flex flex-col gap-3']">
        <FieldInput v-model="profile.endpoint" type="url" autocomplete="url" :label="t('settings.pages.memory-panel.endpoint')" />
        <FieldInput v-model="token" type="password" autocomplete="off" :label="t('settings.pages.memory-panel.token')" />
        <p :class="['text-xs text-neutral-500', 'dark:text-neutral-400']">
          {{ t('settings.pages.memory-panel.replacement') }}
        </p>
        <FieldCheckbox v-model="profile.enabled" :label="t('settings.pages.memory-panel.enabled')" />
        <p role="status" :class="['text-sm']">
          {{ t('settings.pages.memory-panel.status-label') }}: {{ statusText }}
        </p>
        <p v-if="reasonText" :class="['text-sm text-orange-700', 'dark:text-orange-300']">
          {{ reasonText }}
        </p>
        <p v-if="snapshot.identity" :class="['break-all text-xs text-neutral-500', 'dark:text-neutral-400']">
          {{ t('settings.pages.memory-panel.identity', { client: snapshot.identity.client_id, generation: snapshot.identity.store_generation }) }}
        </p>
        <p :class="['text-sm']">
          {{ t('settings.pages.memory-panel.pending', { count: snapshot.outboxPending ?? '—' }) }}
        </p>
        <p :class="['text-sm']">
          {{ t('settings.pages.memory-panel.consolidation', { count: snapshot.consolidationPending ?? '—' }) }}
        </p>
        <div :class="['flex flex-wrap gap-2']">
          <BasicButton :disabled="busy" @click="saveProfile">
            {{ t('settings.pages.memory-panel.save') }}
          </BasicButton>
          <BasicButton :disabled="busy || !token" @click="connect">
            {{ t('settings.pages.memory-panel.connect') }}
          </BasicButton>
          <BasicButton :disabled="busy" @click="run({ kind: 'disconnect' })">
            {{ t('settings.pages.memory-panel.disconnect') }}
          </BasicButton>
          <BasicButton :disabled="busy" @click="run({ kind: 'refresh' })">
            {{ t('settings.pages.memory-panel.refresh') }}
          </BasicButton>
        </div>
        <p v-if="errorText" role="alert" :class="['text-sm text-red-700', 'dark:text-red-300']">
          {{ errorText }}
        </p>
      </div>
    </section>

    <DesktopMemorySettingsPanel v-if="desktopFacade" :facade="desktopFacade" />

    <template v-if="props.mode === 'short-term'">
      <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']">
        <h2 :class="['mb-3 text-lg font-semibold']">
          {{ t('settings.pages.memory-panel.current') }}
        </h2>
        <dl :class="['grid gap-2 text-sm sm:grid-cols-2']">
          <div>
            <dt :class="['font-medium']">
              {{ t('settings.pages.memory-panel.card') }}
            </dt><dd>{{ cards.activeCard?.name ?? t('settings.pages.memory-panel.none') }}</dd>
          </div>
          <div>
            <dt :class="['font-medium']">
              {{ t('settings.pages.memory-panel.session') }}
            </dt><dd>{{ sessions.activeSessionId || t('settings.pages.memory-panel.none') }}</dd>
          </div>
          <div>
            <dt :class="['font-medium']">
              {{ t('settings.pages.memory-panel.world') }}
            </dt><dd>{{ currentWorld }}</dd>
          </div>
          <div>
            <dt :class="['font-medium']">
              {{ t('settings.pages.memory-panel.current-character') }}
            </dt><dd>{{ currentCharacter }}</dd>
          </div>
          <div>
            <dt :class="['font-medium']">
              {{ t('settings.pages.memory-panel.current-world') }}
            </dt><dd>{{ currentWorld }}</dd>
          </div>
          <div>
            <dt :class="['font-medium']">
              {{ t('settings.pages.memory-panel.last-sync') }}
            </dt><dd>{{ lastSync }}</dd>
          </div>
          <div>
            <dt :class="['font-medium']">
              {{ t('settings.pages.memory-panel.sync-state') }}
            </dt><dd>{{ snapshot.connected ? t('settings.pages.memory-panel.connected') : t('settings.pages.memory-panel.not-connected') }}</dd>
          </div>
        </dl>
      </section>
      <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']">
        <h2 :class="['mb-3 text-lg font-semibold']">
          {{ t('settings.pages.memory-panel.retention') }}
        </h2>
        <ul :class="['list-disc list-inside text-sm space-y-1']">
          <li>{{ t('settings.pages.memory-panel.limits') }}</li><li>{{ t('settings.pages.memory-panel.observation') }}</li>
        </ul>
      </section>
      <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']">
        <h2 :class="['mb-2 text-lg font-semibold']">
          {{ t('settings.pages.memory-panel.conversation-actions') }}
        </h2>
        <p :class="['mb-3 text-sm text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.memory-panel.new-conversation-note') }}
        </p>
        <BasicButton :disabled="busy || !sessions.activeSessionId" @click="startNewConversation">
          {{ t('settings.pages.memory-panel.new-conversation') }}
        </BasicButton>
      </section>
    </template>

    <template v-else>
      <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']">
        <h2 :class="['mb-3 text-lg font-semibold']">
          {{ t('settings.pages.memory-panel.character-world') }}
        </h2>
        <p :class="['mb-3 text-sm']">
          {{ t('settings.pages.memory-panel.active-card', { name: cards.activeCard?.name ?? t('settings.pages.memory-panel.none') }) }}
        </p>
        <div :class="['flex flex-col gap-3', 'sm:flex-row']">
          <FieldSelect v-model="characterId" :options="characterOptions" :label="t('settings.pages.memory-panel.character')" :placeholder="t('settings.pages.memory-panel.choose-character')" layout="vertical" />
          <FieldSelect v-model="worldId" :options="worldOptions" :label="t('settings.pages.memory-panel.world')" :placeholder="t('settings.pages.memory-panel.choose-world')" layout="vertical" />
        </div>
        <div :class="['mt-3']">
          <BasicButton :disabled="busy || !cards.activeCard || !characterId || !worldId" @click="bindCard">
            {{ t('settings.pages.memory-panel.bind-card') }}
          </BasicButton>
        </div>
        <div :class="['mt-4 flex flex-col gap-2', 'sm:flex-row']">
          <FieldInput v-model="characterName" :label="t('settings.pages.memory-panel.new-character')" />
          <BasicButton :disabled="busy || !characterName.trim()" @click="createCharacter">
            {{ t('settings.pages.memory-panel.create-character') }}
          </BasicButton>
          <FieldInput v-model="worldName" :label="t('settings.pages.memory-panel.new-world')" />
          <BasicButton :disabled="busy || !worldName.trim()" @click="createWorld">
            {{ t('settings.pages.memory-panel.create-world') }}
          </BasicButton>
        </div>
      </section>
      <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']">
        <h2 :class="['mb-2 text-lg font-semibold']">
          {{ t('settings.pages.memory-panel.persona') }}
        </h2>
        <p :class="['mb-3 text-sm']">
          {{ t('settings.pages.memory-panel.persona-note') }}
        </p>
        <BasicButton :disabled="busy || !cards.activeCard" @click="proposePersona">
          {{ t('settings.pages.memory-panel.propose') }}
        </BasicButton>
        <div v-if="snapshot.candidate" :class="['mt-3 border border-neutral-200 rounded-lg p-3 dark:border-neutral-700']">
          <p :class="['whitespace-pre-wrap text-sm']">
            {{ snapshot.candidate.text }}
          </p>
          <p :class="['mt-2 break-all text-xs text-neutral-500']">
            {{ t('settings.pages.memory-panel.digest', { digest: snapshot.candidate.digest }) }}
          </p>
          <BasicButton :class="['mt-3']" :disabled="busy" @click="run({ kind: 'approve-persona', candidateId: snapshot.candidate.candidateId, digest: snapshot.candidate.digest })">
            {{ t('settings.pages.memory-panel.approve') }}
          </BasicButton>
        </div>
      </section>
      <section :class="['rounded-xl bg-neutral-50 p-4', 'dark:bg-black/30']">
        <h2 :class="['mb-2 text-lg font-semibold']">
          {{ t('settings.pages.memory-panel.model-binding') }}
        </h2>
        <p :class="['mb-3 text-sm']">
          {{ t('settings.pages.memory-panel.model-note') }}
        </p>
        <p :class="['mb-3 text-sm']">
          {{ t('settings.pages.memory-panel.active-model', { provider: consciousness.activeProvider || t('settings.pages.memory-panel.unknown'), model: consciousness.activeModel || t('settings.pages.memory-panel.unknown') }) }}
        </p>
        <ul :class="['mb-3 text-sm space-y-2']">
          <li v-for="[key, binding] in Object.entries(profile.modelBindings)" :key="key" :class="['border border-neutral-200 rounded-lg p-3 dark:border-neutral-700']">
            <p :class="['break-all font-medium']">
              {{ key }} → {{ binding.externalProfileId }}
            </p>
            <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.pages.memory-panel.binding-version', { binding: binding.bindingRevision ?? t('settings.pages.memory-panel.unknown'), profile: binding.profileId ?? t('settings.pages.memory-panel.unknown'), revision: binding.profileRevision ?? t('settings.pages.memory-panel.unknown') }) }}
            </p>
          </li>
        </ul>
        <FieldInput v-model="externalProfileId" autocomplete="off" :label="t('settings.pages.memory-panel.external-profile')" />
        <div v-if="externalProfileId.trim()" :class="['mt-3 flex flex-col gap-3']">
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.memory-panel.pin-note') }}
          </p>
          <FieldInput v-model="bindingRevision" type="number" :label="t('settings.pages.memory-panel.binding-revision')" />
          <FieldInput v-model="modelProfileId" autocomplete="off" :label="t('settings.pages.memory-panel.profile-id')" />
          <FieldInput v-model="modelProfileRevision" type="number" :label="t('settings.pages.memory-panel.profile-revision')" />
        </div>
        <BasicButton :class="['mt-3']" :disabled="busy || !externalProfileId.trim()" @click="bindModel">
          {{ t('settings.pages.memory-panel.bind-model') }}
        </BasicButton>
      </section>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.memory-panel.management-unavailable') }}
      </p>
    </template>
  </div>
</template>
