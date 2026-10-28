<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, dt, locale } = useConservationText()
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import { formatObservationId } from '../../utils/observationId'
import { formatPlantId } from '../../utils/plantId'
import { formatSpeciesRequestId } from '../../utils/speciesRequestId'
import type { ObservationStatus, SpeciesRequestStatus } from '../../data/conservation'

interface ApiObservation {
  observation_id: string | number
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
}

interface ReviewObservation {
  numericId: number
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

interface ApiSpeciesRequest {
  request_id: string | number
  requested_by?: string | number | null
  reviewed_by?: string | number | null
  suggested_common_name?: string | null
  genus_id?: string | number | null
  genus_name?: string | null
  description?: string | null
  habitat?: string | null
  request_status?: string | null
  review_comment?: string | null
  submitted_at?: string | null
  reviewed_at?: string | null
  approved_species_id?: string | number | null
}

interface SpeciesRequestView {
  numericId: number
  id: string
  requestedBy: string
  reviewedBy: string
  proposedScientificName: string
  proposedCommonName: string
  genusId: string
  genus: string
  family: string
  description: string
  habitat: string
  identificationNotes: string
  submittedAt: string
  status: string
  reviewComment: string
  reviewedAt: string
  approvedSpeciesId: string
  photos: string[]
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })
const search = ref('')
const status = ref('')
const species = ref('')
const date = ref('')
const selected = ref<ReviewObservation | null>(null)
const comment = ref('')
const observations = ref<ReviewObservation[]>([])
const speciesRequests = ref<SpeciesRequestView[]>([])
const isLoading = ref(true)
const loadError = ref('')
const reviewingSpecies = ref(false)
const speciesComment = ref('')
const feedback = ref<{ id: number; variant: 'error'; message: string } | null>(null)
let feedbackId = 0

const showNotSavedFeedback = (message: string) => {
  feedback.value = { id: ++feedbackId, variant: 'error', message }
}

const dismissFeedback = (id: number) => {
  if (feedback.value?.id === id) feedback.value = null
}

const supportedStatuses: ObservationStatus[] = [
  'Draft',
  'Pending Review',
  'Approved',
  'Rejected',
  'Correction Required',
  'Flagged',
]
const canonicalStatus = (value: string | null | undefined) => {
  const normalized = (value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  return supportedStatuses.find((item) => item.toLowerCase() === normalized) || ''
}
const stringValue = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value)
const dateKey = (value: string | undefined) => {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
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

const mapObservation = (item: ApiObservation): ReviewObservation | null => {
  const numericId = Number(item.observation_id)
  const id = formatObservationId(item.observation_id)
  const plantId = formatPlantId(item.plant_id)
  if (!id || !plantId || !Number.isSafeInteger(numericId)) return null

  const height = Number(item.height_cm)
  return {
    numericId,
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
    status: canonicalStatus(item.verification_status || item.status),
    morphology: item.morphology || '',
    notes: item.notes || '',
    gpsAccuracy: '',
    reviewedBy: stringValue(item.verified_by) || undefined,
    reviewedAt: item.verified_at || undefined,
    reviewComment: item.verification_comments || undefined,
    photos: [],
    speciesId: stringValue(item.species_id),
    scientificName: item.scientific_name || '',
    commonName: item.common_name || '',
  }
}

const mapSpeciesRequest = (item: ApiSpeciesRequest): SpeciesRequestView | null => {
  const numericId = Number(item.request_id)
  const id = formatSpeciesRequestId(item.request_id)
  if (!id || !Number.isSafeInteger(numericId)) return null

  return {
    numericId,
    id,
    requestedBy: stringValue(item.requested_by),
    reviewedBy: stringValue(item.reviewed_by),
    proposedScientificName: '',
    proposedCommonName: item.suggested_common_name || '',
    genusId: stringValue(item.genus_id),
    genus: item.genus_name || '',
    family: '',
    description: item.description || '',
    habitat: item.habitat || '',
    identificationNotes: '',
    submittedAt: item.submitted_at || '',
    status: item.request_status || '',
    reviewComment: item.review_comment || '',
    reviewedAt: item.reviewed_at || '',
    approvedSpeciesId: stringValue(item.approved_species_id),
    photos: [],
  }
}

const counts = computed(() => [
  ['Pending Review', observations.value.filter((o) => o.status === 'Pending Review').length],
  [
    'Correction Required',
    observations.value.filter((o) => o.status === 'Correction Required').length,
  ],
  ['Flagged', observations.value.filter((o) => o.status === 'Flagged').length],
  [
    'Approved Today',
    observations.value.filter(
      (o) => o.status === 'Approved' && dateKey(o.reviewedAt) === dateKey(new Date().toISOString()),
    ).length,
  ],
])

const filtered = computed(() =>
  observations.value.filter((observation) => {
    const searchable = `${observation.id} ${observation.plantId} ${observation.speciesId} ${observation.scientificName} ${observation.commonName} ${observation.recordedBy} ${observation.status}`
    const matchesDate = !date.value || dateKey(observation.observedAt) === date.value
    return (
      searchable.toLowerCase().includes(search.value.toLowerCase()) &&
      (!status.value || observation.status === status.value) &&
      (!species.value || observation.speciesId === species.value) &&
      matchesDate
    )
  }),
)

const selectedSpecies = computed(() => selected.value)
const selectedRequest = computed<SpeciesRequestView | undefined>(() => undefined)
const speciesResolved = computed(
  () => !selectedRequest.value || selectedRequest.value.status === 'Approved',
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

function open(observation: ReviewObservation) {
  selected.value = observation
  comment.value = observation.reviewComment || ''
  reviewingSpecies.value = false
  speciesComment.value = ''
}

function closeReview() {
  selected.value = null
  reviewingSpecies.value = false
  router.replace({ query: {} })
}

function decide(next: ObservationStatus) {
  if (!selected.value) return
  showNotSavedFeedback(
    t('conservationPages.reviews.feedback.observationNotSaved', { decision: ct(next) }),
  )
}

function decideSpecies(next: SpeciesRequestStatus) {
  showNotSavedFeedback(
    t('conservationPages.reviews.feedback.speciesRequestNotSaved', { decision: ct(next) }),
  )
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const [observationsResponse, speciesRequestsResponse] = await Promise.all([
      fetch('/api/observations'),
      fetch('/api/species-requests'),
    ])
    if (!observationsResponse.ok || !speciesRequestsResponse.ok) {
      throw new Error('Unable to load review submissions.')
    }

    const observationsResult = (await observationsResponse.json()) as {
      observations: ApiObservation[]
    }
    const speciesRequestsResult = (await speciesRequestsResponse.json()) as {
      species_requests: ApiSpeciesRequest[]
    }
    observations.value = observationsResult.observations
      .map(mapObservation)
      .filter((item): item is ReviewObservation => item !== null)
    speciesRequests.value = speciesRequestsResult.species_requests
      .map(mapSpeciesRequest)
      .filter((item): item is SpeciesRequestView => item !== null)

    const id = String(route.query.review || '')
    const observation = observations.value.find((item) => item.id === id)
    if (observation) open(observation)
  } catch (loadFailure) {
    observations.value = []
    speciesRequests.value = []
    loadError.value =
      loadFailure instanceof Error ? loadFailure.message : 'Unable to load review submissions.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <ActionFeedback
    v-if="feedback"
    :key="feedback.id"
    :feedback-id="feedback.id"
    :variant="feedback.variant"
    :message="feedback.message"
    @dismiss="dismissFeedback"
  />

  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ ct('VERIFICATION WORKFLOW') }}</p>
      <h2>{{ ct('Review Submissions') }}</h2>
      <p>{{ ct('Verify botanist observations and preserve a clear review decision.') }}</p>
    </div>
  </section>
  <section class="summary-grid">
    <article v-for="count in counts" :key="String(count[0])" class="summary-card">
      <p>{{ ct(count[0]) }}</p>
      <strong>{{ count[1] }}</strong
      ><small>{{ ct('Observation submissions') }}</small>
    </article>
  </section>
  <div class="control-bar">
    <label class="field search-field"
      ><span>{{ ct('Search') }}</span
      ><input v-model="search" :placeholder="ct('Observation ID, Plant ID, species or botanist')"
    /></label>
    <label class="field"
      ><span>{{ ct('Review status') }}</span
      ><select v-model="status">
        <option value="">{{ ct('All statuses') }}</option>
        <option
          v-for="reviewStatus in [
            'Pending Review',
            'Approved',
            'Rejected',
            'Correction Required',
            'Flagged',
          ]"
          :key="reviewStatus"
          :value="reviewStatus"
        >
          {{ ct(reviewStatus) }}
        </option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Species') }}</span
      ><select v-model="species">
        <option value="">{{ ct('All species') }}</option>
        <option v-for="item in speciesOptions" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Date') }}</span
      ><input v-model="date" type="date"
    /></label>
  </div>
  <section class="panel">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('Observation ID') }}</th>
            <th>{{ ct('Plant ID') }}</th>
            <th>{{ ct('Species') }}</th>
            <th>{{ ct('Submitted By') }}</th>
            <th>{{ ct('Location') }}</th>
            <th>{{ ct('Observation Date') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="observation in filtered" :key="observation.numericId">
            <td>
              <strong>{{ observation.id }}</strong>
            </td>
            <td>{{ observation.plantId }}</td>
            <td>
              <em v-if="observation.scientificName">{{ observation.scientificName }}</em>
              <span v-else>{{ ct('Species unavailable') }}</span>
            </td>
            <td>{{ observation.recordedBy || '—' }}</td>
            <td>—</td>
            <td>{{ formatDate(observation.observedAt) }}</td>
            <td>
              <span class="badge" :class="observation.status.toLowerCase().replaceAll(' ', '-')">{{
                observation.status ? ct(observation.status) : '—'
              }}</span>
            </td>
            <td>
              <button class="action-button" @click="open(observation)">{{ ct('Review') }}</button>
            </td>
          </tr>
          <tr v-if="isLoading || loadError || !filtered.length">
            <td colspan="8">
              {{
                isLoading
                  ? 'Loading review submissions...'
                  : loadError || ct('No review submissions found.')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <AppModal
    v-if="selected"
    :title="ct('Review {id}', { id: selected.id })"
    :subtitle="
      ct('{id} · submitted by {name}', { id: selected.plantId, name: selected.recordedBy })
    "
    wide
    @close="closeReview"
  >
    <section class="review-section">
      <p class="section-kicker">{{ ct('PLANT / OBSERVATION INFORMATION') }}</p>
      <div class="two-column">
        <div>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Species') }}</dt>
              <dd>{{ selectedSpecies?.scientificName || ct('Species unavailable') }}</dd>
            </div>
            <div>
              <dt>{{ ct('Taxonomy') }}</dt>
              <dd>
                {{ selectedSpecies?.commonName || '—' }}
              </dd>
            </div>
            <div>
              <dt>{{ ct('Height') }}</dt>
              <dd>{{ selected.height || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Growth Stage') }}</dt>
              <dd>{{ selected.growthStage ? ct(selected.growthStage) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Health') }}</dt>
              <dd>{{ selected.health ? ct(selected.health) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Morphology') }}</dt>
              <dd>{{ selected.morphology || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Observation Date') }}</dt>
              <dd>{{ formatDate(selected.observedAt) }}</dd>
            </div>
          </dl>
          <h3 v-if="selected.photos.length">{{ ct('Photographs') }}</h3>
          <div v-if="selected.photos.length" class="media-grid">
            <div v-for="photo in selected.photos" :key="photo" class="media-placeholder">
              {{ ct(photo) }}
            </div>
          </div>
        </div>
        <aside>
          <h3>{{ ct('Observation History') }}</h3>
          <div
            v-for="observation in observations.filter((item) => item.plantId === selected?.plantId)"
            :key="observation.id"
            class="history-item"
          >
            <strong>{{ observation.id }}</strong
            ><span
              >{{ formatDate(observation.observedAt) }} · {{ observation.height || '—' }} ·
              {{ observation.health ? ct(observation.health) : '—' }}</span
            >
          </div>
          <label class="form-field officer-comment"
            ><span>{{ ct('Observation Review Comment') }}</span
            ><textarea
              v-model="comment"
              :placeholder="ct('Record the observation decision or required action')"
            ></textarea>
          </label>
        </aside>
      </div>
    </section>

    <section v-if="selectedRequest" class="species-dependency">
      <div class="dependency-heading">
        <div>
          <p class="section-kicker">{{ ct('SPECIES DEPENDENCY') }}</p>
          <h3 v-if="selectedRequest.status === 'Approved'">
            {{ selectedRequest.approvedSpeciesId }} — {{ selectedSpecies?.scientificName || '—' }}
          </h3>
          <h3 v-else>
            {{ ct('Proposed New Species') }} · {{ ct(selectedRequest.proposedScientificName) }}
          </h3>
          <span>{{ ct('Species Request: {id}', { id: selectedRequest.id }) }}</span>
        </div>
        <span class="badge" :class="selectedRequest.status.toLowerCase().replaceAll(' ', '-')">{{
          ct(selectedRequest.status)
        }}</span>
      </div>
      <button class="secondary-button" @click="reviewingSpecies = !reviewingSpecies">
        {{ ct(reviewingSpecies ? 'Hide Species Request' : 'Review Species Request') }}
      </button>
      <div v-if="reviewingSpecies" class="species-review-panel">
        <dl class="detail-list">
          <div>
            <dt>{{ ct('Request ID') }}</dt>
            <dd>{{ selectedRequest.id }}</dd>
          </div>
          <div>
            <dt>{{ ct('Request Status') }}</dt>
            <dd>{{ ct(selectedRequest.status) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Proposed Scientific Name') }}</dt>
            <dd>{{ ct(selectedRequest.proposedScientificName) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Proposed Common Name') }}</dt>
            <dd>{{ ct(selectedRequest.proposedCommonName) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Genus') }}</dt>
            <dd>{{ ct(selectedRequest.genus) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Family') }}</dt>
            <dd>{{ ct(selectedRequest.family) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Description') }}</dt>
            <dd>{{ ct(selectedRequest.description) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Habitat / Ecological Information') }}</dt>
            <dd>{{ ct(selectedRequest.habitat) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Identification Notes') }}</dt>
            <dd>{{ ct(selectedRequest.identificationNotes) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Submitted By') }}</dt>
            <dd>{{ selectedRequest.requestedBy }}</dd>
          </div>
          <div>
            <dt>{{ ct('Submitted Date') }}</dt>
            <dd>{{ dt(selectedRequest.submittedAt) }}</dd>
          </div>
        </dl>
        <h3>{{ ct('Submitted Photographs / Evidence') }}</h3>
        <div class="media-grid">
          <div v-for="photo in selectedRequest.photos" :key="photo" class="media-placeholder">
            {{ ct(photo) }}
          </div>
        </div>
        <template v-if="selectedRequest.status !== 'Approved'"
          ><div class="species-review-fields">
            <label class="form-field full"
              ><span>{{ ct('Species Request Comment') }}</span
              ><textarea
                v-model="speciesComment"
                :placeholder="ct('Record the species decision or required correction')"
              ></textarea>
            </label>
          </div>
          <div class="species-actions">
            <button class="primary-button" @click="decideSpecies('Approved')">
              {{ ct('Approve Species') }}</button
            ><button class="danger-button" @click="decideSpecies('Rejected')">
              {{ ct('Reject') }}</button
            ><button class="secondary-button" @click="decideSpecies('Correction Required')">
              {{ ct('Request Correction') }}
            </button>
          </div></template
        >
        <p v-else class="resolved-message">
          {{
            ct('Species approved as {id}. The observation decision remains separate.', {
              id: selectedRequest.approvedSpeciesId || '—',
            })
          }}
        </p>
      </div>
    </section>
    <p v-if="!speciesResolved" class="approval-blocked">
      {{ ct('Resolve the linked species request before approving this plant submission.') }}
    </p>
    <div class="modal-actions">
      <button class="primary-button" :disabled="!speciesResolved" @click="decide('Approved')">
        {{ ct('Approve') }}</button
      ><button class="danger-button" @click="decide('Rejected')">{{ ct('Reject') }}</button
      ><button class="secondary-button" @click="decide('Correction Required')">
        {{ ct('Request Correction') }}</button
      ><button class="secondary-button" @click="decide('Flagged')">{{ ct('Flag') }}</button>
    </div>
  </AppModal>
</template>

<style scoped>
.history-item {
  padding: 10px 0;
  display: grid;
  gap: 3px;
  border-bottom: 1px solid #edf0ed;
  font-size: 10px;
}
.history-item span {
  color: #829088;
}
.officer-comment {
  margin-top: 18px;
}
.form-error {
  color: #b84d42;
  font-size: 10px;
}
.review-section > .section-kicker {
  margin-bottom: 14px;
}
.proposed-species {
  display: grid;
  gap: 3px;
}
.proposed-species small {
  color: #a06b12;
  font-size: 8px;
  font-weight: 800;
  text-transform: uppercase;
}
.proposed-species .badge {
  width: max-content;
}
.species-dependency {
  margin-top: 20px;
  padding: 17px;
  border: 1px solid #cfe0d5;
  border-radius: 12px;
  background: #f8fbf8;
}
.dependency-heading {
  margin-bottom: 13px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.dependency-heading h3 {
  margin: 0 0 5px;
}
.dependency-heading span:not(.badge) {
  color: #71817a;
  font-size: 10px;
}
.species-review-panel {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #dce7df;
}
.species-review-panel > h3 {
  margin: 18px 0 10px;
}
.species-review-fields {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}
.species-actions {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.approval-blocked {
  margin: 16px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff0d5;
  color: #8a5d13;
  font-size: 10px;
  font-weight: 700;
}
.resolved-message {
  margin: 14px 0 0;
  color: #287a53;
  font-size: 10px;
  font-weight: 700;
}
.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
@media (max-width: 620px) {
  .dependency-heading {
    flex-direction: column;
  }
  .species-review-fields {
    grid-template-columns: 1fr;
  }
  .species-review-fields .full {
    grid-column: auto;
  }
}
</style>