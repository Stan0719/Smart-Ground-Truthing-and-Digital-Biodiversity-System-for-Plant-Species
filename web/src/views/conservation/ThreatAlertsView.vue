<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, sf, dt, speciesText, observationText, locale } = useConservationText()
import { computed, ref } from 'vue'
import AppModal from '../../components/conservation/AppModal.vue'
import { conservationStore, speciesForPlant, type ThreatAlert } from '../../data/conservation'
const search = ref(''),
  severity = ref(''),
  status = ref(''),
  date = ref(''),
  location = ref(''),
  selected = ref<ThreatAlert | null>(null),
  note = ref('')
const cards = computed(() => [
  ['Active Alerts', conservationStore.alerts.filter((a) => a.status !== 'Resolved').length],
  ['High Severity', conservationStore.alerts.filter((a) => a.severity === 'High').length],
  ['Under Review', conservationStore.alerts.filter((a) => a.status === 'Reviewing').length],
  ['Resolved', conservationStore.alerts.filter((a) => a.status === 'Resolved').length],
])
const filtered = computed(() =>
  conservationStore.alerts.filter(
    (a) =>
      `${a.id} ${a.plantId} ${a.type} ${ct(a.type)}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (!severity.value || a.severity === severity.value) &&
      (!status.value || a.status === status.value) &&
      (!location.value || a.zone === location.value) &&
      (!date.value ||
        a.detectedAt.includes(
          new Date(date.value + 'T00:00:00').toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        )),
  ),
)
function startReview(alert: ThreatAlert) {
  selected.value = alert
  update('Reviewing')
}
function update(next: 'Reviewing' | 'Resolved') {
  if (!selected.value) return
  if (note.value.trim()) selected.value.notes.push(note.value.trim())
  selected.value.status = next
  note.value = ''
}
</script>
<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ ct('INCIDENT RESPONSE') }}</p>
      <h2>{{ ct('Threat Alerts') }}</h2>
      <p>{{ ct('Review environmental and security events around monitored plants.') }}</p>
    </div>
  </section>
  <section class="summary-grid">
    <article v-for="c in cards" :key="String(c[0])" class="summary-card">
      <p>{{ ct(c[0]) }}</p>
      <strong>{{ c[1] }}</strong
      ><small>{{ ct('Current alert register') }}</small>
    </article>
  </section>
  <div class="control-bar">
    <label class="field search-field"
      ><span>{{ ct('Search') }}</span
      ><input v-model="search" :placeholder="ct('Alert ID, Plant ID or type')" /></label
    ><label class="field"
      ><span>{{ ct('Severity') }}</span
      ><select v-model="severity">
        <option value="">{{ ct('All severities') }}</option>
        <option value="Low">{{ ct('Low') }}</option>
        <option value="Medium">{{ ct('Medium') }}</option>
        <option value="High">{{ ct('High') }}</option>
      </select></label
    ><label class="field"
      ><span>{{ ct('Status') }}</span
      ><select v-model="status">
        <option value="">{{ ct('All statuses') }}</option>
        <option value="New">{{ ct('New') }}</option>
        <option value="Reviewing">{{ ct('Reviewing') }}</option>
        <option value="Resolved">{{ ct('Resolved') }}</option>
      </select></label
    ><label class="field"
      ><span>{{ ct('Date') }}</span
      ><input v-model="date" type="date" /></label
    ><label class="field"
      ><span>{{ ct('Location') }}</span
      ><select v-model="location">
        <option value="">{{ ct('All locations') }}</option>
        <option value="Zone A">{{ ct('Zone A') }}</option>
        <option value="Zone B">{{ ct('Zone B') }}</option>
        <option value="Zone C">{{ ct('Zone C') }}</option>
      </select></label
    >
  </div>
  <section class="panel">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('Alert ID') }}</th>
            <th>{{ ct('Alert Type') }}</th>
            <th>{{ ct('Plant ID') }}</th>
            <th>{{ ct('Species') }}</th>
            <th>{{ ct('Sensor') }}</th>
            <th>{{ ct('Location') }}</th>
            <th>{{ ct('Severity') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Detected At') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in filtered" :key="a.id">
            <td>
              <strong>{{ a.id }}</strong>
            </td>
            <td>{{ ct(a.type) }}</td>
            <td>{{ a.plantId }}</td>
            <td>
              <em>{{ speciesText(a.plantId) }}</em>
            </td>
            <td>{{ a.sensorId }}</td>
            <td>{{ ct(a.zone) }}</td>
            <td>
              <span class="badge" :class="a.severity.toLowerCase()">{{ ct(a.severity) }}</span>
            </td>
            <td>
              <span class="badge" :class="a.status.toLowerCase()">{{ ct(a.status) }}</span>
            </td>
            <td>{{ dt(a.detectedAt) }}</td>
            <td>
              <div class="action-group">
                <button class="action-button" @click="selected = a">{{ ct('View') }}</button
                ><button v-if="a.status === 'New'" class="action-button" @click="startReview(a)">
                  {{ ct('Review') }}</button
                ><button v-if="a.status !== 'Resolved'" class="action-button" @click="selected = a">
                  {{ ct('Resolve') }}</button
                ><RouterLink
                  class="action-button"
                  :to="{ name: 'conservation-observations', query: { plant: a.plantId } }"
                  >{{ ct('Plant') }}</RouterLink
                ><RouterLink
                  class="action-button"
                  :to="{ name: 'conservation-map', query: { plant: a.plantId } }"
                  >{{ ct('Location') }}</RouterLink
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AppModal
    v-if="selected"
    :title="`${selected.id} · ${ct(selected.type)}`"
    :subtitle="`${selected.plantId} · ${speciesText(selected.plantId)}`"
    @close="selected = null"
    ><dl class="detail-list">
      <div>
        <dt>{{ ct('Sensor / Device') }}</dt>
        <dd>{{ selected.sensorId }}</dd>
      </div>
      <div>
        <dt>{{ ct('Environmental Reading') }}</dt>
        <dd>{{ ct(selected.reading) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Timestamp') }}</dt>
        <dd>{{ dt(selected.detectedAt) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Location') }}</dt>
        <dd>{{ ct(selected.zone) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Severity') }}</dt>
        <dd>{{ ct(selected.severity) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Current Status') }}</dt>
        <dd>{{ ct(selected.status) }}</dd>
      </div>
    </dl>
    <h3>{{ ct('Response History') }}</h3>
    <div v-if="!selected.notes.length" class="media-placeholder">
      {{ ct('No response notes yet') }}
    </div>
    <p v-for="n in selected.notes" :key="n" class="response-note">{{ ct(n) }}</p>
    <label class="form-field"
      ><span>{{ ct('Add response note') }}</span
      ><textarea
        v-model="note"
        :placeholder="ct('Describe the response or investigation')"
      ></textarea>
    </label>
    <div class="modal-actions">
      <button
        v-if="selected.status === 'New'"
        class="secondary-button"
        @click="update('Reviewing')"
      >
        {{ ct('Mark as Reviewing') }}</button
      ><button
        v-if="selected.status !== 'Resolved'"
        class="primary-button"
        @click="update('Resolved')"
      >
        {{ ct('Mark as Resolved') }}
      </button>
    </div></AppModal
  >
</template>
<style scoped>
a.action-button {
  text-decoration: none;
}
.response-note {
  padding: 10px;
  border-left: 3px solid #65a187;
  background: #f4f8f4;
  color: #526b60;
  font-size: 10px;
}
</style>
