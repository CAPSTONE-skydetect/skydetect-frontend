import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreShare } from '../src/lib/scoreShare.js'

test('score magnitudes produce complementary rounded shares', () => {
  assert.deepEqual(scoreShare([4, 2, -1]), { dronePercent: 86, birdPercent: 14, droneSum: 6, birdSum: 1 })
  assert.equal(scoreShare([-4, -2, 1]).birdPercent, 86)
  assert.equal(scoreShare([0, -2, -1]).birdPercent, 100)
  assert.equal(scoreShare([1]).dronePercent, 100)
  assert.equal(scoreShare([1, -1]).dronePercent, 50)
})

test('missing, invalid and entirely zero scores cannot produce a percentage', () => {
  for (const scores of [undefined, [], [0, 0], [1, null], ['2'], [NaN], [Infinity]]) {
    assert.equal(scoreShare(scores), null)
  }
})

test('extreme finite scores keep a finite ratio', () => {
  assert.equal(scoreShare([1e308, 1e308, -1e308]).dronePercent, 67)
})
