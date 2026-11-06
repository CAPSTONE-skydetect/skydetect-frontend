import assert from 'node:assert/strict'
import test from 'node:test'
import { LIVE_HLS_CONFIG as config } from '../src/composables/liveHlsConfig.js'

test('seconds-based latency limits do not mix with segment-count settings', () => {
  assert.equal(config.lowLatencyMode, true)
  assert.ok(config.liveSyncDuration > 0)
  assert.ok(config.liveMaxLatencyDuration > config.liveSyncDuration)
  assert.equal(config.liveSyncDurationCount, undefined)
  assert.equal(config.liveMaxLatencyDurationCount, undefined)
})

test('catch-up is bounded and retry behavior is preserved', () => {
  assert.ok(config.maxLiveSyncPlaybackRate > 1)
  assert.ok(config.maxLiveSyncPlaybackRate <= 1.1)
  for (const key of ['manifestLoadingMaxRetry', 'levelLoadingMaxRetry', 'fragLoadingMaxRetry']) {
    assert.equal(config[key], 6)
  }
})
