<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, sf, dt, speciesText, observationText, locale } = useConservationText()
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  conservationStore,
  plantFor,
  speciesForPlant,
  speciesRequestForPlant,
  type Observation,
  type ObservationStatus,
  type SpeciesRecord,
  type SpeciesRequestStatus,
} from '../../data/conservation'

const route = useRoute()
const router = useRouter()
const search = ref('')
const status = ref('')
const species = ref('')
const date = ref('')
const selected = ref<Observation | null>(null)
const comment = ref('')
const error = ref('')
const reviewingSpecies = ref(false)
const speciesComment = ref('')
const speciesError = ref('')

const counts = computed(() => [
  [
    'Pending Review',
    conservationStore.observations.filter((o) => o.status === 'Pending Review').length,
  ],
  [
    'Correction Required',
    conservationStore.observations.filter((o) => o.status === 'Correction Required').length,
  ],
  ['Flagged', conservationStore.observations.filter((o) => o.status === 'Flagged').length],
  [
    'Approved Today',
    conservationStore.observations.filter(
      (o) => o.status === 'Approved' && o.reviewedAt?.startsWith('3 Oct'),
    ).length,
  ],
])

const filtered = computed(() =>
  conservationStore.observations.filter((observation) => {
    const officialSpecies = speciesForPlant(observation.plantId)
    const request = speciesRequestForPlant(observation.plantId)
    const searchable = `${observation.id} ${observation.plantId} ${officialSpecies?.scientificName ?? ''} ${officialSpecies ? sf(officialSpecies) + ' ' + sf(officialSpecies, 'common') : ''} ${request?.proposedScientificName ?? ''} ${ct(request?.proposedScientificName)} ${request?.proposedCommonName ?? ''} ${observation.recordedBy}`
    const matchesDate =
      !date.value ||
      observation.submittedAt.includes(
        new Date(`${date.value}T00:00:00`).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      )
    return (
      searchable.toLowerCase().includes(search.value.toLowerCase()) &&
      (!status.value || observation.status === status.value) &&
      (!species.value || officialSpecies?.id === species.value) &&
      matchesDate
    )
  }),
)

const selectedSpecies = computed(() =>
  selected.value ? speciesForPlant(selected.value.plantId) : undefined,
)
const selectedRequest = computed(() =>
  selected.value ? speciesRequestForPlant(selected.value.plantId) : undefined,
)
const speciesResolved = computed(
  () => !selectedRequest.value || selectedRequest.value.status === 'Approved',
)

function open(observation: Observation) {
  selected.value = observation
  comment.value = observation.reviewComment ? observationText(observation, 'reviewComment') : ''
  error.value = ''
  reviewingSpecies.value = false
  speciesError.value = ''
  const request = speciesRequestForPlant(observation.plantId)
  speciesComment.value = request?.reviewComment ? ct(request.reviewComment) : ''
}

function closeReview() {
  selected.value = null
  reviewingSpecies.value = false
  router.replace({ query: {} })
}

function decide(next: ObservationStatus) {
  if (!selected.value) return
  if (next === 'Approved' && !speciesResolved.value) {
    error.value = 'Resolve the linked species request before approving this plant submission.'
    return
  }
  if (next !== 'Approved' && !comment.value.trim()) {
    error.value = 'An officer comment is required for this decision.'
    return
  }
  selected.value.status = next
  selected.value.reviewComment = comment.value || 'Submission verified.'
  selected.value.reviewedBy = 'Officer01'
  selected.value.reviewedAt = '3 Oct 2026'
  closeReview()
}

function nextSpeciesId() {
  const highestId = conservationStore.species.reduce((highest, item) => {
    const numericId = Number.parseInt(item.id.match(/^SP(\d+)$/)?.[1] || '0', 10)
    return Math.max(highest, numericId)
  }, 0)
  return `SP${String(highestId + 1).padStart(3, '0')}`
}

function decideSpecies(next: SpeciesRequestStatus) {
  const request = selectedRequest.value
  const plant = selected.value ? plantFor(selected.value.plantId) : undefined
  if (!request || !plant) return
  speciesError.value = ''
  if (request.status === 'Approved' && request.approvedSpeciesId) {
    reviewingSpecies.value = false
    return
  }
  if (next !== 'Approved' && !speciesComment.value.trim()) {
    speciesError.value = 'A Species Request Comment is required for this decision.'
    return
  }
  if (next === 'Approved' && !request.proposedScientificName.trim()) {
    speciesError.value = 'Scientific name is required for approval.'
    return
  }
  if (next === 'Approved') {
    const newSpecies: SpeciesRecord = {
      id: nextSpeciesId(),
      scientificName: request.proposedScientificName,
      commonName: request.proposedCommonName,
      genus: request.genus,
      family: request.family,
      status: 'Not Assessed',
      plantCount: 1,
      updated: '3 Oct 2026',
      description: request.description,
      habitat: request.habitat,
      image: '/images/hero.jpg',
    }
    conservationStore.species.push(newSpecies)
    request.approvedSpeciesId = newSpecies.id
    plant.speciesId = newSpecies.id
  }
  request.status = next
  request.reviewedBy = 'Officer01'
  request.reviewedAt = '3 Oct 2026'
  request.reviewComment = speciesComment.value
  reviewingSpecies.value = false
}

onMounted(() => {
  const id = String(route.query.review || '')
  const observation = conservationStore.observations.find((item) => item.id === id)
  if (observation) open(observation)
})
</script>

<template>
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
        <option v-for="item in conservationStore.species" :key="item.id" :value="item.id">
          {{ sf(item, 'common') }}
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
            <th>{{ ct('Submitted Date') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="observation in filtered" :key="observation.id">
            <td>
              <strong>{{ observation.id }}</strong>
            </td>
            <td>{{ observation.plantId }}</td>
            <td>
              <em v-if="speciesForPlant(observation.plantId)">{{
                speciesText(observation.plantId)
              }}</em>
              <span v-else-if="speciesRequestForPlant(observation.plantId)" class="proposed-species"
                ><small>{{ ct('Proposed New Species') }}</small
                ><em>{{
                  ct(speciesRequestForPlant(observation.plantId)?.proposedScientificName)
                }}</em
                ><span
                  class="badge"
                  :class="
                    speciesRequestForPlant(observation.plantId)
                      ?.status.toLowerCase()
                      .replaceAll(' ', '-')
                  "
                  >{{ ct(speciesRequestForPlant(observation.plantId)?.status) }}</span
                ></span
              >
              <span v-else>{{ ct('Species unavailable') }}</span>
            </td>
            <td>{{ observation.recordedBy }}</td>
            <td>{{ ct(observation.location) }}</td>
            <td>{{ dt(observation.submittedAt) }}</td>
            <td>
              <span class="badge" :class="observation.status.toLowerCase().replaceAll(' ', '-')">{{
                ct(observation.status)
              }}</span>
            </td>
            <td>
              <button class="action-button" @click="open(observation)">{{ ct('Review') }}</button>
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
              <dd>{{ selectedSpecies ? sf(selectedSpecies) : ct('Proposed New Species') }}</dd>
            </div>
            <div>
              <dt>{{ ct('Taxonomy') }}</dt>
              <dd>
                {{
                  selectedSpecies
                    ? sf(selectedSpecies, 'family')
                    : ct(selectedRequest?.family || 'Pending Review')
                }}
              </dd>
            </div>
            <div>
              <dt>{{ ct('Height') }}</dt>
              <dd>{{ selected.height }}</dd>
            </div>
            <div>
              <dt>{{ ct('Growth Stage') }}</dt>
              <dd>{{ ct(selected.growthStage) }}</dd>
            </div>
            <div>
              <dt>{{ ct('Health') }}</dt>
              <dd>{{ ct(selected.health) }}</dd>
            </div>
            <div>
              <dt>{{ ct('Morphology') }}</dt>
              <dd>{{ observationText(selected, 'morphology') }}</dd>
            </div>
            <div>
              <dt>{{ ct('Coordinates') }}</dt>
              <dd>
                {{ plantFor(selected.plantId)?.latitude }},
                {{ plantFor(selected.plantId)?.longitude }} ({{ selected.gpsAccuracy }})
              </dd>
            </div>
            <div>
              <dt>{{ ct('Submission Date') }}</dt>
              <dd>{{ dt(selected.submittedAt) }}</dd>
            </div>
          </dl>
          <h3>{{ ct('Photographs') }}</h3>
          <div class="media-grid">
            <div v-for="photo in selected.photos" :key="photo" class="media-placeholder">
              {{ ct(photo) }}
            </div>
          </div>
        </div>
        <aside>
          <h3>{{ ct('Observation History') }}</h3>
          <div
            v-for="observation in conservationStore.observations.filter(
              (item) => item.plantId === selected?.plantId,
            )"
            :key="observation.id"
            class="history-item"
          >
            <strong>{{ observation.id }}</strong
            ><span
              >{{ dt(observation.observedAt) }} · {{ observation.height }} ·
              {{ ct(observation.health) }}</span
            >
          </div>
          <label class="form-field officer-comment"
            ><span>{{ ct('Observation Review Comment') }}</span
            ><textarea
              v-model="comment"
              :placeholder="ct('Record the observation decision or required action')"
            ></textarea>
          </label>
          <p v-if="error" class="form-error">{{ ct(error) }}</p>
        </aside>
      </div>
    </section>

    <section v-if="selectedRequest" class="species-dependency">
      <div class="dependency-heading">
        <div>
          <p class="section-kicker">{{ ct('SPECIES DEPENDENCY') }}</p>
          <h3 v-if="selectedRequest.status === 'Approved'">
            {{ selectedRequest.approvedSpeciesId }} — {{ sf(selectedSpecies) }}
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
          <p v-if="speciesError" class="form-error">{{ ct(speciesError) }}</p>
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
