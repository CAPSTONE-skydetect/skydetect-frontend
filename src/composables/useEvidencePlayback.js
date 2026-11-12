import { ref, watch, onBeforeUnmount } from 'vue'

export function useEvidencePlayback(videoRef) {
  const error = ref(null)
  const active = ref(null)
  let cleanup = null
  let generation = 0
  function stop(pause = true) {
    generation++
    const video = active.value ? videoRef.value : null
    cleanup?.()
    cleanup = null
    active.value = null
    if (pause) video?.pause()
  }
  async function play(range) {
    stop()
    error.value = null
    const video = videoRef.value
    if (!video || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0
        || range.end <= range.start || !Number.isFinite(video.duration) || range.end > video.duration + 0.05) {
      error.value = '이 구간을 재생할 수 없습니다. 원본 영상의 길이와 시각을 확인해 주세요.'
      return
    }
    const token = generation
    video.pause()
    video.currentTime = range.start
    active.value = range
    const check = () => { if (video.currentTime >= range.end || video.currentTime < range.start - 0.1) stop() }
    const paused = () => stop(false)
    video.addEventListener('timeupdate', check)
    video.addEventListener('ended', paused)
    // Poll as well: timeupdate alone can leave a noticeable tail after 2 seconds.
    const timer = setInterval(check, 50)
    cleanup = () => {
      clearInterval(timer)
      video.removeEventListener('timeupdate', check)
      video.removeEventListener('ended', paused)
      video.removeEventListener('pause', paused)
    }
    video.scrollIntoView({ block: 'center', behavior: 'smooth' })
    try {
      await video.play()
      if (generation === token) video.addEventListener('pause', paused)
    } catch {
      if (generation === token) {
        stop()
        error.value = '구간 재생을 시작하지 못했습니다. 다시 눌러 주세요.'
      }
    }
  }
  watch(videoRef, () => { stop(false); error.value = null })
  onBeforeUnmount(() => stop())
  return { play, stop, error, active }
}
