<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppModal from '../../components/conservation/AppModal.vue'
import { plantApi, type Species } from '../../services/plantApi'

const genera = ref<{ genus_id: number; genus_name: string; family_name: string }[]>([])
const species = ref<Species[]>([])
const error = ref(''), message = ref(''), busy = ref(false), opened = ref(false), editing = ref('')
const search = ref(''), family = ref(''), status = ref('')
const families = computed(() => [...new Set(species.value.map(item => item.family_name).filter((value): value is string => Boolean(value)))].sort())
const statuses = computed(() => [...new Set(species.value.map(item => item.conservation_status).filter((value): value is string => Boolean(value)))].sort())
const filtered = computed(() => species.value.filter(item => {
  const query = search.value.trim().toLowerCase()
  return (!query || [item.species_id, item.scientific_name, item.common_name, item.genus_name, item.family_name].some(value => String(value || '').toLowerCase().includes(query))) && (!family.value || item.family_name === family.value) && (!status.value || item.conservation_status === status.value)
}))
const blank = () => ({ genus_id: null as number | null, scientific_name: '', common_name: '', description: '', conservation_status: '', visibility: 'protected', habitat: '', culturalSignificance: '' })
const form = reactive(blank())
async function load() { species.value = (await plantApi<{ species: Species[] }>('/species?scope=scientific')).species }
onMounted(async () => { try { genera.value = (await plantApi<{ genera: typeof genera.value }>('/taxonomy')).genera; await load() } catch (e) { error.value = e instanceof Error ? e.message : 'Unable to load species.' } })
function open(item?: Species) { Object.assign(form, blank(), item || {}, { visibility: item?.sensitivity || 'protected' }); editing.value = item?.species_id || ''; opened.value = true; error.value = '' }
async function save() { if (busy.value) return; busy.value = true; error.value = ''; try { await plantApi(editing.value ? '/species/' + editing.value : '/species', editing.value ? 'PATCH' : 'POST', form); await load(); opened.value = false; message.value = 'Official species saved.' } catch (e) { error.value = e instanceof Error ? e.message : 'Save failed.' } finally { busy.value = false } }
async function remove(item: Species) { if (!confirm('Delete this official species? Referenced species cannot be deleted.')) return; try { await plantApi('/species/' + item.species_id, 'DELETE', {}); await load() } catch (e) { error.value = e instanceof Error ? e.message : 'Delete failed.' } }
async function upload(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file || !editing.value) return; if (file.size > 4 * 1024 * 1024) { error.value = 'Use a file no larger than 4 MiB.'; return } try { const bytes = new Uint8Array(await file.arrayBuffer()); let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); await plantApi('/assets', 'POST', { species_id: editing.value, content_type: file.type, base64: btoa(raw), client_key: crypto.randomUUID() }); message.value = 'Official attachment uploaded.' } catch (e) { error.value = e instanceof Error ? e.message : 'Upload failed.' } }
</script>

<template>
  <section class="page-intro"><div><p class="page-kicker">SPECIES KNOWLEDGE BASE</p><h2>Plant Species</h2><p>Manage official taxonomic, ecological and conservation information.</p></div></section>
  <p v-if="error" class="page-alert" role="alert">{{ error }}</p><p v-if="message" class="page-success" role="status">{{ message }}</p>
  <div class="control-bar">
    <label class="field search-field"><span>Search species</span><input v-model="search" placeholder="Search ID, scientific or common name" /></label>
    <label class="field"><span>Family</span><select v-model="family"><option value="">All families</option><option v-for="name in families" :key="name">{{ name }}</option></select></label>
    <label class="field"><span>Conservation status</span><select v-model="status"><option value="">All statuses</option><option v-for="name in statuses" :key="name">{{ name }}</option></select></label>
    <button class="primary-button" aria-label="Add Species" @click="open()">+ Add Species</button>
  </div>
  <section class="panel"><div class="table-scroll"><table><thead><tr><th>Species ID</th><th>Scientific Name</th><th>Common Name</th><th>Genus</th><th>Family</th><th>Conservation Status</th><th>Actions</th></tr></thead><tbody>
    <tr v-for="item in filtered" :key="item.species_id"><td><strong>{{ item.species_id }}</strong></td><td><em>{{ item.scientific_name }}</em></td><td>{{ item.common_name }}</td><td>{{ item.genus_name || '—' }}</td><td>{{ item.family_name || '—' }}</td><td><span class="badge" :class="item.conservation_status?.toLowerCase().replaceAll(' ', '-')">{{ item.conservation_status || 'Not Assessed' }}</span></td><td><div class="action-group"><button class="action-button" @click="open(item)">Edit</button><button class="action-button danger" @click="remove(item)">Delete</button></div></td></tr>
    <tr v-if="!filtered.length"><td colspan="7" class="empty-row">{{ species.length ? 'No species match the selected filters.' : 'No official species recorded.' }}</td></tr>
  </tbody></table></div></section>
  <AppModal v-if="opened" :title="editing ? 'Edit official species' : 'Add official species'" subtitle="Species records contain general biological information, not individual observations." wide @close="opened = false">
    <form class="form-grid" @submit.prevent="save">
      <label class="form-field"><span>Scientific Name</span><input v-model="form.scientific_name" required maxlength="200" /></label>
      <label class="form-field"><span>Common Name</span><input v-model="form.common_name" required maxlength="200" /></label>
      <label class="form-field"><span>Genus and Family</span><select v-model="form.genus_id"><option :value="null">Not classified</option><option v-for="genus in genera" :key="genus.genus_id" :value="genus.genus_id">{{ genus.genus_name }} · {{ genus.family_name }}</option></select></label>
      <label class="form-field"><span>Conservation Status</span><input v-model="form.conservation_status" required /></label>
      <label class="form-field full"><span>Description</span><textarea v-model="form.description" required /></label>
      <label class="form-field"><span>Publication Classification</span><select v-model="form.visibility"><option value="public">Public</option><option value="internal">Internal</option><option value="protected">Protected</option></select></label>
      <label class="form-field"><span>Habitat</span><textarea v-model="form.habitat" /></label>
      <label class="form-field full"><span>Cultural Significance</span><textarea v-model="form.culturalSignificance" /></label>
      <label v-if="editing" class="form-field full"><span>Official Photo or PDF</span><input type="file" accept="image/png,image/jpeg,application/pdf" @change="upload" /></label>
      <p v-if="error" class="page-alert full" role="alert">{{ error }}</p>
      <div class="form-actions full"><button type="button" class="secondary-button" @click="opened = false">Cancel</button><button class="primary-button" :disabled="busy">Save official species</button></div>
    </form>
  </AppModal>
</template>

<style scoped>
.page-alert,.page-success{padding:11px 14px;border-radius:9px;margin:0 0 16px;font-size:12px}.page-alert{background:#fff0ec;color:#a02020}.page-success{background:#e7f4eb;color:#28745a}.form-actions{display:flex;justify-content:flex-end;gap:9px}.form-field.full,.form-actions.full,.page-alert.full{grid-column:1/-1}.form-field textarea{min-height:90px}
</style>
