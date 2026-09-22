<script setup>
/**
 * 오른쪽 패널 — 잘라낸 클립.
 *
 * 왼쪽과 달리 여기는 멈춰 있다. 사용자가 프레임을 고르고 박스를 그리고 분석을
 * 요청한다. 화면 다섯 상태가 그대로 이 컴포넌트의 분기다.
 *
 *   IDLE          아직 검출 전 (또는 패널을 비운 상태)
 *   CLIP_PENDING  +10초가 아직 안 지났다
 *   CLIP_READY    정지 화면. 프레임 선택 + 박스 지정
 *   ANALYZING     AI 파이프라인 대기
 *   DONE          결과
 *   (+ CLIP_FAILED / ANALYSIS_FAILED)
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import BoxOverlay from './BoxOverlay.vue'
import AnalysisResult from './AnalysisResult.vue'
import TrackOverlay from './TrackOverlay.vue'
import { toFrameIndex, createFitTransform } from '../lib/videoGeometry.js'
import { captureThumbnail } from '../lib/videoThumbnail.js'
import { addHistory } from '../lib/historyStore.js'

const props = defineProps({
  session: { type: Object, required: true },
})

const videoEl = ref(null)
const sourceBox = ref(null)     // 원본 픽셀 좌표 {x, y, width, height}
const frameIndex = ref(0)
const playing = ref(false)
const now = ref(Date.now())
const requestError = ref(null)
/**
 * video.videoWidth / clientWidth 는 DOM 속성이라 바뀌어도 Vue 가 모른다.
 * 메타데이터 로드와 창 크기 변경 때 이 값을 올려 computed 를 다시 돌린다.
 */
const geometryVersion = ref(0)
/**
 * 결과가 나온 뒤 A 파트 추적 결과를 영상 위에 겹쳐 볼지.
 *
 * AI 가 만든 overlay.mp4 를 쓰지 않는다. OpenCV 'mp4v'(MPEG-4 Part 2) 라
 * 브라우저가 디코딩하지 못한다. 대신 TrackSequence 를 받아 캔버스로 직접 그린다.
 */
const showOverlay = ref(false)

const clip = computed(() => props.session.selectedClip.value)
const state = computed(() => props.session.screenState.value)
const meta = computed(() => clip.value?.meta || null)

/** 클립이 바뀌면 그려둔 박스와 프레임 위치를 반드시 버린다. */
watch(() => clip.value?.clipId, () => {
  sourceBox.value = null
  frameIndex.value = 0
  playing.value = false
  requestError.value = null
  showOverlay.value = false
})

/**
 * 분석이 끝나면 기록에 남긴다.
 *
 * 썸네일은 지금 찍어야 한다. 사용자가 프레임을 옮기거나 다른 클립을 고르면
 * 판정 당시 화면이 사라진다.
 */
const recorded = new Set()
watch(() => clip.value?.analysis, (analysis) => {
  if (!analysis || analysis.status !== 'DONE') return
  if (!analysis.analysisId || recorded.has(analysis.analysisId)) return
  recorded.add(analysis.analysisId)

  addHistory({
    source: 'live',
    title: clip.value.clipId,
    label: analysis.label,
    confidence: analysis.confidence,
    rejectReason: analysis.rejectReason,
    bbox: lastRequestedBbox,
    initFrameIndex: analysis.request?.initFrameIndex ?? frameIndex.value,
    quality: analysis.quality || null,
    topFeatures: analysis.topFeatures || null,
    metrics: null,
    tuning: null,
    processingTimeMs: analysis.processingTimeMs,
    thumbnail: captureThumbnail(videoEl.value, { box: sourceBox.value }),
    overlayUrl: analysis.overlayUrl || null,
  })
}, { deep: true })

/** 기록에 남길 좌표. 분석 요청 시점의 값을 들고 있는다. */
let lastRequestedBbox = null

// 남은 시간 --------------------------------------------------------------

const ticker = setInterval(() => { now.value = Date.now() }, 250)
onBeforeUnmount(() => clearInterval(ticker))

/** readyAt 은 서버가 준 값이다. 클라이언트에서 10초를 직접 세면 시계가 틀어진다. */
const remainingSeconds = computed(() => {
  if (!clip.value?.readyAt) return null
  return Math.max(0, Math.ceil((clip.value.readyAt - now.value) / 1000))
})

const pendingProgress = computed(() => {
  const entry = clip.value
  if (!entry?.readyAt) return 0
  const total = entry.readyAt - entry.triggeredAt
  if (total <= 0) return 1
  return Math.min(1, Math.max(0, (now.value - entry.triggeredAt) / total))
})

const pendingBarStyle = computed(() => ({ width: (pendingProgress.value * 100).toFixed(1) + '%' }))

// 프레임 조작 ------------------------------------------------------------

const lastFrame = computed(() => Math.max(0, (meta.value?.frameCount || 1) - 1))

/**
 * 프레임 번호 → 재생 위치.
 *
 * 프레임 i 는 [i/fps, (i+1)/fps) 구간을 차지한다. 정확히 i/fps 로 seek 하면
 * 브라우저 반올림 때문에 i-1 프레임이 잡히는 일이 있어 구간 안쪽을 노린다.
 * 0.2 를 더하면 뒤에서 Math.round(currentTime * fps) 로 되돌릴 때 i 가 나온다.
 */
function seekToFrame(index) {
  const video = videoEl.value
  const fps = meta.value?.fps
  if (!video || !fps) return
  const clamped = Math.min(Math.max(0, index), lastFrame.value)
  frameIndex.value = clamped
  video.currentTime = (clamped + 0.2) / fps
}

/** videoWidth 는 메타데이터가 로드돼야 채워진다. 그 전에는 0 이다. */
function onLoadedMetadata() {
  geometryVersion.value += 1
  seekToFrame(0)
}

function onResize() {
  geometryVersion.value += 1
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

function onTimeUpdate() {
  const video = videoEl.value
  const fps = meta.value?.fps
  if (!video || !fps) return
  frameIndex.value = toFrameIndex(video.currentTime, fps, meta.value?.frameCount)
}

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  if (video.paused) {
    video.play()
    playing.value = true
  } else {
    video.pause()
    playing.value = false
  }
}

/** 박스를 그리기 시작하면 멈춘다. 움직이는 화면에 박스를 그릴 수는 없다. */
function pauseForDrawing() {
  const video = videoEl.value
  if (video && !video.paused) {
    video.pause()
    playing.value = false
  }
}

// 분석 요청 --------------------------------------------------------------

const canAnalyze = computed(() => state.value === 'CLIP_READY' && !!sourceBox.value)

async function requestAnalysis() {
  if (!canAnalyze.value) return
  requestError.value = null

  const box = sourceBox.value
  const payload = {
    initFrameIndex: frameIndex.value,
    // [x, y, w, h] 원본 픽셀. 정수로 보낸다. 픽셀 인덱스에 소수점은 의미가 없다.
    targetBbox: [
      Math.round(box.x),
      Math.round(box.y),
      Math.round(box.width),
      Math.round(box.height),
    ],
  }

  lastRequestedBbox = payload.targetBbox

  try {
    // videoUrl 은 AI 직결 경로에서만 쓴다 (클립 영상을 AI 에 업로드해야 한다).
    await props.session.requestAnalysis(clip.value.clipId, payload, {
      videoUrl: meta.value?.videoUrl,
    })
  } catch (error) {
    requestError.value = error
  }
}

function redraw() {
  props.session.resetAnalysis(clip.value.clipId)
  sourceBox.value = null
  showOverlay.value = false
}

/** A 파트 추적 결과. AI 경로로 분석했을 때만 온다. */
const trackPoints = computed(() => clip.value?.analysis?.points || null)

// 표시용 ------------------------------------------------------------------

const STATE_LABEL = {
  IDLE: '대기',
  CLIP_PENDING: '저장 중',
  CLIP_READY: '박스 지정',
  ANALYZING: '분석 중',
  DONE: '결과',
  CLIP_FAILED: '클립 실패',
  ANALYSIS_FAILED: '분석 실패',
}

/**
 * 화면 배율.
 *
 * clientWidth / videoWidth 로 계산하면 안 된다. object-fit: contain 에서는
 * 세로가 한계일 수 있고(패널이 납작할 때) 그러면 실제 배율은 훨씬 작다.
 * BoxOverlay 와 같은 계산을 써야 화면의 숫자와 실제 변환이 일치한다.
 */
const scaleLabel = computed(() => {
  geometryVersion.value
  const video = videoEl.value
  if (!video) return null
  const tf = createFitTransform({
    intrinsicWidth: video.videoWidth,
    intrinsicHeight: video.videoHeight,
    boxWidth: video.clientWidth,
    boxHeight: video.clientHeight,
    fit: 'contain',
  })
  if (!tf) return null

  const label = tf.intrinsicWidth + 'x' + tf.intrinsicHeight
    + ' → ' + Math.round(tf.displayWidth) + 'x' + Math.round(tf.displayHeight)
    + ' (' + tf.scale.toFixed(3) + 'x)'
  // 레터박스 여백이 있으면 같이 보여준다. 좌표가 어긋날 때 먼저 의심할 값이다.
  const padX = Math.round(tf.offsetX)
  const padY = Math.round(tf.offsetY)
  if (padX > 0 || padY > 0) return label + ' · 여백 ' + padX + ',' + padY
  return label
})

const timeLabel = computed(() => {
  const fps = meta.value?.fps
  if (!fps) return ''
  return (frameIndex.value / fps).toFixed(2) + 's'
})
</script>

<template>
  <section class="panel clip">
    <div class="panel__head">
      <span class="panel__title">클립</span>
      <span
        class="badge"
        :class="{
          'badge--warn': state === 'CLIP_PENDING' || state === 'ANALYZING',
          'badge--ok': state === 'CLIP_READY' || state === 'DONE',
          'badge--error': state === 'CLIP_FAILED' || state === 'ANALYSIS_FAILED',
        }"
      >
        <span
          class="dot"
          :class="{ 'dot--pulse': state === 'CLIP_PENDING' || state === 'ANALYZING' }"
        />
        {{ STATE_LABEL[state] }}
      </span>

      <div style="flex: 1" />
      <span v-if="clip" class="faint mono clip__id">{{ clip.clipId }}</span>
      <button
        v-if="clip"
        class="clip__close"
        title="패널 비우기"
        @click="session.clearSelection()"
      >✕</button>
    </div>

    <div class="panel__body">
      <div v-if="state === 'IDLE'" class="clip__empty">
        <p class="faint">검출 대기</p>
      </div>

      <div v-else-if="state === 'CLIP_PENDING'" class="clip__pending">
        <div class="spinner clip__pending-spinner" />
        <p class="dim">
          구간 저장 중
          <b v-if="remainingSeconds !== null" class="mono">{{ remainingSeconds }}초</b>
        </p>
        <div class="clip__progress">
          <div class="clip__progress-bar" :style="pendingBarStyle" />
        </div>
      </div>

      <div v-else-if="state === 'CLIP_FAILED'" class="clip__empty">
        <p class="clip__error-text">구간 저장 실패</p>
        <p class="faint">{{ clip.error?.message }}</p>
        <button @click="session.dismiss(clip.clipId)">닫기</button>
      </div>

      <template v-else>
        <div class="clip__stage">
          <video
            ref="videoEl"
            class="clip__video"
            :src="meta?.videoUrl"
            playsinline
            muted
            preload="auto"
            @loadedmetadata="onLoadedMetadata"
            @timeupdate="onTimeUpdate"
            @ended="playing = false"
          />
          <TrackOverlay
            v-if="showOverlay && trackPoints"
            :video-el="videoEl"
            :points="trackPoints"
            :fps="meta?.fps || 30"
          />
          <BoxOverlay
            v-if="!showOverlay"
            :video-el="videoEl"
            :source-box="sourceBox"
            :active="state === 'CLIP_READY'"
            @update:source-box="sourceBox = $event"
            @draw-start="pauseForDrawing"
          />
        </div>

        <div class="clip__scrub">
          <button class="clip__icon" :disabled="state !== 'CLIP_READY'" @click="togglePlay">
            {{ playing ? '❚❚' : '▶' }}
          </button>
          <button
            class="clip__icon"
            :disabled="state !== 'CLIP_READY'"
            @click="seekToFrame(frameIndex - 1)"
          >◀</button>
          <input
            class="clip__range"
            type="range"
            :min="0"
            :max="lastFrame"
            :value="frameIndex"
            :disabled="state !== 'CLIP_READY'"
            @input="seekToFrame(Number($event.target.value))"
          />
          <button
            class="clip__icon"
            :disabled="state !== 'CLIP_READY'"
            @click="seekToFrame(frameIndex + 1)"
          >▶</button>
          <span class="mono clip__frame">
            frame <b>{{ frameIndex }}</b> / {{ lastFrame }}
            <span class="faint">· {{ timeLabel }} · {{ meta?.fps }}fps</span>
          </span>
        </div>

        <div class="clip__coords">
          <span class="faint mono">{{ scaleLabel }}</span>
          <div style="flex: 1" />
          <span v-if="sourceBox" class="mono clip__bbox">
            bbox [{{ Math.round(sourceBox.x) }}, {{ Math.round(sourceBox.y) }},
            {{ Math.round(sourceBox.width) }}, {{ Math.round(sourceBox.height) }}]
          </span>
          <span v-else-if="state === 'CLIP_READY'" class="faint">드래그해서 박스 지정</span>
        </div>

        <div class="clip__actions">
          <template v-if="state === 'CLIP_READY'">
            <button class="clip__primary" :disabled="!canAnalyze" @click="requestAnalysis">
              분석 요청
            </button>
            <button v-if="sourceBox" @click="sourceBox = null">박스 지우기</button>
            <p v-if="requestError" class="clip__error-text">{{ requestError.message }}</p>
          </template>

          <template v-else-if="state === 'ANALYZING'">
            <div class="clip__analyzing">
              <div class="spinner" />
              <span>분석 중</span>
              <span class="faint mono">{{ clip.analysis.status }}</span>
            </div>
          </template>

          <template v-else-if="state === 'DONE' && trackPoints">
            <button @click="showOverlay = !showOverlay">
              {{ showOverlay ? '지정 박스 보기' : '추적 오버레이 보기' }}
            </button>
          </template>

          <template v-else-if="state === 'ANALYSIS_FAILED'">
            <p class="clip__error-text">
              분석 실패 {{ clip.analysisError?.message || clip.analysis?.message || '' }}
            </p>
            <button @click="redraw">다시 지정</button>
          </template>
        </div>

        <AnalysisResult v-if="state === 'DONE'" :analysis="clip.analysis" @redraw="redraw" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.clip__id { font-size: 11px; }
.clip__close {
  padding: 2px 8px;
  border-color: transparent;
  background: transparent;
  color: var(--text-faint);
}
.clip__close:hover { color: var(--text); background: var(--bg-elevated); }

.clip__empty, .clip__pending {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 24px;
}
.clip__empty p, .clip__pending p { margin: 0; }
.clip__pending-spinner { width: 26px; height: 26px; }
.clip__progress {
  width: min(280px, 70%);
  height: 4px;
  background: var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.clip__progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width 240ms linear;
}
.clip__error-text { color: var(--danger); margin: 0; font-size: 13px; }

.clip__stage {
  position: relative;
  flex: 1;
  min-height: 160px;
  background: #05080c;
  overflow: hidden;
}
.clip__video {
  width: 100%;
  height: 100%;
  /* BoxOverlay 의 createFitTransform({fit:'contain'}) 과 반드시 같아야 한다.
     여기만 cover 로 바꾸면 좌표가 조용히 어긋난다. */
  object-fit: contain;
  display: block;
}

.clip__scrub {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
}
.clip__icon { padding: 4px 10px; min-width: 34px; }
.clip__range { flex: 1; accent-color: var(--accent); width: auto; }
.clip__frame { font-size: 12px; white-space: nowrap; }

.clip__coords {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12px;
  border-top: 1px solid var(--border);
  min-height: 30px;
}
.clip__bbox { color: var(--accent); }

.clip__actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}
.clip__actions:empty { display: none; }
.clip__actions p { margin: 0; font-size: 12px; }
.clip__primary {
  background: var(--accent-dim);
  border-color: var(--accent);
  font-weight: 600;
}
.clip__primary:hover:not(:disabled) { background: #2a6396; }
.clip__analyzing { display: flex; align-items: center; gap: 10px; }
</style>
