<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  conservationStore,
  plantFor,
  speciesForPlant,
  type Observation,
} from '../../data/conservation'
const { t, te, locale } = useI18n()
const keyFor = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const label = (value: string | undefined) => {
  if (!value) return '—'
  const key = `conservationPages.observations.values.${keyFor(value)}`
  const shared = `dashboardValues.${keyFor(value)}`
  return te(key) ? t(key) : te(shared) ? t(shared) : value
}
const speciesName = (plantId: string) => {
  const sp = speciesForPlant(plantId)
  if (!sp) return t('conservationPages.observations.unconfirmedSpecies')
  const key = `conservationSpecies.scientific.${sp.id}`
  return te(key) ? t(key) : sp.scientificName
}
const commonName = (id: string, fallback: string) => {
  const key = `conservationSpecies.common.${id}`
  return te(key) ? t(key) : fallback
}
const recordText = (record: Observation, field: 'morphology' | 'notes' | 'reviewComment') => {
  const value = record[field]
  const key = `conservationPages.observations.records.${record.id}.${field}`
  return value && te(key) && value === t(`${key}Source`) ? t(key) : value || '—'
}
const parseDate = (value: string) => {
  const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})(?:, (\d{2}):(\d{2}))?$/.exec(value)
  if (!match) return null
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ].indexOf(match[2]!)
  return month < 0
    ? null
    : new Date(
        Number(match[3]),
        month,
        Number(match[1]),
        Number(match[4] || 0),
        Number(match[5] || 0),
      )
}
const formatDate = (value: string | undefined) => {
  if (!value) return '—'
  const parsed = parseDate(value)
  if (!parsed) return value
  return new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(value.includes(',')
      ? ({ hour: '2-digit', minute: '2-digit', hour12: false } as const)
      : {}),
  }).format(parsed)
}
const search = ref(''),
  status = ref(''),
  species = ref(''),
  location = ref(''),
  botanist = ref(''),
  date = ref(''),
  selected = ref<Observation | null>(null),
  plantModal = ref(false),
  historyModal = ref(false)
const filtered = computed(() =>
  conservationStore.observations.filter((o) => {
    const sp = speciesForPlant(o.plantId)
    return (
      `${o.id} ${o.plantId} ${sp?.scientificName} ${sp?.commonName} ${speciesName(o.plantId)} ${sp ? commonName(sp.id, sp.commonName) : ''} ${o.recordedBy}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (!status.value || o.status === status.value) &&
      (!species.value || sp?.id === species.value) &&
      (!location.value || o.location === location.value) &&
      (!botanist.value || o.recordedBy === botanist.value) &&
      (!date.value ||
        o.observedAt.startsWith(
          new Date(date.value + 'T00:00:00').toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        ))
    )
  }),
)
const history = computed(() =>
  selected.value
    ? conservationStore.observations.filter((o) => o.plantId === selected.value?.plantId)
    : [],
)
function open(o: Observation) {
  selected.value = o
  plantModal.value = false
  historyModal.value = false
}
function openPlant(o: Observation) {
  open(o)
  plantModal.value = true
}
function openHistory(o: Observation) {
  open(o)
  historyModal.value = true
}
function closeModal() {
  selected.value = null
  plantModal.value = false
  historyModal.value = false
}
</script>
<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ t('conservationPages.observations.eyebrow') }}</p>
      <h2>{{ t('conservationPages.observations.title') }}</h2>
      <p>{{ t('conservationPages.observations.intro') }}</p>
    </div>
  </section>
  <div class="control-bar">
    <label class="field search-field"
      ><span>{{ t('conservationPages.observations.search') }}</span
      ><input
        v-model="search"
        :placeholder="t('conservationPages.observations.searchPlaceholder')" /></label
    ><label class="field"
      ><span>{{ t('conservationPages.observations.status') }}</span
      ><select v-model="status">
        <option value="">{{ t('conservationPages.observations.allStatuses') }}</option>
        <option
          v-for="s in [
            'Draft',
            'Pending Review',
            'Approved',
            'Rejected',
            'Correction Required',
            'Flagged',
          ]"
          :key="s"
          :value="s"
        >
          {{ label(s) }}
        </option>
      </select></label
    ><label class="field"
      ><span>{{ t('conservationPages.observations.species') }}</span
      ><select v-model="species">
        <option value="">{{ t('conservationPages.observations.allSpecies') }}</option>
        <option v-for="s in conservationStore.species" :key="s.id" :value="s.id">
          {{ commonName(s.id, s.commonName) }}
        </option>
      </select></label
    ><label class="field"
      ><span>{{ t('conservationPages.observations.location') }}</span
      ><select v-model="location">
        <option value="">{{ t('conservationPages.observations.allLocations') }}</option>
        <option
          v-for="l in [...new Set(conservationStore.observations.map((o) => o.location))]"
          :key="l"
          :value="l"
        >
          {{ label(l) }}
        </option>
      </select></label
    ><label class="field"
      ><span>{{ t('conservationPages.observations.botanist') }}</span
      ><select v-model="botanist">
        <option value="">{{ t('conservationPages.observations.allBotanists') }}</option>
        <option
          v-for="b in [...new Set(conservationStore.observations.map((o) => o.recordedBy))]"
          :key="b"
        >
          {{ b }}
        </option>
      </select></label
    ><label class="field"
      ><span>{{ t('conservationPages.observations.date') }}</span
      ><input v-model="date" type="date"
    /></label>
  </div>
  <section class="panel">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ t('conservationPages.observations.observationId') }}</th>
            <th>{{ t('conservationPages.observations.plantId') }}</th>
            <th>{{ t('conservationPages.observations.species') }}</th>
            <th>{{ t('conservationPages.observations.recordedBy') }}</th>
            <th>{{ t('conservationPages.observations.height') }}</th>
            <th>{{ t('conservationPages.observations.growthStage') }}</th>
            <th>{{ t('conservationPages.observations.health') }}</th>
            <th>{{ t('conservationPages.observations.location') }}</th>
            <th>{{ t('conservationPages.observations.observationDate') }}</th>
            <th>{{ t('conservationPages.observations.status') }}</th>
            <th>{{ t('conservationPages.observations.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in filtered" :key="o.id">
            <td>
              <strong>{{ o.id }}</strong>
            </td>
            <td>{{ o.plantId }}</td>
            <td>
              <em>{{ speciesName(o.plantId) }}</em>
            </td>
            <td>{{ o.recordedBy }}</td>
            <td>{{ o.height }}</td>
            <td>{{ label(o.growthStage) }}</td>
            <td>{{ label(o.health) }}</td>
            <td>{{ label(o.location) }}</td>
            <td>{{ formatDate(o.observedAt) }}</td>
            <td>
              <span class="badge" :class="o.status.toLowerCase().replaceAll(' ', '-')">{{
                label(o.status)
              }}</span>
            </td>
            <td>
              <div class="action-group">
                <button class="action-button" @click="open(o)">
                  {{ t('conservationPages.observations.view') }}</button
                ><button class="action-button" @click="openPlant(o)">
                  {{ t('conservationPages.observations.viewPlant') }}</button
                ><button class="action-button" @click="openHistory(o)">
                  {{ t('conservationPages.observations.history') }}</button
                ><RouterLink
                  class="action-button"
                  :to="{ name: 'conservation-map', query: { plant: o.plantId } }"
                  >{{ t('conservationPages.observations.location') }}</RouterLink
                ><RouterLink
                  v-if="o.status === 'Pending Review'"
                  class="action-button"
                  :to="{ name: 'conservation-reviews', query: { review: o.id } }"
                  >{{ t('conservationPages.observations.review') }}</RouterLink
                >
              </div>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="11">{{ t('conservationPages.observations.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AppModal
    v-if="selected && !plantModal && !historyModal"
    :title="t('conservationPages.observations.observationTitle', { id: selected.id })"
    :subtitle="`${selected.plantId} · ${speciesName(selected.plantId)}`"
    wide
    @close="selected = null"
    ><dl class="detail-list">
      <div>
        <dt>{{ t('conservationPages.observations.recordedBy') }}</dt>
        <dd>{{ selected.recordedBy }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.dateTime') }}</dt>
        <dd>{{ formatDate(selected.observedAt) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.height') }}</dt>
        <dd>{{ selected.height }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.growthStage') }}</dt>
        <dd>{{ label(selected.growthStage) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.healthStatus') }}</dt>
        <dd>{{ label(selected.health) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.morphology') }}</dt>
        <dd>{{ recordText(selected, 'morphology') }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.notes') }}</dt>
        <dd>{{ recordText(selected, 'notes') }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.gpsAccuracy') }}</dt>
        <dd>{{ selected.gpsAccuracy }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.coordinates') }}</dt>
        <dd>
          {{ plantFor(selected.plantId)?.latitude }}, {{ plantFor(selected.plantId)?.longitude }}
        </dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.review') }}</dt>
        <dd>
          {{ label(selected.status) }} ·
          {{ selected.reviewedBy || t('conservationPages.observations.notReviewed') }}
        </dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.reviewedAt') }}</dt>
        <dd>{{ formatDate(selected.reviewedAt) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.reviewComments') }}</dt>
        <dd>{{ recordText(selected, 'reviewComment') }}</dd>
      </div>
    </dl>
    <h3>{{ t('conservationPages.observations.media') }}</h3>
    <div class="media-grid">
      <div v-for="p in selected.photos" :key="p" class="media-placeholder">
        {{ t('conservationPages.observations.photo', { name: label(p) }) }}
      </div>
    </div></AppModal
  >
  <AppModal
    v-if="selected && plantModal"
    :title="t('conservationPages.observations.plantTitle', { id: selected.plantId })"
    :subtitle="speciesName(selected.plantId)"
    @close="closeModal"
    ><dl class="detail-list">
      <div>
        <dt>{{ t('conservationPages.observations.registeredBy') }}</dt>
        <dd>{{ plantFor(selected.plantId)?.registeredBy }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.registeredAt') }}</dt>
        <dd>{{ formatDate(plantFor(selected.plantId)?.registeredAt) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.zone') }}</dt>
        <dd>{{ label(plantFor(selected.plantId)?.zone) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.health') }}</dt>
        <dd>{{ label(plantFor(selected.plantId)?.health) }}</dd>
      </div>
    </dl></AppModal
  >
  <AppModal
    v-if="selected && historyModal"
    :title="t('conservationPages.observations.historyTitle', { id: selected.plantId })"
    :subtitle="t('conservationPages.observations.historySubtitle')"
    wide
    @close="closeModal"
    ><div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ t('conservationPages.observations.id') }}</th>
            <th>{{ t('conservationPages.observations.date') }}</th>
            <th>{{ t('conservationPages.observations.height') }}</th>
            <th>{{ t('conservationPages.observations.health') }}</th>
            <th>{{ t('conservationPages.observations.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in history" :key="o.id">
            <td>{{ o.id }}</td>
            <td>{{ formatDate(o.observedAt) }}</td>
            <td>{{ o.height }}</td>
            <td>{{ label(o.health) }}</td>
            <td>
              <span class="badge" :class="o.status.toLowerCase().replaceAll(' ', '-')">{{
                label(o.status)
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div></AppModal
  >
</template>
<style scoped>
a.action-button {
  text-decoration: none;
}
</style>
