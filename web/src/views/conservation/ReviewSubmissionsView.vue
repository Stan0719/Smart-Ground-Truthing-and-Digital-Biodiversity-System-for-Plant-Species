<script setup lang="ts">
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
    const searchable = `${observation.id} ${observation.plantId} ${officialSpecies?.scientificName ?? ''} ${request?.proposedScientificName ?? ''} ${request?.proposedCommonName ?? ''} ${observation.recordedBy}`
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
  comment.value = observation.reviewComment || ''
  error.value = ''
  reviewingSpecies.value = false
  speciesError.value = ''
  const request = speciesRequestForPlant(observation.plantId)
  speciesComment.value = request?.reviewComment || ''
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
      <p class="page-kicker">VERIFICATION WORKFLOW</p>
      <h2>Review Submissions</h2>
      <p>Verify botanist observations and preserve a clear review decision.</p>
    </div>
  </section>
  <section class="summary-grid">
    <article v-for="count in counts" :key="String(count[0])" class="summary-card">
      <p>{{ count[0] }}</p>
      <strong>{{ count[1] }}</strong
      ><small>Observation submissions</small>
    </article>
  </section>
  <div class="control-bar">
    <label class="field search-field"
      ><span>Search</span
      ><input v-model="search" placeholder="Observation ID, Plant ID, species or botanist"
    /></label>
    <label class="field"
      ><span>Review status</span
      ><select v-model="status">
        <option value="">All statuses</option>
        <option
          v-for="reviewStatus in [
            'Pending Review',
            'Approved',
            'Rejected',
            'Correction Required',
            'Flagged',
          ]"
          :key="reviewStatus"
        >
          {{ reviewStatus }}
        </option>
      </select></label
    >
    <label class="field"
      ><span>Species</span
      ><select v-model="species">
        <option value="">All species</option>
        <option v-for="item in conservationStore.species" :key="item.id" :value="item.id">
          {{ item.commonName }}
        </option>
      </select></label
    >
    <label class="field"><span>Date</span><input v-model="date" type="date" /></label>
  </div>
  <section class="panel">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Observation ID</th>
            <th>Plant ID</th>
            <th>Species</th>
            <th>Submitted By</th>
            <th>Location</th>
            <th>Submitted Date</th>
            <th>Status</th>
            <th>Actions</th>
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
                speciesForPlant(observation.plantId)?.scientificName
              }}</em>
              <span v-else-if="speciesRequestForPlant(observation.plantId)" class="proposed-species"
                ><small>Proposed New Species</small
                ><em>{{ speciesRequestForPlant(observation.plantId)?.proposedScientificName }}</em
                ><span
                  class="badge"
                  :class="
                    speciesRequestForPlant(observation.plantId)
                      ?.status.toLowerCase()
                      .replaceAll(' ', '-')
                  "
                  >{{ speciesRequestForPlant(observation.plantId)?.status }}</span
                ></span
              >
              <span v-else>Species unavailable</span>
            </td>
            <td>{{ observation.recordedBy }}</td>
            <td>{{ observation.location }}</td>
            <td>{{ observation.submittedAt }}</td>
            <td>
              <span class="badge" :class="observation.status.toLowerCase().replaceAll(' ', '-')">{{
                observation.status
              }}</span>
            </td>
            <td><button class="action-button" @click="open(observation)">Review</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <AppModal
    v-if="selected"
    :title="`Review ${selected.id}`"
    :subtitle="`${selected.plantId} · submitted by ${selected.recordedBy}`"
    wide
    @close="closeReview"
  >
    <section class="review-section">
      <p class="section-kicker">PLANT / OBSERVATION INFORMATION</p>
      <div class="two-column">
        <div>
          <dl class="detail-list">
            <div>
              <dt>Species</dt>
              <dd>{{ selectedSpecies?.scientificName || 'Proposed new species' }}</dd>
            </div>
            <div>
              <dt>Taxonomy</dt>
              <dd>{{ selectedSpecies?.family || selectedRequest?.family || 'Pending review' }}</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{{ selected.height }}</dd>
            </div>
            <div>
              <dt>Growth Stage</dt>
              <dd>{{ selected.growthStage }}</dd>
            </div>
            <div>
              <dt>Health</dt>
              <dd>{{ selected.health }}</dd>
            </div>
            <div>
              <dt>Morphology</dt>
              <dd>{{ selected.morphology }}</dd>
            </div>
            <div>
              <dt>Coordinates</dt>
              <dd>
                {{ plantFor(selected.plantId)?.latitude }},
                {{ plantFor(selected.plantId)?.longitude }} ({{ selected.gpsAccuracy }})
              </dd>
            </div>
            <div>
              <dt>Submission Date</dt>
              <dd>{{ selected.submittedAt }}</dd>
            </div>
          </dl>
          <h3>Photographs</h3>
          <div class="media-grid">
            <div v-for="photo in selected.photos" :key="photo" class="media-placeholder">
              {{ photo }}
            </div>
          </div>
        </div>
        <aside>
          <h3>Observation History</h3>
          <div
            v-for="observation in conservationStore.observations.filter(
              (item) => item.plantId === selected?.plantId,
            )"
            :key="observation.id"
            class="history-item"
          >
            <strong>{{ observation.id }}</strong
            ><span
              >{{ observation.observedAt }} · {{ observation.height }} ·
              {{ observation.health }}</span
            >
          </div>
          <label class="form-field officer-comment"
            ><span>Observation Review Comment</span
            ><textarea
              v-model="comment"
              placeholder="Record the observation decision or required action"
            ></textarea>
          </label>
          <p v-if="error" class="form-error">{{ error }}</p>
        </aside>
      </div>
    </section>

    <section v-if="selectedRequest" class="species-dependency">
      <div class="dependency-heading">
        <div>
          <p class="section-kicker">SPECIES DEPENDENCY</p>
          <h3 v-if="selectedRequest.status === 'Approved'">
            {{ selectedRequest.approvedSpeciesId }} — {{ selectedSpecies?.scientificName }}
          </h3>
          <h3 v-else>Proposed New Species · {{ selectedRequest.proposedScientificName }}</h3>
          <span>Species Request: {{ selectedRequest.id }}</span>
        </div>
        <span class="badge" :class="selectedRequest.status.toLowerCase().replaceAll(' ', '-')">{{
          selectedRequest.status
        }}</span>
      </div>
      <button class="secondary-button" @click="reviewingSpecies = !reviewingSpecies">
        {{ reviewingSpecies ? 'Hide Species Request' : 'Review Species Request' }}
      </button>
      <div v-if="reviewingSpecies" class="species-review-panel">
        <dl class="detail-list">
          <div>
            <dt>Request ID</dt>
            <dd>{{ selectedRequest.id }}</dd>
          </div>
          <div>
            <dt>Request Status</dt>
            <dd>{{ selectedRequest.status }}</dd>
          </div>
          <div>
            <dt>Proposed Scientific Name</dt>
            <dd>{{ selectedRequest.proposedScientificName }}</dd>
          </div>
          <div>
            <dt>Proposed Common Name</dt>
            <dd>{{ selectedRequest.proposedCommonName }}</dd>
          </div>
          <div>
            <dt>Genus</dt>
            <dd>{{ selectedRequest.genus }}</dd>
          </div>
          <div>
            <dt>Family</dt>
            <dd>{{ selectedRequest.family }}</dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>{{ selectedRequest.description }}</dd>
          </div>
          <div>
            <dt>Habitat / Ecological Information</dt>
            <dd>{{ selectedRequest.habitat }}</dd>
          </div>
          <div>
            <dt>Identification Notes</dt>
            <dd>{{ selectedRequest.identificationNotes }}</dd>
          </div>
          <div>
            <dt>Submitted By</dt>
            <dd>{{ selectedRequest.requestedBy }}</dd>
          </div>
          <div>
            <dt>Submitted Date</dt>
            <dd>{{ selectedRequest.submittedAt }}</dd>
          </div>
        </dl>
        <h3>Submitted Photographs / Evidence</h3>
        <div class="media-grid">
          <div v-for="photo in selectedRequest.photos" :key="photo" class="media-placeholder">
            {{ photo }}
          </div>
        </div>
        <template v-if="selectedRequest.status !== 'Approved'"
          ><div class="species-review-fields">
            <label class="form-field full"
              ><span>Species Request Comment</span
              ><textarea
                v-model="speciesComment"
                placeholder="Record the species decision or required correction"
              ></textarea>
            </label>
          </div>
          <p v-if="speciesError" class="form-error">{{ speciesError }}</p>
          <div class="species-actions">
            <button class="primary-button" @click="decideSpecies('Approved')">
              Approve Species</button
            ><button class="danger-button" @click="decideSpecies('Rejected')">Reject</button
            ><button class="secondary-button" @click="decideSpecies('Correction Required')">
              Request Correction
            </button>
          </div></template
        >
        <p v-else class="resolved-message">
          Species approved as {{ selectedRequest.approvedSpeciesId }}. The observation decision
          remains separate.
        </p>
      </div>
    </section>
    <p v-if="!speciesResolved" class="approval-blocked">
      Resolve the linked species request before approving this plant submission.
    </p>
    <div class="modal-actions">
      <button class="primary-button" :disabled="!speciesResolved" @click="decide('Approved')">
        Approve</button
      ><button class="danger-button" @click="decide('Rejected')">Reject</button
      ><button class="secondary-button" @click="decide('Correction Required')">
        Request Correction</button
      ><button class="secondary-button" @click="decide('Flagged')">Flag</button>
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
