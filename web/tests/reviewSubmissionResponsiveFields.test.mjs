import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/conservation/ReviewSubmissionsView.vue', import.meta.url), 'utf8')
const standaloneRows = readFileSync(new URL('../src/components/conservation/StandaloneSpeciesRows.vue', import.meta.url), 'utf8')

test('mobile review cards retain desktop review fields in their original order', () => {
  const headers = source.match(/<th scope="col">[\s\S]*?<\/thead>/)?.[0] || ''
  for (const field of ['submissionId', 'plantId', 'Species', 'Submitted By', 'reviewedByColumn', 'recordCreated', 'Status', 'scoreColumn', 'Actions']) {
    assert.ok(headers.includes(field), `missing desktop field: ${field}`)
  }
  assert.equal((headers.match(/<th scope="col"[^>]*>/g) || []).length, 9)
  assert.ok(!headers.includes('approvedChanges.submissionType'), 'Submission Type must not have its own desktop column')
  assert.ok(!headers.includes('Location Zone'), 'Location Zone must not have its own desktop column')
  for (const field of ["t('approvedChanges.submissionType')", "ct('Species')", "ct('Submitted By')", "t('approvedChanges.reviewedByColumn')", "ct('Location Zone')", "rt('recordCreated')", "ct('Status')", "t('plantProximity.scoreColumn')", "ct('Actions')"]) {
    assert.ok(source.includes(`class="review-cell-label" aria-hidden="true">{{ ${field} }}`), `missing mobile label: ${field}`)
  }
  assert.match(source, /class="submission-type-cell mobile-submission-type-cell"/)
  assert.match(source, /class="mobile-location-cell"/)
  assert.match(source, /class="desktop-submission-type"[^>]*>[\s\S]*?species-request-badge/)
  assert.match(standaloneRows, /class="desktop-submission-type"[^>]*>\s*\{\{ t\('conservationPages\.reviews\.speciesRequest\.title'\) \}\}/)
  assert.match(standaloneRows, /class="mobile-submission-type-cell"/)
  assert.match(standaloneRows, /class="mobile-location-cell"/)
})

test('mobile review cards use one column and keep each cell visible in desktop DOM order', () => {
  const mobile = source.slice(source.indexOf('@container (max-width: 767px)'))
  assert.match(mobile, /\.reviews-table tbody tr\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(mobile, /\.reviews-table tbody td\s*\{[^}]*grid-column: 1 \/ -1/)
  assert.match(mobile, /\.review-cell-label\s*\{[^}]*display\s*:\s*inline-flex/)
  assert.match(mobile, /\.review-cell-label::after\s*\{[^}]*content\s*:\s*':'/)
  assert.match(mobile, /tbody td\.mobile-submission-type-cell, \.reviews-table tbody td\.mobile-location-cell\s*\{ display: flex/)
  assert.match(mobile, /\.reviews-table \.desktop-submission-type\s*\{ display: none; \}/)
  assert.doesNotMatch(mobile, /\.reviews-table tbody td\.(?:submission-type-cell|proximity-cell|actions-cell)\s*\{[^}]*display:\s*none/)
})


test('desktop stacks genuine Plant names and centers headers without changing mobile card structure',()=>{
 const desktop=source.slice(source.indexOf('@container (min-width: 768px)'),source.indexOf('.reviews-table .identity-cell strong'))
 assert.match(desktop,/thead th \{ text-align: center/);assert.match(desktop,/tbody td \{ text-align: center/);assert.match(desktop,/action-group[^}]*justify-content: center/)
 assert.match(desktop,/plant-identity \{ flex-direction: column; align-items: center; gap: 2px/)
 assert.match(desktop,/padding-left: 10px; padding-right: 10px/)
 assert.match(desktop,/min-width: 84rem/)
 assert.match(source,/plant-identity \{ display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; font-size: inherit/)
 assert.match(source,/plant-identity strong \{ font-size: inherit; font-weight: 700/)
 assert.match(source,/plant-display-name \{ color: #60776c; font-size: inherit; font-weight: 400/)
 assert.match(source,/<strong>\{\{ observation.plantId \}\}<\/strong><span v-if="observation.plantScientificName" class="plant-display-name">\{\{ observation.plantScientificName \}\}/)
 assert.match(source,/row.change.base_snapshot.scientific_name/)
 assert.doesNotMatch(source,/class="plant-display-name">\{\{[^}]*species/)
 const mobile=source.slice(source.indexOf('@container (max-width: 767px)'))
 assert.doesNotMatch(mobile,/plant-identity|plant-display-name|scoreColumnLine/)
})
test('desktop risk header uses exactly two localized lines and retains original mobile risk label',()=>{
 assert.match(source,/scoreColumnLine1'\) \}\}<br \/>\{\{ t\('plantProximity.scoreColumnLine2/)
 assert.match(source,/class="review-cell-label" aria-hidden="true">\{\{ t\('plantProximity.scoreColumn'\) \}\}/)
 for(const lang of ['en','ms','zh-CN']){
  const messages=JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8')).plantProximity
  assert.ok(messages.scoreColumnLine1);assert.ok(messages.scoreColumnLine2)
  if(lang==='en')assert.deepEqual([messages.scoreColumnLine1,messages.scoreColumnLine2],['Duplicate Risk','Score (%)'])
 }
})
