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
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import BoxOverlay from './BoxOverlay.vue'
import AnalysisResult from './AnalysisResult.vue'
import TrackOverlay from './TrackOverlay.vue'
import AnalyzeOverlay from './AnalyzeOverlay.vue'
import RadarEmpty from './RadarEmpty.vue'
import { toFrameIndex, createFitTransform } from '../lib/videoGeometry.js'
import { captureThumbnail } from '../lib/videoThumbnail.js'
import { addHistory, evidenceOf } from '../lib/historyStore.js'
import { aiModel } from '../lib/aiModel.js'
import TrackerProfileSelect from './TrackerProfileSelect.vue'
import { trackerLabel } from '../lib/trackerProfiles.js'

const props = defineProps({
  session: { type: Object, required: true },
})

const videoEl = ref(null)
const sourceBox = ref(null)     // 원본 픽셀 좌표 {x, y, width, height}
const frameIndex = ref(0)
const analysisDurationSeconds = ref(13)
const trackerVariant = ref('d0')
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
  analysisDurationSeconds.value = Math.min(13, (clip.value?.meta?.durationMs || 13000) / 1000)
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
    model: analysis.model || null,
    label: analysis.label,
    confidence: analysis.confidence,
    decisionScore: analysis.decisionScore ?? null,
    rejectReason: analysis.rejectReason,
    bbox: lastRequestedBbox,
    initFrameIndex: analysis.request?.initFrameIndex ?? frameIndex.value,
    quality: analysis.quality || null,
    topFeatures: analysis.topFeatures || null,
    ...evidenceOf(analysis),
    metrics: null,
    tuning: { trackerVariant: analysis.request?.trackerVariant ?? 'd0' },
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

const framePts = computed(() => meta.value?.framePts || null)
const lastFrame = computed(() => Math.max(0, (framePts.value?.length || meta.value?.frameCount || 1) - 1))

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
  if (framePts.value?.[clamped] !== undefined) {
    const current = framePts.value[clamped]
    const next = framePts.value[clamped + 1]
    const previous = framePts.value[clamped - 1]
    const step = next !== undefined ? next - current : current - (previous ?? current - 1 / fps)
    video.currentTime = current + Math.max(0, step) * 0.45
  } else {
    video.currentTime = (clamped + 0.2) / fps
  }
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
  if (framePts.value?.length) {
    let low = 0
    let high = framePts.value.length - 1
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (framePts.value[mid] < video.currentTime) low = mid + 1
      else high = mid
    }
    const before = Math.max(0, low - 1)
    frameIndex.value = Math.abs(framePts.value[before] - video.currentTime)
      <= Math.abs(framePts.value[low] - video.currentTime) ? before : low
  } else {
    frameIndex.value = toFrameIndex(video.currentTime, fps, meta.value?.frameCount)
  }
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

const intervalStartSeconds = computed(() => framePts.value?.[frameIndex.value]
  ?? (meta.value?.fps ? frameIndex.value / meta.value.fps : 0))
const maxAnalysisSeconds = computed(() => Math.max(0,
  (meta.value?.durationMs || 0) / 1000 - intervalStartSeconds.value))
const canAnalyze = computed(() => state.value === 'CLIP_READY' && !!sourceBox.value
  && analysisDurationSeconds.value > 0
  && analysisDurationSeconds.value <= maxAnalysisSeconds.value + 0.01)

watch([intervalStartSeconds, maxAnalysisSeconds], () => {
  if (maxAnalysisSeconds.value > 0 && analysisDurationSeconds.value > maxAnalysisSeconds.value) {
    analysisDurationSeconds.value = Math.floor(maxAnalysisSeconds.value * 100) / 100
  }
})

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
    maxSeconds: Number(analysisDurationSeconds.value.toFixed(2)),
    trackerVariant: trackerVariant.value,
  }

  lastRequestedBbox = payload.targetBbox

  try {
    // videoUrl 은 AI 직결 경로에서만 쓴다 (클립 영상을 AI 에 업로드해야 한다).
    await props.session.requestAnalysis(clip.value.clipId, payload, {
      videoUrl: meta.value?.videoUrl,
      localClip: /^clip_[0-9a-f]{32}$/.test(clip.value.clipId),
      model: aiModel.value,
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

/**
 * 결과가 나오면 추적 오버레이로 바꾸고, 지정한 프레임부터 한 번 재생해
 * 박스가 대상을 따라가며 궤적이 쌓이는 모습을 바로 보여 준다.
 */
watch(() => [clip.value?.clipId, state.value, trackPoints.value], ([, current, points]) => {
  if (current !== 'DONE' || !points?.length) return
  showOverlay.value = true
  nextTick(() => {
    const video = videoEl.value
    if (!video) return
    seekToFrame(clip.value?.analysis?.request?.initFrameIndex ?? points[0].frameIndex)
    video.play().then(() => { playing.value = true }).catch(() => {})
  })
})

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

  const label = '원본 ' + tf.intrinsicWidth + 'x' + tf.intrinsicHeight
    + ', 표시 ' + Math.round(tf.displayWidth) + 'x' + Math.round(tf.displayHeight)
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
  return (framePts.value?.[frameIndex.value] ?? (frameIndex.value / fps)).toFixed(3) + 's'
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
        class="btn-ghost btn-sm btn-icon"
        title="패널 비우기"
        @click="session.clearSelection()"
      ><Icon name="close" /></button>
    </div>

    <div class="panel__body">
      <RadarEmpty v-if="state === 'IDLE'">
        <p class="radar-empty__title">검출 대기</p>
        <p class="faint">왼쪽에서 <b class="clip__key">검출</b>을 누르면 그 시각 전후 구간이 여기에 뜹니다.</p>
      </RadarEmpty>

      <div v-else-if="state === 'CLIP_PENDING'" class="clip__pending">
        <p class="dim">
          구간 저장 중
          <b v-if="remainingSeconds !== null" class="mono">{{ remainingSeconds }}s</b>
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
          <AnalyzeOverlay
            v-if="state === 'ANALYZING'"
            :video-el="videoEl"
            :source-box="sourceBox"
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

        <div class="strip clip__scrub">
          <button
            class="btn-ghost btn-icon"
            :title="playing ? '일시정지' : '재생'"
            :disabled="state !== 'CLIP_READY'"
            @click="togglePlay"
          ><Icon :name="playing ? 'pause' : 'play'" /></button>
          <button
            class="btn-ghost btn-icon"
            title="이전 프레임"
            :disabled="state !== 'CLIP_READY'"
            @click="seekToFrame(frameIndex - 1)"
          ><Icon name="prev" /></button>
          <button
            class="btn-ghost btn-icon"
            title="다음 프레임"
            :disabled="state !== 'CLIP_READY'"
            @click="seekToFrame(frameIndex + 1)"
          ><Icon name="next" /></button>
          <input
            class="clip__range"
            type="range"
            :min="0"
            :max="lastFrame"
            :value="frameIndex"
            :disabled="state !== 'CLIP_READY'"
            @input="seekToFrame(Number($event.target.value))"
          />
          <span class="mono clip__frame">
            <span><b>{{ frameIndex }}</b><span class="faint"> / {{ lastFrame }}</span></span>
            <span class="faint">{{ timeLabel }} · {{ meta?.fps }}fps</span>
          </span>
        </div>

        <div class="strip clip__coords">
          <span class="faint mono">{{ scaleLabel }}</span>
          <div style="flex: 1" />
          <span v-if="sourceBox" class="mono clip__bbox">
            <span class="faint">bbox</span>
            {{ Math.round(sourceBox.x) }}, {{ Math.round(sourceBox.y) }},
            {{ Math.round(sourceBox.width) }}×{{ Math.round(sourceBox.height) }}
          </span>
          <span v-else-if="state === 'CLIP_READY'" class="dim">멈춘 화면에서 대상을 클릭하세요 (드래그로 크기 지정)</span>
        </div>

        <div class="strip clip__actions">
          <p v-if="clip?.timing?.shortenedByGap" class="clip__error-text">
            원본 영상이 끊겨 연속 구간 {{ (meta.durationMs / 1000).toFixed(1) }}초만 저장했어요.
          </p>
          <template v-if="state === 'CLIP_READY'">
            <TrackerProfileSelect v-model="trackerVariant" />
            <label class="clip__interval">
              분석 길이
              <input
                v-model.number="analysisDurationSeconds"
                type="number" min="0.1" step="0.1"
                :max="maxAnalysisSeconds.toFixed(2)"
              /> 초
              <span class="faint">frame {{ frameIndex }} ({{ timeLabel }})부터
                {{ (intervalStartSeconds + analysisDurationSeconds).toFixed(2) }}s까지</span>
            </label>
            <button class="btn-primary" :disabled="!canAnalyze" @click="requestAnalysis">
              분석 요청
            </button>
            <button v-if="sourceBox" class="btn-ghost" @click="sourceBox = null">박스 지우기</button>
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
            <div class="seg-toggle">
              <button :class="{ on: showOverlay }" @click="showOverlay = true">추적 오버레이</button>
              <button :class="{ on: !showOverlay }" @click="showOverlay = false">지정 박스</button>
            </div>
<a v-if="clip.analysis.trackSequenceUrl" :href="clip.analysis.trackSequenceUrl" download>
              TrackSequence 다운로드
            </a>
            <a v-if="clip.analysis.overlayUrl" :href="clip.analysis.overlayUrl" download>
              오버레이 다운로드
            </a>
          </template>

          <template v-else-if="state === 'ANALYSIS_FAILED'">
            <p class="clip__error-text">
              분석 실패 {{ clip.analysisError?.message || clip.analysis?.message || '' }}
            </p>
            <button @click="redraw">다시 지정</button>
          </template>
        </div>

        <AnalysisResult v-if="state === 'DONE'" :analysis="clip.analysis" @redraw="redraw" />
        <p v-if="state === 'DONE'" class="faint">사용한 추적 방식: {{ trackerLabel(clip.analysis?.request?.trackerVariant) }}</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.clip__id { font-size: 12px; }
.clip__timing { font-size: 11px; }
.clip__interval { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.clip__interval input { width: 76px; }
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
  gap: 8px;
  text-align: center;
  padding: 24px;
}
.clip__empty p, .clip__pending p { margin: 0; }
.clip__empty p:first-child { font-weight: 600; }
.clip__empty .faint { max-width: 280px; font-size: 12px; }
.clip__key { color: var(--accent-text); font-weight: 600; }

.clip__progress {
  width: min(260px, 70%);
  height: 2px;
  background: var(--border-strong);
  overflow: hidden;
}
.clip__progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width 240ms linear;
}
.clip__error-text { color: var(--danger); margin: 0; font-size: 12px; }

.clip__stage {
  position: relative;
  flex: 1;
  min-height: 160px;
  background: var(--bg-video);
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

.clip__scrub { gap: 2px; padding: 0 12px 0 6px; }
.clip__range { flex: 1; width: auto; margin: 0 10px; }
.clip__frame { font-size: 12px; white-space: nowrap; display: flex; gap: 10px; }

.clip__coords { min-height: 32px; font-size: 12px; gap: 10px; }
.clip__bbox { color: var(--accent-text); }

.clip__actions { padding: 9px 14px; flex-wrap: wrap; gap: 8px; }
.clip__actions:empty { display: none; }
.clip__actions p { margin: 0; font-size: 12px; }
.clip__analyzing { display: flex; align-items: center; gap: 10px; font-size: 12px; height: 30px; }

/* 결과 뒤 보기 전환 */
.seg-toggle { display: flex; border: 1px solid var(--border-strong); border-radius: var(--radius); overflow: hidden; }
.seg-toggle button { border: none; border-radius: 0; height: 28px; color: var(--text-dim); }
.seg-toggle button + button { border-left: 1px solid var(--border-strong); }
.seg-toggle button.on { background: var(--bg-elevated); color: var(--text); font-weight: 600; }
</style>
