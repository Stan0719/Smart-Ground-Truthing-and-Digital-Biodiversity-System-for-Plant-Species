import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
vm.runInContext(read('../utils/plantApi.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context)

test('Map status filters retain only authorized current Plant records', () => {
  const records = [
    { plantId: '1', currentStatus: 'Approved', registeredBy: 'staff:other' },
    { plantId: '2', currentStatus: 'Pending Review', registeredBy: 'staff:owner' },
    { plantId: '3', currentStatus: 'Rejected', registeredBy: 'staff:owner', plantImage: { uri: 'authenticated-photo' } },
    { plantId: '4', currentStatus: 'Rejected', registeredBy: 'staff:other' },
    { plantId: '5', currentStatus: 'Pending Review', registeredBy: 'staff:other' },
    { plantId: '6', currentStatus: 'Withdrawn', registeredBy: 'staff:owner' },
    { plantId: '7', currentStatus: 'Cancelled', registeredBy: 'staff:owner' },
  ]
  context.records = records
  const result = vm.runInContext(`(() => {
    const visible = records.filter((record) => isMapPlantVisible(record, 'Botanist', 'owner'));
    return {
      all: filterMapPlantsByStatus(visible, 'Botanist', 'owner', 'allVisible').map((row) => row.plantId),
      approved: filterMapPlantsByStatus(visible, 'Botanist', 'owner', 'approved').map((row) => row.plantId),
      pending: filterMapPlantsByStatus(visible, 'Botanist', 'owner', 'myPending').map((row) => row.plantId),
      visitor: records.filter((row) => isMapPlantVisible(row, 'Visitor', 'owner')).map((row) => row.plantId),
      officer: filterMapPlantsByStatus(records, 'Conservation Officer', 'owner', 'allVisible').map((row) => row.plantId),
      invalidFilter: filterMapPlantsByStatus(records, 'Botanist', 'owner', 'myRejected').map((row) => row.plantId),
    };
  })()`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    all: ['1', '2'], approved: ['1'], pending: ['2'], visitor: ['1'],
    officer: ['1'], invalidFilter: [],
  })
  assert.equal(records[2].plantImage.uri, 'authenticated-photo')
})

test('Map cards, count and markers share search and status results', () => {
  const source = read('../screens/Map.js')
  assert.match(source, /filterMapPlantsByStatus\(documentedPlants, user\?\.role, user\?\.id, effectiveStatusFilter\)/)
  assert.match(source, /const mappedPlants = useMemo\(\(\) => filteredPlants\.filter/)
  assert.match(source, /<PlantExplorerMap key=\{isBotanist \? effectiveStatusFilter : "default"\}/)
  assert.match(source, /plants=\{mappedPlants\} onViewDetails=\{openPlant\}/)
  assert.match(source, /\{filteredPlants\.length\}/)
  assert.match(source, /<FlatList data=\{filteredPlants\}/)
  assert.match(source, /onPress=\{\(\) => openPlant\(item\)\}/)
  assert.match(source, /isBotanist && <DiscoverableScrollView horizontal/)
  assert.match(source, /statusFilterChip: \{ minHeight: 44/)
  const chipSection = source.slice(source.indexOf('contentContainerStyle={styles.statusFilters}'), source.indexOf('</DiscoverableScrollView>}', source.indexOf('contentContainerStyle={styles.statusFilters}')))
  assert.deepEqual(Array.from(chipSection.matchAll(/\["(allVisible|approved|myPending|myRejected)",/g), (item) => item[1]),
    ['allVisible', 'approved', 'myPending'])
  assert.doesNotMatch(chipSection, /myRejected/)
  assert.match(chipSection, /accessibilityState=\{\{ selected \}\}/)
  assert.match(source, /getPlantLocationDisplay\(record\.location, user\?\.role\)/)
  assert.match(source, /plant\.mapLocation\.status === "available"/)
  assert.match(source, /selectedMapPlantVisible = selectedMapPlantId != null && mappedPlants\.some/)
  assert.match(source, /selectedPlantId=\{selectedMapPlantVisible \? selectedMapPlantId : null\}/)
  assert.match(source, /setSelectedMapPlantId\(null\)/)
})
