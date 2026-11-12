import test from 'node:test'
import assert from 'node:assert/strict'
import { clipPreparation } from '../src/lib/clipPreparation.js'

test('new pending clip is timed independently of selected ready clip', () => {
  const ready = { clipId: 'old', status: 'READY', triggeredAt: 0 }
  const pending = { clipId: 'new', status: 'PENDING', triggeredAt: 1000, readyAt: 11000 }
  assert.deepEqual(clipPreparation([ready, pending], 3500), {
    clipId: 'new', count: 1, elapsed: 2.5, remaining: 7.5, phase: 'waiting',
  })
  assert.equal(ready.status, 'READY')
  assert.equal(clipPreparation([pending], 900).remaining, 10)
})
test('countdown reaching zero means processing, never ready', () => {
  const state = clipPreparation([{ clipId: 'new', status: 'PENDING', triggeredAt: 1000, readyAt: 11000 }], 25000)
  assert.equal(state.phase, 'processing')
  assert.equal(state.elapsed, 24)
  assert.equal(state.remaining, 0)
})
test('multiple pending clips show latest timer and disappear only on completion', () => {
  assert.equal(clipPreparation([{ status: 'READY' }, { status: 'FAILED' }], 0), null)
  const rows = [{ clipId: 'first', status: 'PENDING', triggeredAt: 1000, readyAt: 11000 }, { clipId: 'second', status: 'PENDING', triggeredAt: 2000, readyAt: 12000 }]
  assert.equal(clipPreparation(rows, 3000).clipId, 'second')
  assert.equal(clipPreparation(rows, 3000).count, 2)
})
