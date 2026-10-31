<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  conservationStore,
  type ConservationStatus,
  type SpeciesRecord,
} from '../../data/conservation'

const route = useRoute()
const router = useRouter()
const { t, te, locale } = useI18n()
const speciesValue = (
  species: SpeciesRecord,
  field: 'scientific' | 'common' | 'genus' | 'family',
) => {
  const key = `conservationSpecies.${field}.${species.id}`
  const fallback =
    field === 'scientific'
      ? species.scientificName
      : species[field === 'common' ? 'commonName' : field]
  return te(key) ? t(key) : fallback
}
const statusLabel = (value: string) => {
  const key = `dashboardValues.${value.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  return te(key) ? t(key) : value
}
const formattedDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const dateLocale = locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ms' ? 'ms-MY' : 'en-MY'
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

const search = ref('')
const family = ref('')
const status = ref('')
const modal = ref<'form' | 'view' | 'delete' | null>(null)
const selected = ref<SpeciesRecord | null>(null)
const editing = ref(false)
const feedback = ref<{ id: number; variant: 'success' | 'error'; message: string } | null>(null)
let feedbackId = 0

const showFeedback = (variant: 'success' | 'error', message: string) => {
  feedback.value = { id: ++feedbackId, variant, message }
}

const dismissFeedback = (id: number) => {
  if (feedback.value?.id === id) feedback.value = null
}

type RequiredSpeciesField = 'scientificName' | 'commonName' | 'genus' | 'family'
type SpeciesFormErrors = Record<RequiredSpeciesField | 'image', string>

const requiredFields: RequiredSpeciesField[] = ['scientificName', 'commonName', 'genus', 'family']
const errors = reactive<SpeciesFormErrors>({
  scientificName: '',
  commonName: '',
  genus: '',
  family: '',
  image: '',
})
const touched = reactive<Record<RequiredSpeciesField, boolean>>({
  scientificName: false,
  commonName: false,
  genus: false,
  family: false,
})
const fieldRefs: Partial<Record<RequiredSpeciesField, HTMLInputElement | null>> = {}
const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp']
const imageFileInput = ref<HTMLInputElement | null>(null)
const hasUploadedDeviceImage = ref(false)
const deleteCancelButton = ref<HTMLButtonElement | null>(null)
const deleteModalShake = ref(false)
let deleteShakeTimer: ReturnType<typeof setTimeout> | null = null

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

const resetValidation = () => {
  requiredFields.forEach((field) => {
    errors[field] = ''
    touched[field] = false
  })
  errors.image = ''
}

const setFieldRef = (field: RequiredSpeciesField, element: unknown) => {
  fieldRefs[field] = element instanceof HTMLInputElement ? element : null
}

const validateField = (field: RequiredSpeciesField) => {
  const value = form[field].trim()

  if (!value) {
    errors[field] =
      field === 'scientificName'
        ? 'Scientific name is required.'
        : field === 'commonName'
          ? 'Common name is required.'
          : field === 'genus'
            ? 'Genus is required.'
            : 'Family is required.'
    return false
  }

  if (value.length > 200) {
    errors[field] = 'Use 200 characters or fewer.'
    return false
  }

  if (field === 'scientificName') {
    if (!/\p{L}/u.test(value)) {
      errors.scientificName = 'Scientific name must include alphabetic text.'
      return false
    }

    const normalizedName = value.toLocaleLowerCase()
    const duplicate = conservationStore.species.some(
      (species) =>
        (!editing.value || species.id !== form.id) &&
        species.scientificName.trim().toLocaleLowerCase() === normalizedName,
    )

    if (duplicate) {
      errors.scientificName = 'A species with this scientific name already exists.'
      return false
    }
  }

  errors[field] = ''
  return true
}

const touchAndValidate = (field: RequiredSpeciesField) => {
  touched[field] = true
  validateField(field)
}

const revalidateIfNeeded = (field: RequiredSpeciesField) => {
  if (touched[field] || errors[field]) validateField(field)
}

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
  hasUploadedDeviceImage.value = Boolean(item?.image.startsWith('data:image/'))
  if (imageFileInput.value) imageFileInput.value.value = ''
  resetValidation()
  modal.value = 'form'
}

function save() {
  if (form.description.trim().length > 4000 || form.habitat.trim().length > 4000) {
    showFeedback('error', 'Description and habitat must be 4,000 characters or fewer.')
    return
  }
  requiredFields.forEach((field) => {
    touched[field] = true
  })
  const fieldsAreValid = requiredFields.map(validateField).every(Boolean)

  if (!fieldsAreValid || errors.image) {
    const firstInvalidField = requiredFields.find((field) => errors[field])
    if (firstInvalidField) fieldRefs[firstInvalidField]?.focus()
    return
  }

  form.scientificName = form.scientificName.trim()
  form.commonName = form.commonName.trim()
  form.genus = form.genus.trim()
  form.family = form.family.trim()
  form.description = form.description.trim()
  form.habitat = form.habitat.trim()
  form.image = form.image.trim()

  if (editing.value) {
    const index = conservationStore.species.findIndex((s) => s.id === form.id)

    if (index === -1) {
      showFeedback('error', t('conservationPages.species.feedback.editError'))
      return
    }
    conservationStore.species[index] = { ...form }
    modal.value = null
    router.replace({ query: {} })
    showFeedback('success', t('conservationPages.species.feedback.edited'))
    return
  } else {
    conservationStore.species.push({ ...form })
  }

  modal.value = null
  router.replace({ query: {} })
  showFeedback('success', t('conservationPages.species.feedback.added'))
}

function view(species: SpeciesRecord) {
  selected.value = species
  modal.value = 'view'
}

function confirmDelete(species: SpeciesRecord) {
  selected.value = species
  modal.value = 'delete'
  void nextTick(() => deleteCancelButton.value?.focus())
}

const handleDeleteBackdropAttempt = async () => {
  if (deleteShakeTimer !== null) clearTimeout(deleteShakeTimer)
  deleteModalShake.value = false
  await nextTick()
  deleteModalShake.value = true
  deleteShakeTimer = setTimeout(() => {
    deleteModalShake.value = false
    deleteShakeTimer = null
  }, 340)
}

function remove() {
  if (!selected.value) return

  const index = conservationStore.species.findIndex((s) => s.id === selected.value?.id)

  if (index === -1) {
    showFeedback('error', t('conservationPages.species.feedback.deleteError'))
    return
  }

  conservationStore.species.splice(index, 1)
  modal.value = null
  showFeedback('success', t('conservationPages.species.feedback.deleted'))
}

function handleImageUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) return

  if (!supportedImageTypes.includes(file.type)) {
    errors.image = 'Please select an image file (JPG, PNG, or WEBP).'
    input.value = ''
    return
  }

  errors.image = ''

  const reader = new FileReader()

  reader.onload = () => {
    if (typeof reader.result === 'string') {
      form.image = reader.result
      hasUploadedDeviceImage.value = true
    }
  }

  reader.readAsDataURL(file)
}

function handleImageUrlInput() {
  hasUploadedDeviceImage.value = false
  if (imageFileInput.value) imageFileInput.value.value = ''
}

function removeUploadedImage() {
  form.image = ''
  hasUploadedDeviceImage.value = false
  errors.image = ''
  if (imageFileInput.value) imageFileInput.value.value = ''
}

onMounted(() => {
  if (route.query.action === 'add') {
    openForm()
  }
})

onBeforeUnmount(() => {
  if (deleteShakeTimer !== null) clearTimeout(deleteShakeTimer)
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
      <p class="page-kicker">{{ t('conservationPages.species.knowledgeBase') }}</p>
      <h2>Plant Species</h2>
      <p>Manage official taxonomic, ecological and conservation information.</p>
    </div>
  </section>

  <div class="control-bar">
    <label class="field search-field">
      <span>{{ t('conservationPages.species.searchSpecies') }}</span>
      <input v-model.trim="search" maxlength="100" :placeholder="t('conservationPages.species.searchPlaceholder')" />
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
            <th>{{ t('speciesLabels.scientificName') }}</th>
            <th>{{ t('speciesLabels.commonName') }}</th>
            <th>Genus</th>
            <th>Family</th>
            <th>Conservation Status</th>
            <th>{{ t('conservationPages.species.plantRecords') }}</th>
            <th>{{ t('conservationPages.species.lastUpdated') }}</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="s in filtered" :key="s.id">
            <td>
              <strong>{{ s.id }}</strong>
            </td>

            <td>
              <em>{{ speciesValue(s, 'scientific') }}</em>
            </td>

            <td>{{ speciesValue(s, 'common') }}</td>
            <td>{{ speciesValue(s, 'genus') }}</td>
            <td>{{ speciesValue(s, 'family') }}</td>

            <td>
              <span class="badge" :class="s.status.toLowerCase().replaceAll(' ', '-')">
                {{ statusLabel(s.status) }}
              </span>
            </td>

            <td>{{ s.plantCount }}</td>
            <td>{{ formattedDate(s.updated) }}</td>

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
    <p class="prototype-notice">
      Prototype: changes made here are stored only for this session and are not saved to the
      database.
    </p>

    <form class="form-grid" novalidate @submit.prevent="save">
      <label class="form-field">
        <span>Species ID</span>
        <input v-model="form.id" readonly class="readonly-field" />
      </label>

      <label class="form-field">
        <span>Scientific Name <b class="required-marker" aria-hidden="true">*</b></span>
        <input
          :ref="(element) => setFieldRef('scientificName', element)"
          v-model="form.scientificName"
          placeholder="e.g. Nepenthes ampullaria"
          :aria-invalid="Boolean(errors.scientificName)"
          :aria-describedby="
            errors.scientificName
              ? 'scientific-name-help scientific-name-error'
              : 'scientific-name-help'
          "
          @blur="touchAndValidate('scientificName')"
          @input="revalidateIfNeeded('scientificName')"
        />
        <small id="scientific-name-help" class="field-help">
          Use the accepted botanical name, including genus and species.
        </small>
        <small v-if="errors.scientificName" id="scientific-name-error" class="field-error">
          {{ errors.scientificName }}
        </small>
      </label>

      <label class="form-field">
        <span>Common Name <b class="required-marker" aria-hidden="true">*</b></span>
        <input
          :ref="(element) => setFieldRef('commonName', element)"
          v-model="form.commonName"
          placeholder="e.g. Flask-shaped Pitcher Plant"
          :aria-invalid="Boolean(errors.commonName)"
          :aria-describedby="errors.commonName ? 'common-name-error' : undefined"
          @blur="touchAndValidate('commonName')"
          @input="revalidateIfNeeded('commonName')"
        />
        <small v-if="errors.commonName" id="common-name-error" class="field-error">
          {{ errors.commonName }}
        </small>
      </label>

      <label class="form-field">
        <span>Genus <b class="required-marker" aria-hidden="true">*</b></span>
        <input
          :ref="(element) => setFieldRef('genus', element)"
          v-model="form.genus"
          placeholder="e.g. Nepenthes"
          :aria-invalid="Boolean(errors.genus)"
          :aria-describedby="errors.genus ? 'genus-help genus-error' : 'genus-help'"
          @blur="touchAndValidate('genus')"
          @input="revalidateIfNeeded('genus')"
        />
        <small id="genus-help" class="field-help">Enter the plant genus only.</small>
        <small v-if="errors.genus" id="genus-error" class="field-error">
          {{ errors.genus }}
        </small>
      </label>

      <label class="form-field">
        <span>Family <b class="required-marker" aria-hidden="true">*</b></span>
        <input
          :ref="(element) => setFieldRef('family', element)"
          v-model="form.family"
          placeholder="e.g. Nepenthaceae"
          :aria-invalid="Boolean(errors.family)"
          :aria-describedby="errors.family ? 'family-help family-error' : 'family-help'"
          @blur="touchAndValidate('family')"
          @input="revalidateIfNeeded('family')"
        />
        <small id="family-help" class="field-help">Enter the botanical family.</small>
        <small v-if="errors.family" id="family-error" class="field-error">
          {{ errors.family }}
        </small>
      </label>

      <label class="form-field">
        <span>Conservation Status</span>
        <select v-model="form.status" aria-describedby="conservation-status-help">
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
        <small id="conservation-status-help" class="field-help">
          Select the conservation category used for this species.
        </small>
      </label>

      <label class="form-field full">
        <span>Description</span>
        <textarea
          v-model="form.description"
          placeholder="e.g. Brief identifying features of the species"
          aria-describedby="species-description-help"
        ></textarea>
        <small id="species-description-help" class="field-help">
          Add brief identifying characteristics or notes.
        </small>
      </label>

      <label class="form-field full">
        <span>Habitat / Ecological Information</span>
        <textarea
          v-model="form.habitat"
          placeholder="e.g. Lowland rainforest, limestone forest"
          aria-describedby="species-habitat-help"
        ></textarea>
        <small id="species-habitat-help" class="field-help">
          Describe the typical habitat where the species is found.
        </small>
      </label>

      <div class="form-field full">
        <span>Representative Photograph / Image URL</span>
        <input
          v-model="form.image"
          type="text"
          placeholder="e.g. https://example.com/plant.jpg"
          aria-describedby="species-image-help"
          @input="handleImageUrlInput"
        />
        <small id="species-image-help" class="field-help">
          Optional. Enter a direct image URL or upload a supported image file.
        </small>
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
          <input
            ref="imageFileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            :aria-invalid="Boolean(errors.image)"
            :aria-describedby="
              errors.image ? 'species-image-help species-image-error' : 'species-image-help'
            "
            @change="handleImageUpload"
          />
        </label>
        <small v-if="errors.image" id="species-image-error" class="field-error">
          {{ errors.image }}
        </small>
        <div v-if="form.image" class="image-preview-wrap">
          <img :src="form.image" alt="Species representative preview" class="image-preview" />
          <button
            type="button"
            class="remove-image-button"
            aria-label="Remove image"
            title="Remove image"
            @click="removeUploadedImage"
          >
            ×
          </button>
        </div>
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
    title="Delete species?"
    :subtitle="`${selected.id} — ${selected.scientificName}`"
    :close-on-backdrop="false"
    danger-backdrop
    :shake="deleteModalShake"
    hide-close
    compact
    @close="modal = null"
    @backdrop-attempt="handleDeleteBackdropAttempt"
  >
    <div class="delete-confirmation-content">
      <div class="delete-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="M6.5 7l.8 13h9.4l.8-13" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      </div>
      <p>Are you sure you want to delete this species?</p>
      <p class="delete-warning">
        This will remove the species from the current session. This action cannot be undone.
      </p>

      <div class="modal-actions">
        <button ref="deleteCancelButton" class="secondary-button" @click="modal = null">
          Cancel
        </button>

        <button class="danger-button" @click="remove">Delete Species</button>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.form-grid {
  align-items: start;
}

.form-field {
  align-content: start;
}

.form-field > input:not([type='file']),
.form-field > select {
  box-sizing: border-box;
  height: 38px;
  min-height: 38px;
  padding-block: 0;
}

.form-field > textarea {
  box-sizing: border-box;
  height: 96px;
  min-height: 96px;
}

.prototype-notice {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid #d8e4dc;
  border-radius: 8px;
  background: #f7faf7;
  color: #5f746a;
  font-size: 10px;
  line-height: 1.5;
}

.delete-warning {
  margin: 8px 0 0;
  color: #7b665f;
  font-size: 10px;
  line-height: 1.5;
}

.delete-confirmation-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.delete-icon {
  width: 54px;
  height: 54px;
  margin: 2px auto 14px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f8e9e7;
  color: #a7463c;
}

.delete-icon svg {
  width: 30px;
  height: 30px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.delete-confirmation-content > p:first-child {
  margin: 0;
  color: #38594c;
  font-size: 12px;
  font-weight: 700;
}

.delete-confirmation-content .modal-actions {
  width: 100%;
  margin-top: 22px;
  justify-content: center;
}

.required-marker {
  color: #9f463b;
}

.form-field input[aria-invalid='true'],
.form-field textarea[aria-invalid='true'],
.form-field select[aria-invalid='true'],
.custom-file-upload:has(input[aria-invalid='true']) {
  border-color: #b84d42;
}

.field-error {
  color: #a13f35;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.4;
}

.field-help {
  color: #74857d;
  font-size: 10px;
  line-height: 1.4;
}

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

.image-preview-wrap {
  position: relative;
  width: 180px;
  max-width: 100%;
  height: 130px;
  margin-top: 10px;
}

.image-preview {
  width: 100%;
  height: 100%;
  border: 1px solid #dce4dc;
  border-radius: 8px;
  object-fit: cover;
}

.remove-image-button {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 50%;
  background: rgba(28, 48, 40, 0.82);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 18px;
  line-height: 1;
  box-shadow: 0 2px 8px rgba(20, 42, 33, 0.24);
}

.remove-image-button:hover {
  background: #8e3f36;
}

.remove-image-button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px #3f7f66;
}

.species-view-image {
  width: 100%;
  max-height: 280px;
  margin-bottom: 18px;
  border-radius: 12px;
  object-fit: cover;
}
</style>
