<script setup>
/**
 * 업로드 분석 화면.
 *
 * 동작은 CODEX 브랜치의 A 파트 수동 ROI UI 를 따른다.
 *
 *   위 왼쪽   업로드한 원본. 객체 선택 -> 프레임 고정 -> ROI 지정
 *   위 오른쪽 추적 오버레이 재생 (궤적 + 프레임별 검출)
 *   아래      추적 설정 + 실행 + 판정/지표/다운로드
 *
 * 선택 모드가 있는 이유: ROI 는 "어느 프레임의" 어느 자리인지가 같이 정해져야
 * 한다. 아무 때나 그릴 수 있게 두면 그린 뒤 프레임을 옮겼을 때 서버로 가는
 * init_frame_index 와 박스가 서로 다른 순간을 가리킨다. 그래서 선택을 시작하는
 * 순간 프레임을 고정하고(selectionFrame), 추적은 그 값으로 보낸다.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import BoxOverlay from './BoxOverlay.vue'
import OverlayPlayer from './OverlayPlayer.vue'
import AnalysisResult from './AnalysisResult.vue'
import TrackingTuning from './TrackingTuning.vue'
import { toFrameIndex, createFitTransform } from '../lib/videoGeometry.js'
import { captureThumbnail } from '../lib/videoThumbnail.js'
import { addHistory } from '../lib/historyStore.js'
import { aiModel, aiBase } from '../lib/aiModel.js'
import {
  uploadVideo, runManualTracking, toAnalysisDto, toProxiedUrl,
  fetchTrajectory, pointsFromHistory, DEFAULT_TUNING,
} from '../api/ai.js'

/** 클릭만 했을 때 만드는 박스 크기. CODEX 기본값. */
const CLICK_BOX_SIZE = 32

// 영상 상태
const fileInput = ref(null)
const videoEl = ref(null)
const objectUrl = ref(null)
const fileName = ref('')
const uploaded = ref(null)      // AI 가 돌려준 { source_video_id, video_path, metadata } + 올린 서버 model
let pickedFile = null           // 판정 모델을 바꾸면 그 서버에 다시 올려야 해서 들고 있는다
const uploading = ref(false)
const uploadError = ref(null)
const previewError = ref(false) // 브라우저가 영상을 재생하지 못함 (코덱)

// 선택 상태
const sourceBox = ref(null)     // 원본 픽셀 {x, y, width, height}
const selectionMode = ref(false)
const selectionFrame = ref(null) // 선택을 시작한 순간 고정된 프레임
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
const result = ref(null)
const lastRequest = ref(null)
const showDebug = ref(false)

let elapsedTimer = null

const meta = computed(() => uploaded.value?.metadata || null)
const fps = computed(() => meta.value?.fps || 30)
const frameCount = computed(() => meta.value?.frame_count || 0)
const lastFrame = computed(() => Math.max(0, frameCount.value - 1))
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
    // 화면 재생은 보통 올린 파일을 그대로 쓴다. 서버에서 다시 받아올 이유가 없다.
    pickedFile = file
    const model = aiModel.value
    uploaded.value = { ...(await uploadVideo(file, undefined, aiBase(model))), model }

    // 브라우저가 재생 못 하는 코덱(MPEG-2 등)이면 AI 가 H.264 mp4 로 바꿔 둔다.
    // 추적도 그 파일로 하므로 화면도 같은 파일을 재생해야 프레임 번호가 맞는다.
    if (uploaded.value.transcoded) {
      const serverUrl = toProxiedUrl(uploaded.value.download_urls?.source_video, aiBase(model))
      if (serverUrl) {
        URL.revokeObjectURL(objectUrl.value)
        objectUrl.value = serverUrl
        previewError.value = false
      }
    }
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
  pickedFile = null
  uploadError.value = null
  previewError.value = false
  clearSelection()
  frameIndex.value = 0
  playing.value = false
  result.value = null
  runError.value = null
}

/** 재생 실패. 업로드 중이면 서버가 변환해 줄 수 있으니 결과를 기다린다. */
function onVideoError() {
  previewError.value = true
}

onBeforeUnmount(() => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  clearInterval(elapsedTimer)
  window.removeEventListener('resize', onResize)
})

// 선택 --------------------------------------------------------------------

/**
 * 객체 선택 시작. 영상을 멈추고 지금 프레임을 고정한다.
 * 이 시점의 프레임 번호가 그대로 init_frame_index 가 된다.
 */
function beginSelection() {
  if (!uploaded.value) return
  videoEl.value?.pause()
  playing.value = false
  selectionMode.value = true
  selectionFrame.value = frameIndex.value
}

function clearSelection() {
  sourceBox.value = null
  selectionFrame.value = null
  selectionMode.value = false
}

/** 다시 선택: 지우고 바로 선택 모드로 들어간다 (CODEX 와 같다). */
function reselect() {
  clearSelection()
  beginSelection()
}

function onBoxPicked(box) {
  sourceBox.value = box
  if (box) {
    selectionFrame.value = selectionFrame.value ?? frameIndex.value
    // 박스가 정해지면 선택 모드를 빠져나온다. 확대경이 계속 떠 있으면 방해된다.
    selectionMode.value = false
  }
}

const selectionHint = computed(() => {
  if (!uploaded.value) return '영상을 먼저 올리세요.'
  if (selectionMode.value) {
    return `프레임 ${selectionFrame.value} 고정. 객체 주변을 드래그하거나, `
      + `짧게 클릭하면 ${CLICK_BOX_SIZE}px 박스를 만듭니다.`
  }
  if (sourceBox.value) {
    return `frame ${selectionFrame.value} · ROI `
      + `${Math.round(sourceBox.value.width)}x${Math.round(sourceBox.value.height)} 고정`
  }
  return '영상을 멈춘 뒤 객체 선택을 누르세요.'
})

// 프레임 조작 --------------------------------------------------------------

function seekToFrame(index) {
  const video = videoEl.value
  if (!video || !fps.value) return
  const clamped = Math.min(Math.max(0, index), lastFrame.value)
  frameIndex.value = clamped
  // 프레임 i 는 [i/fps, (i+1)/fps) 구간이다. 경계로 seek 하면 i-1 이 잡힐 수 있다.
  video.currentTime = (clamped + 0.2) / fps.value
  // 선택 모드 중에 프레임을 옮기면 고정 프레임도 따라간다.
  if (selectionMode.value) selectionFrame.value = clamped
}

function seekToSeconds(seconds) {
  const video = videoEl.value
  if (!video || !Number.isFinite(seconds)) return
  video.currentTime = Math.min(Math.max(0, seconds), video.duration || seconds)
}

function onTimeUpdate() {
  const video = videoEl.value
  if (!video || !fps.value) return
  frameIndex.value = toFrameIndex(video.currentTime, fps.value, frameCount.value)
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
  // 선택 모드에서는 재생하지 않는다. 프레임이 고정돼 있어야 한다.
  if (selectionMode.value) return
  if (video.paused) { video.play(); playing.value = true }
  else { video.pause(); playing.value = false }
}

// ROI 숫자 입력. 드래그로 그린 값을 미세 조정할 수 있게 열어둔다.
const boxFields = computed(() => {
  const box = sourceBox.value
  if (!box) return { centerX: '', centerY: '', width: CLICK_BOX_SIZE, height: CLICK_BOX_SIZE }
  return {
    centerX: Math.round(box.x + box.width / 2),
    centerY: Math.round(box.y + box.height / 2),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
})

function setBoxField(key, rawValue) {
  const value = Number(rawValue)
  if (!Number.isFinite(value) || !meta.value) return

  const next = { ...boxFields.value, [key]: value }
  const width = Math.max(4, next.width || CLICK_BOX_SIZE)
  const height = Math.max(4, next.height || CLICK_BOX_SIZE)
  const frameWidth = meta.value.width
  const frameHeight = meta.value.height

  sourceBox.value = {
    x: clamp((next.centerX || 0) - width / 2, 0, Math.max(0, frameWidth - width)),
    y: clamp((next.centerY || 0) - height / 2, 0, Math.max(0, frameHeight - height)),
    width: Math.min(width, frameWidth),
    height: Math.min(height, frameHeight),
  }
  selectionFrame.value = selectionFrame.value ?? frameIndex.value
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// 실행 --------------------------------------------------------------------

async function run() {
  if (!canRun.value) return
  running.value = true
  runError.value = null
  result.value = null
  elapsed.value = 0
  selectionMode.value = false

  const startedAt = Date.now()
  elapsedTimer = setInterval(() => { elapsed.value = Date.now() - startedAt }, 500)

  // 결과가 온 뒤에는 영상이 다른 프레임에 가 있을 수 있으니 지금 찍어둔다.
  const thumbnail = captureThumbnail(videoEl.value, { box: sourceBox.value })
  // CODEX 는 반올림 없이 실수 그대로 보낸다. 같은 입력이면 같은 결과가 나와야
  // 하므로 여기서도 반올림하지 않는다.
  const bbox = [
    sourceBox.value.x,
    sourceBox.value.y,
    sourceBox.value.width,
    sourceBox.value.height,
  ]
  const initFrame = selectionFrame.value ?? frameIndex.value

  const request = {
    sourceVideoId: uploaded.value.source_video_id,
    videoPath: uploaded.value.video_path,
    initFrameIndex: initFrame,
    targetBbox: bbox,
    stabilize: options.value.stabilize,
    resizeWidth: options.value.resizeWidth,
    maxSeconds: options.value.maxSeconds,
    tuning: { ...tuning.value },
  }
  lastRequest.value = request

  try {
    // 영상 경로는 올린 서버 기준이다. 업로드 뒤에 판정 모델을 바꿨으면 그 서버에 다시 올린다.
    const model = aiModel.value
    const base = aiBase(model)
    if (uploaded.value.model !== model && pickedFile) {
      uploaded.value = { ...(await uploadVideo(pickedFile, undefined, base)), model }
      request.sourceVideoId = uploaded.value.source_video_id
      request.videoPath = uploaded.value.video_path
    }

    const response = await runManualTracking(request, base)

    const elapsedMs = Date.now() - startedAt
    const analysis = toAnalysisDto(response.prediction, {
      elapsedMs, model: response.model || model,
    })
    const urls = mapUrls(response.download_urls, base)
    const track = response.tracks?.[0] || null

    // 화면에 겹쳐 그릴 좌표는 궤적 CSV 의 raw 값을 쓴다.
    // track.history 는 카메라 움직임 보정 좌표라 실제 위치와 어긋난다.
    const points = await fetchTrajectory(urls.trajectory, {
      processedWidth: track?.processed_width,
      processedHeight: track?.processed_height,
    }).catch(() => null)

    result.value = {
      analysis,
      metrics: response.metrics || {},
      metadata: response.metadata || {},
      track,
      points: points || pointsFromHistory(track),
      features: response.features || null,
      urls,
    }

    if (analysis) {
      addHistory({
        source: 'upload',
        title: fileName.value,
        model: analysis.model,
        label: analysis.label,
        confidence: analysis.confidence,
        decisionScore: analysis.decisionScore,
        rejectReason: analysis.rejectReason,
        featureReasons: response.features?.reasons || null,
        bbox,
        initFrameIndex: initFrame,
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

function mapUrls(downloadUrls = {}, base) {
  return {
    overlay: toProxiedUrl(downloadUrls.overlay, base),
    trackSequence: toProxiedUrl(downloadUrls.track_sequence, base),
    trajectory: toProxiedUrl(downloadUrls.trajectory, base),
    metrics: toProxiedUrl(downloadUrls.metrics, base),
    foregroundMask: toProxiedUrl(downloadUrls.foreground_mask, base),
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

/** CODEX 의 결과 요약 한 줄과 같은 구성. */
const resultSummary = computed(() => {
  const r = result.value
  if (!r) return null
  const quality = r.track?.quality || {}
  return [
    `${quality.num_points ?? '-'} observed`,
    `${pct(r.metrics?.visible_ratio)} visible`,
    quality.track_stability || 'unknown',
    r.metrics?.method || 'manual_roi',
  ].join(' · ')
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

/**
 * AI 로 보낸 값과 돌아온 핵심 값을 그대로 보여준다.
 * 다른 UI 와 결과가 다를 때 어디가 다른지 여기서 바로 맞춰볼 수 있다.
 */
const debugText = computed(() => {
  const r = lastRequest.value
  if (!r) return ''
  return JSON.stringify({
    request: {
      init_frame_index: r.initFrameIndex,
      target_bbox: r.targetBbox,
      stabilize: r.stabilize,
      resize_width: r.resizeWidth,
      max_seconds: r.maxSeconds,
      tuning: {
        klt_accept_conf: r.tuning.kltAcceptConf,
        recovery_conf: r.tuning.recoveryConf,
        update_conf: r.tuning.updateConf,
        search_radius_multiplier: r.tuning.searchRadius,
        online_update_enabled: r.tuning.onlineUpdate,
      },
    },
    response: result.value ? {
      run_id: result.value.metadata?.run_id,
      init_frame_index: result.value.metadata?.init_frame_index,
      coordinate_mode: result.value.metadata?.coordinate_mode,
      label: result.value.analysis?.label,
      confidence: result.value.analysis?.confidence,
      quality: result.value.track?.quality,
      metrics: result.value.metrics,
      first_point: result.value.track?.history?.[0],
      last_point: result.value.track?.history?.at(-1),
    } : null,
  }, null, 2)
})

const elapsedLabel = computed(() => (elapsed.value / 1000).toFixed(0) + '초')
const currentSeconds = computed(() => (frameIndex.value / (fps.value || 30)).toFixed(2))

watch(objectUrl, () => { result.value = null })
</script>

<template>
  <main class="upload">
    <!-- 선택 중에는 원본을 전체 폭으로 넓힌다.
         ROI 는 원본 픽셀 단위라, 영상이 작게 보이면 화면 1px 이 원본 여러 px 을
         가리켜 클릭이 몇 px 만 빗나가도 대상에서 벗어난다. 그때 오버레이
         재생기는 볼 일이 없으므로 자리를 내준다. -->
    <div class="upload__top" :class="{ 'upload__top--focus': selectionMode }">
      <!-- 왼쪽: 원본 + ROI 지정 -->
      <section class="panel">
        <div class="panel__head">
          <span class="panel__title">원본 영상</span>
          <span v-if="uploading" class="badge badge--warn"><span class="dot dot--pulse" />업로드 중</span>
          <span v-else-if="selectionMode" class="badge badge--warn">
            <span class="dot dot--pulse" />선택 중 · frame {{ selectionFrame }}
          </span>
          <span v-else-if="sourceBox" class="badge badge--ok"><span class="dot" />ROI 지정됨</span>
          <span v-else-if="uploaded && previewError" class="badge badge--error"><span class="dot" />재생 불가</span>
          <span v-else-if="uploaded" class="badge badge--ok"><span class="dot" />준비됨</span>
          <span
            v-if="uploaded?.transcoded"
            class="badge"
            :title="`원본 코덱 ${uploaded.original_codec || '알 수 없음'} → 브라우저 재생용 H.264 로 변환`"
          >H.264 변환됨</span>
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
                @error="onVideoError"
              />
              <p v-if="previewError && !uploading" class="upload__error upload__preview-error">
                브라우저에서 재생할 수 없는 영상입니다 (코덱).
                H.264 mp4 로 변환해서 다시 올려 주세요.
              </p>
              <BoxOverlay
                :video-el="videoEl"
                :source-box="sourceBox"
                :active="selectionMode && !running"
                :click-box-size="CLICK_BOX_SIZE"
                @update:source-box="onBoxPicked"
              />
            </div>

            <div class="upload__scrub">
              <button
                class="upload__icon"
                :disabled="selectionMode"
                @click="togglePlay"
              >{{ playing ? '❚❚' : '▶' }}</button>
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

            <div class="upload__select">
              <button
                class="upload__select-btn"
                :disabled="!uploaded || selectionMode || running"
                @click="beginSelection"
              >객체 선택</button>
              <button :disabled="!sourceBox || running" @click="reselect">다시 선택</button>
              <span class="faint upload__hint">{{ selectionHint }}</span>
            </div>

            <div class="upload__coords">
              <span class="faint mono">{{ scaleLabel }}</span>
              <div style="flex: 1" />
              <span v-if="sourceBox" class="mono upload__bbox">
                bbox [{{ Math.round(sourceBox.x) }}, {{ Math.round(sourceBox.y) }},
                {{ Math.round(sourceBox.width) }}, {{ Math.round(sourceBox.height) }}]
              </span>
            </div>
          </template>
        </div>
      </section>

      <!-- 오른쪽: 추적 오버레이 재생 -->
      <section v-show="!selectionMode" class="panel">
        <div class="panel__head">
          <span class="panel__title">추적 오버레이</span>
          <span v-if="running" class="badge badge--warn">
            <span class="dot dot--pulse" />추적 중 {{ elapsedLabel }}
          </span>
          <span v-else-if="result" class="badge badge--ok"><span class="dot" />완료</span>
          <div style="flex: 1" />
          <span v-if="resultSummary" class="faint mono upload__summary">{{ resultSummary }}</span>
        </div>

        <div class="panel__body">
          <div v-if="running" class="upload__waiting">
            <div class="spinner" />
            <p class="dim">추적 중 <b class="mono">{{ elapsedLabel }}</b></p>
          </div>

          <OverlayPlayer
            v-else
            :src="objectUrl"
            :points="result?.points || null"
            :fps="fps"
            :frame-count="frameCount"
          />
        </div>
      </section>
    </div>

    <!-- 아래: 초기 객체 지정 + 추적 설정 + 실행 + 결과 -->
    <section class="panel upload__bottom">
      <div class="target">
        <span class="target__title">초기 객체 지정</span>
        <div class="target__fields">
          <label class="field">
            <span class="dim">시작 프레임</span>
            <input
              type="number" min="0" :max="lastFrame"
              :value="selectionFrame ?? frameIndex"
              :disabled="!uploaded || running"
              @change="seekToFrame(Number($event.target.value))"
            />
          </label>
          <label class="field">
            <span class="dim">현재 시간 (초)</span>
            <input
              type="number" min="0" step="0.01" :value="currentSeconds"
              :disabled="!uploaded || running"
              @change="seekToSeconds(Number($event.target.value))"
            />
          </label>
          <label class="field">
            <span class="dim">중심 X</span>
            <input
              type="number" step="1" :value="boxFields.centerX"
              :disabled="!sourceBox || running"
              @change="setBoxField('centerX', $event.target.value)"
            />
          </label>
          <label class="field">
            <span class="dim">중심 Y</span>
            <input
              type="number" step="1" :value="boxFields.centerY"
              :disabled="!sourceBox || running"
              @change="setBoxField('centerY', $event.target.value)"
            />
          </label>
          <label class="field">
            <span class="dim">bbox W</span>
            <input
              type="number" min="4" step="1" :value="boxFields.width"
              :disabled="!sourceBox || running"
              @change="setBoxField('width', $event.target.value)"
            />
          </label>
          <label class="field">
            <span class="dim">bbox H</span>
            <input
              type="number" min="4" step="1" :value="boxFields.height"
              :disabled="!sourceBox || running"
              @change="setBoxField('height', $event.target.value)"
            />
          </label>
        </div>
      </div>

      <TrackingTuning
        v-model:tuning="tuning"
        v-model:options="options"
        :disabled="running"
        layout="row"
      />

      <div class="upload__actions">
        <button class="upload__run" :disabled="!canRun" @click="run">ROI 추적</button>
        <span v-if="!uploaded" class="faint">영상을 먼저 올리세요</span>
        <span v-else-if="!sourceBox" class="faint">객체 선택으로 ROI 를 지정하세요</span>
        <p v-if="runError" class="upload__error">{{ runError.message }}</p>

        <div style="flex: 1" />

        <div v-if="result" class="upload__downloads">
          <a v-if="result.urls.trackSequence" :href="result.urls.trackSequence" download>TrackSequence</a>
          <a v-if="result.urls.trajectory" :href="result.urls.trajectory" download>Trajectory CSV</a>
          <a v-if="result.urls.metrics" :href="result.urls.metrics" download>Metrics</a>
          <a
            v-if="result.urls.overlay" :href="result.urls.overlay" download
          >Overlay (mp4v)</a>
          <a v-if="result.urls.foregroundMask" :href="result.urls.foregroundMask" download>Foreground</a>
        </div>
      </div>

      <template v-if="result">
        <AnalysisResult
          :analysis="result.analysis"
          :feature-reasons="result.features?.reasons"
          @redraw="result = null"
        />

        <dl class="upload__metrics">
          <template v-for="[name, value] in metricRows" :key="name">
            <dt class="faint">{{ name }}</dt>
            <dd class="mono">{{ value }}</dd>
          </template>
        </dl>
      </template>

      <div v-if="lastRequest" class="debug">
        <button class="debug__toggle" @click="showDebug = !showDebug">
          {{ showDebug ? '요청 원본 닫기' : '요청 원본' }}
        </button>
        <pre v-if="showDebug" class="debug__body mono">{{ debugText }}</pre>
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
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.upload__top {
  display: grid;
  /* 왼쪽(ROI 지정)이 정밀 작업이라 조금 더 넓게 준다. */
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 12px;
  /* 영상이 클수록 클릭 한 픽셀이 가리키는 원본 픽셀이 줄어 ROI 가 정확해진다. */
  min-height: 700px;
}
/* 선택 중에는 높이도 화면만큼 키운다. 가로만 넓히면 contain 때문에 세로에
   막혀 배율이 그대로다. */
.upload__top--focus {
  grid-template-columns: minmax(0, 1fr);
  min-height: 92vh;
}
.upload__bottom { flex: none; }
.upload__file { display: none; }
.upload__name { font-size: 11px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.upload__summary { font-size: 11px; }
.upload__change { padding: 3px 10px; font-size: 11px; }

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
.upload__video {
  width: 100%;
  height: 100%;
  /* BoxOverlay 의 fit:'contain' 과 반드시 같아야 한다. */
  object-fit: contain;
  display: block;
}

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

.field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.field input { padding: 6px 8px; font-size: 12px; }

.upload__select {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}
.upload__select-btn { background: var(--accent-dim); border-color: var(--accent); font-weight: 600; }
.upload__select-btn:hover:not(:disabled) { background: #2a6396; }
.upload__hint { font-size: 11px; flex: 1; min-width: 200px; }

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

.upload__waiting {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}
.upload__waiting p { margin: 0; }

.target { padding: 14px 14px 0; }
.target__title { font-weight: 600; font-size: 13px; }
.target__fields {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.debug { padding: 0 14px 14px; }
.debug__toggle { padding: 4px 12px; font-size: 11px; background: transparent; }
.debug__body {
  margin: 10px 0 0;
  padding: 12px;
  background: #05080c;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 11px;
  line-height: 1.5;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

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
  padding: 10px 22px;
}
.upload__run:hover:not(:disabled) { background: #2a6396; }
.upload__error { color: var(--danger); font-size: 12px; margin: 0; }

.upload__downloads { display: flex; gap: 8px; flex-wrap: wrap; }
.upload__downloads a {
  font-size: 11px;
  padding: 5px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text-dim);
  text-decoration: none;
}
.upload__downloads a:hover { color: var(--text); border-color: var(--accent-dim); }

.upload__metrics {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.upload__metrics dt { font-size: 11px; }
.upload__metrics dd { margin: 0; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 1300px) {
  .upload__metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 1100px) {
  .upload__top { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .upload__top > * { min-height: 420px; }
  .target__fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.upload__preview-error {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: 80%;
  text-align: center;
}
</style>
