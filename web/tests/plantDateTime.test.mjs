import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPlantDateTime } from '../src/utils/plantDateTime.ts'

test('Plant Detail timestamps use Malaysia time, abbreviated months and 24-hour time including rollover', () => {
  for (const [input, expected] of [
    ['2026-11-03T05:31:37.284Z', 'Nov 3, 2026, 13:31'],
    ['2026-11-04T16:12:59.398Z', 'Nov 5, 2026, 00:12'],
    ['2026-12-31T16:00:00Z', 'Jan 1, 2027, 00:00'],
    ['2026-11-03T13:31:37.284+08:00', 'Nov 3, 2026, 13:31'],
    ['2026-11-03T00:31:37.284-05:00', 'Nov 3, 2026, 13:31'],
    ['2024-02-29T15:59:00Z', 'Feb 29, 2024, 23:59'],
    ['2026-11-03T05:31Z', 'Nov 3, 2026, 13:31'],
  ]) assert.equal(formatPlantDateTime(input), expected, input)
})

test('missing, invalid and ambiguous timestamps show an unavailable value rather than inventing a timezone', () => {
  for (const input of [null, undefined, '', ' ', {}, 0, 'invalid', '2026-11-03', '2026-11-03T05:31:37',
    '2026-02-30T05:31:37Z', '2026-02-29T05:31:37Z', '2026-13-03T05:31:37Z', '2026-11-00T05:31:37Z',
    '2026-11-03T24:00:00Z', '2026-11-03T05:60:00Z', '2026-11-03T05:31:60Z', '2026-11-03T05:31:00+25:00']) {
    assert.equal(formatPlantDateTime(input), '—')
    assert.equal(formatPlantDateTime(input, 'Unavailable'), 'Unavailable')
  }
})

test('output is independent of the host timezone and input timestamps remain unchanged', () => {
  const previous = process.env.TZ, input = '2026-11-03T05:31:37.284Z'
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timezone
      assert.equal(formatPlantDateTime(input), 'Nov 3, 2026, 13:31')
    }
    assert.equal(input, '2026-11-03T05:31:37.284Z')
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})
