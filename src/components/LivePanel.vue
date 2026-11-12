<script setup>
/**
 * 왼쪽 패널 — 라이브 스트림.
 *
 * 규칙은 하나다. 무슨 일이 있어도 멈추지 않는다.
 * 오른쪽에서 클립을 기다리든 분석이 돌든 왼쪽은 계속 흐르고 검출 버튼도 계속
 * 눌려야 한다. 그래서 버튼의 disabled 는 요청을 보내는 순간에만 걸린다.
 */
import { ref, computed } from 'vue'
import { useHls } from '../composables/useHls.js'
import { useWebRtc } from '../composables/useWebRtc.js'
import { HLS_URL, WHEP_URL, DEVICE_RECONNECT_URL } from '../api/config.js'
import { http } from '../api/http.js'

const props = defineProps({
  session: { type: Object, required: true },
})

const videoEl = ref(null)
const source = ref(HLS_URL)
const transport = WHEP_URL ? 'webrtc' : 'hls'
const isWebRtc = computed(() => transport === 'webrtc')
const hls = useHls(videoEl, source, computed(() => !isWebRtc.value))
const rtc = useWebRtc(videoEl, WHEP_URL, isWebRtc)
const status = computed(() => (isWebRtc.value ? rtc : hls).status.value)
const error = computed(() => (isWebRtc.value ? rtc : hls).error.value)
const engine = computed(() => isWebRtc.value ? 'WebRTC' : hls.engine.value)
const { fastMode, liveDelay, stalls, goLive, toggleFastMode } = hls
const rtcStats = rtc.stats
const reconnecting = ref(false)
const reconnectError = ref(null)
async function retry() {
  if (reconnecting.value) return
  reconnecting.value = true
  reconnectError.value = null
  try {
    if (DEVICE_RECONNECT_URL) await http.post(DEVICE_RECONNECT_URL)
    const player = isWebRtc.value ? rtc : hls
    player.retry()
  } catch (error) {
    reconnectError.value = error.message
  } finally { reconnecting.value = false }
}
const resume = () => (isWebRtc.value ? rtc : hls).resume()

async function onTrigger() {
  try {
    await props.session.trigger({
      clientClickEpochMs: Date.now(),
      displayedMediaTimeS: Number.isFinite(videoEl.value?.currentTime)
        ? videoEl.value.currentTime : null,
      displayTimeMapping: `${engine.value} media position only; sensor capture wall-clock mapping unknown`,
    })
  } catch {
    // 에러는 session.triggerError 로 화면에 뜬다.
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <span class="panel__title">라이브</span>

      <span v-if="status === 'playing'" class="badge badge--live">
        <span class="dot dot--pulse" />LIVE
      </span>
      <span v-else-if="status === 'loading'" class="badge">
        <span class="dot dot--pulse" />연결 중
      </span>
      <span v-else-if="status === 'paused' || status === 'blocked'" class="badge badge--warn">
        <span class="dot" />일시정지
      </span>
      <span v-else-if="status === 'error'" class="badge badge--error">
        <span class="dot" />스트림 끊김
      </span>

      <div style="flex: 1" />
      <button v-if="DEVICE_RECONNECT_URL" :disabled="reconnecting" @click="retry">
        {{ reconnecting ? '파이 연결 확인 중…' : '파이 연결 확인' }}
      </button>
      <span v-if="!isWebRtc" class="faint live__engine" title="hls.js가 추정한 라이브 끝과 재생 위치의 차이입니다. 카메라 촬영부터 화면까지의 전체 지연은 아닙니다.">
        재생 지연 {{ liveDelay === null ? '측정 대기' : `${liveDelay.toFixed(2)}초` }} · 버퍼 멈춤 {{ stalls }}회
      </span>
      <span v-else class="faint live__engine">
        {{ rtcStats ? `${rtcStats.width || '?'}×${rtcStats.height || '?'} · ${rtcStats.fps || 0}fps` : 'WebRTC 수신 대기' }}
      </span>
      <button v-if="engine === 'hls.js'" :aria-pressed="fastMode" @click="toggleFastMode"
        title="저지연은 목표 버퍼 0.8초, 안정 모드는 1.2초입니다. 저지연에서 끊기면 안정 모드로 복귀하세요.">
        {{ fastMode ? '저지연 모드' : '안정 모드' }}
      </button>
      <button v-if="engine === 'hls.js'" @click="goLive">라이브 복귀</button>
      <span class="faint mono live__engine">{{ engine }}</span>
    </div>

    <div class="panel__body">
      <p v-if="reconnectError" class="live__error" role="alert">{{ reconnectError }}</p>
      <div class="live__stage">
        <!-- muted 가 없으면 브라우저 자동재생 정책에 막힌다. 관제 영상에 소리는 필요 없다. -->
        <video ref="videoEl" class="live__video" muted playsinline loop autoplay />

        <!-- 화면 모서리 표식. 영상 영역이 어디까지인지 어두운 하늘에서도 보이게 한다. -->
        <i class="live__corner live__corner--tl" />
        <i class="live__corner live__corner--tr" />
        <i class="live__corner live__corner--bl" />
        <i class="live__corner live__corner--br" />

        <!-- 멈춤과 고장을 구분한다. 탭을 백그라운드로 보내면 브라우저가 무음 영상을
             절전 정지시키는데, 그걸 스트림 오류로 그리면 멀쩡한 서버를 의심하게 된다. -->
        <div v-if="status === 'paused' || status === 'blocked'" class="live__overlay">
          <p class="dim">{{ error?.message || '재생이 멈췄습니다.' }}</p>
          <button @click="resume">재생</button>
        </div>

        <div v-else-if="status === 'error'" class="live__overlay">
          <p>{{ error?.message }}</p>
          <p class="faint mono live__src">{{ isWebRtc ? WHEP_URL : source }}</p>
          <button @click="retry">다시 연결</button>
        </div>
      </div>

      <div class="live__controls">
        <button class="live__trigger" :disabled="session.triggering.value" @click="onTrigger">
          <span v-if="session.triggering.value" class="spinner live__spinner" />
          <span v-else class="live__trigger-dot" />
          검출
        </button>

        <div style="flex: 1" />

        <span v-if="session.pendingCount.value > 0" class="badge badge--warn">
          <span class="dot dot--pulse" />저장 중 {{ session.pendingCount.value }}건
        </span>
      </div>

      <p v-if="session.triggerError.value" class="live__error">
        {{ session.triggerError.value.message }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.panel__head, .live__controls { flex-wrap: wrap; }
.live__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--bg-video);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.live__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.live__corner {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 0 solid rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
.live__corner--tl { top: 10px; left: 10px; border-top-width: 1px; border-left-width: 1px; }
.live__corner--tr { top: 10px; right: 10px; border-top-width: 1px; border-right-width: 1px; }
.live__corner--bl { bottom: 10px; left: 10px; border-bottom-width: 1px; border-left-width: 1px; }
.live__corner--br { bottom: 10px; right: 10px; border-bottom-width: 1px; border-right-width: 1px; }

.live__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(7, 7, 8, 0.85);
  text-align: center;
  padding: 20px;
}
.live__overlay p { margin: 0; }
.live__src { font-size: 12px; word-break: break-all; }
.live__engine { font-size: 12px; }

.live__controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}

/* 이 화면의 유일한 주 행동. 강조색을 통째로 쓴다. */
.live__trigger {
  height: 40px;
  padding: 0 22px;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--on-accent);
  background: var(--accent);
  border-color: var(--accent);
}
.live__trigger:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.live__trigger-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--on-accent);
}
.live__spinner { border-color: rgba(0, 0, 0, 0.25); border-top-color: var(--on-accent); }

.live__error {
  margin: 0;
  padding: 10px 14px;
  color: var(--danger);
  font-size: 12px;
  border-top: 1px solid var(--border);
}
</style>
