import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
const filename = new URL('../src/components/conservation/SubmissionChanges.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'submission-changes' })
const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname,
  id: 'submission-changes', compilerOptions: { bindingMetadata: script.bindings } })
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
async function render(update, locale = 'en', props = {}) {
  const messages = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'))
  const exports = {}
  const context = { exports, require(name) {
    if (name === 'vue') return vue
    if (name === 'vue-i18n') return { useI18n: () => ({ t: (key, params = {}) => Object.entries(params).reduce(
      (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), key.split('.').reduce((value, key) => value[key], messages)) }) }
    return { reviewDateTime: value => value }
  } }
  vm.runInNewContext(`(function () { ${compile(script.content)} })()`, context)
  const component = exports.default
  vm.runInNewContext(`(function () { ${compile(template.code)} })()`, context)
  component.render = exports.render
  return renderToString(vue.createSSRApp(component, { update, revision: 2, ...props }))
}
test('verified changes render stored values and metadata in every locale with an explicit reload', async () => {
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const html = await render({ state: 'updated', version: 2, updated_at: '2026-11-13T04:00:00Z',
      changes: [{ field: 'heightCm', before: 12, after: 18 }] }, locale)
    assert.match(html, /12/)
    assert.match(html, /18/)
    assert.match(html, /updated-badge/)
    assert.match(html, /type="button"/)
  }
})
test('missing history and ordinary revisions never fabricate an Updated badge or old values', async () => {
  for (const value of [undefined, null, { state: 'unavailable' }, { state: 'unchanged' }]) {
    const html = await render(value)
    assert.doesNotMatch(html, /class="updated-badge"/)
    if (value?.state !== 'unchanged') assert.match(html, /could not be verified/)
    assert.match(html, /Loaded observation revision 2/)
  }
})


test('first pending registration has a neutral revision without inventing missing history in all locales', async () => {
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const html = await render({ state: 'unavailable', changes: [] }, locale, { revision: 1, initialSubmission: true })
    assert.doesNotMatch(html, /history-unavailable|updated-badge/)
    const messages = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'))
    assert.ok(html.includes(messages.submissionChanges.loadedRevision.replace('{revision}', '1')))
    assert.ok(!html.includes(messages.submissionChanges.historyUnavailable))
  }
})


test('reload can be relocated to the review header without changing other consumers', async () => {
  const hidden = await render({ state: 'unchanged' }, 'en', { hideReload: true })
  assert.doesNotMatch(hidden, /<button/)
  assert.match(await render({ state: 'unchanged' }), /<button/)
})


test('Observation history can hide routine revision and reload controls while preserving truthful history and other consumers',async()=>{
 for(const locale of ['en','ms','zh-CN']){
  const messages=JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`,import.meta.url),'utf8'))
  const hidden=await render({state:'unavailable'},locale,{hideRevision:true,hideReload:true})
  assert.ok(hidden.includes(messages.submissionChanges.historyUnavailable));assert.ok(!hidden.includes(messages.submissionChanges.loadedRevision.replace('{revision}','2')));assert.doesNotMatch(hidden,/<button/)
  assert.ok((await render({state:'unavailable'},locale)).includes(messages.submissionChanges.loadedRevision.replace('{revision}','2')))
 }
})
