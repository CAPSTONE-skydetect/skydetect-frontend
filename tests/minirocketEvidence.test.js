import test from 'node:test'
import assert from 'node:assert/strict'
import { minirocketEvidence, trackingQuality } from '../src/lib/minirocketEvidence.js'
import { observedTrailSegments } from '../src/lib/observedTrail.js'
test('mixed windows respect actual verdict and rank score contribution, not votes', () => {
  const e = minirocketEvidence({ label: 'drone', windowScores: [-.1, -.2, 1], windowStartsS: [0, 1, 2], trackStartS: 3 })
  assert.match(e.summary, /드론.*엇갈/)
  assert.equal(e.bird, 2)
  assert.equal(e.drone, 1)
  assert.equal(e.ranked[0].start, 5)
  assert.equal(e.ranked[0].end, 7)
})
test('bird contribution ranks negative magnitude, missing timing is not video zero', () => {
  const e = minirocketEvidence({ label: 'bird', windowScores: [-.1, -.8, .2], windowStartsS: [0, 1, 2] })
  assert.equal(e.ranked[0].index, 1)
  assert.equal(e.ranked[0].start, null)
  assert.equal(e.ranked[0].end, null)
})
test('abstention never claims a decided class even with positive mean', () => {
  const e = minirocketEvidence({ label: 'uncertain', decisionScore: .1, windowScores: [.2, 0] })
  assert.match(e.summary, /보류/)
  assert.equal(e.decided, false)
  assert.equal(e.neutral, 1)
  assert.match(e.rankTitle, /검토/)
})
test('no windows, partial metadata, zero and malformed scores do not invent evidence', () => {
  assert.match(minirocketEvidence({ label: 'drone' }).summary, /근거가 없습니다/)
  assert.equal(minirocketEvidence({ windowScores: [null, NaN, Infinity, '1'] }).windows.length, 0)
  assert.match(minirocketEvidence({ label: 'drone', windowScores: [0] }).summary, /경계/)
  assert.equal(minirocketEvidence({ windowScores: [1], windowStartsS: [-1], trackStartS: 0 }).windows[0].start, null)
  assert.equal(minirocketEvidence({ windowScores: [1], windowStartsS: [0], trackStartS: 0 }).windows[0].start, 0)
})
test('missing quality stays unknown; zero missing is a valid value', () => {
  assert.deepEqual(trackingQuality(null), { points: '정보 없음', missing: '정보 없음', stability: '정보 없음' })
  assert.equal(trackingQuality({ missingRatio: 0 }).missing, '0.0%')
  assert.equal(trackingQuality({ missingRatio: 1.2 }).missing, '정보 없음')
  assert.equal(trackingQuality({ numPoints: 120, missingRatio: .12, trackStability: 'fair' }).missing, '12.0%')
})
test('both directions have independent representatives and zero is neither side', () => {
  const e = minirocketEvidence({ label: 'drone', windowScores: [-.1, .1, .5, -.2, .4], windowStartsS: [0, 1, 2, 3, 4], trackStartS: 0 })
  assert.equal(e.representatives[0].window.index, 2)
  assert.equal(e.representatives[1].window.index, 3)
  assert.equal(e.coveredSeconds, 6)
  assert.equal(minirocketEvidence({ windowScores: [0, .1] }).representatives[1].window, null)
})
test('union duration handles duplicates, gaps, unknown offsets and incomplete data', () => {
  const a = { windowScores: [1, 1, 1], windowStartsS: [0, 0, 5], trackStartS: 2 }
  assert.equal(minirocketEvidence(a).coveredSeconds, 4)
  assert.equal(minirocketEvidence({ ...a, trackStartS: null }).coveredSeconds, null)
  assert.equal(minirocketEvidence({ ...a, windowsUsed: 4 }).coveredSeconds, null)
})
test('overlay trail does not bridge unobserved or absent frames', () => {
  const p = (frameIndex, visible = true) => ({ frameIndex, visible })
  const segments = observedTrailSegments([p(0), p(1), p(2, false), p(3), p(4), p(8), p(9)], 8)
  assert.deepEqual(segments.map(s => s.map(p => p.frameIndex)), [[0, 1], [3, 4], [8]])
})
