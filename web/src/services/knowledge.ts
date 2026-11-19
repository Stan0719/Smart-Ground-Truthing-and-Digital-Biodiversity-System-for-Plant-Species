import { ref } from 'vue'
import { sessionSnapshot, subscribeSession, type AuthUser } from './auth'
import { mapPlantCardMetadata } from './plantCardMapping'
import { plantApi, type Species } from './plantApi'
import { plants } from '../data/plants'
import { plantRecords } from '../data/plantRecords'
import { refreshSession } from '../composables/usePrototypeSession'
import { plantThumbnailImages, speciesImageSelection } from './assetImages'
export const knowledgeError = ref('')
export const catalogueLimited = ref(false)
let generation = 0
let refreshRequest = 0
const sessionKey = () => { const s = sessionSnapshot(); return s.pending ? 'pending' : s.user ? `${s.user.id}:${s.user.role}:${s.user.status}:${s.user.mustChangePassword}` : 'guest' }
let account = sessionKey()
let work: { key: string; promise: Promise<void> } | null = null
subscribeSession(() => {
  const next = sessionKey()
  if (next === account) return
  account = next; work = null; generation++; plants.splice(0); plantRecords.splice(0); catalogueLimited.value = false
})
interface RecordRow {
  plant_image_asset_id?: string
  plant_id: string
  species_id: string
  rbac_status?: string
  status?: string
  latitude?: number
  longitude?: number
  accuracy_m?: number
  zone?: string | null
  altitude_m?: number | null
  registered_at?: string
  observed_at?: string
  registered_subject?: string
  latest_approved?: {
    heightCm: number
    healthStatus: string
    lifeStage: string
    morphology: string
    notes?: string
  }
}
export function refreshKnowledge(user?: AuthUser | null) {
  const key = sessionKey()
  if (work?.key === key) return work.promise
  const promise = loadKnowledge(user)
  const pending = { key, promise }
  work = pending
  void promise.finally(() => { if (work === pending) work = null })
  return promise
}
async function loadKnowledge(verifiedUser?: AuthUser | null) {
  let attempt = ++generation
  const request = ++refreshRequest
  knowledgeError.value = ''
  try {
    const user = verifiedUser === undefined ? await refreshSession() : verifiedUser
    if (request !== refreshRequest) return
    // Our own initial verification may publish a newly verified identity.
    // Bind the ensuing catalogue reads to that identity, not the pre-check state.
    attempt = generation
    const verified = sessionSnapshot()
    if (verified.pending || (user ? !verified.user || user.id !== verified.user.id || user.role !== verified.user.role || user.status !== verified.user.status || user.mustChangePassword !== verified.user.mustChangePassword : verified.user !== null))
      throw Error('Knowledge service unavailable.')
    // Password-change sessions cannot read the scientific catalogue.
    if (user && (user.mustChangePassword || user.status !== 'Active')) return
    const scientific = ['Botanist', 'Conservation Officer', 'Administrator'].includes(user?.role || '')
    const [catalog, records] = await Promise.all([
      plantApi<{ species: Species[] }>(`/species?scope=${scientific ? 'scientific' : 'public'}`),
      plantApi<{ plants: RecordRow[] }>(user ? '/plants' : '/plants?scope=public-web'),
    ])
    if (attempt !== generation) return
    if (!Array.isArray(catalog.species) || !Array.isArray(records.plants) ||
      catalog.species.some(s => !s || s.species_id == null || typeof s.scientific_name !== 'string') ||
      records.plants.some(r => !r || r.plant_id == null || r.species_id == null)) throw Error('Invalid catalogue response.')
    const nextPlants = catalog.species.map((s) => ({
        speciesId: String(s.species_id),
        slug: String(s.species_id),
        name: s.common_name || s.scientific_name,
        scientificName: s.scientific_name,
        genus: s.genus_name,
        category: 'Uncategorized' as const,
        family: s.family_name,
        description: s.description || '',
        overview: s.description || '',
        habitat: s.habitat || '',
        culturalSignificance: s.culturalSignificance,
        characteristics: [],
        significance: '',
        conservationStatus: s.conservation_status,
        sensitivityLevel: s.sensitivity,
        images: [],
      }))
    const nextRecords = records.plants.map((r) => {
        const s = nextPlants.find((v) => v.speciesId === String(r.species_id))
        return {
          plantId: String(r.plant_id),
          speciesSlug: String(r.species_id),
          speciesId: String(r.species_id),
          speciesName: s?.scientificName || '',
          commonName: s?.name || '',
          ...mapPlantCardMetadata(r),
          qr: { code: '', status: r.rbac_status || r.status || '' },
          registeredBy: r.registered_subject || '',
          registeredAt: r.registered_at?.slice(0, 10) || '',
          images: plantThumbnailImages(r),
          observations: [],
        }
      })
    for (let i = 0; i < nextPlants.length; i += 10) {
      await Promise.all(
        nextPlants.slice(i, i + 10).map(async (s) => {
          const result = await plantApi<{ assets: { id: string; content_type: string }[] }>(
            `/assets?species_id=${s.speciesId}`,
          )
          if (attempt !== generation) return
          if (!Array.isArray(result.assets)) throw Error('Invalid asset response.')
          const portrait = catalog.species.find(row => String(row.species_id) === s.speciesId)
          Object.assign(s, speciesImageSelection(result.assets, portrait?.image_url, portrait?.image_asset_id))
        }),
      )
      if (attempt !== generation) return
    }
    if (attempt !== generation || request !== refreshRequest) return
    plants.splice(0, plants.length, ...nextPlants)
    plantRecords.splice(0, plantRecords.length, ...nextRecords)
    catalogueLimited.value = catalog.species.length >= 200 || records.plants.length >= 500
  } catch (e) {
    if (attempt === generation) {
      if ([401, 403, 404].includes((e as { status?: number })?.status || 0)) { plants.splice(0); plantRecords.splice(0); catalogueLimited.value = false }
      knowledgeError.value = e instanceof Error ? e.message : 'Knowledge service unavailable.'
    }
  }
}
