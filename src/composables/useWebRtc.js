import { ref, watch, onBeforeUnmount } from 'vue'
import { WhepPreview } from '../lib/whepPreview.js'

export function useWebRtc(videoRef, endpoint, enabled) {
  const status = ref('idle')
  const error = ref(null)
  const stats = ref(null)
  let player = null
  function stop() { player?.stop(); player = null; stats.value = null; status.value = 'idle' }
  watch([videoRef, enabled], ([video, active]) => {
    stop()
    if (!video || !active || !endpoint) return
    player = new WhepPreview(video, endpoint,
      (next, reason) => { status.value = next; error.value = reason },
      (next) => { stats.value = next })
    player.start()
  }, { immediate: true })
  onBeforeUnmount(stop)
  return { status, error, stats, retry: () => player?.start(), resume: () => player?.resume() }
}
