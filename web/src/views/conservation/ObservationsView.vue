<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '../../components/conservation/AppModal.vue'
import { formatObservationId } from '../../utils/observationId'
import { formatPlantId } from '../../utils/plantId'

interface ApiObservation {
  id?: string | number | null
  content?:{heightCm?:number;lifeStage?:string;healthStatus?:string;morphology?:string;notes?:string}
  owner_subject?:string
  created_at?:string
  observation_id?: string | number | null
  plant_id: string | number
  recorded_by?: string | number | null
  height_cm?: string | number | null
  morphology?: string | null
  life_stage?: string | null
  health_status?: string | null
  notes?: string | null
  observed_at?: string | null
  status?: string | null
  species_id?: string | number | null
  scientific_name?: string | null
  common_name?: string | null
  verified_by?: string | number | null
  verification_status?: string | null
  verification_comments?: string | null
  verified_at?: string | null
  review_decision?: string | null
  reviewed_at?: string | null
  review_comment?: string | null
  assets?: { id: string | number; content_type?: string | null; approved?: boolean | null }[] | null
}

interface ObservationView {
  numericId: string
  id: string
  plantId: string
  recordedBy: string
  height: string
  growthStage: string
  health: string
  location: string
  observedAt: string
  submittedAt: string
  status: string
  morphology: string
  notes: string
  gpsAccuracy: string
  reviewedBy?: string
  reviewedAt?: string
  reviewComment?: string
  photos: string[]
  speciesId: string
  scientificName: string
  commonName: string
}

const { t, te, locale } = useI18n()
const keyFor = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const label = (value: string | undefined) => {
  if (!value) return '—'
  const key = `conservationPages.observations.values.${keyFor(value)}`
  const shared = `dashboardValues.${keyFor(value)}`
  return te(key) ? t(key) : te(shared) ? t(shared) : value
}
const speciesName = (record: ObservationView) =>
  record.scientificName || t('conservationPages.observations.unconfirmedSpecies')
const recordText = (record: ObservationView, field: 'morphology' | 'notes' | 'reviewComment') =>
  record[field] || '—'
const formatDate = (value: string | undefined) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}
const dateKey = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const canonicalStatus = (value: string | null | undefined) => {
  const normalized = (value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  const statuses = [
    'Draft',
    'Pending Review',
    'Approved',
    'Rejected',
    'Correction Required',
    'Flagged',
  ]
  return statuses.find((item) => item.toLowerCase() === normalized) || value?.trim() || '—'
}
const stringValue = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value)
const observations = ref<ObservationView[]>([])
const isLoading = ref(true)
const loadError = ref('')

const mapObservation = (item: ApiObservation): ObservationView | null => {
  const rawId = item.id ?? item.observation_id
  const formattedId = rawId === null || rawId === undefined ? null : formatObservationId(rawId)
  const id = stringValue(rawId) || formattedId || ''
  const plantId = formatPlantId(item.plant_id)
  if (!id || !plantId) return null

  item={...item,height_cm:item.content?.heightCm??item.height_cm,life_stage:item.content?.lifeStage??item.life_stage,health_status:item.content?.healthStatus??item.health_status,morphology:item.content?.morphology??item.morphology,notes:item.content?.notes??item.notes,recorded_by:item.owner_subject??item.recorded_by,observed_at:item.created_at??item.observed_at}
  const height = Number(item.height_cm)
  return {
    numericId: id,
    id,
    plantId,
    recordedBy: stringValue(item.recorded_by),
    height:
      item.height_cm !== null && item.height_cm !== undefined && Number.isFinite(height)
        ? `${height} cm`
        : '',
    growthStage: item.life_stage || '',
    health: item.health_status || '',
    location: '',
    observedAt: item.observed_at || '',
    submittedAt: '',
    status: canonicalStatus(item.status || item.review_decision || item.verification_status),
    morphology: item.morphology || '',
    notes: item.notes || '',
    gpsAccuracy: '',
    reviewedBy: stringValue(item.verified_by) || undefined,
    reviewedAt: item.reviewed_at ?? item.verified_at ?? undefined,
    reviewComment: item.review_comment ?? item.verification_comments ?? undefined,
    photos: (item.assets || [])
      .filter((asset) => asset.approved !== false && (!asset.content_type || asset.content_type.startsWith('image/')))
      .map((asset) => String(asset.id)),
    speciesId: stringValue(item.species_id),
    scientificName: item.scientific_name || '',
    commonName: item.common_name || '',
  }
}

const loadObservations = async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const response = await fetch('/api/observations')
    if (!response.ok) throw new Error('Unable to load observations.')
    const result = (await response.json()) as { observations: ApiObservation[] }
    observations.value = result.observations
      .map(mapObservation)
      .filter((item): item is ObservationView => item !== null)
  } catch (error) {
    observations.value = []
    loadError.value = error instanceof Error ? error.message : 'Unable to load observations.'
  } finally {
    isLoading.value = false
  }
}

onMounted(loadObservations)
const search = ref(''),
  status = ref(''),
  species = ref(''),
  location = ref(''),
  botanist = ref(''),
  date = ref(''),
  selected = ref<ObservationView | null>(null),
  plantModal = ref(false),
  historyModal = ref(false)
const filtered = computed(() =>
  observations.value.filter(
    (o) =>
      `${o.id} ${o.plantId} ${o.scientificName} ${o.commonName} ${o.speciesId} ${o.recordedBy} ${o.observedAt} ${o.status}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (!status.value || o.status === status.value) &&
      (!species.value || o.speciesId === species.value) &&
      (!location.value || o.location === location.value) &&
      (!botanist.value || o.recordedBy === botanist.value) &&
      (!date.value || dateKey(o.observedAt) === date.value),
  ),
)
const history = computed(() =>
  selected.value ? observations.value.filter((o) => o.plantId === selected.value?.plantId) : [],
)
const speciesOptions = computed(() => {
  const options = new Map<string, string>()
  observations.value.forEach((observation) => {
    if (observation.speciesId) {
      options.set(
        observation.speciesId,
        observation.commonName || observation.scientificName || observation.speciesId,
      )
    }
  })
  return [...options].map(([id, name]) => ({ id, name }))
})
function open(o: ObservationView) {
  selected.value = o
  plantModal.value = false
  historyModal.value = false
}
function openPlant(o: ObservationView) {
  open(o)
  plantModal.value = true
}
function openHistory(o: ObservationView) {
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
        <option v-for="s in speciesOptions" :key="s.id" :value="s.id">
          {{ s.name }}
        </option>
      </select></label
    ><label class="field"
      ><span>{{ t('conservationPages.observations.location') }}</span
      ><select v-model="location">
        <option value="">{{ t('conservationPages.observations.allLocations') }}</option>
        <option
          v-for="l in [...new Set(observations.map((o) => o.location).filter(Boolean))]"
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
          v-for="b in [...new Set(observations.map((o) => o.recordedBy).filter(Boolean))]"
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
          <tr v-for="o in filtered" :key="o.numericId">
            <td>
              <strong>{{ o.id }}</strong>
            </td>
            <td>{{ o.plantId }}</td>
            <td>
              <em>{{ speciesName(o) }}</em>
            </td>
            <td>{{ label(o.recordedBy) }}</td>
            <td>{{ label(o.height) }}</td>
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
          <tr v-if="isLoading || loadError || !filtered.length">
            <td colspan="11">
              {{
                isLoading
                  ? 'Loading observations...'
                  : loadError || t('conservationPages.observations.empty')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AppModal
    v-if="selected && !plantModal && !historyModal"
    :title="t('conservationPages.observations.observationTitle', { id: selected.id })"
    :subtitle="`${selected.plantId} · ${speciesName(selected)}`"
    wide
    @close="selected = null"
    ><dl class="detail-list">
      <div>
        <dt>{{ t('conservationPages.observations.recordedBy') }}</dt>
        <dd>{{ label(selected.recordedBy) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.dateTime') }}</dt>
        <dd>{{ formatDate(selected.observedAt) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.height') }}</dt>
        <dd>{{ label(selected.height) }}</dd>
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
      <div v-if="selected.gpsAccuracy">
        <dt>{{ t('conservationPages.observations.gpsAccuracy') }}</dt>
        <dd>{{ selected.gpsAccuracy }}</dd>
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
    <h3 v-if="selected.photos.length">{{ t('conservationPages.observations.media') }}</h3>
    <div v-if="selected.photos.length" class="media-grid">
      <div v-for="p in selected.photos" :key="p" class="media-placeholder">
        {{ t('conservationPages.observations.photo', { name: label(p) }) }}
      </div>
    </div></AppModal
  >
  <AppModal
    v-if="selected && plantModal"
    :title="t('conservationPages.observations.plantTitle', { id: selected.plantId })"
    :subtitle="speciesName(selected)"
    @close="closeModal"
    ><dl class="detail-list">
      <div>
        <dt>{{ t('conservationPages.observations.registeredBy') }}</dt>
        <dd>—</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.registeredAt') }}</dt>
        <dd>—</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.zone') }}</dt>
        <dd>—</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.observations.health') }}</dt>
        <dd>—</dd>
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
            <td>{{ label(o.height) }}</td>
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
