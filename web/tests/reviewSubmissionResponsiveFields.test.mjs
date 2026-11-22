import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/conservation/ReviewSubmissionsView.vue', import.meta.url), 'utf8')

test('mobile review cards retain desktop review fields in their original order', () => {
  const headers = source.match(/<th scope="col">[\s\S]*?<\/thead>/)?.[0] || ''
  for (const field of ['submissionId', 'plantId', 'submissionType', 'Species', 'Submitted By', 'reviewedByColumn', 'Location Zone', 'recordCreated', 'Status', 'scoreColumn', 'Actions']) {
    assert.ok(headers.includes(field), `missing desktop field: ${field}`)
  }
  for (const field of ["t('approvedChanges.submissionType')", "ct('Species')", "ct('Submitted By')", "t('approvedChanges.reviewedByColumn')", "ct('Location Zone')", "rt('recordCreated')", "ct('Status')", "t('plantProximity.scoreColumn')", "ct('Actions')"]) {
    assert.ok(source.includes(`class="review-cell-label" aria-hidden="true">{{ ${field} }}`), `missing mobile label: ${field}`)
  }
})

test('mobile review cards use one column and keep each cell visible in desktop DOM order', () => {
  const mobile = source.slice(source.indexOf('@container (max-width: 767px)'))
  assert.match(mobile, /\.reviews-table tbody tr\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(mobile, /\.reviews-table tbody td\s*\{[^}]*grid-column: 1 \/ -1/)
  assert.match(mobile, /\.review-cell-label\s*\{[^}]*display\s*:\s*inline-flex/)
  assert.match(mobile, /\.review-cell-label::after\s*\{[^}]*content\s*:\s*':'/)
  assert.doesNotMatch(mobile, /\.reviews-table tbody td\.(?:submission-type-cell|proximity-cell|actions-cell)\s*\{[^}]*display:\s*none/)
})
