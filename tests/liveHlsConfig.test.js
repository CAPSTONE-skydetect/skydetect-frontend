import assert from 'node:assert/strict'
import test from 'node:test'
import { LIVE_HLS_CONFIG as config, FAST_LIVE_HLS_CONFIG as fast, readLiveDelay } from '../src/composables/liveHlsConfig.js'

test('seconds-based latency limits do not mix with segment-count settings', () => {
  assert.equal(config.lowLatencyMode, true)
  assert.ok(config.liveSyncDuration > 0)
  assert.ok(config.liveMaxLatencyDuration > config.liveSyncDuration)
  assert.equal(config.liveSyncDurationCount, undefined)
  assert.equal(config.liveMaxLatencyDurationCount, undefined)
})

test('fast preview reduces target while preserving stable fallback', () => {
  assert.equal(config.liveSyncDuration, 1.2)
  assert.equal(fast.liveSyncDuration, 0.8)
  assert.ok(fast.liveMaxLatencyDuration > fast.liveSyncDuration)
  assert.ok(fast.liveMaxLatencyDuration < config.liveMaxLatencyDuration)
  assert.equal(fast.maxLiveSyncPlaybackRate, config.maxLiveSyncPlaybackRate)
})

test('delay is unknown before live initialization or while paused', () => {
  const video = { paused: false, readyState: 4 }
  assert.equal(readLiveDelay(null, video), null)
  assert.equal(readLiveDelay({ liveSyncPosition: null, latency: 0 }, video), null)
  assert.equal(readLiveDelay({ liveSyncPosition: 10, latency: 1.3 }, { ...video, paused: true }), null)
  assert.equal(readLiveDelay({ liveSyncPosition: 10, latency: 1.3 }, { ...video, readyState: 1 }), null)
  assert.equal(readLiveDelay({ liveSyncPosition: 10, latency: NaN }, video), null)
  assert.equal(readLiveDelay({ liveSyncPosition: 10, latency: 1.3 }, video), 1.3)
})

test('catch-up is bounded and retry behavior is preserved', () => {
  assert.ok(config.maxLiveSyncPlaybackRate > 1)
  assert.ok(config.maxLiveSyncPlaybackRate <= 1.1)
  for (const key of ['manifestLoadingMaxRetry', 'levelLoadingMaxRetry', 'fragLoadingMaxRetry']) {
    assert.equal(config[key], 6)
  }
})
