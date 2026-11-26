<script setup>
/**
 * 폰 전용 실시간 화면. 폰 안의 카메라를 직접 열어 보여 주고, "검출"을 누르면 그 순간부터
 * 10초를 폰에서 녹화해 업로드 분석 화면으로 넘긴다. 서버로 영상을 계속 보내지 않으므로
 * 파이 중계(mediamtx)·방화벽과 무관하고, 노트북이 파이를 보는 동안에도 서로 영향이 없다.
 *
 * 이후 객체 선택·추적·판정은 업로드 분석 화면이 그대로 한다 (lib/pendingUpload 로 파일을 넘긴다).
 * 누르기 전 3초는 폰에서 만들 수 없어 누른 뒤 10초만 녹화한다.
 */
import { ref, computed, watch, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import {
  RECORD_SECONDS, pickRecorderMime, recordingName, cameraErrorMessage,
} from '../lib/phoneCapture.js'
import { pendingUpload } from '../lib/pendingUpload.js'

const emit = defineEmits(['recorded'])

const videoEl = ref(null)
const status = ref('idle') // idle | starting | ready | recording | error
const error = ref(null)
const elapsed = ref(0)
const visible = ref(true)

let stream = null
let recorder = null
let ticker = null
let discard = false

onActivated(() => { visible.value = true })
onDeactivated(() => { visible.value = false })

const recording = computed(() => status.value === 'recording')
const remaining = computed(() => Math.max(0, Math.ceil(RECORD_SECONDS - elapsed.value)))
const progress = computed(() => Math.min(100, (elapsed.value / RECORD_SECONDS) * 100))

async function startCamera() {
  stopCamera()
  status.value = 'starting'
  error.value = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    })
    // 켜는 동안 화면을 벗어났다면 바로 닫는다. 카메라 표시등이 계속 켜져 있으면 안 된다.
    if (!visible.value) { stopCamera(); status.value = 'idle'; return }
    const video = videoEl.value
    video.srcObject = stream
    await video.play().catch(() => {})
    status.value = 'ready'
  } catch (e) {
    stopCamera()
    error.value = cameraErrorMessage(e)
    status.value = 'error'
  }
}

function stopCamera() {
  cancelRecording()
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  if (videoEl.value) videoEl.value.srcObject = null
}

// 이 화면이 보이는 동안만 카메라를 쓴다. 다른 화면으로 가면 끈다.
watch([videoEl, visible], ([video, show]) => {
  if (!video) return
  if (show) { if (status.value === 'idle' || status.value === 'error') startCamera() }
  else { stopCamera(); status.value = 'idle' }
}, { immediate: true, flush: 'post' })

function startRecording() {
  if (!stream || recording.value) return
  const mime = pickRecorderMime()
  const chunks = []
  discard = false
  try {
    recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 4_000_000,
    })
  } catch (e) {
    error.value = '이 브라우저에서는 영상을 녹화할 수 없습니다.'
    status.value = 'error'
    return
  }
  const type = recorder.mimeType || mime || 'video/webm'
  recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data) }
  recorder.onstop = () => {
    clearInterval(ticker)
    recorder = null
    if (discard || !chunks.length) { if (status.value === 'recording') status.value = 'ready'; return }
    const file = new File(chunks, recordingName(type), { type: type.split(';')[0] })
    status.value = 'ready'
    pendingUpload.value = file
    emit('recorded', file)
  }
  const startedAt = performance.now()
  elapsed.value = 0
  status.value = 'recording'
  recorder.start(1000)
  ticker = setInterval(() => {
    elapsed.value = (performance.now() - startedAt) / 1000
    if (elapsed.value >= RECORD_SECONDS) recorder?.state === 'recording' && recorder.stop()
  }, 100)
}

function cancelRecording() {
  clearInterval(ticker)
  if (recorder && recorder.state !== 'inactive') {
    discard = true
    recorder.stop()
  }
  recorder = null
  if (status.value === 'recording') status.value = 'ready'
}

// 녹화 중 화면이 꺼지거나 앱이 백그라운드로 가면 브라우저가 영상 입력을 멈춘다. 빈 파일을 올리지 않도록 버린다.
function onVisibility() {
  if (document.hidden && recording.value) {
    cancelRecording()
    error.value = '화면이 꺼져 녹화를 취소했습니다. 다시 눌러 주세요.'
  }
}
document.addEventListener('visibilitychange', onVisibility)

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  stopCamera()
})
</script>

<template>
  <section class="panel phone">
    <div class="panel__head">
      <span class="panel__title">폰 카메라</span>

      <span v-if="recording" class="badge badge--live"><span class="dot dot--pulse" />REC {{ remaining }}초</span>
      <span v-else-if="status === 'ready'" class="badge badge--live"><span class="dot dot--pulse" />LIVE</span>
      <span v-else-if="status === 'starting'" class="badge"><span class="dot dot--pulse" />카메라 여는 중</span>
      <span v-else-if="status === 'error'" class="badge badge--error"><span class="dot" />카메라 오류</span>
    </div>

    <div class="panel__body">
      <div class="phone__stage">
        <video ref="videoEl" class="phone__video" muted playsinline autoplay />
        <i class="phone__corner phone__corner--tl" /><i class="phone__corner phone__corner--tr" />
        <i class="phone__corner phone__corner--bl" /><i class="phone__corner phone__corner--br" />

        <div v-if="status === 'error'" class="phone__overlay">
          <p>{{ error }}</p>
          <button @click="startCamera">다시 시도</button>
        </div>
      </div>

      <div v-if="recording" class="phone__bar" aria-hidden="true"><i :style="{ width: progress + '%' }" /></div>

      <div class="phone__controls">
        <button v-if="!recording" class="phone__trigger" :disabled="status !== 'ready'" @click="startRecording">
          <span class="phone__dot" />검출 ({{ RECORD_SECONDS }}초 녹화)
        </button>
        <button v-else class="phone__trigger phone__trigger--stop" @click="cancelRecording">취소</button>
      </div>

      <p v-if="error && status !== 'error'" class="phone__note phone__note--warn" role="alert">{{ error }}</p>
      <p class="phone__note faint">
        드론을 화면 안에 두고 누르면 그 순간부터 {{ RECORD_SECONDS }}초를 녹화해 업로드 분석 화면으로 넘어갑니다.
      </p>
    </div>
  </section>
</template>

<style scoped>
.phone__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--bg-video);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.phone__video { width: 100%; height: 100%; object-fit: contain; display: block; }
.phone__corner {
  position: absolute; width: 14px; height: 14px; pointer-events: none;
  border: 0 solid rgba(255, 255, 255, 0.35);
}
.phone__corner--tl { top: 10px; left: 10px; border-top-width: 1px; border-left-width: 1px; }
.phone__corner--tr { top: 10px; right: 10px; border-top-width: 1px; border-right-width: 1px; }
.phone__corner--bl { bottom: 10px; left: 10px; border-bottom-width: 1px; border-left-width: 1px; }
.phone__corner--br { bottom: 10px; right: 10px; border-bottom-width: 1px; border-right-width: 1px; }

.phone__overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  padding: 20px; text-align: center; background: rgba(7, 7, 8, 0.85);
}
.phone__overlay p { margin: 0; font-size: 13px; line-height: 1.6; }

.phone__bar { flex: none; height: 3px; background: var(--border); }
.phone__bar i { display: block; height: 100%; background: var(--accent); transition: width 0.1s linear; }

.phone__controls { flex: none; padding: 12px 14px; border-top: 1px solid var(--border); display: flex; }
.phone__trigger {
  flex: 1; height: 48px; gap: 10px; font-size: 15px; font-weight: 700;
  color: var(--on-accent); background: var(--accent); border-color: var(--accent);
}
.phone__trigger:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.phone__trigger--stop { color: var(--text); background: transparent; border-color: var(--border-strong); }
.phone__trigger--stop:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-strong); }
.phone__dot { width: 9px; height: 9px; border-radius: 50%; background: currentColor; }

.phone__note { flex: none; margin: 0; padding: 0 14px 12px; font-size: 12px; line-height: 1.6; }
.phone__note--warn { padding-top: 10px; color: var(--danger); }
</style>
