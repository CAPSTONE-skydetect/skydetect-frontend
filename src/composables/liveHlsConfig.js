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
