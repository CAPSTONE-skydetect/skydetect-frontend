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
import Icon from './Icon.vue'
import BoxOverlay from './BoxOverlay.vue'
import AnalyzeOverlay from './AnalyzeOverlay.vue'
import OverlayPlayer from './OverlayPlayer.vue'
import AnalysisResult from './AnalysisResult.vue'
import TrackingTuning from './TrackingTuning.vue'
import { toFrameIndex, createFitTransform } from '../lib/videoGeometry.js'
import { captureThumbnail } from '../lib/videoThumbnail.js'
import { addHistory, evidenceOf } from '../lib/historyStore.js'
import { aiModel, aiBase } from '../lib/aiModel.js'
import { trackerLabel } from '../lib/trackerProfiles.js'
import { bindSelectionDismiss } from '../lib/selectionDismiss.js'
import { useEvidencePlayback } from '../composables/useEvidencePlayback.js'
import {
  uploadVideo, runManualTracking, toAnalysisDto, toProxiedUrl, trackStartSeconds,
  fetchTrajectory, pointsFromHistory, DEFAULT_TUNING,
} from '../api/ai.js'

/** 클릭만 했을 때 만드는 박스 크기. CODEX 기본값. */
const CLICK_BOX_SIZE = 32

// 영상 상태
const fileInput = ref(null)
const videoEl = ref(null)
const overlayPlayer = ref(null)
const evidenceVideo = computed(() => overlayPlayer.value?.videoEl || videoEl.value)
const evidencePlayback = useEvidencePlayback(evidenceVideo)
function playEvidenceWindow(range) {
  videoEl.value?.pause()
  evidencePlayback.play(range)
}
const objectUrl = ref(null)
const fileName = ref('')
const uploaded = ref(null)      // AI 가 돌려준 { source_video_id, video_path, metadata } + 올린 서버 model
let pickedFile = null           // 판정 모델을 바꾸면 그 서버에 다시 올려야 해서 들고 있는다
const uploading = ref(false)
const uploadError = ref(null)
const previewError = ref(false) // 브라우저가 영상을 재생하지 못함 (코덱)
const dragOver = ref(false)     // 드롭 영역 위에 파일을 끌고 있는 중

// 선택 상태
const sourceBox = ref(null)     // 원본 픽셀 {x, y, width, height}
const selectionMode = ref(false)
const selectionStage = ref(null)
const selectionButton = ref(null)
let selectionSnapshot = null
let removeSelectionDismiss = null
const selectionFrame = ref(null) // 선택을 시작한 순간 고정된 프레임
const frameIndex = ref(0)
const playing = ref(false)
const geometryVersion = ref(0)

// 추적 설정
/** 초기 객체 지정 + 추적 설정 묶음을 펼쳐 둘지. 마지막 선택을 기억한다. */
const SETUP_KEY = 'skydetect.upload.setupOpen'
const setupOpen = ref((() => {
  try { return localStorage.getItem(SETUP_KEY) !== '0' } catch { return true }
})())
watch(setupOpen, (open) => {
  try { localStorage.setItem(SETUP_KEY, open ? '1' : '0') } catch { /* 저장 불가 */ }
})
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
const canRun = computed(() => !!uploaded.value && !!sourceBox.value && !running.value && !selectionMode.value)

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

/**
 * 끌어다 놓은 파일도 선택창으로 고른 것과 같은 경로로 처리한다.
 * onFilePicked 가 event.target.files[0] 만 읽으므로 같은 모양의 객체를 넘긴다.
 */
function onDrop(event) {
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  const isVideo = file.type.startsWith('video/') || /\.(mp4|avi|mov|mkv|mpg|mpeg)$/i.test(file.name)
  if (!isVideo) {
    uploadError.value = new Error('영상 파일만 올릴 수 있습니다.')
    return
  }
  onFilePicked({ target: { files: [file] } })
}

function onDragLeave(event) {
  // 자식 요소로 옮겨 갈 때도 dragleave 가 오므로 영역 밖으로 나간 경우만 끈다.
  if (!event.currentTarget.contains(event.relatedTarget)) dragOver.value = false
}

function reset() {
  evidencePlayback.stop()
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
  removeSelectionDismiss?.()
})

// 선택 --------------------------------------------------------------------

/**
 * 객체 선택 시작. 영상을 멈추고 지금 프레임을 고정한다.
 * 이 시점의 프레임 번호가 그대로 init_frame_index 가 된다.
 */
function beginSelection() {
  if (!uploaded.value || running.value || selectionMode.value) return
  selectionSnapshot = { box: sourceBox.value ? { ...sourceBox.value } : null, frame: selectionFrame.value }
  videoEl.value?.pause()
  playing.value = false
  selectionMode.value = true
  selectionFrame.value = frameIndex.value
}

function cancelSelection() {
  if (!selectionMode.value) return
  selectionMode.value = false
  sourceBox.value = selectionSnapshot?.box ?? null
  selectionFrame.value = selectionSnapshot?.frame ?? null
  selectionSnapshot = null
  if (sourceBox.value && selectionFrame.value !== null) seekToFrame(selectionFrame.value)
}

function clearSelection() {
  sourceBox.value = null
  selectionFrame.value = null
  selectionMode.value = false
  selectionSnapshot = null
}

/** Keep the committed ROI until a replacement is confirmed. */
function reselect() {
  beginSelection()
}

function onBoxPicked(box) {
  sourceBox.value = box
  if (box) {
    selectionFrame.value = selectionFrame.value ?? frameIndex.value
    // 박스가 정해지면 선택 모드를 빠져나온다. 확대경이 계속 떠 있으면 방해된다.
    selectionMode.value = false
    selectionSnapshot = null
  }
}

const selectionHint = computed(() => {
  if (!uploaded.value) return '영상을 먼저 올리세요.'
  if (selectionMode.value) {
    return `객체 주변을 드래그하거나, 클릭하면 ${CLICK_BOX_SIZE}px 박스를 만듭니다.`
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
onMounted(() => {
  window.addEventListener('resize', onResize)
  removeSelectionDismiss = bindSelectionDismiss(window, {
    isActive: () => selectionMode.value,
    roots: () => [selectionStage.value, selectionButton.value],
    cancel: cancelSelection,
  })
})

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
  evidencePlayback.stop()
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
    const track = response.tracks?.[0] || null
    const analysis = toAnalysisDto(response.prediction, {
      elapsedMs,
      model: response.model || model,
      featureValues: response.features?.values || null,
      trackStartS: trackStartSeconds(track),
    })
    const urls = mapUrls(response.download_urls, base)

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
        ...evidenceOf(analysis),
        metrics: response.metrics || null,
        tuning: { ...request.tuning, stabilize: request.stabilize, resizeWidth: request.resizeWidth, maxSeconds: request.maxSeconds },
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
  return '원본 ' + tf.intrinsicWidth + 'x' + tf.intrinsicHeight
    + ', 표시 ' + Math.round(tf.displayWidth) + 'x' + Math.round(tf.displayHeight)
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
        tracker_variant: r.tuning.trackerVariant ?? 'd0',
        klt_accept_conf: r.tuning.kltAcceptConf,
        recovery_conf: r.tuning.recoveryConf,
        update_conf: r.tuning.updateConf,
        search_radius_multiplier: r.tuning.searchRadius,
        online_update_enabled: r.tuning.onlineUpdate,
      },
    },
    response: result.value ? {
      run_id: result.value.metadata?.run_id,
      tracker_variant: result.value.metadata?.tracker_variant,
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
    <!-- 객체 선택 중에도 두 화면 배치를 그대로 둔다. 작은 대상은 BoxOverlay 의
         돋보기로 확대해 보며 고른다. -->
    <div class="upload__top">
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
          <div style="flex: 1" />
          <span v-if="fileName" class="faint mono upload__name">{{ fileName }}</span>
          <button v-if="uploaded" class="btn-ghost btn-sm" @click="fileInput.click()">다른 영상</button>
        </div>

        <div class="panel__body">
          <div
            v-if="!objectUrl"
            class="upload__drop"
            :class="{ 'upload__drop--over': dragOver }"
            @dragenter.prevent="dragOver = true"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="onDragLeave"
            @drop.prevent="onDrop"
          >
            <Icon name="upload" :size="16" class="dim" />
            <p>영상을 끌어다 놓거나 선택하세요</p>
            <button class="btn-primary upload__pick" @click="fileInput.click()">영상 선택</button>
            <p class="dim upload__formats">mp4 · avi · mov · mkv · mpg</p>
            <p v-if="uploadError" class="upload__error">{{ uploadError.message }}</p>
          </div>

          <template v-else>
            <div ref="selectionStage" class="upload__stage">
              <video
                ref="videoEl"
                class="upload__video"
                :src="objectUrl"
                playsinline
                muted
                preload="auto"
                @loadedmetadata="onLoadedMetadata"
                @timeupdate="onTimeUpdate"
                @play="playing = true"
                @pause="playing = false"
                @ended="playing = false"
                @error="onVideoError"
              />
              <p v-if="previewError && !uploading" class="upload__error upload__preview-error">
                브라우저에서 재생할 수 없는 영상입니다 (코덱).
                H.264 mp4 로 변환해서 다시 올려 주세요.
              </p>
              <AnalyzeOverlay v-if="running" :video-el="videoEl" :source-box="sourceBox" />
              <BoxOverlay
                v-else
                :video-el="videoEl"
                :source-box="sourceBox"
                :active="selectionMode && !running"
                :click-box-size="CLICK_BOX_SIZE"
                @update:source-box="onBoxPicked"
              />
            </div>

            <div class="strip upload__scrub">
              <button
                class="btn-ghost btn-icon"
                :disabled="selectionMode"
                :aria-label="playing ? '일시정지' : '재생'"
                @click="togglePlay"
              ><Icon :name="playing ? 'pause' : 'play'" /></button>
              <button class="btn-ghost btn-icon" aria-label="이전 프레임" @click="seekToFrame(frameIndex - 1)"><Icon name="prev" /></button>
              <input
                class="upload__range" type="range"
                :min="0" :max="lastFrame" :value="frameIndex"
                @input="seekToFrame(Number($event.target.value))"
              />
              <button class="btn-ghost btn-icon" aria-label="다음 프레임" @click="seekToFrame(frameIndex + 1)"><Icon name="next" /></button>
              <span class="mono upload__frame">
                frame <b>{{ frameIndex }}</b> / {{ lastFrame }}
                <span class="faint">· {{ fps.toFixed(0) }}fps</span>
              </span>
            </div>

            <div class="strip upload__select">
              <button
                ref="selectionButton"
                class="btn-primary"
                :disabled="!uploaded || running"
                :aria-pressed="selectionMode"
                @click="selectionMode ? cancelSelection() : beginSelection()"
              >{{ selectionMode ? '선택 취소' : '객체 선택' }}</button>
              <button :disabled="!sourceBox || selectionMode || running" @click="reselect">다시 선택</button>
              <span class="faint upload__hint">{{ selectionHint }}</span>
            </div>

            <div class="strip upload__coords">
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
      <section class="panel">
        <div class="panel__head">
          <span class="panel__title">추적 오버레이</span>
          <span v-if="running" class="badge badge--warn">
            <span class="dot dot--pulse" />추적 중 {{ elapsedLabel }}
          </span>
          <span v-else-if="result" class="badge badge--ok"><span class="dot" />완료</span>
          <div style="flex: 1" />
        </div>

        <div class="panel__body">
          <div v-if="running" class="upload__waiting">
            <div class="spinner" />
            <p class="dim">추적 중 <b class="mono">{{ elapsedLabel }}</b></p>
          </div>

          <OverlayPlayer
            v-else
            ref="overlayPlayer"
            :src="objectUrl"
            :active-window="evidencePlayback.active.value"
            :has-result="!!result"
            :points="result?.points || null"
            :fps="fps"
            :frame-count="frameCount"
          />
        </div>
      </section>
    </div>

    <!-- 아래: 초기 객체 지정 + 추적 설정 + 실행 + 결과 -->
    <section class="panel upload__bottom">
      <button
        type="button"
        class="setup__toggle"
        :aria-expanded="setupOpen"
        aria-controls="upload-setup"
        @click="setupOpen = !setupOpen"
      >
        <Icon :name="setupOpen ? 'up' : 'down'" />
        <span>초기 객체 지정 · 추적 설정</span>
        <span v-if="!setupOpen && sourceBox" class="faint mono setup__summary">
          frame {{ selectionFrame ?? frameIndex }} · bbox {{ Math.round(sourceBox.width) }}×{{ Math.round(sourceBox.height) }}
        </span>
        <span class="faint setup__state">{{ setupOpen ? '접기' : '펼치기' }}</span>
      </button>

      <div v-show="setupOpen" id="upload-setup" class="setup">
      <div class="target">
        <span class="eyebrow">초기 객체 지정</span>
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
      </div>

      <div class="upload__actions">
        <button class="btn-primary upload__run" :disabled="!canRun" @click="run">ROI 추적</button>
        <span v-if="!uploaded" class="faint">영상을 먼저 올리세요</span>
        <span v-else-if="!sourceBox" class="faint">객체 선택으로 ROI 를 지정하세요</span>
        <p v-if="runError" class="upload__error">{{ runError.message }}</p>

        <div style="flex: 1" />

        <div v-if="result" class="upload__downloads">
          <a v-if="result.urls.trackSequence" :href="result.urls.trackSequence" download><Icon name="download" :size="12" />TrackSequence</a>
          <a v-if="result.urls.trajectory" :href="result.urls.trajectory" download><Icon name="download" :size="12" />Trajectory CSV</a>
          <a v-if="result.urls.metrics" :href="result.urls.metrics" download><Icon name="download" :size="12" />Metrics</a>
          <a
            v-if="result.urls.overlay" :href="result.urls.overlay" download
          ><Icon name="download" :size="12" />Overlay (mp4v)</a>
          <a v-if="result.urls.foregroundMask" :href="result.urls.foregroundMask" download><Icon name="download" :size="12" />Foreground</a>
        </div>
      </div>

      <template v-if="result">
        <p v-if="result" class="faint">사용한 추적 방식: {{ trackerLabel(result.metadata?.tracker_variant) }}</p>
        <AnalysisResult
          :analysis="result.analysis"
          :feature-reasons="result.features?.reasons"
          :can-replay="!!objectUrl && !previewError"
          :active-window="evidencePlayback.active.value"
          @play-window="playEvidenceWindow"
          @redraw="evidencePlayback.stop(); result = null"
        />
        <p v-if="evidencePlayback.active.value" class="dim" role="status">주요 구간 재생 중 · {{ evidencePlayback.active.value.start.toFixed(1) }}–{{ evidencePlayback.active.value.end.toFixed(1) }}초</p>
        <p v-if="evidencePlayback.error.value" class="upload__error" role="alert">{{ evidencePlayback.error.value }}</p>

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
      accept="video/mp4,video/x-msvideo,video/quicktime,video/x-matroska,video/mpeg,.mpg,.mpeg,video/*"
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
  gap: var(--gap);
  overflow-y: auto;
}
.upload__top {
  flex: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
  min-height: 0;
}
.upload__bottom { flex: none; }
.upload__file { display: none; }
.upload__name { font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.upload__summary { font-size: 12px; }

/* 점선 드롭 영역. 패널 안쪽 24px 에 두고, 파일을 끌어오면 테두리가 강조색이 된다. */
.upload__drop {
  flex: 1;
  margin: 20px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  transition: border-color 100ms, background 100ms;
}
.upload__drop--over { border-color: var(--accent); background: var(--accent-dim); }
.upload__drop > .icon {
  width: 44px;
  height: 44px;
  padding: 13px;
  border-radius: var(--radius);
  color: var(--text);
  background: #2a3038;
  border: 1px solid #3d4651;
}
.upload__drop > p:first-of-type { font-size: 14px; font-weight: 600; color: var(--text); }
.upload__drop p { margin: 0; }
.upload__formats { font-size: 12px; }
.upload__pick { height: 36px; padding: 0 20px; }

.upload__stage {
  position: relative;
  flex: none;
  aspect-ratio: 16 / 9;
  min-height: 0;
  background: var(--bg-video);
  overflow: hidden;
}
.upload__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* BoxOverlay 의 fit:'contain' 과 반드시 같아야 한다. */
  object-fit: contain;
  display: block;
}

.upload__scrub {
  gap: 4px;
  height: 40px;
}
.upload__top :deep(.player__stage) { flex: none; min-height: 0; aspect-ratio: 16 / 9; }
.upload__top :deep(.player__video) { position: absolute; inset: 0; }
.upload__top :deep(.player__controls) { height: 40px; }
.upload__range { flex: 1; accent-color: var(--accent); width: auto; }
.upload__frame { font-size: 12px; white-space: nowrap; }

.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.field input { padding: 6px 8px; font-size: 12px; }

.upload__select {
  flex-wrap: wrap;
  padding-top: 8px;
  padding-bottom: 8px;
}
.upload__hint { font-size: 12px; flex: 1; min-width: 200px; }

.upload__coords {
  gap: 10px;
  font-size: 12px;
  min-height: 32px;
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

.setup__toggle {
  width: 100%;
  height: 44px;
  justify-content: flex-start;
  gap: 10px;
  padding: 0 16px;
  border: none;
  border-radius: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.setup__toggle:hover:not(:disabled) { background: var(--bg-hover); border: none; }
.setup__summary { font-weight: 400; }
.setup__state { margin-left: auto; font-weight: 500; }
.target { padding: 14px 14px 0; border-top: 1px solid var(--border); }
.target__fields {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.debug { padding: 0 14px 14px; }
.debug__toggle { padding: 4px 12px; font-size: 12px; background: transparent; }
.debug__body {
  margin: 10px 0 0;
  padding: 12px;
  background: var(--bg-video);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
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
  height: 36px;
  padding: 0 22px;
}
.upload__error { color: var(--danger); font-size: 12px; margin: 0; }

.upload__downloads { display: flex; gap: 8px; flex-wrap: wrap; }
.upload__downloads a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text-dim);
  text-decoration: none;
}
.upload__downloads a:hover { color: var(--text); background: var(--bg-hover); }

.upload__metrics {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.upload__metrics dt { font-size: 12px; }
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
