export const LIVE_HLS_CONFIG = Object.freeze({
  lowLatencyMode: true,
  // Seconds behind the received stream edge, not measured camera-to-screen delay.
  liveSyncDuration: 1.2,
  liveMaxLatencyDuration: 4,
  maxLiveSyncPlaybackRate: 1.1,
  backBufferLength: 10,
  manifestLoadingMaxRetry: 6,
  levelLoadingMaxRetry: 6,
  fragLoadingMaxRetry: 6,
})

// Preview only: recording and analysis timestamps are unaffected.
export const FAST_LIVE_HLS_CONFIG = Object.freeze({
  ...LIVE_HLS_CONFIG,
  liveSyncDuration: 0.8,
  liveMaxLatencyDuration: 2.5,
})

export function readLiveDelay(hls, video) {
  if (!hls || !video || video.paused || video.readyState < 2 ||
      !Number.isFinite(hls.liveSyncPosition) || !Number.isFinite(hls.latency) ||
      hls.latency <= 0) return null
  return hls.latency
}
