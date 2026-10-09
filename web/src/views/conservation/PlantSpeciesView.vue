<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  conservationStore,
  type ConservationStatus,
  type SpeciesRecord,
} from '../../data/conservation'

const route = useRoute()
const router = useRouter()

const search = ref('')
const family = ref('')
const status = ref('')
const modal = ref<'form' | 'view' | 'delete' | null>(null)
const selected = ref<SpeciesRecord | null>(null)
const editing = ref(false)

const blank = () => ({
  id: `SP${String(conservationStore.species.length + 1).padStart(3, '0')}`,
  scientificName: '',
  commonName: '',
  genus: '',
  family: '',
  status: 'Least Concern' as ConservationStatus,
  plantCount: 0,
  updated: '3 Oct 2026',
  description: '',
  habitat: '',
  image: '',
})

const form = reactive<SpeciesRecord>(blank())

const families = computed(() => [...new Set(conservationStore.species.map((s) => s.family))])

const filtered = computed(() =>
  conservationStore.species.filter(
    (s) =>
      `${s.scientificName} ${s.commonName} ${s.family}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (!family.value || s.family === family.value) &&
      (!status.value || s.status === status.value),
  ),
)

function openForm(item?: SpeciesRecord) {
  editing.value = !!item
  Object.assign(form, item ? { ...item } : blank())
  modal.value = 'form'
}

function save() {
  if (!form.scientificName || !form.commonName || !form.genus || !form.family) {
    return
  }

  if (editing.value) {
    const index = conservationStore.species.findIndex((s) => s.id === form.id)

    if (index !== -1) {
      conservationStore.species[index] = { ...form }
    }
  } else {
    conservationStore.species.push({ ...form })
  }

  modal.value = null
  router.replace({ query: {} })
}

function view(species: SpeciesRecord) {
  selected.value = species
  modal.value = 'view'
}

function confirmDelete(species: SpeciesRecord) {
  selected.value = species
  modal.value = 'delete'
}

function remove() {
  if (!selected.value) return

  const index = conservationStore.species.findIndex((s) => s.id === selected.value?.id)

  if (index !== -1) {
    conservationStore.species.splice(index, 1)
  }

  modal.value = null
}

function handleImageUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) return

  if (!file.type.startsWith('image/')) {
    input.value = ''
    return
  }

  const reader = new FileReader()

  reader.onload = () => {
    if (typeof reader.result === 'string') {
      form.image = reader.result
    }
  }

  reader.readAsDataURL(file)
}

onMounted(() => {
  if (route.query.action === 'add') {
    openForm()
  }
})
</script>

<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">KNOWLEDGE BASE</p>
      <h2>Plant Species</h2>
      <p>Manage official taxonomic, ecological and conservation information.</p>
    </div>
  </section>

  <div class="control-bar">
    <label class="field search-field">
      <span>Search species</span>
      <input v-model="search" placeholder="Scientific name, common name or family" />
    </label>

    <label class="field">
      <span>Family</span>
      <select v-model="family">
        <option value="">All families</option>
        <option v-for="f in families" :key="f">
          {{ f }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>Conservation status</span>
      <select v-model="status">
        <option value="">All statuses</option>
        <option
          v-for="s in [
            'Not Assessed',
            'Least Concern',
            'Near Threatened',
            'Vulnerable',
            'Endangered',
            'Critically Endangered',
          ]"
          :key="s"
        >
          {{ s }}
        </option>
      </select>
    </label>

    <button class="primary-button" @click="openForm()">+ Add Species</button>
  </div>

  <section class="panel">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Species ID</th>
            <th>Scientific Name</th>
            <th>Common Name</th>
            <th>Genus</th>
            <th>Family</th>
            <th>Conservation Status</th>
            <th>Plant Records</th>
            <th>Last Updated</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="s in filtered" :key="s.id">
            <td>
              <strong>{{ s.id }}</strong>
            </td>

            <td>
              <em>{{ s.scientificName }}</em>
            </td>

            <td>{{ s.commonName }}</td>
            <td>{{ s.genus }}</td>
            <td>{{ s.family }}</td>

            <td>
              <span class="badge" :class="s.status.toLowerCase().replaceAll(' ', '-')">
                {{ s.status }}
              </span>
            </td>

            <td>{{ s.plantCount }}</td>
            <td>{{ s.updated }}</td>

            <td>
              <div class="action-group">
                <button class="action-button" @click="view(s)">View</button>

                <button class="action-button" @click="openForm(s)">Edit</button>

                <button class="action-button danger" @click="confirmDelete(s)">Delete</button>
              </div>
            </td>
          </tr>

          <tr v-if="!filtered.length">
            <td colspan="9" class="empty-row">No species match the selected filters.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Add / Edit Species -->
  <AppModal
    v-if="modal === 'form'"
    :title="editing ? 'Edit Species' : 'Add Species'"
    subtitle="Species records contain general biological information, not individual observations."
    wide
    @close="modal = null"
  >
    <form class="form-grid" @submit.prevent="save">
      <label class="form-field">
        <span>Species ID</span>
        <input v-model="form.id" readonly class="readonly-field" />
      </label>

      <label class="form-field">
        <span>Scientific Name</span>
        <input v-model="form.scientificName" required />
      </label>

      <label class="form-field">
        <span>Common Name</span>
        <input v-model="form.commonName" required />
      </label>

      <label class="form-field">
        <span>Genus</span>
        <input v-model="form.genus" required />
      </label>

      <label class="form-field">
        <span>Family</span>
        <input v-model="form.family" required />
      </label>

      <label class="form-field">
        <span>Conservation Status</span>
        <select v-model="form.status">
          <option
            v-for="s in [
              'Not Assessed',
              'Least Concern',
              'Near Threatened',
              'Vulnerable',
              'Endangered',
              'Critically Endangered',
            ]"
            :key="s"
          >
            {{ s }}
          </option>
        </select>
      </label>

      <label class="form-field full">
        <span>Description</span>
        <textarea v-model="form.description"></textarea>
      </label>

      <label class="form-field full">
        <span>Habitat / Ecological Information</span>
        <textarea v-model="form.habitat"></textarea>
      </label>

      <div class="form-field full">
        <span>Representative Photograph / Image URL</span>
        <input v-model="form.image" type="text" placeholder="Enter image URL" />
        <span class="image-or">or upload from device</span>
        <label class="custom-file-upload">
          <div class="upload-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M10 1C9.73478 1 9.48043 1.10536 9.29289 1.29289L3.29289 7.29289C3.10536 7.48043 3 7.73478 3 8V20C3 21.6569 4.34315 23 6 23H7C7.55228 23 8 22.5523 8 22C8 21.4477 7.55228 21 7 21H6C5.44772 21 5 20.5523 5 20V9H10C10.5523 9 11 8.55228 11 8V3H18C18.5523 3 19 3.44772 19 4V9C19 9.55228 19.4477 10 20 10C20.5523 10 21 9.55228 21 9V4C21 2.34315 19.6569 1 18 1H10ZM9 7H6.41421L9 4.41421V7ZM14 15.5C14 14.1193 15.1193 13 16.5 13C17.8807 13 19 14.1193 19 15.5V16V17H20C21.1046 17 22 17.8954 22 19C22 20.1046 21.1046 21 20 21H13C11.8954 21 11 20.1046 11 19C11 17.8954 11.8954 17 13 17H14V16V15.5ZM16.5 11C14.142 11 12.2076 12.8136 12.0156 15.122C10.2825 15.5606 9 17.1305 9 19C9 21.2091 10.7909 23 13 23H20C22.2091 23 24 21.2091 24 19C24 17.1305 22.7175 15.5606 20.9844 15.122C20.7924 12.8136 18.858 11 16.5 11Z"
                clip-rule="evenodd"
                fill-rule="evenodd"
              />
            </svg>
          </div>
          <div class="upload-text">
            <span>Click to upload image</span>
            <small>PNG, JPG or WEBP</small>
          </div>
          <input type="file" accept="image/*" @change="handleImageUpload" />
        </label>
        <img
          v-if="form.image"
          :src="form.image"
          alt="Species representative preview"
          class="image-preview"
        />
      </div>

      <div class="modal-actions form-field full">
        <button type="button" class="secondary-button" @click="modal = null">Cancel</button>

        <button class="primary-button">
          {{ editing ? 'Save Changes' : 'Create Species' }}
        </button>
      </div>
    </form>
  </AppModal>

  <!-- View Species -->
  <AppModal
    v-if="modal === 'view' && selected"
    :title="selected.scientificName"
    :subtitle="selected.commonName"
    @close="modal = null"
  >
    <img
      v-if="selected.image"
      :src="selected.image"
      :alt="selected.scientificName"
      class="species-view-image"
    />

    <dl class="detail-list">
      <div>
        <dt>Species ID</dt>
        <dd>{{ selected.id }}</dd>
      </div>

      <div>
        <dt>Genus</dt>
        <dd>{{ selected.genus }}</dd>
      </div>

      <div>
        <dt>Family</dt>
        <dd>{{ selected.family }}</dd>
      </div>

      <div>
        <dt>Conservation Status</dt>
        <dd>{{ selected.status }}</dd>
      </div>

      <div>
        <dt>Plant Records</dt>
        <dd>{{ selected.plantCount }}</dd>
      </div>

      <div>
        <dt>Habitat / Ecological Information</dt>
        <dd>{{ selected.habitat || '—' }}</dd>
      </div>
    </dl>

    <p>{{ selected.description }}</p>
  </AppModal>

  <!-- Delete Species -->
  <AppModal
    v-if="modal === 'delete' && selected"
    title="Delete species record?"
    :subtitle="`${selected.id} — ${selected.scientificName}`"
    @close="modal = null"
  >
    <p>
      This removes the species from this frontend mock state. This action cannot be undone during
      the current session.
    </p>

    <div class="modal-actions">
      <button class="secondary-button" @click="modal = null">Cancel</button>

      <button class="danger-button" @click="remove">Delete Species</button>
    </div>
  </AppModal>
</template>

<style scoped>
.image-or {
  margin: 8px 0 4px;
  color: #829088;
  font-size: 10px;
}

.custom-file-upload {
  width: 100%;
  max-width: 360px;
  height: 180px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border: 2px dashed #b8cec1;
  border-radius: 10px;
  background: #fbfdfb;
  color: #416052;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.custom-file-upload:hover {
  border-color: #62a087;
  background: #f7fbf8;
}

.custom-file-upload:focus-within {
  border-color: #62a087;
  box-shadow: 0 0 0 3px rgba(98, 160, 135, 0.12);
}

.upload-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-icon svg {
  width: 52px;
  height: 52px;
  fill: #4f806d;
}

.upload-text {
  display: grid;
  gap: 4px;
  text-align: center;
}

.upload-text span {
  color: #315749;
  font-size: 12px;
  font-weight: 700;
}

.upload-text small {
  color: #829088;
  font-size: 9px;
}

.custom-file-upload input[type='file'] {
  display: none;
}

.image-preview {
  width: 180px;
  max-width: 100%;
  height: 130px;
  margin-top: 10px;
  border: 1px solid #dce4dc;
  border-radius: 8px;
  object-fit: cover;
}

.species-view-image {
  width: 100%;
  max-height: 280px;
  margin-bottom: 18px;
  border-radius: 12px;
  object-fit: cover;
}
</style>
