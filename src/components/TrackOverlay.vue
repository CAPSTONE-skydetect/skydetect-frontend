<script setup>
/**
 * A 파트 추적 결과를 영상 위에 그리는 오버레이.
 *
 * 왜 AI 가 준 overlay.mp4 를 안 쓰는가:
 *   AI 는 OpenCV VideoWriter 의 'mp4v' fourcc 로 오버레이를 쓴다
 *   (`ai_server/services/tracking_video_io.py`). 그러면 MPEG-4 Part 2 가 되는데
 *   브라우저는 이 코덱을 디코딩하지 못한다. H.264(avc1) 만 재생된다.
 *   실제로 붙여보니 readyState 가 0 에서 안 올라갔다.
 *
 * 그래서 TrackSequence 를 받아 캔버스로 직접 그린다. 오히려 낫다.
 *   - 원본 해상도 그대로 본다 (overlay.mp4 는 처리 해상도 1280 으로 줄어 있다)
 *   - 프레임을 앞뒤로 돌려가며 볼 수 있다
 *   - 궤적을 같이 그릴 수 있다
 * overlay.mp4 는 다운로드 링크로 남겨둔다.
 *
 * 좌표: TrackPoint 의 cx/cy/w/h 는 processed_width/height 기준 0~1 정규화다.
 * 비율이라 원본 해상도에 그대로 곱하면 된다 (processed 는 원본의 등비 축소).
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { createFitTransform, rectToDisplay } from '../lib/videoGeometry.js'

const props = defineProps({
  videoEl: { type: Object, default: null },
  /** AI 의 TrackSequence. { history: [{frame_index, cx, cy, w, h, conf}], ... } */
  track: { type: Object, default: null },
  fps: { type: Number, default: 30 },
  /** 지나온 궤적을 같이 그릴지 */
  showTrail: { type: Boolean, default: true },
})

const canvasEl = ref(null)

let frameByIndex = new Map()
let orderedPoints = []
let rafId = null
let resizeObserver = null

/** frame_index 로 바로 찾을 수 있게 미리 펼쳐둔다. 프레임마다 훑으면 느리다. */
function indexTrack() {
  frameByIndex = new Map()
  orderedPoints = props.track?.history || []
  orderedPoints.forEach((point) => frameByIndex.set(point.frame_index, point))
}

function currentFrame() {
  const video = props.videoEl
  if (!video || !props.fps) return 0
  return Math.round(video.currentTime * props.fps)
}

function render() {
  const canvas = canvasEl.value
  const video = props.videoEl
  if (!canvas || !video) return

  const dpr = window.devicePixelRatio || 1
  const width = video.clientWidth
  const height = video.clientHeight
  if (!width || !height) return

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const tf = createFitTransform({
    intrinsicWidth: video.videoWidth,
    intrinsicHeight: video.videoHeight,
    boxWidth: width,
    boxHeight: height,
    fit: 'contain',
  })
  if (!tf || !orderedPoints.length) return

  const frame = currentFrame()

  if (props.showTrail) drawTrail(ctx, tf, frame)

  const point = frameByIndex.get(frame)
  if (point) drawBox(ctx, tf, point)
  else drawLost(ctx, tf)
}

/** 지금까지 지나온 중심점을 이어 그린다. 궤적이 보이면 판정이 납득된다. */
function drawTrail(ctx, tf, frame) {
  ctx.strokeStyle = 'rgba(77,163,255,0.55)'
  ctx.lineWidth = 1.5
  ctx.beginPath()

  let started = false
  for (const point of orderedPoints) {
    if (point.frame_index > frame) break
    const x = point.cx * tf.intrinsicWidth * tf.scale + tf.offsetX
    const y = point.cy * tf.intrinsicHeight * tf.scale + tf.offsetY
    if (started) ctx.lineTo(x, y)
    else { ctx.moveTo(x, y); started = true }
  }
  if (started) ctx.stroke()
}

function drawBox(ctx, tf, point) {
  const sourceRect = {
    x: (point.cx - point.w / 2) * tf.intrinsicWidth,
    y: (point.cy - point.h / 2) * tf.intrinsicHeight,
    width: point.w * tf.intrinsicWidth,
    height: point.h * tf.intrinsicHeight,
  }
  const box = rectToDisplay(tf, sourceRect)

  // 너무 작으면 보이지 않으니 최소 크기를 준다.
  const drawWidth = Math.max(box.width, 10)
  const drawHeight = Math.max(box.height, 10)
  const drawX = box.x - (drawWidth - box.width) / 2
  const drawY = box.y - (drawHeight - box.height) / 2

  ctx.strokeStyle = '#4ade80'
  ctx.lineWidth = 2
  ctx.strokeRect(drawX, drawY, drawWidth, drawHeight)

  const text = `f${point.frame_index} · ${point.conf.toFixed(2)}`
  ctx.font = '11px ui-monospace, Consolas, monospace'
  const padding = 5
  const labelWidth = ctx.measureText(text).width + padding * 2
  const labelY = drawY - 19 < 0 ? drawY + drawHeight + 3 : drawY - 19

  ctx.fillStyle = 'rgba(13,17,23,0.85)'
  ctx.fillRect(drawX, labelY, labelWidth, 17)
  ctx.fillStyle = '#4ade80'
  ctx.fillText(text, drawX + padding, labelY + 12)
}

/** 그 프레임에 관측이 없는 경우. 추적이 끊긴 구간이라는 걸 알려준다. */
function drawLost(ctx, tf) {
  const text = 'LOST'
  ctx.font = '11px ui-monospace, Consolas, monospace'
  ctx.fillStyle = 'rgba(13,17,23,0.85)'
  ctx.fillRect(tf.offsetX + 8, tf.offsetY + 8, ctx.measureText(text).width + 12, 17)
  ctx.fillStyle = '#fbbf24'
  ctx.fillText(text, tf.offsetX + 14, tf.offsetY + 20)
}

// 재생 중에는 매 프레임 다시 그린다. timeupdate 는 초당 4회쯤이라 끊겨 보인다.
function loop() {
  render()
  rafId = requestAnimationFrame(loop)
}

function startLoop() {
  if (rafId === null) loop()
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  render() // 멈춘 위치를 정확히 한 번 그려둔다
}

function bind(video) {
  video.addEventListener('play', startLoop)
  video.addEventListener('pause', stopLoop)
  video.addEventListener('seeked', render)
  video.addEventListener('loadedmetadata', render)
  if (!video.paused) startLoop()
  else render()
}

function unbind(video) {
  video?.removeEventListener('play', startLoop)
  video?.removeEventListener('pause', stopLoop)
  video?.removeEventListener('seeked', render)
  video?.removeEventListener('loadedmetadata', render)
}

onMounted(() => {
  indexTrack()
  resizeObserver = new ResizeObserver(render)
  if (props.videoEl) {
    resizeObserver.observe(props.videoEl)
    bind(props.videoEl)
  }
})

onBeforeUnmount(() => {
  stopLoop()
  resizeObserver?.disconnect()
  unbind(props.videoEl)
})

watch(() => props.videoEl, (video, previous) => {
  if (previous) {
    resizeObserver?.unobserve(previous)
    unbind(previous)
  }
  if (video) {
    resizeObserver?.observe(video)
    bind(video)
  }
})

watch(() => props.track, () => {
  indexTrack()
  render()
})
</script>

<template>
  <canvas ref="canvasEl" class="track-overlay" />
</template>

<style scoped>
.track-overlay {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
</style>
