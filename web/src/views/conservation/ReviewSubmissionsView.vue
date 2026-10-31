<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, dt, locale } = useConservationText()
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import PlantSimilarityDrawer from '../../components/conservation/PlantSimilarityDrawer.vue'
import { formatObservationId } from '../../utils/observationId'
import { formatPlantId } from '../../utils/plantId'
import { formatSpeciesRequestId } from '../../utils/speciesRequestId'
import type { ObservationStatus, SpeciesRequestStatus } from '../../data/conservation'
import {
  plantSimilarityByObservation,
  type PlantSimilarityAnalysis,
} from '../../data/plantSimilarityPrototype'

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
  speciesCategory: string
  speciesRequestId: string
  locationZone: string
  latitude: string
  longitude: string
  altitude: string
  qrCode: string
  qrStatus: string
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
const similarityAnalysis = ref<PlantSimilarityAnalysis | null>(null)
const similarityTrigger = ref<HTMLElement | null>(null)
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
    speciesCategory: '',
    speciesRequestId: '',
    locationZone: '',
    latitude: '',
    longitude: '',
    altitude: '',
    qrCode: '',
    qrStatus: '',
  }
}

const submissionImageCategories = [
  { label: 'Whole Plant', requirement: 'Required submission image' },
  { label: 'Leaf Close-up', requirement: 'Required submission image' },
  { label: 'Stem / Bark', requirement: 'Required submission image' },
  { label: 'Flower / Fruit', requirement: 'Optional submission image' },
] as const

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

const similarityFor = (observationId: string) =>
  plantSimilarityByObservation.get(observationId)

const formatSimilarity = (value: number) => `${Math.round(value * 100)}%`

function openSimilarity(analysis: PlantSimilarityAnalysis, event: Event) {
  similarityTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  similarityAnalysis.value = analysis
}

function closeSimilarity() {
  similarityAnalysis.value = null
  void nextTick(() => similarityTrigger.value?.focus())
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
            <th>{{ ct('Location Zone') }}</th>
            <th>{{ ct('Observation Date') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Similarity') }}</th>
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
            <td>{{ observation.locationZone || '—' }}</td>
            <td>{{ formatDate(observation.observedAt) }}</td>
            <td>
              <span class="badge" :class="observation.status.toLowerCase().replaceAll(' ', '-')">{{
                observation.status ? ct(observation.status) : '—'
              }}</span>
            </td>
            <td>
              <button
                v-if="similarityFor(observation.id)?.status === 'available'"
                class="similarity-badge-button"
                type="button"
                :aria-label="`View prototype visual similarity results for ${observation.id}: ${formatSimilarity(similarityFor(observation.id)!.highestSimilarity)}`"
                @click="openSimilarity(similarityFor(observation.id)!, $event)"
              >
                <strong>{{ formatSimilarity(similarityFor(observation.id)!.highestSimilarity) }}</strong>
                <span>Prototype</span>
              </button>
              <span v-else class="similarity-unavailable">Not analyzed</span>
            </td>
            <td>
              <button class="action-button" @click="open(observation)">{{ ct('Review') }}</button>
            </td>
          </tr>
          <tr v-if="isLoading || loadError || !filtered.length">
            <td colspan="9">
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
      <p class="section-kicker">{{ ct('PLANT & SPECIES INFORMATION') }}</p>
      <div class="two-column">
        <div>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Plant ID') }}</dt>
              <dd>{{ selected.plantId || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Species ID') }}</dt>
              <dd>{{ selected.speciesId || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Scientific Name') }}</dt>
              <dd>{{ selectedSpecies?.scientificName || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Common Name') }}</dt>
              <dd>{{ selectedSpecies?.commonName || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Species Category') }}</dt>
              <dd>{{ selected.speciesCategory || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Species Request ID') }}</dt>
              <dd>{{ selected.speciesRequestId || '—' }}</dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">
            {{ ct('OBSERVATION INFORMATION') }}
          </p>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Height') }}</dt>
              <dd>{{ selected.height || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Growth Stage') }}</dt>
              <dd>{{ selected.growthStage ? ct(selected.growthStage) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Health Status') }}</dt>
              <dd>{{ selected.health ? ct(selected.health) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Morphology') }}</dt>
              <dd>{{ selected.morphology || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Description / Notes') }}</dt>
              <dd>{{ selected.notes || '—' }}</dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">
            {{ ct('LOCATION INFORMATION') }}
          </p>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Location Zone') }}</dt>
              <dd>{{ selected.locationZone || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Latitude') }}</dt>
              <dd>{{ selected.latitude || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Longitude') }}</dt>
              <dd>{{ selected.longitude || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Altitude') }}</dt>
              <dd>{{ selected.altitude || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('GPS Accuracy') }}</dt>
              <dd>{{ selected.gpsAccuracy || '—' }}</dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">{{ ct('QR INFORMATION') }}</p>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('QR Code') }}</dt>
              <dd>{{ selected.qrCode || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('QR Status') }}</dt>
              <dd>{{ selected.qrStatus || '—' }}</dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">{{ ct('SUBMITTED IMAGES') }}</p>
          <div class="submission-image-grid">
            <article
              v-for="imageCategory in submissionImageCategories"
              :key="imageCategory.label"
              class="submitted-image-item"
            >
              <div class="submitted-image-preview">
                <span>{{ ct('No image submitted') }}</span>
              </div>
              <div class="submitted-image-caption">
                <strong>{{ ct(imageCategory.label) }}</strong>
                <small>{{ ct(imageCategory.requirement) }}</small>
              </div>
            </article>
            <article class="submitted-image-item">
              <div class="submitted-image-preview">
                <span>{{ ct('No additional photos') }}</span>
              </div>
              <div class="submitted-image-caption">
                <strong>{{ ct('Additional Photos') }}</strong>
                <small>{{ ct('Optional submission images') }}</small>
              </div>
            </article>
          </div>

          <p class="section-kicker review-subsection-heading">
            {{ ct('SUBMISSION INFORMATION') }}
          </p>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Submitted By') }}</dt>
              <dd>{{ selected.recordedBy || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Submitted At') }}</dt>
              <dd>{{ formatDate(selected.submittedAt) }}</dd>
            </div>
            <div>
              <dt>{{ ct('Observation Date') }}</dt>
              <dd>{{ formatDate(selected.observedAt) }}</dd>
            </div>
            <div>
              <dt>{{ ct('Status') }}</dt>
              <dd>{{ selected.status ? ct(selected.status) : '—' }}</dd>
            </div>
          </dl>
        </div>
        <aside>
          <p class="section-kicker">{{ ct('REVIEW DECISION') }}</p>
          <section class="review-similarity-summary" aria-labelledby="review-similarity-heading">
            <div>
              <span>Frontend prototype</span>
              <h3 id="review-similarity-heading">AI Plant Similarity</h3>
              <p v-if="similarityFor(selected.id)?.status === 'available'">
                Highest mock visual match:
                <strong>{{ formatSimilarity(similarityFor(selected.id)!.highestSimilarity) }}</strong>
              </p>
              <p v-else>No prototype analysis is available for this submission.</p>
            </div>
            <button
              v-if="similarityFor(selected.id)?.status === 'available'"
              class="secondary-button"
              type="button"
              @click="openSimilarity(similarityFor(selected.id)!, $event)"
            >
              View matches
            </button>
          </section>
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
            <dt>{{ ct('Scientific Name') }}</dt>
            <dd>{{ ct(selectedRequest.proposedScientificName) }}</dd>
          </div>
          <div>
            <dt>{{ ct('Common Name') }}</dt>
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
            <dt>{{ ct('Conservation Status') }}</dt>
            <dd>—</dd>
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
        <h3>{{ ct('Species Photos') }}</h3>
        <div class="submission-image-grid">
          <article class="submission-image-card">
            <strong>{{ ct('Species Photos') }}</strong>
            <small>{{ ct('Optional submission image') }}</small>
            <span>{{ ct('No image submitted') }}</span>
          </article>
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

  <PlantSimilarityDrawer
    v-if="similarityAnalysis"
    :analysis="similarityAnalysis"
    @close="closeSimilarity"
  />
</template>

<style scoped>
.similarity-badge-button {
  min-width: 58px;
  padding: 5px 8px;
  display: inline-grid;
  justify-items: center;
  gap: 1px;
  border: 1px solid #bcd7c8;
  border-radius: 9px;
  background: #e8f3ec;
  color: #287a53;
  cursor: pointer;
}
.similarity-badge-button strong {
  color: inherit;
  font-size: 10px;
  line-height: 1.1;
}
.similarity-badge-button span {
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.similarity-badge-button:hover {
  border-color: #73a68e;
  background: #dceee3;
}
.similarity-badge-button:focus-visible {
  outline: 3px solid rgba(65, 132, 104, 0.22);
  outline-offset: 2px;
}
.similarity-unavailable {
  color: #89968f;
  font-size: 9px;
}
.review-similarity-summary {
  margin: 10px 0 20px;
  padding: 14px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #d6e5dc;
  border-radius: 10px;
  background: #f6faf7;
}
.review-similarity-summary span {
  color: #698075;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.review-similarity-summary h3 {
  margin: 4px 0;
  color: #315749;
  font-size: 12px;
}
.review-similarity-summary p {
  margin: 0;
  color: #71817a;
  font-size: 9px;
  line-height: 1.45;
}
.review-similarity-summary p strong {
  color: #287a53;
}
.review-similarity-summary .secondary-button {
  flex: 0 0 auto;
}
.review-subsection-heading {
  margin-top: 24px;
  margin-bottom: 12px;
}
.submission-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  gap: 10px;
}
.submitted-image-item {
  min-width: 0;
}
.submitted-image-preview {
  width: 100%;
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  padding: 12px;
  border: 1px dashed #a9c1b4;
  border-radius: 10px;
  background: #edf4ee;
  color: #587568;
  text-align: center;
  font-size: 10px;
  line-height: 1.4;
}
.submitted-image-preview img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}
.submitted-image-caption {
  padding: 8px 2px 0;
  display: grid;
  gap: 3px;
}
.submitted-image-caption strong {
  color: #38594c;
  font-size: 11px;
}
.submitted-image-caption small {
  color: #71857b;
  font-size: 10px;
  line-height: 1.4;
}
.submission-image-card {
  min-width: 0;
  min-height: 112px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 5px;
  border: 1px dashed #a9c1b4;
  border-radius: 10px;
  background: #edf4ee;
  color: #38594c;
}
.submission-image-card strong {
  font-size: 11px;
}
.submission-image-card small,
.submission-image-card span {
  color: #71857b;
  font-size: 9px;
  line-height: 1.4;
}
.submission-image-card span {
  margin-top: 4px;
  color: #587568;
}
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
  .review-similarity-summary {
    align-items: flex-start;
    flex-direction: column;
  }
  .submission-image-grid {
    grid-template-columns: 1fr;
  }
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
