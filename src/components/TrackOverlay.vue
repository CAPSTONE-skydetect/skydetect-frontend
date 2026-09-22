<script setup>
/**
 * A 파트 추적 결과를 영상 위에 그리는 오버레이.
 *
 * 그리는 좌표는 `api/ai.js` 의 fetchTrajectory 가 만들어 준다. trajectory.csv 의
 * raw_x/raw_y 를 쓴다. TrackSequence.history 의 cx/cy 를 쓰면 안 된다 - 그쪽은
 * 카메라 움직임 보정 좌표라 실제 프레임에서 물체가 보이는 자리가 아니다.
 * (자세한 근거는 fetchTrajectory 주석)
 *
 * AI 가 만든 overlay.mp4 를 쓰지 않는 이유는 코덱이다. OpenCV 의
 * `VideoWriter_fourcc(*"mp4v")` 는 MPEG-4 Part 2 라 브라우저가 디코딩하지 못한다.
 * 직접 그리면 원본 해상도로 보이고 프레임 단위로 돌려볼 수도 있다.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { createFitTransform, rectToDisplay } from '../lib/videoGeometry.js'

const props = defineProps({
  videoEl: { type: Object, default: null },
  /** [{frameIndex, cx, cy, w, h, conf, visible, source}] cx 등은 0~1 비율 */
  points: { type: Array, default: () => [] },
  fps: { type: Number, default: 30 },
  showTrail: { type: Boolean, default: true },
})

const canvasEl = ref(null)

/**
 * 추적 방식별 색. AI 오버레이와 같은 배색이다 (OpenCV 는 BGR 이라 순서를 뒤집었다).
 * 어느 단계가 물체를 잡고 있는지 색으로 바로 보인다.
 */
const SOURCE_COLOR = {
  manual_roi: '#ff3b30',   // 처음 지정한 ROI
  klt: '#ffdc00',          // KLT 광류 추적
  appearance: '#28a0dc',   // 외형 매칭으로 재포착
  motion: '#50dc46',       // 움직임 기반 복구
  prediction: '#ff8c00',   // 관측 없이 예측만
  compensated: '#4da3ff',  // CSV 를 못 받아 보정 좌표로 대체한 경우
}
const DEFAULT_COLOR = '#ffdc00'

let byFrame = new Map()
let rafId = null
let resizeObserver = null

/** frame_index 로 바로 찾도록 펼쳐둔다. 프레임마다 훑으면 느리다. */
function indexPoints() {
  byFrame = new Map()
  props.points.forEach((point) => byFrame.set(point.frameIndex, point))
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
  if (!tf || !props.points.length) return

  const frame = currentFrame()
  const point = byFrame.get(frame)
  const color = SOURCE_COLOR[point?.source] || DEFAULT_COLOR

  if (props.showTrail) drawTrail(ctx, tf, frame, color)

  if (!point) drawNotice(ctx, tf, 'LOST', '#fbbf24')
  else if (!point.visible) drawBox(ctx, tf, point, color, true)
  else drawBox(ctx, tf, point, color, false)
}

/**
 * 지나온 경로. 보이는 프레임만 잇는다.
 * AI 오버레이도 visible 일 때만 점을 더한다. 놓친 구간까지 이으면 있지도 않은
 * 궤적을 그리게 된다.
 */
function drawTrail(ctx, tf, frame, color) {
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.65
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.beginPath()

  let started = false
  for (const point of props.points) {
    if (point.frameIndex > frame) break
    if (!point.visible) continue
    const x = point.cx * tf.intrinsicWidth * tf.scale + tf.offsetX
    const y = point.cy * tf.intrinsicHeight * tf.scale + tf.offsetY
    if (started) ctx.lineTo(x, y)
    else { ctx.moveTo(x, y); started = true }
  }
  if (started) ctx.stroke()
  ctx.globalAlpha = 1
}

function drawBox(ctx, tf, point, color, predicted) {
  const sourceRect = {
    x: (point.cx - point.w / 2) * tf.intrinsicWidth,
    y: (point.cy - point.h / 2) * tf.intrinsicHeight,
    width: point.w * tf.intrinsicWidth,
    height: point.h * tf.intrinsicHeight,
  }
  const box = rectToDisplay(tf, sourceRect)

  // 대상이 작으면 박스도 몇 픽셀밖에 안 되어 보이지 않는다. 최소 크기를 준다.
  const drawWidth = Math.max(box.width, 12)
  const drawHeight = Math.max(box.height, 12)
  const drawX = box.x - (drawWidth - box.width) / 2
  const drawY = box.y - (drawHeight - box.height) / 2

  ctx.strokeStyle = color
  ctx.lineWidth = 2
  // 관측 없이 예측만 한 프레임은 점선으로 구분한다.
  if (predicted) ctx.setLineDash([5, 4])
  ctx.strokeRect(drawX, drawY, drawWidth, drawHeight)
  ctx.setLineDash([])

  const text = `f${point.frameIndex} ${point.source} ${point.conf.toFixed(2)}`
  ctx.font = '11px ui-monospace, Consolas, monospace'
  const padding = 5
  const labelWidth = ctx.measureText(text).width + padding * 2
  const labelY = drawY - 19 < 0 ? drawY + drawHeight + 3 : drawY - 19

  ctx.fillStyle = 'rgba(13,17,23,0.85)'
  ctx.fillRect(drawX, labelY, labelWidth, 17)
  ctx.fillStyle = color
  ctx.fillText(text, drawX + padding, labelY + 12)
}

/** 그 프레임에 아무 기록이 없는 경우. 추적 구간 밖이거나 완전히 놓친 구간이다. */
function drawNotice(ctx, tf, text, color) {
  ctx.font = '11px ui-monospace, Consolas, monospace'
  ctx.fillStyle = 'rgba(13,17,23,0.85)'
  ctx.fillRect(tf.offsetX + 8, tf.offsetY + 8, ctx.measureText(text).width + 12, 17)
  ctx.fillStyle = color
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
  indexPoints()
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

watch(() => props.points, () => {
  indexPoints()
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
