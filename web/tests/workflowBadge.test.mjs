import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { workflowBadgeStyle, workflowBadgePalette, threatAlertBadgeStyle, threatAlertBadgePalette } from '../src/utils/workflowBadge.ts'
import { conservationBadgePalette } from '../src/utils/conservationBadge.ts'

test('all implemented workflow statuses have the exact independent palette', () => {
  const expected = {
    Approved: ['#DCFCE7', '#166534'], 'Pending Review': ['#FEF9C3', '#854D0E'],
    'Correction Required': ['#FFEDD5', '#9A3412'], Rejected: ['#FEE2E2', '#B91C1C'],
    Flagged: ['#F3E8FF', '#6B21A8'], Draft: ['#E5E7EB', '#374151'],
  }
  assert.deepEqual(Object.keys(workflowBadgePalette), Object.keys(expected))
  for (const [status, [backgroundColor, color]] of Object.entries(expected)) {
    assert.deepEqual(workflowBadgeStyle(status), { backgroundColor, color })
    assert.ok(Object.isFrozen(workflowBadgeStyle(status)))
  }
})

test('unknown/null and conservation values fall back safely without changing labels', () => {
  for (const value of [null, undefined, '', 'Unknown', 'approved', '__proto__', 'constructor', {}, 1, ...Object.keys(conservationBadgePalette)]) {
    assert.deepEqual(workflowBadgeStyle(value), { backgroundColor: '#E5E7EB', color: '#374151' })
    assert.equal(Object.hasOwn(workflowBadgePalette, String(value)), false)
  }
})

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
test('both palettes meet WCAG AA normal-text contrast of 4.5:1', () => {
  for (const palette of [workflowBadgePalette, conservationBadgePalette, threatAlertBadgePalette]) {
    for (const [status, style] of Object.entries(palette)) {
      const values = [luminance(style.backgroundColor), luminance(style.color)].sort((a,b) => b-a)
      assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, status)
    }
  }
})

test('alert palette has exact approved colors, neutral fallbacks and no changes to other palettes', () => {
  assert.deepEqual(threatAlertBadgePalette, {
    New: { backgroundColor: '#DBEAFE', color: '#1E40AF' },
    Reviewing: { backgroundColor: '#FEF9C3', color: '#854D0E' },
    Resolved: { backgroundColor: '#DCFCE7', color: '#166534' },
  })
  for (const status of Object.keys(threatAlertBadgePalette)) {
    assert.deepEqual(threatAlertBadgeStyle(status), threatAlertBadgePalette[status])
    assert.ok(Object.isFrozen(threatAlertBadgeStyle(status)))
    assert.deepEqual(workflowBadgeStyle(status), { backgroundColor: '#E5E7EB', color: '#374151' })
  }
  for (const status of [null, undefined, '', 'Unknown', 'new', '__proto__', 'constructor', {}, 1, ...Object.keys(workflowBadgePalette), ...Object.keys(conservationBadgePalette)]) {
    assert.deepEqual(threatAlertBadgeStyle(status), { backgroundColor: '#E5E7EB', color: '#374151' })
  }
})

test('workflow badges bind the shared style while retaining their visible labels', () => {
  for (const [file, value] of [
    ['views/PlantDetailView.vue', 'plant.staff.status'],
    ['components/PlantObservationHistory.vue', 'observation.status'],
    ['views/conservation/ObservationsView.vue', 'item.status'],
    ['views/conservation/ReviewSubmissionsView.vue', 'observation.status'],
  ]) {
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
    assert.ok(source.includes(`:style="workflowBadgeStyle(${value})"`), file)
    assert.ok(source.replace(/\s+/g, ' ').includes(value + ')'), file)
  }
})
