/**
 * HLS 재생.
 *
 * 왜 hls.js 가 필요한가: Safari 말고는 .m3u8 을 <video src> 로 못 읽는다.
 *
 * 라이브 스트림은 끊겨도 화면이 죽으면 안 된다. 관제 화면에서 제일 나쁜 건
 * 왼쪽이 멈춘 걸 아무도 모르는 상황이다. 그래서 재생 상태를 밖으로 내보내
 * 배지로 표시하고, 멈춘 이유에 따라 다르게 대응한다.
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import Hls from 'hls.js'

/**
 * @param {import('vue').Ref<HTMLVideoElement|null>} videoRef
 * @param {import('vue').Ref<string>} sourceRef  .m3u8 주소
 */
export function useHls(videoRef, sourceRef) {
  /** 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error' */
  const status = ref('idle')
  const error = ref(null)
  const engine = ref('none') // 'native' | 'hls.js' | 'none'

  let hls = null

  function teardown() {
    if (hls) {
      hls.destroy()
      hls = null
    }
    const video = videoRef.value
    if (video) {
      video.removeAttribute('src')
      video.load()
    }
  }

  function attach() {
    const video = videoRef.value
    const source = sourceRef.value
    if (!video || !source) return

    teardown()
    status.value = 'loading'
    error.value = null

    // 순서에 주의: **hls.js 를 먼저** 본다.
    //
    // 흔한 구현은 canPlayType('application/vnd.apple.mpegurl') 을 먼저 보고
    // 참이면 네이티브로 가는데, Chromium 계열이 이 값으로 'maybe' 를 돌려준다.
    // (이 프로젝트 개발 환경에서 실제로 그랬다)
    // 그러면 Safari 가 아닌데도 네이티브 경로로 빠져서, 라이브 스트림에서
    // 조용히 재생이 안 되는 상태가 된다.
    // MSE 가 있으면 hls.js 가 언제나 더 예측 가능하다. 네이티브는 진짜 대안이
    // 없을 때(MSE 가 없는 iOS Safari 같은 경우)만 쓴다.
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        engine.value = 'native'
        video.src = source
        tryPlay()
        return
      }
      engine.value = 'none'
      status.value = 'error'
      error.value = new Error('이 브라우저는 HLS 재생을 지원하지 않는다.')
      return
    }

    engine.value = 'hls.js'
    hls = new Hls({
      // 관제 화면이므로 지연을 짧게 유지한다. 뒤처지면 라이브 엣지로 따라붙는다.
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      // 끊겼을 때 자동 재시도
      manifestLoadingMaxRetry: 6,
      levelLoadingMaxRetry: 6,
      fragLoadingMaxRetry: 6,
    })

    hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      // 치명적 오류는 종류별로 복구 방법이 다르다. 무조건 destroy 하면
      // 잠깐의 네트워크 끊김에도 화면이 영영 죽는다.
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          status.value = 'error'
          error.value = new Error(`스트림을 불러오지 못했다 (${data.details})`)
          hls.startLoad()
          break
        case Hls.ErrorTypes.MEDIA_ERROR:
          status.value = 'error'
          error.value = new Error(`디코딩 오류 (${data.details})`)
          hls.recoverMediaError()
          break
        default:
          status.value = 'error'
          error.value = new Error(`재생 오류 (${data.details})`)
          teardown()
      }
    })

    hls.loadSource(source)
    hls.attachMedia(video)
  }

  /**
   * play() 거절은 원인에 따라 의미가 완전히 다르다. 한 덩어리로 "에러" 처리하면
   * 탭을 잠깐 백그라운드로 보낸 것만으로 화면이 빨갛게 죽는다.
   */
  function tryPlay() {
    const video = videoRef.value
    if (!video) return
    video.play().then(() => {
      status.value = 'playing'
      error.value = null
    }).catch((err) => {
      if (err.name === 'AbortError') {
        // 다른 재생 요청이나 브라우저의 절전 정책(백그라운드 탭의 무음 영상)에
        // 의해 취소된 것. 고장이 아니다. 다시 앞으로 오면 재생된다.
        status.value = 'paused'
        return
      }
      if (err.name === 'NotAllowedError') {
        // 자동재생 정책. muted 라 보통은 통과하지만, 막히면 사용자 클릭이 필요하다.
        status.value = 'blocked'
        error.value = new Error('브라우저가 자동 재생을 막았다. 재생을 눌러라.')
        return
      }
      status.value = 'error'
      error.value = err
    })
  }

  function onPlaying() {
    status.value = 'playing'
    error.value = null
  }

  function onPause() {
    // 스트림이 끝나서가 아니라 절전/탭 전환으로 멈춘 경우.
    if (status.value === 'playing') status.value = 'paused'
  }

  function bind(video) {
    video.addEventListener('playing', onPlaying)
    video.addEventListener('pause', onPause)
  }

  function unbind(video) {
    video?.removeEventListener('playing', onPlaying)
    video?.removeEventListener('pause', onPause)
  }

  watch([videoRef, sourceRef], ([video], [previousVideo]) => {
    if (previousVideo && previousVideo !== video) unbind(previousVideo)
    if (!video) return
    unbind(video)
    bind(video)
    attach()
  }, { immediate: true })

  onBeforeUnmount(() => {
    unbind(videoRef.value)
    teardown()
  })

  return {
    status,
    error,
    engine,
    /** 스트림을 처음부터 다시 붙인다 (네트워크 오류 복구용) */
    retry: attach,
    /** 사용자 클릭으로 재생 재개 (자동재생 차단/절전 정지 복구용) */
    resume: tryPlay,
  }
}
