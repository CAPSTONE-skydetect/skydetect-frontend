<script setup>
/**
 * 업로드 분석 화면.
 *
 * 실시간 화면과 구조는 같다 (왼쪽 영상 / 오른쪽 분석). 다른 점은 영상의 출처다.
 * 라이브에서 잘라낸 클립 대신 사용자가 올린 파일을 A 파트 파이프라인에 그대로
 * 태우고, 오른쪽에 추적 오버레이 영상을 받아 띄운다.
 *
 *   왼쪽  업로드한 원본. 프레임을 고르고 ROI 박스를 그린다
 *   오른쪽 추적 설정 → 실행 → 오버레이 + 판정
 *
 * 백엔드를 거치지 않고 AI(8000)를 직접 부른다. 개발/검증용 화면이라 그렇다.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import BoxOverlay from './BoxOverlay.vue'
import AnalysisResult from './AnalysisResult.vue'
import TrackingTuning from './TrackingTuning.vue'
import TrackOverlay from './TrackOverlay.vue'
import { toFrameIndex, createFitTransform } from '../lib/videoGeometry.js'
import { captureThumbnail } from '../lib/videoThumbnail.js'
import { addHistory } from '../lib/historyStore.js'
import {
  uploadVideo, runManualTracking, toAnalysisDto, toProxiedUrl, DEFAULT_TUNING,
} from '../api/ai.js'

// 영상 상태
const fileInput = ref(null)
const videoEl = ref(null)
const resultVideoEl = ref(null)
const objectUrl = ref(null)
const fileName = ref('')
const uploaded = ref(null)      // AI 가 돌려준 { source_video_id, video_path, metadata }
const uploading = ref(false)
const uploadError = ref(null)

// 선택 상태
const sourceBox = ref(null)     // 원본 픽셀 {x, y, width, height}
const frameIndex = ref(0)
const playing = ref(false)
const geometryVersion = ref(0)

// 추적 설정
const tuning = ref({ ...DEFAULT_TUNING })
const options = ref({ stabilize: true, resizeWidth: 1280, maxSeconds: 10 })

// 실행 상태
const running = ref(false)
const runError = ref(null)
const elapsed = ref(0)
const result = ref(null)        // { analysis, metrics, urls, metadata, track }

let elapsedTimer = null

const meta = computed(() => uploaded.value?.metadata || null)
const fps = computed(() => meta.value?.fps || 30)
const lastFrame = computed(() => Math.max(0, (meta.value?.frame_count || 1) - 1))
const canRun = computed(() => !!uploaded.value && !!sourceBox.value && !running.value)

// 업로드 ------------------------------------------------------------------

async function onFilePicked(event) {
  const file = event.target.files?.[0]
  if (!file) return

  reset()
  fileName.value = file.name
  objectUrl.value = URL.createObjectURL(file)
  uploading.value = true

  try {
    // AI 는 서버 안의 파일 경로로만 작업하므로 먼저 올려야 한다.
    // 왼쪽 재생은 올린 파일을 그대로 쓴다. 서버에서 다시 받아올 이유가 없다.
    uploaded.value = await uploadVideo(file)
  } catch (error) {
    uploadError.value = error
  } finally {
    uploading.value = false
  }
}

function reset() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = null
  uploaded.value = null
  uploadError.value = null
  sourceBox.value = null
  frameIndex.value = 0
  playing.value = false
  result.value = null
  runError.value = null
}

onBeforeUnmount(() => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  clearInterval(elapsedTimer)
  window.removeEventListener('resize', onResize)
})

// 프레임 조작 --------------------------------------------------------------

function seekToFrame(index) {
  const video = videoEl.value
  if (!video || !fps.value) return
  const clamped = Math.min(Math.max(0, index), lastFrame.value)
  frameIndex.value = clamped
  // 프레임 i 는 [i/fps, (i+1)/fps) 구간이다. 경계로 seek 하면 i-1 이 잡힐 수 있다.
  video.currentTime = (clamped + 0.2) / fps.value
}

function onTimeUpdate() {
  const video = videoEl.value
  if (!video || !fps.value) return
  frameIndex.value = toFrameIndex(video.currentTime, fps.value, meta.value?.frame_count)
}

function onLoadedMetadata() {
  geometryVersion.value += 1
  seekToFrame(0)
}

function onResize() { geometryVersion.value += 1 }
onMounted(() => window.addEventListener('resize', onResize))

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  if (video.paused) { video.play(); playing.value = true }
  else { video.pause(); playing.value = false }
}

function pauseForDrawing() {
  const video = videoEl.value
  if (video && !video.paused) { video.pause(); playing.value = false }
}

// bbox 숫자 입력. 드래그로 그린 값을 미세 조정할 수 있게 열어둔다.
const boxFields = computed(() => {
  const box = sourceBox.value
  if (!box) return { centerX: '', centerY: '', width: '', height: '' }
  return {
    centerX: Math.round(box.x + box.width / 2),
    centerY: Math.round(box.y + box.height / 2),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
})

function setBoxField(key, rawValue) {
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return
  const current = boxFields.value
  const next = { ...current, [key]: value }
  const width = Math.max(4, next.width || 4)
  const height = Math.max(4, next.height || 4)
  sourceBox.value = {
    x: (next.centerX || 0) - width / 2,
    y: (next.centerY || 0) - height / 2,
    width,
    height,
  }
}

// 실행 --------------------------------------------------------------------

async function run() {
  if (!canRun.value) return
  running.value = true
  runError.value = null
  result.value = null
  elapsed.value = 0

  const startedAt = Date.now()
  elapsedTimer = setInterval(() => { elapsed.value = Date.now() - startedAt }, 500)

  // 결과가 온 뒤에는 영상이 다른 프레임에 가 있을 수 있으니 지금 찍어둔다.
  const thumbnail = captureThumbnail(videoEl.value, { box: sourceBox.value })
  const bbox = [
    Math.round(sourceBox.value.x),
    Math.round(sourceBox.value.y),
    Math.round(sourceBox.value.width),
    Math.round(sourceBox.value.height),
  ]

  try {
    const response = await runManualTracking({
      sourceVideoId: uploaded.value.source_video_id,
      videoPath: uploaded.value.video_path,
      initFrameIndex: frameIndex.value,
      targetBbox: bbox,
      stabilize: options.value.stabilize,
      resizeWidth: options.value.resizeWidth,
      maxSeconds: options.value.maxSeconds,
      tuning: tuning.value,
    })

    const elapsedMs = Date.now() - startedAt
    const analysis = toAnalysisDto(response.prediction, { elapsedMs })
    const urls = mapUrls(response.download_urls)

    result.value = {
      analysis,
      metrics: response.metrics || {},
      metadata: response.metadata || {},
      track: response.tracks?.[0] || null,
      features: response.features || null,
      urls,
    }

    if (analysis) {
      addHistory({
        source: 'upload',
        title: fileName.value,
        label: analysis.label,
        confidence: analysis.confidence,
        rejectReason: analysis.rejectReason,
        bbox,
        initFrameIndex: frameIndex.value,
        quality: analysis.quality,
        topFeatures: analysis.topFeatures,
        metrics: response.metrics || null,
        tuning: { ...tuning.value, ...options.value },
        processingTimeMs: elapsedMs,
        thumbnail,
        overlayUrl: urls.overlay,
      })
    }
  } catch (error) {
    runError.value = error
  } finally {
    clearInterval(elapsedTimer)
    running.value = false
  }
}

function mapUrls(downloadUrls = {}) {
  return {
    overlay: toProxiedUrl(downloadUrls.overlay),
    trackSequence: toProxiedUrl(downloadUrls.track_sequence),
    trajectory: toProxiedUrl(downloadUrls.trajectory),
    metrics: toProxiedUrl(downloadUrls.metrics),
    foregroundMask: toProxiedUrl(downloadUrls.foreground_mask),
  }
}

// 표시용 ------------------------------------------------------------------

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
  return tf.intrinsicWidth + 'x' + tf.intrinsicHeight
    + ' → ' + Math.round(tf.displayWidth) + 'x' + Math.round(tf.displayHeight)
    + ' (' + tf.scale.toFixed(3) + 'x)'
})

const metricRows = computed(() => {
  const r = result.value
  if (!r) return []
  const quality = r.track?.quality || {}
  const counts = r.metrics?.tracking_source_counts || {}
  return [
    ['추적 프레임', quality.num_points ?? '-'],
    ['평균 conf', fmt(quality.mean_conf)],
    ['누락 비율', pct(quality.missing_ratio)],
    ['가시 비율', pct(r.metrics?.visible_ratio)],
    ['KLT', counts.klt ?? '-'],
    ['외형 매칭', counts.appearance ?? '-'],
    ['움직임 복구', counts.motion ?? '-'],
    ['보정 방식', r.metrics?.method || '-'],
  ]
})

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '-'
}
function pct(value) {
  return Number.isFinite(value) ? Math.round(value * 100) + '%' : '-'
}

const elapsedLabel = computed(() => (elapsed.value / 1000).toFixed(0) + '초')

// 영상이 바뀌면 이전 결과는 의미가 없다.
watch(objectUrl, () => { result.value = null })
</script>

<template>
  <main class="upload">
    <!-- 왼쪽: 원본 -->
    <section class="panel">
      <div class="panel__head">
        <span class="panel__title">원본 영상</span>
        <span v-if="uploading" class="badge badge--warn"><span class="dot dot--pulse" />업로드 중</span>
        <span v-else-if="uploaded" class="badge badge--ok"><span class="dot" />준비됨</span>
        <div style="flex: 1" />
        <span v-if="fileName" class="faint mono upload__name">{{ fileName }}</span>
        <button v-if="uploaded" class="upload__change" @click="fileInput.click()">다른 영상</button>
      </div>

      <div class="panel__body">
        <div v-if="!objectUrl" class="upload__drop">
          <p class="dim">분석할 영상을 선택하세요</p>
          <button class="upload__pick" @click="fileInput.click()">영상 선택</button>
          <p class="faint">mp4 · avi · mov · mkv</p>
          <p v-if="uploadError" class="upload__error">{{ uploadError.message }}</p>
        </div>

        <template v-else>
          <div class="upload__stage">
            <video
              ref="videoEl"
              class="upload__video"
              :src="objectUrl"
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
              :disabled="!uploaded || running"
              @update:source-box="sourceBox = $event"
              @draw-start="pauseForDrawing"
            />
          </div>

          <div class="upload__scrub">
            <button class="upload__icon" @click="togglePlay">{{ playing ? '❚❚' : '▶' }}</button>
            <button class="upload__icon" @click="seekToFrame(frameIndex - 1)">◀</button>
            <input
              class="upload__range" type="range"
              :min="0" :max="lastFrame" :value="frameIndex"
              @input="seekToFrame(Number($event.target.value))"
            />
            <button class="upload__icon" @click="seekToFrame(frameIndex + 1)">▶</button>
            <span class="mono upload__frame">
              frame <b>{{ frameIndex }}</b> / {{ lastFrame }}
              <span class="faint">· {{ fps.toFixed(0) }}fps</span>
            </span>
          </div>

          <!-- ROI 숫자 입력. 드래그로 그린 값을 미세 조정한다. -->
          <div class="upload__roi">
            <label class="field">
              <span class="dim">시작 프레임</span>
              <input
                type="number" min="0" :max="lastFrame" :value="frameIndex"
                @input="seekToFrame(Number($event.target.value))"
              />
            </label>
            <label class="field">
              <span class="dim">중심 X</span>
              <input
                type="number" step="1" :value="boxFields.centerX" :disabled="!sourceBox"
                @input="setBoxField('centerX', $event.target.value)"
              />
            </label>
            <label class="field">
              <span class="dim">중심 Y</span>
              <input
                type="number" step="1" :value="boxFields.centerY" :disabled="!sourceBox"
                @input="setBoxField('centerY', $event.target.value)"
              />
            </label>
            <label class="field">
              <span class="dim">bbox W</span>
              <input
                type="number" min="4" step="1" :value="boxFields.width" :disabled="!sourceBox"
                @input="setBoxField('width', $event.target.value)"
              />
            </label>
            <label class="field">
              <span class="dim">bbox H</span>
              <input
                type="number" min="4" step="1" :value="boxFields.height" :disabled="!sourceBox"
                @input="setBoxField('height', $event.target.value)"
              />
            </label>
          </div>

          <div class="upload__coords">
            <span class="faint mono">{{ scaleLabel }}</span>
            <div style="flex: 1" />
            <span v-if="sourceBox" class="mono upload__bbox">
              bbox [{{ boxFields.centerX - Math.round(boxFields.width / 2) }},
              {{ boxFields.centerY - Math.round(boxFields.height / 2) }},
              {{ boxFields.width }}, {{ boxFields.height }}]
            </span>
            <span v-else class="faint">영상을 멈추고 비행체 주변을 드래그하세요</span>
          </div>
        </template>
      </div>
    </section>

    <!-- 오른쪽: 분석 -->
    <section class="panel">
      <div class="panel__head">
        <span class="panel__title">분석</span>
        <span v-if="running" class="badge badge--warn">
          <span class="dot dot--pulse" />추적 중 {{ elapsedLabel }}
        </span>
        <span v-else-if="result" class="badge badge--ok"><span class="dot" />완료</span>
        <div style="flex: 1" />
        <span class="faint mono upload__engine">AI 8000</span>
      </div>

      <div class="panel__body upload__right">
        <!-- 결과가 없으면 설정, 있으면 오버레이가 위로 온다 -->
        <template v-if="result">
          <!-- A 파트 추적 오버레이.
               AI 가 만든 overlay.mp4 는 OpenCV 'mp4v'(MPEG-4 Part 2)라 브라우저가
               디코딩하지 못한다. 그래서 원본 위에 TrackSequence 를 직접 그린다.
               overlay.mp4 는 아래 다운로드로 남겨둔다. -->
          <div class="upload__stage upload__stage--overlay">
            <video
              ref="resultVideoEl"
              class="upload__video"
              :src="objectUrl"
              controls playsinline loop muted
            />
            <TrackOverlay
              v-if="result.track"
              :video-el="resultVideoEl"
              :track="result.track"
              :fps="fps"
            />
          </div>
          <p class="faint upload__note">
            추적 결과를 원본 위에 그린 것이다. 초록 박스가 프레임별 검출,
            파란 선이 궤적이다.
          </p>

          <AnalysisResult :analysis="result.analysis" @redraw="result = null" />

          <dl class="upload__metrics">
            <template v-for="[name, value] in metricRows" :key="name">
              <dt class="faint">{{ name }}</dt>
              <dd class="mono">{{ value }}</dd>
            </template>
          </dl>

          <div class="upload__downloads">
            <a v-if="result.urls.trackSequence" :href="result.urls.trackSequence" download>TrackSequence</a>
            <a v-if="result.urls.trajectory" :href="result.urls.trajectory" download>Trajectory CSV</a>
            <a v-if="result.urls.metrics" :href="result.urls.metrics" download>Metrics</a>
            <a v-if="result.urls.overlay" :href="result.urls.overlay" download title="OpenCV mp4v 코덱이라 브라우저에서는 재생되지 않는다">Overlay (mp4v)</a>
            <a v-if="result.urls.foregroundMask" :href="result.urls.foregroundMask" download>Foreground</a>
          </div>
        </template>

        <div v-else-if="running" class="upload__waiting">
          <div class="spinner" />
          <p class="dim">추적 중 <b class="mono">{{ elapsedLabel }}</b></p>
          <p class="faint">프레임 수와 해상도에 따라 수 분이 걸립니다.</p>
        </div>

        <TrackingTuning
          v-if="!result"
          v-model:tuning="tuning"
          v-model:options="options"
          :disabled="running"
        />

        <div v-if="!result" class="upload__actions">
          <button class="upload__run" :disabled="!canRun" @click="run">ROI 추적</button>
          <span v-if="!uploaded" class="faint">영상을 먼저 올리세요</span>
          <span v-else-if="!sourceBox" class="faint">왼쪽에서 박스를 그리세요</span>
          <p v-if="runError" class="upload__error">{{ runError.message }}</p>
        </div>
      </div>
    </section>

    <input
      ref="fileInput"
      class="upload__file"
      type="file"
      accept="video/mp4,video/x-msvideo,video/quicktime,video/x-matroska,video/*"
      @change="onFilePicked"
    />
  </main>
</template>

<style scoped>
.upload {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.upload__file { display: none; }
.upload__name { font-size: 11px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.upload__change { padding: 3px 10px; font-size: 11px; }
.upload__engine { font-size: 11px; }

.upload__drop {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}
.upload__drop p { margin: 0; }
.upload__pick { background: var(--accent-dim); border-color: var(--accent); font-weight: 600; }

.upload__stage {
  position: relative;
  flex: 1;
  min-height: 180px;
  background: #05080c;
  overflow: hidden;
}
.upload__stage--overlay { flex: none; height: 300px; }
.upload__video {
  width: 100%;
  height: 100%;
  /* BoxOverlay 의 fit:'contain' 과 반드시 같아야 한다. */
  object-fit: contain;
  display: block;
}
.upload__nooverlay { display: grid; place-items: center; height: 100%; margin: 0; }
.upload__note { margin: 0; padding: 8px 14px; font-size: 11px; }

.upload__scrub {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
}
.upload__icon { padding: 4px 10px; min-width: 34px; }
.upload__range { flex: 1; accent-color: var(--accent); width: auto; }
.upload__frame { font-size: 12px; white-space: nowrap; }

.upload__roi {
  flex: none;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}
.field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.field input { padding: 6px 8px; font-size: 12px; }

.upload__coords {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12px;
  border-top: 1px solid var(--border);
  min-height: 30px;
}
.upload__bbox { color: var(--accent); }

.upload__right { overflow-y: auto; }

.upload__waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 16px;
  text-align: center;
}
.upload__waiting p { margin: 0; }

.upload__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}
.upload__run {
  background: var(--accent-dim);
  border-color: var(--accent);
  font-weight: 600;
  padding: 10px 20px;
}
.upload__run:hover:not(:disabled) { background: #2a6396; }
.upload__error { color: var(--danger); font-size: 12px; margin: 0; width: 100%; }

.upload__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.upload__metrics dt { font-size: 11px; }
.upload__metrics dd { margin: 0; }

.upload__downloads {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 14px 14px;
}
.upload__downloads a {
  font-size: 11px;
  padding: 5px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text-dim);
  text-decoration: none;
}
.upload__downloads a:hover { color: var(--text); border-color: var(--accent-dim); }

@media (max-width: 1100px) {
  .upload { grid-template-columns: minmax(0, 1fr); grid-auto-rows: min-content; }
  .upload > * { min-height: 360px; }
  .upload__roi { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
