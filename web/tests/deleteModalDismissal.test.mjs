import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const modal = read('components/conservation/AppModal.vue')
const plantDelete = read('components/conservation/OfficerPlantDelete.vue')
const species = read('views/conservation/PlantSpeciesView.vue')
const adminDelete = read('views/AdminUserManagementView.vue')
const conservationCss = read('styles/conservation.css')

test('destructive backdrop clicks retrigger the Admin panel shake without dismissing', () => {
  assert.match(modal, /@click\.self="backdropClick"/)
  const click = modal.slice(modal.indexOf('function backdropClick()'), modal.indexOf('function animationEnd'))
  assert.match(click, /if \(props\.dangerBackdrop\)/)
  assert.match(click, /classList\.remove\('danger-shake'\)[\s\S]*offsetWidth[\s\S]*classList\.add\('danger-shake'\)/)
  assert.match(click, /else if \(props\.closeOnBackdrop\) emit\('close'\)/)
  assert.match(modal, /\.danger-shake\s*\{\s*animation: modal-danger-shake 300ms ease-in-out/)
  assert.match(modal, /@keyframes modal-danger-shake\s*\{\s*0%, 100% \{ transform: translateX\(0\); \} 25% \{ transform: translateX\(-4px\); \} 50% \{ transform: translateX\(4px\); \} 75% \{ transform: translateX\(-3px\); \}/)
  assert.match(adminDelete, /\.user-delete-modal\.user-delete-shake\s*\{ animation: user-delete-shake 300ms ease-in-out/)
  assert.match(modal, /@media \(prefers-reduced-motion: reduce\) \{ \.danger-shake \{ animation: none; \} \}/)
})

test('Officer and Species confirmations keep explicit close controls and block Escape/backdrop dismissal', () => {
  assert.match(plantDelete, /:close-on-backdrop="false"\s+:close-on-escape="false"\s+danger-backdrop\s+accessible/)
  assert.match(plantDelete, /@close="!busy&&emit\('close'\)"/)
  assert.match(plantDelete, /@click="emit\('close'\)"/)
  assert.match(plantDelete, /@click="check"/)
  assert.match(species, /:close-on-backdrop="false"[\s\S]*:close-on-escape="false"[\s\S]*danger-backdrop accessible/)
  assert.doesNotMatch(species.match(/<AppModal v-if="modal === 'delete'[\s\S]*?<\/AppModal>/)?.[0] || '', /hide-close/)
  assert.match(modal, /:aria-label="t\('common\.close'\)"/)
  assert.match(species, /@close="!mutation && \(modal = null\)"/)
})

test('Escape is contained while focus remains trapped and the modal stays viewport constrained', () => {
  const keyboardStart = modal.indexOf('function keyboard')
  const keyboard = modal.slice(keyboardStart, modal.indexOf('onMounted(', keyboardStart))
  assert.match(keyboard, /event\.key === 'Escape'[\s\S]*event\.preventDefault\(\)[\s\S]*if \(props\.closeOnEscape\) emit\('close'\)[\s\S]*else event\.stopPropagation\(\)/)
  assert.match(keyboard, /event\.key !== 'Tab'/)
  assert.match(modal, /button:not\(:disabled\),input:not\(:disabled\),select:not\(:disabled\),textarea:not\(:disabled\)/)
  assert.match(modal, /getClientRects\(\)\.length > 0/)
  assert.match(modal, /focusables\(\)\[0\] \|\| card\.value/)
  assert.match(modal, /opener\.focus\(\{ preventScroll: true \}\)/)
  assert.match(conservationCss, /\.officer-layout \.modal-card\s*\{[\s\S]*max-height: calc\(100vh - 40px\);[\s\S]*overflow: auto/)
  const mobileStyles = conservationCss.slice(conservationCss.indexOf('@media (max-width: 620px)'))
  assert.ok(mobileStyles.includes('.officer-layout .modal-card'))
  assert.ok(mobileStyles.includes('max-height: calc(100vh - 20px)'))
})

test('Plant and Species confirmations use the supplied hierarchy with localized copy and responsive layouts', () => {
  assert.match(plantDelete, /class="plant-delete-icon"/)
  assert.match(plantDelete, /class="plant-delete-question"/)
  assert.match(plantDelete, /class="plant-delete-close"/)
  assert.match(plantDelete, /class="plant-delete-verify"/)
  assert.match(plantDelete, /class="plant-delete-confirm"/)
  assert.match(plantDelete, /width:min\(600px,calc\(100vw - 32px\)\)/)
  assert.match(plantDelete, /font-size:22px;line-height:30px/)
  assert.match(plantDelete, /min-height:44px/)
  assert.doesNotMatch(plantDelete, /min-height:min\(780px/)
  assert.match(plantDelete, /@media\(max-width:560px\)/)
  assert.match(species, /class="species-delete-icon"/)
  assert.match(species, /class="species-delete-warning"/)
  assert.match(species, /class="species-delete-important"/)
  assert.match(species, /class="species-delete-actions"/)
  assert.match(species, /width:min\(640px,calc\(100vw - 32px\)\)/)
  assert.match(species, /font-size:22px;line-height:30px/)
  assert.doesNotMatch(species, /width:min\(1700px/)
  assert.match(species, /@media\(max-width:560px\)/)
  assert.match(modal, /<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" \/><\/svg>/)
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const copy = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')).conservationPages.species
    assert.ok(copy.deleteDialogSubtitle && copy.deleteIrreversible && copy.deleteImportant)
  }
})
