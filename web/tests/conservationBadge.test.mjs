import assert from 'node:assert/strict'
import test from 'node:test'
import { conservationBadgeStyle, conservationBadgePalette } from '../src/utils/conservationBadge.ts'

test('six canonical conservation statuses use the exact requested background/text pairs', () => {
  const expected = {
    'Not Assessed': ['#E5E7EB', '#374151'], 'Least Concern': ['#DCFCE7', '#166534'],
    'Near Threatened': ['#FEF9C3', '#854D0E'], 'Vulnerable': ['#FFEDD5', '#9A3412'],
    'Endangered': ['#FEE2E2', '#B91C1C'], 'Critically Endangered': ['#7F1D1D', '#FFFFFF'],
  }
  assert.deepEqual(Object.keys(conservationBadgePalette), Object.keys(expected))
  for (const [status, [backgroundColor, color]] of Object.entries(expected)) {
    assert.deepEqual(conservationBadgeStyle(status), { backgroundColor, color })
    assert.ok(Object.isFrozen(conservationBadgeStyle(status)))
  }
})

test('unknown/null inputs have a neutral fallback and review statuses never enter the conservation mapping', () => {
  for (const value of [undefined, null, '', 'Unknown', 'Approved', 'Pending Review', 'Rejected', 'Flagged', 'Correction Required', '__proto__', 'constructor', {}, 1]) {
    assert.deepEqual(conservationBadgeStyle(value), { backgroundColor: '#E5E7EB', color: '#374151' })
    assert.equal(Object.hasOwn(conservationBadgePalette, String(value)), false)
  }
  const value = 'Unknown'; conservationBadgeStyle(value); assert.equal(value, 'Unknown')
})
