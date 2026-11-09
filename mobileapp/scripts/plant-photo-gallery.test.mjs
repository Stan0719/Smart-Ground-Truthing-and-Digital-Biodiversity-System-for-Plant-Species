import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const React = require('react')
const ts = require('typescript')

function loadGallery() {
  const source = readFileSync(new URL('../utils/plantPhotoGallery.js', import.meta.url), 'utf8')
    .replace(/export /g, '')
  const context = vm.createContext({})
  vm.runInContext(source, context)
  return { context, functions: vm.runInContext('({ clampPhotoIndex, stepPhotoIndex, uniquePlantPhotos })', context) }
}

test('one plant photo stays simple and navigation remains at its only image', async () => {
  const { context } = loadGallery()
  const photos = await vm.runInContext('uniquePlantPhotos([{ id: "one", uri: "https://images.test/plant-1.jpg", headers: { Authorization: "token" } }])', context)
  assert.equal(photos.length, 1)
  assert.equal(await vm.runInContext('clampPhotoIndex(9, 1)', context), 0)
  assert.equal(await vm.runInContext('stepPhotoIndex(0, 1, 1)', context), 0)
})

test('multiple plant photos are deduplicated and previous/next navigation wraps', async () => {
  const { context } = loadGallery()
  const photos = await vm.runInContext(`uniquePlantPhotos([
    { id: 'a', uri: 'https://images.test/a.jpg', headers: { Authorization: 'owner-token' } },
    { id: 'a-copy', uri: 'https://images.test/a.jpg' },
    { id: 'b', uri: 'https://images.test/b.jpg' },
    { id: 'missing', uri: '' },
    { id: 'invalid', uri: 'not-an-image-url' },
    null,
  ])`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(photos.map((photo) => photo.id))), ['a', 'b'])
  assert.deepEqual(JSON.parse(JSON.stringify(photos[0].headers)), { Authorization: 'owner-token' })
  assert.equal(await vm.runInContext('stepPhotoIndex(0, -1, 2)', context), 1)
  assert.equal(await vm.runInContext('stepPhotoIndex(1, 1, 2)', context), 0)
  assert.equal(await vm.runInContext('clampPhotoIndex(8, 2)', context), 1)
})

test('Plant Detail selection, viewer navigation and plant-change reset use the same plant image sources', () => {
  const source = readFileSync(new URL('../screens/PlantDetail.js', import.meta.url), 'utf8')
  const { functions: galleryFunctions } = loadGallery()
  assert.match(source, /setSelectedPhotoUri\(null\)/)
  assert.match(source, /setFailedPhotoUris\(\[\]\)/)
  assert.match(source, /onPress=\{\(\) => setSelectedPhotoUri\(photo\.uri\)\}/)
  assert.match(source, /activePhotoIndex \+ 1\} \/ \{displayablePhotos\.length/)
  assert.match(source, /<Modal visible=\{imageViewerVisible && Boolean\(selectedPhoto\)\}/)
  assert.match(source, /onRequestClose=\{\(\) => setImageViewerVisible\(false\)\}/)
  assert.match(source, /stepPhotoIndex\(activePhotoIndex, direction, displayablePhotos\.length\)/)
  assert.match(source, /onError=\{\(\) => failPhoto\(selectedPhoto\.uri\)\}/)
  assert.doesNotMatch(source, /getSpeciesImageSource/)
  const botanistSource = readFileSync(new URL('../screens/BotanistPlantDetail.js', import.meta.url), 'utf8')
  assert.match(botanistSource, /onPress=\{\(\) => \{ setSelectedPhotoUri\(photo\.uri\); setPhotoViewerVisible\(true\); \}\}/)
  assert.match(botanistSource, /<Modal visible=\{photoViewerVisible && Boolean\(selectedPhoto\)\}/)
  assert.match(botanistSource, /selectedPhotoIndex \+ 1\} \/ \{photos\.length/)
})

test('Plant Detail thumbnail taps select a distinct image and the viewer navigates the same photo list', () => {
  const source = readFileSync(new URL('../screens/PlantDetail.js', import.meta.url), 'utf8')
  const { functions: galleryFunctions } = loadGallery()
  const compiled = ts.transpileModule(source, {
    fileName: 'PlantDetail.jsx',
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const plant = {
    plantId: '17', currentStatus: 'Approved', plantScientificName: 'Plant 17',
    photos: [
      { id: 'p1', uri: 'https://images.test/plant-17-1.jpg', headers: { Authorization: 'test' } },
      { id: 'p2', uri: 'https://images.test/plant-17-2.jpg', headers: { Authorization: 'test' } },
    ], latestApproved: {}, location: {}, observations: [],
  }
  const state = []
  let stateIndex = 0
  const refs = []
  let refIndex = 0
  const effectDeps = []
  const pendingEffects = []
  let effectIndex = 0
  let routePlantId = '17'
  const hooks = {
    ...React,
    useState(initial) {
      const index = stateIndex++
      if (!(index in state)) state[index] = index === 0 ? plant : typeof initial === 'function' ? initial() : initial
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useRef(initial) {
      const index = refIndex++
      if (!refs[index]) refs[index] = { current: initial }
      return refs[index]
    },
    useEffect(effect, dependencies = []) {
      const index = effectIndex++
      const previous = effectDeps[index]
      if (!previous || dependencies.some((value, position) => value !== previous[position])) {
        effectDeps[index] = dependencies
        pendingEffects.push(effect)
      }
    },
    useCallback: (fn) => fn,
  }
  const native = { StyleSheet: { create: (styles) => styles } }
  for (const name of ['View', 'Text', 'ScrollView', 'TouchableOpacity', 'Image', 'RefreshControl', 'Modal']) native[name] = name
  const translations = {
    useAppTranslation: () => {},
    t: (key, values = {}) => key === 'plantDetail.photoNumber' ? `Photo ${values.value0}` : key,
    translateLabel: (value) => value,
    translateUIMessage: (value) => value,
    translateFieldValue: (_label, value) => value,
    dateLocale: () => 'en',
  }
  const dependencies = {
    react: hooks,
    'react-native': native,
    '../translations/i18n': translations,
    '../data/mockData': { getPlantById: () => null, getSpeciesBySlug: () => null },
    '../utils/plantApi': { fetchPlantDetail: async () => plant, getPlantDisplayObservation: (record) => record.latestApproved },
    '../components/RefreshButton': { default: 'RefreshButton' },
    '../components/FavouriteHeart': { default: 'FavouriteHeart' },
    '../hooks/useVisitorFavourites': { default: () => ({ refreshing: false, isFavourite: () => false, isPending: () => false, toggle: () => {}, refresh: () => {}, loading: false }) },
    '../utils/plantLocationDisplay': { getPlantLocationDisplay: () => ({ status: 'missing', zone: null }) },
    '@react-navigation/native': { useFocusEffect: () => {} },
    '../utils/plantPhotoGallery': galleryFunctions,
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => {
    assert.ok(name in dependencies, name)
    const dependency = dependencies[name]
    return name === 'react' ? dependency : { ...dependency, __esModule: true }
  }, module, module.exports)
  const screen = module.exports.default
  const render = () => {
    stateIndex = 0
    refIndex = 0
    effectIndex = 0
    pendingEffects.length = 0
    return screen({ route: { params: { plantId: routePlantId } }, navigation: { goBack() {} }, user: { id: 'owner', role: 'Botanist' } })
  }
  const flushEffects = () => { for (const effect of pendingEffects.splice(0)) effect() }
  const children = (node) => node && typeof node === 'object' ? React.Children.toArray(node.props?.children) : []
  const find = (tree, predicate) => {
    if (predicate(tree)) return tree
    for (const child of children(tree)) {
      const match = find(child, predicate)
      if (match) return match
    }
  }
  const treeText = (node) => typeof node === 'string' || typeof node === 'number' ? String(node) : children(node).map(treeText).join(' ')

  let tree = render()
  flushEffects()
  state[0] = plant // Simulate the plant response after the route-focus fetch.
  tree = render()
  let selectedThumbnail = find(tree, (node) => node?.type === 'TouchableOpacity' && node.props.accessibilityState?.selected)
  assert.ok(selectedThumbnail)
  const secondThumbnail = find(tree, (node) => node?.type === 'TouchableOpacity' && node.props.accessibilityLabel === 'Photo 2, 2 / 2')
  assert.ok(secondThumbnail)
  secondThumbnail.props.onPress()
  tree = render()
  const mainImage = find(tree, (node) => node?.type === 'Image' && node.props.style?.height === '100%')
  assert.equal(mainImage.props.source.uri, 'https://images.test/plant-17-2.jpg')
  assert.ok(treeText(tree).replace(/\s+/g, ' ').includes('2 / 2'))

  const mainImageButton = find(tree, (node) => node?.type === 'TouchableOpacity' && node.props.style?.width === '100%' && node.props.onPress)
  mainImageButton.props.onPress()
  tree = render()
  const modal = find(tree, (node) => node?.type === 'Modal')
  assert.equal(modal.props.visible, true)
  const previous = find(modal, (node) => node?.type === 'TouchableOpacity' && node.props.accessibilityLabel === 'plantDetail.previousPhoto')
  previous.props.onPress()
  tree = render()
  const viewer = find(tree, (node) => node?.type === 'Modal')
  const viewerImage = find(viewer, (node) => node?.type === 'Image')
  assert.equal(viewerImage.props.source.uri, 'https://images.test/plant-17-1.jpg')

  routePlantId = '18'
  const secondPlant = { ...plant, plantId: '18', photos: [{ id: 'p18', uri: 'https://images.test/plant-18-1.jpg' }] }
  render()
  flushEffects()
  state[0] = secondPlant // Simulate the new plant response.
  tree = render()
  const newPlantImage = find(tree, (node) => node?.type === 'Image' && node.props.style?.height === '100%')
  assert.equal(newPlantImage.props.source.uri, 'https://images.test/plant-18-1.jpg')
  assert.equal(treeText(tree).includes('2 / 2'), false)
})
