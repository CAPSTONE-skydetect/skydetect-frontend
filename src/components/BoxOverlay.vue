<script setup>
/**
 * 영상 위에 ROI 박스를 지정하는 canvas 오버레이.
 *
 * 동작은 CODEX 브랜치의 A 파트 수동 ROI UI(`ai_server/static/app.js`)를 따른다.
 *
 *   - 드래그하면 그 사각형이 ROI 가 된다
 *   - 짧게 클릭하면(4px 미만 드래그) 클릭 지점을 중심으로 32x32 박스를 만든다.
 *     하늘의 비행체는 수십 픽셀이라 정확히 드래그하기가 어렵다
 *   - 커서를 올리면 돋보기가 뜬다. 원본 38px 영역을 확대해 보여준다
 *   - 박스는 항상 프레임 안으로 clamp 한다 (최소 4px)
 *
 * 좌표 변환은 여기서 한 번 더 값을 한다. 사용자가 그린 건 화면 좌표지만 서버로
 * 보내는 건 원본 픽셀 좌표다. 이 변환이 틀려도 화면은 멀쩡해 보이고 AI 결과만
 * 이상해진다. 그래서 확정된 박스는 그린 사각형을 그대로 두지 않고
 * 원본 좌표로 바꾼 뒤 다시 화면 좌표로 되돌려서 그린다. 어긋나면 눈에 띈다.
 */
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { createFitTransform, toSourcePoint, rectToDisplay } from '../lib/videoGeometry.js'

const props = defineProps({
  /** 기준이 되는 <video>. videoWidth/clientWidth 를 여기서 읽는다. */
  videoEl: { type: Object, default: null },
  /** 확정된 박스. 원본 픽셀 좌표 {x, y, width, height} */
  sourceBox: { type: Object, default: null },
  /** 지금 박스를 그릴 수 있는 상태인가 */
  active: { type: Boolean, default: true },
  /** 클릭만 했을 때 만들 박스 크기 (원본 픽셀). CODEX 기본값 32 */
  clickBoxSize: { type: Number, default: 32 },
  /** 커서 위치 확대경 */
  magnifier: { type: Boolean, default: true },
})

const emit = defineEmits(['update:sourceBox', 'draw-start'])

const canvasEl = ref(null)
/** 드래그 중인 두 점. 원본 픽셀 좌표로 들고 있는다. */
const dragStart = shallowRef(null)
const dragCurrent = shallowRef(null)
const hoverPoint = shallowRef(null)
/** 크기 변경/메타데이터 로드 때 변환을 다시 계산하기 위한 신호 */
const geometryVersion = ref(0)

let resizeObserver = null

const transform = computed(() => {
  geometryVersion.value
  const video = props.videoEl
  if (!video) return null
  return createFitTransform({
    intrinsicWidth: video.videoWidth,
    intrinsicHeight: video.videoHeight,
    boxWidth: video.clientWidth,
    boxHeight: video.clientHeight,
    fit: 'contain', // <video> 의 CSS object-fit 과 반드시 같아야 한다
  })
})

// 포인터 -----------------------------------------------------------------

/** 화면 이벤트를 원본 픽셀 좌표로 바꾼다. 프레임 밖은 잘라낸다. */
function eventToSourcePoint(event) {
  const tf = transform.value
  const rect = canvasEl.value.getBoundingClientRect()
  const point = toSourcePoint(tf, event.clientX - rect.left, event.clientY - rect.top)
  return {
    x: clamp(point.x, 0, Math.max(0, tf.intrinsicWidth - 1)),
    y: clamp(point.y, 0, Math.max(0, tf.intrinsicHeight - 1)),
  }
}

function onPointerDown(event) {
  if (!props.active || !transform.value) return
  event.preventDefault()
  emit('draw-start')
  canvasEl.value.setPointerCapture(event.pointerId)
  dragStart.value = eventToSourcePoint(event)
  dragCurrent.value = dragStart.value
  hoverPoint.value = dragStart.value
  render()
}

function onPointerMove(event) {
  if (!props.active || !transform.value) return
  hoverPoint.value = eventToSourcePoint(event)
  if (dragStart.value) dragCurrent.value = hoverPoint.value
  render()
}

function onPointerUp(event) {
  if (!props.active || !dragStart.value) return
  event.preventDefault()
  canvasEl.value.releasePointerCapture?.(event.pointerId)
  dragCurrent.value = eventToSourcePoint(event)

  const raw = boxFromPoints(dragStart.value, dragCurrent.value)
  // CODEX 와 같은 기준: 4px 미만이면 드래그가 아니라 클릭으로 본다.
  const box = raw.width < 4 || raw.height < 4
    ? {
      x: dragStart.value.x - props.clickBoxSize / 2,
      y: dragStart.value.y - props.clickBoxSize / 2,
      width: props.clickBoxSize,
      height: props.clickBoxSize,
    }
    : raw

  dragStart.value = null
  dragCurrent.value = null
  emit('update:sourceBox', clampBox(box))
  render()
}

function onPointerLeave() {
  hoverPoint.value = null
  render()
}

function onPointerCancel() {
  dragStart.value = null
  dragCurrent.value = null
  render()
}

function boxFromPoints(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/** 프레임 안으로 밀어 넣는다. 밖으로 나간 좌표를 보내면 서버가 422 를 준다. */
function clampBox(box) {
  const tf = transform.value
  const frameWidth = tf.intrinsicWidth
  const frameHeight = tf.intrinsicHeight
  const width = clamp(box.width, 4, Math.max(4, frameWidth))
  const height = clamp(box.height, 4, Math.max(4, frameHeight))
  return {
    x: clamp(box.x, 0, Math.max(0, frameWidth - width)),
    y: clamp(box.y, 0, Math.max(0, frameHeight - height)),
    width,
    height,
  }
}

// 그리기 -----------------------------------------------------------------

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

  const tf = transform.value
  if (!tf) return

  // 영상이 실제로 차지하는 영역. 레터박스 여백에 그리면 좌표가 잘리므로 경계를 보인다.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  ctx.strokeRect(tf.offsetX + 0.5, tf.offsetY + 0.5, tf.displayWidth - 1, tf.displayHeight - 1)
  ctx.setLineDash([])

  // 드래그 중이면 그 사각형을, 아니면 확정된 박스를 그린다.
  // 확정된 박스는 원본 좌표에서 되돌려 그린 것이라 변환 검증을 겸한다.
  const previewSource = dragStart.value && dragCurrent.value
    ? boxFromPoints(dragStart.value, dragCurrent.value)
    : props.sourceBox

  if (previewSource) {
    const box = rectToDisplay(tf, previewSource)
    ctx.fillStyle = 'rgba(243,182,66,0.14)'
    ctx.strokeStyle = '#f3b642'
    ctx.lineWidth = 2
    ctx.fillRect(box.x, box.y, box.width, box.height)
    ctx.strokeRect(box.x, box.y, box.width, box.height)
    drawCrosshair(ctx, box.x + box.width / 2, box.y + box.height / 2)

    if (!dragStart.value) drawLabel(ctx, box, formatBox(previewSource))
  }

  if (props.active && props.magnifier && hoverPoint.value) {
    drawMagnifier(ctx, tf, hoverPoint.value, width, height)
  }
}

function drawCrosshair(ctx, x, y) {
  const arm = 9
  ctx.strokeStyle = '#e05a37'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x - arm, y)
  ctx.lineTo(x + arm, y)
  ctx.moveTo(x, y - arm)
  ctx.lineTo(x, y + arm)
  ctx.stroke()
}

/**
 * 커서 주변을 확대해 보여준다.
 *
 * 하늘의 비행체는 1920 프레임에서 수십 픽셀이고, 화면에는 0.38 배로 줄어 보인다.
 * 확대 없이는 어디가 대상인지 분간이 안 된다. 원본 38px 을 126px 로 키워 그린다.
 * imageSmoothingEnabled=false 로 둬야 픽셀 경계가 보인다.
 */
function drawMagnifier(ctx, tf, point, width, height) {
  const video = props.videoEl
  if (!video.videoWidth) return

  const size = 126
  const sourceSize = 38
  const cursor = {
    x: point.x * tf.scale + tf.offsetX,
    y: point.y * tf.scale + tf.offsetY,
  }

  // 커서 오른쪽에 두되, 화면 밖으로 나가면 왼쪽으로 넘긴다.
  let x = cursor.x + 18
  if (x + size > width) x = cursor.x - size - 18
  const y = clamp(cursor.y - size / 2, 8, Math.max(8, height - size - 8))

  const sourceX = clamp(point.x - sourceSize / 2, 0, video.videoWidth - sourceSize)
  const sourceY = clamp(point.y - sourceSize / 2, 0, video.videoHeight - sourceSize)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#10251f'
  ctx.fillRect(x - 3, y - 3, size + 6, size + 6)
  try {
    ctx.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, x, y, size, size)
  } catch {
    // 아직 디코딩된 프레임이 없으면 그릴 게 없다. 확대경만 비워둔다.
  }
  ctx.strokeStyle = '#f3b642'
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, size, size)
  drawCrosshair(ctx, x + size / 2, y + size / 2)
  ctx.restore()
}

function drawLabel(ctx, box, text) {
  ctx.font = '11px ui-monospace, Consolas, monospace'
  const padding = 5
  const width = ctx.measureText(text).width + padding * 2
  const height = 18
  const y = box.y - height - 3 < 0 ? box.y + 3 : box.y - height - 3

  ctx.fillStyle = 'rgba(13,17,23,0.85)'
  ctx.fillRect(box.x, y, width, height)
  ctx.fillStyle = '#f3b642'
  ctx.fillText(text, box.x + padding, y + 13)
}

function formatBox(box) {
  const round = (n) => Math.round(n)
  return `${round(box.x)}, ${round(box.y)}  ${round(box.width)}x${round(box.height)} px`
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// 크기/메타데이터 변화 추적 ------------------------------------------------

function invalidate() {
  geometryVersion.value += 1
  render()
}

onMounted(() => {
  resizeObserver = new ResizeObserver(invalidate)
  if (props.videoEl) {
    resizeObserver.observe(props.videoEl)
    props.videoEl.addEventListener('loadedmetadata', invalidate)
    props.videoEl.addEventListener('seeked', render)
  }
  render()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  props.videoEl?.removeEventListener('loadedmetadata', invalidate)
  props.videoEl?.removeEventListener('seeked', render)
})

watch(() => props.videoEl, (video, previous) => {
  if (previous) {
    resizeObserver?.unobserve(previous)
    previous.removeEventListener('loadedmetadata', invalidate)
    previous.removeEventListener('seeked', render)
  }
  if (video) {
    resizeObserver?.observe(video)
    // videoWidth 는 메타데이터가 로드돼야 채워진다. 그 전에 계산하면 0 이 나온다.
    video.addEventListener('loadedmetadata', invalidate)
    video.addEventListener('seeked', render)
  }
  invalidate()
})

watch(() => props.sourceBox, render)
watch(() => props.active, (value) => {
  if (!value) hoverPoint.value = null
  render()
})

defineExpose({ redraw: invalidate })
</script>

<template>
  <canvas
    ref="canvasEl"
    class="overlay"
    :class="{ 'overlay--active': active }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerleave="onPointerLeave"
  />
</template>

<style scoped>
.overlay {
  /* 스테이지(=video 와 같은 크기)에 정확히 겹친다. 크기는 render() 가
     video.clientWidth/Height 로 직접 맞춘다. */
  position: absolute;
  left: 0;
  top: 0;
  touch-action: none;
}
.overlay--active { cursor: crosshair; }
</style>
