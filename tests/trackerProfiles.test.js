import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACKER_PROFILES, serializeTrackingTuning, trackerLabel } from '../src/lib/trackerProfiles.js'

const tuning = { kltAcceptConf: .4, recoveryConf: .58, updateConf: .76, searchRadius: 2.5, onlineUpdate: false }
test('old requests default to D0 without changing confidence settings', () => {
  assert.deepEqual(serializeTrackingTuning(tuning), {
    tracker_variant: 'd0', klt_accept_conf: .4, recovery_conf: .58,
    update_conf: .76, search_radius_multiplier: 2.5, online_update_enabled: false,
  })
})
test('all three profiles serialize explicitly and can return to D0', () => {
  for (const p of [...TRACKER_PROFILES, TRACKER_PROFILES[0]]) {
    assert.equal(serializeTrackingTuning({ ...tuning, trackerVariant: p.value }).tracker_variant, p.value)
    assert.equal(trackerLabel(p.value), p.label)
  }
})
test('unknown profile fails instead of silently running D0', () => {
  assert.throws(() => serializeTrackingTuning({ ...tuning, trackerVariant: 'typo' }))
  assert.equal(trackerLabel(undefined), '기존 D0')
})
