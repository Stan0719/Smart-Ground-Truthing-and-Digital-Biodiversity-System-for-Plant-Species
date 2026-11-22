import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { assetUrlFromId } from '../src/services/assetImages.ts'

const source = readFileSync(new URL('../src/components/conservation/SpeciesViewImages.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'species-view-images' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'SpeciesViewImages.vue', id: 'species-view-images', compilerOptions: { bindingMetadata: script.bindings } })
const transpile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = async () => { for (let i = 0; i < 4; i++) { await vue.nextTick(); await new Promise(setImmediate) } }
function harness(api) {
  const props = vue.reactive({ species: { id: '3', scientificName: 'Species name', portraitUrl: assetUrlFromId('photo-2') } })
  const scope = vue.effectScope(), exports = {}, cleanup = [], calls = []
  const context = { exports, require(name) {
    if (name === 'vue') return { ...vue, onBeforeUnmount(fn) { cleanup.push(fn) }, resolveComponent: name => name }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key }) }
    if (name.endsWith('.vue')) return {}
    if (name.endsWith('assetImages')) return { assetUrlFromId }
    if (name.endsWith('speciesManagement')) return { requestSpeciesApi: path => { calls.push(path); return api(path) } }
    throw Error(name)
  } }
  vm.runInNewContext(transpile(script.content), context)
  const state = scope.run(() => exports.default.setup(props, { expose() {} }))
  vm.runInNewContext('(function(){' + transpile(template.code) + '})()', context)
  return { state, props, calls, render: () => exports.render({}, [], props, vue.proxyRefs(state), {}, {}), stop() { cleanup.forEach(fn => fn()); scope.stop() } }
}

test('read-only Species gallery filters non-images, deduplicates and prefers the existing portrait', async () => {
  const h = harness(async () => ({ assets: [
    { id: 'photo-1', content_type: 'image/png' }, { id: 'photo-2', content_type: 'image/jpeg' },
    { id: 'photo-1', content_type: 'image/png' }, { id: 'file', content_type: 'application/pdf' },
  ] }))
  try {
    await flush()
    assert.deepEqual(Array.from(h.state.photos.value, photo => photo.id), ['photo-2', 'photo-1'])
    assert.deepEqual(h.calls, ['/api/assets?species_id=3'])
    let opened
    h.state.preview.value = { open(...args) { opened = args }, close() {} }
    h.state.zoom(h.state.photos.value[1], { currentTarget: {} })
    assert.equal(opened[1], 1); assert.equal(opened[2], 'Species name')
    h.state.failed.value.add(h.state.photos.value[0].url)
    opened = null; h.state.zoom(h.state.photos.value[0], { currentTarget: {} })
    assert.equal(opened, null)
    assert.match(source, /PlantPhotoLightbox ref="preview" root-scroll-lock/)
    assert.doesNotMatch(descriptor.template.content, /photo\.id\s*\}\}|filename|content_type/)
  } finally { h.stop() }
})

test('empty galleries differ from failed reads, retry works, and stale Species results are ignored', async () => {
  let mode = 'fail', release
  const h = harness(async () => { if (mode === 'fail') throw Error('unavailable'); if (mode === 'delay') return new Promise(resolve => { release = resolve }); return { assets: [] } })
  try {
    await flush(); assert.equal(h.state.error.value, true)
    mode = 'empty'; await h.state.load(); assert.equal(h.state.error.value, false); assert.equal(h.state.photos.value.length, 0)
    mode = 'delay'; const pending = h.state.load()
    mode = 'empty'; h.props.species.id = '4'; await flush()
    release({ assets: [{ id: 'old-photo', content_type: 'image/jpeg' }] }); await pending
    assert.equal(h.state.photos.value.length, 0)
    assert.equal(h.state.loading.value, false)
    assert.doesNotThrow(() => h.render())
  } finally { h.stop() }
})
