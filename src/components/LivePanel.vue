<script setup>
/**
 * 왼쪽 패널 — 라이브 스트림.
 *
 * 규칙은 하나다. 무슨 일이 있어도 멈추지 않는다.
 * 오른쪽에서 클립을 기다리든 분석이 돌든 왼쪽은 계속 흐르고 검출 버튼도 계속
 * 눌려야 한다. 그래서 버튼의 disabled 는 요청을 보내는 순간에만 걸린다.
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { useHls } from '../composables/useHls.js'
import { useWebRtc } from '../composables/useWebRtc.js'
import { HLS_URL, WHEP_URL } from '../api/config.js'

const props = defineProps({
  session: { type: Object, required: true },
})

const videoEl = ref(null)
const source = ref(HLS_URL)
const transport = ref(WHEP_URL ? 'webrtc' : 'hls')
const isWebRtc = computed(() => transport.value === 'webrtc')
const hls = useHls(videoEl, source, computed(() => !isWebRtc.value))
const rtc = useWebRtc(videoEl, WHEP_URL, isWebRtc)
const status = computed(() => (isWebRtc.value ? rtc : hls).status.value)
const error = computed(() => (isWebRtc.value ? rtc : hls).error.value)
const engine = computed(() => isWebRtc.value ? 'WebRTC' : hls.engine.value)
const { fastMode, liveDelay, stalls, goLive, toggleFastMode } = hls
const rtcStats = rtc.stats
const retry = () => (isWebRtc.value ? rtc : hls).retry()
const resume = () => (isWebRtc.value ? rtc : hls).resume()
const showClock = ref(false)
const clockText = ref('')
let clockTimer = null
function toggleClock() {
  showClock.value = !showClock.value
  clearInterval(clockTimer)
  if (showClock.value) {
    const tick = () => {
      const now = new Date()
      clockText.value = now.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0')
    }
    tick()
    clockTimer = setInterval(tick, 50)
  }
}
onBeforeUnmount(() => clearInterval(clockTimer))

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
      <span v-if="!isWebRtc" class="faint live__engine" title="hls.js가 추정한 라이브 끝과 재생 위치의 차이입니다. 카메라 촬영부터 화면까지의 전체 지연은 아닙니다.">
        재생 지연 {{ liveDelay === null ? '측정 대기' : `${liveDelay.toFixed(2)}초` }} · 버퍼 멈춤 {{ stalls }}회
      </span>
      <span v-else class="faint live__engine">
        {{ rtcStats ? `${rtcStats.width || '?'}×${rtcStats.height || '?'} · ${rtcStats.fps || 0}fps` : 'WebRTC 수신 대기' }} · 실제 지연은 시계로 측정
      </span>
      <button v-if="WHEP_URL" @click="transport = isWebRtc ? 'hls' : 'webrtc'">{{ isWebRtc ? 'HLS로 전환' : 'WebRTC로 전환' }}</button>
      <button v-if="engine === 'hls.js'" :aria-pressed="fastMode" @click="toggleFastMode"
        title="저지연은 목표 버퍼 0.8초, 안정 모드는 1.2초입니다. 저지연에서 끊기면 안정 모드로 복귀하세요.">
        {{ fastMode ? '저지연 모드' : '안정 모드' }}
      </button>
      <button v-if="engine === 'hls.js'" @click="goLive">라이브 복귀</button>
      <span class="faint mono live__engine">{{ engine }}</span>
    </div>

    <div class="panel__body">
      <div v-if="showClock" class="live__clock">
        <strong>{{ clockText }}</strong>
        <span>카메라로 이 시계를 촬영하세요. 현재 시각과 영상 속 시각의 차이가 실제 화면 지연입니다. (50ms 갱신)</span>
      </div>
      <div class="live__stage">
        <!-- muted 가 없으면 브라우저 자동재생 정책에 막힌다. 관제 영상에 소리는 필요 없다. -->
        <video ref="videoEl" class="live__video" muted playsinline loop autoplay />

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
          <span v-if="session.triggering.value" class="spinner" />
          <span v-else class="live__trigger-dot" />
          검출
        </button>

        <span class="dim live__hint" title="미리보기 재생 위치는 센서 촬영시각과 같다고 가정하지 않습니다.">
          서버 접수 시각 기준 -3초 ~ +10초 저장 · 미리보기와 녹화 경로 분리
        </span>

        <div style="flex: 1" />
        <button @click="toggleClock">{{ showClock ? '측정 시계 닫기' : '지연 측정 시계' }}</button>

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
.live__clock { flex: none; padding: 12px; background: #fff; color: #111; text-align: center; }
.live__clock strong { display: block; font: bold clamp(24px, 4vw, 54px) monospace; font-variant-numeric: tabular-nums; }
.live__clock span { display: block; font-size: 12px; }
.live__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #05080c;
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
.live__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #05080ccc;
  text-align: center;
  padding: 20px;
}
.live__overlay p { margin: 0; }
.live__src { font-size: 12px; word-break: break-all; }
.live__engine { font-size: 11px; }

.live__controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}
.live__trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 700;
  padding: 11px 22px;
  background: #7f1d1d;
  border-color: #b91c1c;
  white-space: nowrap;
}
.live__trigger:hover:not(:disabled) { background: #991b1b; border-color: #ef4444; }
.live__trigger-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #fca5a5;
  box-shadow: 0 0 0 3px #fca5a533;
}
.live__hint { font-size: 12px; }
.live__error {
  margin: 0;
  padding: 10px 14px;
  color: var(--danger);
  font-size: 13px;
  border-top: 1px solid var(--border);
}
</style>
