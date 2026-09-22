<script setup>
/**
 * 클립 위에 박스를 그리는 <canvas> 오버레이.
 *
 * 이 컴포넌트의 존재 이유
 * 사용자가 그린 건 화면 좌표지만 서버로 보내야 하는 건 원본 영상 픽셀 좌표다.
 * 이 변환이 틀려도 화면은 멀쩡해 보인다. 박스는 마우스를 따라 잘 그려지니까.
 * 어긋난 건 AI 에 도착한 뒤에야 드러난다.
 *
 * 그래서 여기서는 그린 사각형을 그대로 보여주지 않는다.
 *   1. 드래그 중에는 화면 좌표 그대로 (흰 점선)
 *   2. 손을 떼면 → 원본 좌표로 변환 → 다시 화면 좌표로 되돌려서 그린다 (파란 실선)
 * 두 사각형이 어긋나면 변환이 틀린 것이다. 눈으로 바로 보인다.
 *
 * 레터박스(object-fit: contain 여백)도 얇게 그려준다. 영상 밖 여백에 박스를
 * 그리면 좌표가 음수가 되는데, 어디까지가 영상인지 보이면 애초에 안 그리게 된다.
 */
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { createFitTransform, rectToSource, rectToDisplay } from '../lib/videoGeometry.js'

const props = defineProps({
  /** 기준이 되는 <video>. videoWidth/clientWidth 를 여기서 읽는다. */
  videoEl: { type: Object, default: null },
  /** 확정된 박스. 원본 픽셀 좌표 {x, y, width, height} */
  sourceBox: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:sourceBox', 'draw-start'])

const canvasEl = ref(null)
/** 화면 좌표 기준 현재 드래그 사각형. 손을 떼면 null 로 돌아간다. */
const dragRect = shallowRef(null)
/** transform 재계산을 유발하기 위한 신호(크기 변경/메타데이터 로드). */
const geometryVersion = ref(0)

let dragOrigin = null
let resizeObserver = null

/**
 * 표시 영역 ↔ 원본 픽셀 변환 정보.
 * geometryVersion 을 읽어서, 크기가 바뀌면 다시 계산되게 묶어둔다.
 */
const transform = computed(() => {
  geometryVersion.value // 의존성 등록용
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

// 드래그

function pointerPosition(event) {
  const rect = canvasEl.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onPointerDown(event) {
  if (props.disabled || !transform.value) return
  emit('draw-start')
  canvasEl.value.setPointerCapture(event.pointerId)
  dragOrigin = pointerPosition(event)
  dragRect.value = { x: dragOrigin.x, y: dragOrigin.y, width: 0, height: 0 }
  render()
}

function onPointerMove(event) {
  if (!dragOrigin) return
  const now = pointerPosition(event)
  dragRect.value = {
    x: Math.min(dragOrigin.x, now.x),
    y: Math.min(dragOrigin.y, now.y),
    width: Math.abs(now.x - dragOrigin.x),
    height: Math.abs(now.y - dragOrigin.y),
  }
  render()
}

function onPointerUp(event) {
  if (!dragOrigin) return
  canvasEl.value.releasePointerCapture?.(event.pointerId)
  const rect = dragRect.value
  dragOrigin = null
  dragRect.value = null

  if (!rect || !transform.value) return render()

  // 클릭에 가까운 건 "지우기"로 본다.
  if (rect.width < 6 || rect.height < 6) {
    emit('update:sourceBox', null)
    return render()
  }

  const source = rectToSource(transform.value, rect)
  if (source.width < 2 || source.height < 2) {
    emit('update:sourceBox', null)
    return render()
  }

  emit('update:sourceBox', source)
  render()
}

// 그리기

function render() {
  const canvas = canvasEl.value
  const video = props.videoEl
  if (!canvas || !video) return

  // 고해상도 화면에서 선이 뭉개지지 않도록 DPR 을 반영한다.
  const dpr = window.devicePixelRatio || 1
  const width = video.clientWidth
  const height = video.clientHeight
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

  // 1) 영상이 실제로 차지하는 영역 (레터박스 경계)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  ctx.strokeRect(tf.offsetX + 0.5, tf.offsetY + 0.5, tf.displayWidth - 1, tf.displayHeight - 1)
  ctx.setLineDash([])

  // 2) 드래그 중인 원본 그대로의 사각형 (화면 좌표)
  if (dragRect.value) {
    ctx.strokeStyle = '#ffffff'
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 1.5
    ctx.strokeRect(dragRect.value.x, dragRect.value.y, dragRect.value.width, dragRect.value.height)
    ctx.setLineDash([])
  }

  // 3) 확정된 박스 — 원본 좌표에서 되돌려 그린 것. 검증용.
  if (props.sourceBox) {
    const back = rectToDisplay(tf, props.sourceBox)
    ctx.strokeStyle = '#4da3ff'
    ctx.lineWidth = 2
    ctx.strokeRect(back.x, back.y, back.width, back.height)

    ctx.fillStyle = 'rgba(77,163,255,0.12)'
    ctx.fillRect(back.x, back.y, back.width, back.height)

    drawLabel(ctx, back, formatBox(props.sourceBox))
  }
}

function drawLabel(ctx, box, text) {
  ctx.font = '11px ui-monospace, Consolas, monospace'
  const padding = 5
  const width = ctx.measureText(text).width + padding * 2
  const height = 18
  // 박스 위에 붙이되, 위쪽 공간이 없으면 안쪽으로 넣는다.
  const y = box.y - height - 3 < 0 ? box.y + 3 : box.y - height - 3

  ctx.fillStyle = 'rgba(13,17,23,0.85)'
  ctx.fillRect(box.x, y, width, height)
  ctx.fillStyle = '#4da3ff'
  ctx.fillText(text, box.x + padding, y + 13)
}

function formatBox(box) {
  const round = (n) => Math.round(n)
  return `${round(box.x)}, ${round(box.y)}  ${round(box.width)}×${round(box.height)} px`
}

// 크기/메타데이터 변화 추적

function invalidate() {
  geometryVersion.value += 1
  render()
}

onMounted(() => {
  resizeObserver = new ResizeObserver(invalidate)
  if (props.videoEl) resizeObserver.observe(props.videoEl)
  render()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

watch(() => props.videoEl, (video, previous) => {
  if (previous) resizeObserver?.unobserve(previous)
  if (video) {
    resizeObserver?.observe(video)
    // videoWidth 는 메타데이터가 로드돼야 채워진다. 그 전에 계산하면 0 이 나온다.
    video.addEventListener('loadedmetadata', invalidate)
  }
  invalidate()
})

watch(() => props.sourceBox, render)

defineExpose({ redraw: invalidate })
</script>

<template>
  <canvas
    ref="canvasEl"
    class="overlay"
    :class="{ 'overlay--drawing': !disabled }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
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
.overlay--drawing { cursor: crosshair; }
</style>
