<script setup>
/**
 * 오른쪽 패널 — 잘라낸 클립.
 *
 * 왼쪽과 달리 여기는 **멈춰 있다.** 사용자가 프레임을 고르고, 박스를 그리고,
 * 분석을 요청한다. 화면 다섯 상태가 그대로 이 컴포넌트의 분기다.
 *
 *   IDLE          아직 트리거 전 (또는 패널을 비운 상태)
 *   CLIP_PENDING  +10초가 아직 안 지났다. 남은 시간을 보여준다
 *   CLIP_READY    정지 화면. 프레임 선택 + 박스 지정 가능
 *   ANALYZING     AI 파이프라인 대기
 *   DONE          결과 표시
 *   (+ CLIP_FAILED / ANALYSIS_FAILED)
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import BoxOverlay from './BoxOverlay.vue'
import AnalysisResult from './AnalysisResult.vue'
import { toFrameIndex, createFitTransform } from '../lib/videoGeometry.js'

const props = defineProps({
  session: { type: Object, required: true },
})

const videoEl = ref(null)
const sourceBox = ref(null)     // 원본 픽셀 좌표 {x, y, width, height}
const frameIndex = ref(0)
const playing = ref(false)
const now = ref(Date.now())     // 남은 시간 표시를 갱신하기 위한 시계
const requestError = ref(null)
/**
 * video.videoWidth / clientWidth 는 DOM 속성이라 바뀌어도 Vue 가 모른다.
 * 메타데이터 로드와 창 크기 변경 때 이 값을 올려서 computed 를 다시 돌린다.
 */
const geometryVersion = ref(0)

const clip = computed(() => props.session.selectedClip.value)
const state = computed(() => props.session.screenState.value)
const meta = computed(() => clip.value?.meta || null)

/** 클립이 바뀌면 그려둔 박스와 프레임 위치를 반드시 버린다. */
watch(() => clip.value?.clipId, () => {
  sourceBox.value = null
  frameIndex.value = 0
  playing.value = false
  requestError.value = null
})

// --- 남은 시간 (CLIP_PENDING) -------------------------------------------------

const ticker = setInterval(() => { now.value = Date.now() }, 250)
onBeforeUnmount(() => clearInterval(ticker))

/**
 * 클립이 준비되기까지 남은 초.
 * readyAt 은 서버가 준 값이다. 클라이언트에서 10초를 직접 세면 시계가 틀어진다.
 */
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

// --- 프레임 조작 --------------------------------------------------------------

const lastFrame = computed(() => Math.max(0, (meta.value?.frameCount || 1) - 1))

/**
 * 프레임 번호 → 재생 위치.
 *
 * 프레임 i 는 [i/fps, (i+1)/fps) 구간을 차지한다. 정확히 i/fps 로 seek 하면
 * 브라우저 반올림 때문에 i-1 프레임이 잡히는 일이 있어서 구간 안쪽을 노린다.
 * 0.2 를 더한 이유: 뒤에서 Math.round(currentTime * fps) 로 되돌릴 때 i 가 나온다.
 */
function seekToFrame(index) {
  const video = videoEl.value
  const fps = meta.value?.fps
  if (!video || !fps) return
  const clamped = Math.min(Math.max(0, index), lastFrame.value)
  frameIndex.value = clamped
  video.currentTime = (clamped + 0.2) / fps
}

/** 메타데이터가 로드돼야 videoWidth 가 채워진다. 그 전에는 0 이라 계산이 무의미하다. */
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
  // 명세대로 Math.round 를 쓴다 (lib/videoGeometry.toFrameIndex).
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

/** 박스를 그리기 시작하면 무조건 멈춘다. 움직이는 화면에 박스를 그릴 수는 없다. */
function pauseForDrawing() {
  const video = videoEl.value
  if (video && !video.paused) {
    video.pause()
    playing.value = false
  }
}

// --- 분석 요청 ----------------------------------------------------------------

const canAnalyze = computed(() => state.value === 'CLIP_READY' && !!sourceBox.value)

async function requestAnalysis() {
  if (!canAnalyze.value) return
  requestError.value = null

  const box = sourceBox.value
  const payload = {
    initFrameIndex: frameIndex.value,
    // [x, y, w, h] 원본 픽셀. 정수로 보낸다 — 픽셀 인덱스에 소수점은 의미가 없다.
    targetBbox: [
      Math.round(box.x),
      Math.round(box.y),
      Math.round(box.width),
      Math.round(box.height),
    ],
  }

  try {
    await props.session.requestAnalysis(clip.value.clipId, payload)
  } catch (error) {
    requestError.value = error
  }
}

function redraw() {
  props.session.resetAnalysis(clip.value.clipId)
  sourceBox.value = null
}

// --- 표시용 --------------------------------------------------------------------

const STATE_LABEL = {
  IDLE: '대기',
  CLIP_PENDING: '구간 저장 중',
  CLIP_READY: '박스 지정',
  ANALYZING: '분석 중',
  DONE: '결과',
  CLIP_FAILED: '클립 실패',
  ANALYSIS_FAILED: '분석 실패',
}

/**
 * 화면 배율 표시. 1920 영상이 700px 폭으로 보이면 0.36x 로 뜬다.
 *
 * clientWidth / videoWidth 로 계산하면 안 된다. object-fit: contain 에서는
 * 가로가 아니라 **세로가 한계**일 수 있고(패널이 납작할 때), 그러면 실제 배율은
 * 훨씬 작다. BoxOverlay 가 쓰는 것과 같은 계산(createFitTransform)을 써야
 * 화면에 뜨는 숫자와 실제 변환이 일치한다.
 */
const scaleLabel = computed(() => {
  geometryVersion.value // 의존성 등록용 (아래는 DOM 속성이라 스스로 반응하지 않는다)
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
    + ' → 표시 ' + Math.round(tf.displayWidth) + 'x' + Math.round(tf.displayHeight)
    + ' (' + tf.scale.toFixed(3) + 'x)'
  // 레터박스 여백이 있으면 같이 보여준다. 좌표가 어긋날 때 제일 먼저 의심할 값이다.
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
      <!-- IDLE -------------------------------------------------------------- -->
      <div v-if="state === 'IDLE'" class="clip__empty">
        <p class="dim">왼쪽에서 <b>검출 트리거</b>를 누르면 여기에 잘라낸 구간이 뜬다.</p>
        <p class="faint">라이브는 계속 흐르고, 이 패널만 정지 화면으로 멈춘다.</p>
      </div>

      <!-- CLIP_PENDING ------------------------------------------------------ -->
      <div v-else-if="state === 'CLIP_PENDING'" class="clip__pending">
        <div class="spinner clip__pending-spinner" />
        <h3>구간 저장 중…</h3>
        <p class="dim">
          트리거 +10초까지가 아직 지나지 않았다.
          <template v-if="remainingSeconds !== null">
            남은 시간 <b class="mono">{{ remainingSeconds }}초</b>
          </template>
        </p>
        <div class="clip__progress">
          <div class="clip__progress-bar" :style="pendingBarStyle" />
        </div>
        <p class="faint">기다리는 동안에도 라이브는 흐르고, 트리거를 또 누를 수 있다.</p>
      </div>

      <!-- CLIP_FAILED ------------------------------------------------------- -->
      <div v-else-if="state === 'CLIP_FAILED'" class="clip__empty">
        <p class="clip__error-text">구간을 잘라내지 못했다.</p>
        <p class="faint">{{ clip.error?.message || '서버가 FAILED 를 반환했다.' }}</p>
        <button @click="session.dismiss(clip.clipId)">닫기</button>
      </div>

      <!-- READY / ANALYZING / DONE ------------------------------------------ -->
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
          <BoxOverlay
            :video-el="videoEl"
            :source-box="sourceBox"
            :disabled="state !== 'CLIP_READY'"
            @update:source-box="sourceBox = $event"
            @draw-start="pauseForDrawing"
          />
        </div>

        <!-- 프레임 조작 -->
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

        <!-- 좌표 검증 정보 -->
        <div class="clip__coords">
          <span class="faint mono">{{ scaleLabel }}</span>
          <div style="flex: 1" />
          <span v-if="sourceBox" class="mono clip__bbox">
            targetBbox [{{ Math.round(sourceBox.x) }}, {{ Math.round(sourceBox.y) }},
            {{ Math.round(sourceBox.width) }}, {{ Math.round(sourceBox.height) }}]
          </span>
          <span v-else class="faint">영상 위를 드래그해 대상에 박스를 그려라</span>
        </div>

        <!-- 액션 -->
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
              <span>
                AI 분석 중…
                <span class="faint mono">{{ clip.analysis.status }}</span>
              </span>
            </div>
            <p class="faint">추적 → 특징추출 → 분류. 수 초에서 수십 초 걸린다.</p>
          </template>

          <template v-else-if="state === 'ANALYSIS_FAILED'">
            <p class="clip__error-text">
              분석에 실패했다. {{ clip.analysisError?.message || '' }}
            </p>
            <button @click="redraw">다시 지정</button>
          </template>
        </div>

        <!-- DONE -->
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
  gap: 10px;
  text-align: center;
  padding: 24px;
}
.clip__pending h3 { margin: 0; font-size: 16px; font-weight: 600; }
.clip__pending p { margin: 0; }
.clip__pending-spinner { width: 28px; height: 28px; }
.clip__progress {
  width: min(320px, 80%);
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
