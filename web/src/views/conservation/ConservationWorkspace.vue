<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { plantApi, type Species, type Observation, type Device } from '../../services/plantApi'
import AuthorizedMap from '../../components/AuthorizedMap.vue'
import StaffDialog from '../../components/StaffDialog.vue'
const route = useRoute(),
  mode = computed(() => String(route.name || '')),
  error = ref(''),
  message = ref(''),
  busy = ref(false),
  saving = ref(false),
  ready = ref(false)
const species = ref<Species[]>([]),
  observations = ref<Observation[]>([]),
  devices = ref<Device[]>([]),
  plants = ref<{ plant_id: string }[]>([])
interface Alert {
  id: string
  device_id: string
  metric: string
  value: number
  status: string
  created_at: string
}
interface Reading {
  id: string
  device_id: string
  values: Record<string, number>
  created_at: string
}
interface Report {
  scientific_name: string
  common_name: string
  approved_plants: number
}
const readings = ref<Reading[]>([]),
  alerts = ref<Alert[]>([]),
  reports = ref<Report[]>([]),
  generatedAt = ref(''),
  search = ref(''),
  status = ref('All'),
  comment = ref('')
const modal = ref<'species' | 'review' | 'response' | null>(null),
  selectedObservation = ref<Observation | null>(null),
  selectedAlert = ref<Alert | null>(null)
const blank = () => ({
  id: '',
  scientific_name: '',
  common_name: '',
  description: '',
  habitat: '',
  culturalSignificance: '',
  visibility: 'internal',
  genus_id: '',
  status_id: '',
  conservation_status: '',
})
const form = ref(blank())
const showSpecies = computed(() => mode.value.includes('species')),
  showReviews = computed(
    () => mode.value.includes('reviews') || mode.value.includes('observations'),
  ),
  showIoT = computed(() => mode.value.includes('iot')),
  showAlerts = computed(() => mode.value.includes('alerts')),
  showReports = computed(() => mode.value.includes('reports')),
  dashboard = computed(() => mode.value.includes('dashboard'))
const filteredSpecies = computed(() =>
  species.value.filter(
    (s) =>
      `${s.scientific_name} ${s.common_name}`.toLowerCase().includes(search.value.toLowerCase()) &&
      (status.value === 'All' || s.sensitivity === status.value),
  ),
)
const filteredObservations = computed(() =>
  observations.value.filter(
    (o) =>
      `${o.plant_id} ${o.content.morphology} ${o.owner_subject}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (status.value === 'All' || o.status === status.value),
  ),
)
const filteredAlerts = computed(() =>
  alerts.value.filter(
    (a) =>
      `${a.metric} ${a.device_id}`.toLowerCase().includes(search.value.toLowerCase()) &&
      (status.value === 'All' || a.status === status.value),
  ),
)
const date = (value: string) => {
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Unavailable'
}
const measurement = (values: Record<string, number>) =>
  Object.entries(values)
    .map(
      ([metric, value]) =>
        `${metric}: ${value}${metric === 'temperature' ? ' °C' : metric === 'humidity' ? ' %' : ''}`,
    )
    .join(' · ')
let generation = 0
async function load() {
  const attempt = ++generation
  error.value = ''
  busy.value = true
  ready.value = false
  try {
    if (showSpecies.value || dashboard.value) {
      const value = await plantApi<{ species: Species[] }>('/species?scope=scientific')
      if (attempt !== generation) return
      species.value = value.species
    }
    if (showReviews.value || dashboard.value) {
      const value = await plantApi<{ observations: Observation[] }>('/observations')
      if (attempt !== generation) return
      observations.value = value.observations
    }
    if (dashboard.value) {
      const [p, a] = await Promise.all([
        plantApi<{ plants: { plant_id: string }[] }>('/plants'),
        plantApi<{ alerts: Alert[] }>('/alerts'),
      ])
      if (attempt !== generation) return
      plants.value = p.plants
      alerts.value = a.alerts
    }
    if (showIoT.value) {
      const [d, r] = await Promise.all([
        plantApi<{ devices: Device[] }>('/devices'),
        plantApi<{ readings: Reading[] }>('/readings'),
      ])
      if (attempt !== generation) return
      devices.value = d.devices
      readings.value = r.readings
    }
    if (showAlerts.value) {
      const value = await plantApi<{ alerts: Alert[] }>('/alerts')
      if (attempt !== generation) return
      alerts.value = value.alerts
    }
    if (showReports.value) {
      const value = await plantApi<{ rows: Report[]; generatedAt: string }>('/reports')
      if (attempt !== generation) return
      reports.value = value.rows
      generatedAt.value = value.generatedAt
    }
    ready.value = true
  } catch (cause) {
    if (attempt === generation)
      error.value = cause instanceof Error ? cause.message : 'Page could not be loaded.'
  } finally {
    if (attempt === generation) busy.value = false
  }
}
function addSpecies() {
  form.value = blank()
  error.value = ''
  modal.value = 'species'
}
function edit(row: Species) {
  form.value = {
    id: row.species_id,
    scientific_name: row.scientific_name,
    common_name: row.common_name,
    description: row.description,
    habitat: row.habitat || '',
    culturalSignificance: row.culturalSignificance || '',
    visibility: row.sensitivity || 'internal',
    genus_id: String(row.genus_id || ''),
    status_id: String(row.status_id || ''),
    conservation_status: row.conservation_status || '',
  }
  error.value = ''
  modal.value = 'species'
}
async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const { id, ...body } = form.value
    const value = await plantApi<{ species_id?: string }>(
      id ? `/species/${id}` : '/species',
      id ? 'PATCH' : 'POST',
      {
        ...body,
        genus_id: body.genus_id ? Number(body.genus_id) : null,
        status_id: null,
        conservation_status: body.conservation_status.trim(),
      },
    )
    if (!id && value.species_id) form.value.id = String(value.species_id)
    message.value = 'Official species saved.'
    modal.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Species could not be saved.'
  } finally {
    saving.value = false
  }
}
async function remove(row: Species) {
  if (!window.confirm(`Delete ${row.scientific_name}? Referenced records prevent deletion.`)) return
  try {
    await plantApi(`/species/${row.species_id}`, 'DELETE', {})
    message.value = 'Species deleted.'
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Species could not be deleted.'
  }
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !form.value.id) return
  try {
    if (file.size > 4194304) throw Error('File must be at most 4 MB.')
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type))
      throw Error('Use a JPEG, PNG or PDF.')
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
      reader.onerror = () => reject(Error('File could not be read.'))
      reader.readAsDataURL(file)
    })
    await plantApi('/assets', 'POST', {
      species_id: form.value.id,
      content_type: file.type,
      base64,
    })
    message.value = 'Official attachment uploaded.'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Upload failed.'
  }
}
function openReview(row: Observation) {
  selectedObservation.value = row
  comment.value = ''
  error.value = ''
  modal.value = 'review'
}
async function review(decision: string) {
  const row = selectedObservation.value
  if (!row || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await plantApi(`/observations/${row.id}/review`, 'POST', {
      decision,
      comment: comment.value,
      revision: row.revision,
    })
    message.value = 'Decision saved.'
    modal.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Decision could not be saved.'
  } finally {
    saving.value = false
  }
}
function openResponse(row: Alert) {
  selectedAlert.value = row
  comment.value = ''
  error.value = ''
  modal.value = 'response'
}
async function respond(status: string) {
  if (!selectedAlert.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    if (!comment.value.trim()) throw Error('Enter a response note.')
    await plantApi(`/alerts/${selectedAlert.value.id}/responses`, 'POST', {
      status,
      note: comment.value,
    })
    message.value = 'Response saved.'
    modal.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Response could not be saved.'
  } finally {
    saving.value = false
  }
}
async function exportReport(format = 'csv') {
  try {
    const result = await plantApi<{ rows: Report[]; generatedAt: string }>('/reports')
    const rows = [
      ['Scientific name', 'Common name', 'Approved plants'],
      ...result.rows.map((r) => [r.scientific_name, r.common_name, r.approved_plants]),
    ]
    if (format === 'pdf') {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ])
      const document = new jsPDF()
      document.text('Biodiversity report', 14, 15)
      autoTable(document, {
        head: [rows[0]!.map(String)],
        body: rows.slice(1).map((row) => row.map(String)),
        startY: 22,
      })
      document.save(`biodiversity-${result.generatedAt.slice(0, 10)}.pdf`)
    } else {
      const escape = (v: unknown) => {
        const value = String(v ?? '')
        return `"${(/^[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`
      }
      const url = URL.createObjectURL(
        new Blob([rows.map((r) => r.map(escape).join(',')).join('\r\n')], { type: 'text/csv' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `biodiversity-${result.generatedAt.slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    message.value = `Exported ${result.rows.length} species.`
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Report could not be exported.'
  }
}
onMounted(load)
watch(mode, () => {
  modal.value = null
  search.value = ''
  status.value = 'All'
  message.value = ''
  species.value = []
  observations.value = []
  devices.value = []
  readings.value = []
  alerts.value = []
  reports.value = []
  void load()
})
</script>
<template>
  <section class="staff-page">
    <div class="page-heading">
      <div>
        <h2>{{ route.meta.title }}</h2>
        <p class="muted">
          {{
            dashboard
              ? 'Review current biodiversity records and conservation tasks.'
              : showSpecies
                ? 'Manage official species records and publication classifications.'
                : showReviews
                  ? 'Inspect field observations and record authorized review decisions.'
                  : showIoT
                    ? 'View received environmental measurements and device status.'
                    : showAlerts
                      ? 'Review sensor alerts and record conservation responses.'
                      : showReports
                        ? 'Preview and export the authorized biodiversity summary.'
                        : 'View authorized plant locations.'
          }}
        </p>
      </div>
      <div class="actions">
        <button :disabled="busy" @click="load">{{ busy ? 'Loading…' : 'Refresh' }}</button
        ><button v-if="showSpecies" class="primary" @click="addSpecies">Add Species</button>
      </div>
    </div>
    <p v-if="error && !modal" role="alert">{{ error }}</p>
    <p v-if="message && !modal" role="status">{{ message }}</p>
    <template v-if="dashboard"
      ><div class="stats">
        <div class="stat">
          <span>Accessible species</span><strong>{{ ready ? species.length : '—' }}</strong>
        </div>
        <div class="stat">
          <span>Plant records</span><strong>{{ ready ? plants.length : '—' }}</strong>
        </div>
        <div class="stat">
          <span>Awaiting review</span
          ><strong>{{
            ready ? observations.filter((o) => o.status === 'Pending Review').length : '—'
          }}</strong>
        </div>
        <div class="stat">
          <span>Open alerts</span
          ><strong>{{ ready ? alerts.filter((a) => a.status !== 'Resolved').length : '—' }}</strong>
        </div>
      </div>
      <section class="panel">
        <h3>Conservation workspace</h3>
        <p class="muted">
          Use the sidebar to manage species, review field submissions, inspect the biodiversity map,
          monitor devices and export reports.
        </p>
        <div class="toolbar">
          <RouterLink to="/conservation/reviews">Review submissions →</RouterLink
          ><RouterLink to="/conservation/species">Manage species →</RouterLink
          ><RouterLink to="/conservation/alerts">View alerts →</RouterLink>
        </div>
        <p v-if="ready && !species.length" class="empty">No species records have been added yet.</p>
      </section></template
    >
    <template v-if="showSpecies"
      ><div class="toolbar">
        <input
          v-model="search"
          aria-label="Search species"
          placeholder="Search scientific or common name"
        /><select v-model="status" aria-label="Species classification">
          <option>All</option>
          <option value="public">Public</option>
          <option value="internal">Scientific staff</option>
          <option value="protected">Protected</option>
        </select>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Species</th>
              <th>Common name</th>
              <th>Conservation status</th>
              <th>Access</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredSpecies" :key="row.species_id">
              <td>
                <strong>{{ row.scientific_name }}</strong
                ><small>Species {{ row.species_id }}</small>
              </td>
              <td>{{ row.common_name }}</td>
              <td>{{ row.conservation_status || 'Not specified' }}</td>
              <td>
                <span class="badge">{{ row.sensitivity }}</span>
              </td>
              <td>
                <div class="actions">
                  <button @click="edit(row)">Edit</button
                  ><button class="danger" @click="remove(row)">Delete</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filteredSpecies.length">
              <td colspan="5" class="empty">
                {{
                  busy
                    ? 'Loading species…'
                    : error
                      ? 'Species unavailable.'
                      : 'No matching species records.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div></template
    >
    <template v-if="showReviews"
      ><div class="toolbar">
        <input
          v-model="search"
          aria-label="Search observations"
          placeholder="Search plant, submitter or morphology…"
        /><select v-model="status" aria-label="Observation status">
          <option>All</option>
          <option>Draft</option>
          <option>Pending Review</option>
          <option>Flagged</option>
          <option>Approved</option>
          <option>Rejected</option>
          <option>Correction Required</option>
        </select>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Plant</th>
              <th>Morphology</th>
              <th>Submitted by</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredObservations" :key="row.id">
              <td>{{ row.plant_id }}</td>
              <td>{{ row.content.morphology }}</td>
              <td>{{ row.owner_subject }}</td>
              <td>
                <span class="badge">{{ row.status }}</span>
              </td>
              <td>
                <button @click="openReview(row)">
                  {{
                    ['Pending Review', 'Flagged'].includes(row.status)
                      ? 'Review'
                      : 'View observation'
                  }}
                </button>
              </td>
            </tr>
            <tr v-if="!filteredObservations.length">
              <td colspan="5" class="empty">
                {{
                  busy
                    ? 'Loading observations…'
                    : error
                      ? 'Observations unavailable.'
                      : 'No matching observations.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div></template
    >
    <section v-if="mode.includes('map')" class="panel">
      <h3>Authorized species distribution</h3>
      <AuthorizedMap />
    </section>
    <template v-if="showIoT"
      ><div class="stats">
        <div class="stat">
          <span>Registered sensors</span><strong>{{ ready ? devices.length : '—' }}</strong>
        </div>
        <div class="stat">
          <span>Readings received</span><strong>{{ ready ? readings.length : '—' }}</strong>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Last report</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in devices" :key="d.id">
              <td>
                {{ d.name }}<small>{{ d.id }}</small>
              </td>
              <td>{{ d.status }}</td>
              <td>{{ d.last_seen ? date(d.last_seen) : 'No reading received' }}</td>
            </tr>
            <tr v-if="!devices.length">
              <td colspan="3" class="empty">
                {{
                  busy
                    ? 'Loading devices…'
                    : error
                      ? 'Devices unavailable.'
                      : 'No sensors registered yet.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section class="panel" style="margin-top: 20px">
        <h3>Recent sensor readings</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Measurements</th>
                <th>Received at</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in readings" :key="r.id">
                <td>{{ devices.find((d) => d.id === r.device_id)?.name || r.device_id }}</td>
                <td>{{ measurement(r.values) }}</td>
                <td>{{ date(r.created_at) }}</td>
              </tr>
              <tr v-if="!readings.length">
                <td colspan="3" class="empty">
                  {{
                    busy
                      ? 'Loading readings…'
                      : error
                        ? 'Readings unavailable.'
                        : 'No sensor readings received yet.'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section></template
    >
    <template v-if="showAlerts"
      ><div class="toolbar">
        <input
          v-model="search"
          aria-label="Search alerts"
          placeholder="Search metric or device…"
        /><select v-model="status" aria-label="Alert status">
          <option>All</option>
          <option>New</option>
          <option>Reviewing</option>
          <option>Resolved</option>
        </select>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Alert</th>
              <th>Measurement</th>
              <th>Status</th>
              <th>Recorded at</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in filteredAlerts" :key="a.id">
              <td>
                {{ a.id }}<small>{{ a.device_id }}</small>
              </td>
              <td>{{ measurement({ [a.metric]: a.value }) }}</td>
              <td>
                <span class="badge">{{ a.status }}</span>
              </td>
              <td>{{ date(a.created_at) }}</td>
              <td>
                <button v-if="a.status !== 'Resolved'" @click="openResponse(a)">Respond</button
                ><span v-else>Response completed</span>
              </td>
            </tr>
            <tr v-if="!filteredAlerts.length">
              <td colspan="5" class="empty">
                {{
                  busy
                    ? 'Loading alerts…'
                    : error
                      ? 'Alerts unavailable.'
                      : 'No matching threat alerts.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div></template
    >
    <template v-if="showReports"
      ><section class="panel">
        <h3>Biodiversity summary</h3>
        <p class="muted">
          Approved plant counts for official species.
          {{ generatedAt ? 'Generated ' + date(generatedAt) : '' }}
        </p>
        <div class="toolbar">
          <button class="primary" :disabled="busy || !ready" @click="exportReport('csv')">
            Download biodiversity CSV</button
          ><button :disabled="busy || !ready" @click="exportReport('pdf')">
            Download biodiversity PDF
          </button>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Scientific name</th>
                <th>Common name</th>
                <th>Approved plants</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in reports" :key="row.scientific_name">
                <td>{{ row.scientific_name }}</td>
                <td>{{ row.common_name }}</td>
                <td>{{ row.approved_plants }}</td>
              </tr>
              <tr v-if="!reports.length">
                <td colspan="3" class="empty">
                  {{
                    busy
                      ? 'Loading report…'
                      : error
                        ? 'Report unavailable.'
                        : 'No species records available for this report.'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section></template
    >
    <StaffDialog
      v-if="modal"
      :title="
        modal === 'species'
          ? form.id
            ? 'Edit official species'
            : 'Add official species'
          : modal === 'review'
            ? 'Observation Review'
            : 'Alert Response'
      "
      :busy="saving"
      @close="modal = null"
    >
      <div class="staff-form">
        <p v-if="error" role="alert">{{ error }}</p>
        <p v-if="message" role="status">{{ message }}</p>
        <form v-if="modal === 'species'" class="staff-form" @submit.prevent="save">
          <label
            >Scientific name<input v-model="form.scientific_name" required maxlength="200" /></label
          ><label>Common name<input v-model="form.common_name" required maxlength="200" /></label
          ><label>Description<textarea v-model="form.description" required /></label
          ><label>Habitat<textarea v-model="form.habitat" /></label
          ><label>Cultural significance<textarea v-model="form.culturalSignificance" /></label
          ><label>Existing genus ID<input v-model="form.genus_id" inputmode="numeric" /></label
          ><label
            >Conservation status (verified name)<input
              v-model="form.conservation_status"
              maxlength="200" /></label
          ><label
            >Publication classification<select v-model="form.visibility">
              <option value="public">Public</option>
              <option value="internal">Scientific staff</option>
              <option value="protected">Protected — Officer only</option>
            </select></label
          ><label v-if="form.id"
            >Official photo or PDF<input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              @change="upload"
          /></label>
          <div class="actions">
            <button type="button" :disabled="saving" @click="modal = null">Cancel</button
            ><button class="primary" :disabled="saving">Save official species</button>
          </div>
        </form>
        <template v-if="modal === 'review' && selectedObservation"
          ><p>
            Plant {{ selectedObservation.plant_id }} · {{ selectedObservation.status }} · Revision
            {{ selectedObservation.revision }}
          </p>
          <p>Submitted by {{ selectedObservation.owner_subject }}</p>
          <p><strong>Height:</strong> {{ selectedObservation.content.heightCm }} cm</p>
          <p><strong>Morphology:</strong> {{ selectedObservation.content.morphology }}</p>
          <p><strong>Notes:</strong> {{ selectedObservation.content.notes || 'None' }}</p>
          <template v-if="['Pending Review', 'Flagged'].includes(selectedObservation.status)"
            ><label
              >Review feedback<textarea
                v-model="comment"
                placeholder="Required for rejection, flag, or correction"
              />
            </label>
            <div class="actions">
              <button :disabled="saving" class="primary" @click="review('Approved')">Approve</button
              ><button :disabled="saving" @click="review('Rejected')">Reject</button
              ><button
                v-if="selectedObservation.status !== 'Flagged'"
                :disabled="saving"
                @click="review('Flagged')"
              >
                Flag</button
              ><button :disabled="saving" @click="review('Correction Required')">
                Request correction
              </button>
            </div></template
          ></template
        >
        <template v-if="modal === 'response' && selectedAlert"
          ><p>{{ selectedAlert.metric }}: {{ selectedAlert.value }} · {{ selectedAlert.status }}</p>
          <label>Response note<textarea v-model="comment" required /></label>
          <div class="actions">
            <button :disabled="saving" @click="respond('Reviewing')">Start response</button
            ><button :disabled="saving" class="primary" @click="respond('Resolved')">
              Resolve
            </button>
          </div></template
        >
      </div>
    </StaffDialog>
  </section>
</template>
<style src="../../styles/staff-workspace.css"></style>
