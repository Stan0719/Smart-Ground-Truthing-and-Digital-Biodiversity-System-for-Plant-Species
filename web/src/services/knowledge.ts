import { ref } from 'vue'
import { mapPlantCardMetadata } from './plantCardMapping'
import { plantApi, type Species } from './plantApi'
import { plants } from '../data/plants'
import { plantRecords } from '../data/plantRecords'
import { refreshSession } from '../composables/usePrototypeSession'
import { plantThumbnailImages, speciesImageSelection } from './assetImages'
export const knowledgeError = ref('')
let generation = 0
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
export async function refreshKnowledge() {
  const attempt = ++generation
  plants.splice(0)
  plantRecords.splice(0)
  knowledgeError.value = ''
  try {
    const user = await refreshSession()
    if (attempt !== generation) return
    // These sessions cannot read plant data under RBAC. Do not issue forbidden
    // background requests from the public homepage or password-change screen.
    if (user?.role === 'Administrator' || user?.mustChangePassword) return
    const scientific = ['Botanist', 'Conservation Officer'].includes(user?.role || '')
    const [catalog, records] = await Promise.all([
      plantApi<{ species: Species[] }>(`/species?scope=${scientific ? 'scientific' : 'public'}`),
      plantApi<{ plants: RecordRow[] }>('/plants'),
    ])
    if (attempt !== generation) return
    plants.push(
      ...catalog.species.map((s) => ({
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
      })),
    )
    plantRecords.push(
      ...records.plants.map((r) => {
        const s = plants.find((v) => v.speciesId === String(r.species_id))
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
      }),
    )
    for (let i = 0; i < plants.length; i += 10) {
      await Promise.all(
        plants.slice(i, i + 10).map(async (s) => {
          const result = await plantApi<{ assets: { id: string; content_type: string }[] }>(
            `/assets?species_id=${s.speciesId}`,
          )
          if (attempt !== generation) return
          const preview = catalog.species.find(row => String(row.species_id) === s.speciesId)?.image_url
          Object.assign(s, speciesImageSelection(result.assets, preview))
        }),
      )
      if (attempt !== generation) return
    }
  } catch (e) {
    // Authentication may change while the parallel plant requests are in flight,
    // or its API may recover after the first session check failed. Re-check the
    // current identity before reporting a denial from an obsolete request.
    if (e instanceof Error && e.message === 'Access denied.') {
      const current = await refreshSession()
      if (attempt !== generation) return
      if (current?.role === 'Administrator' || current?.mustChangePassword) return
    }
    if (attempt === generation) {
      plants.splice(0)
      plantRecords.splice(0)
      knowledgeError.value = e instanceof Error ? e.message : 'Knowledge service unavailable.'
    }
  }
}
