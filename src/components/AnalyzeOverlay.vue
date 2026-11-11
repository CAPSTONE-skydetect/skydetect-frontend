<script setup>
/**
 * 분석 중 연출.
 *
 * AI 가 궤적을 뽑아 분석하는 동안 영상 위에 겹친다. 화면을 어둡게 깔고, 지정한 박스를 붙잡은 채
 * 스캔 선이 영상을 훑고 박스 주변으로 고리가 퍼진다. 분석이 언제 끝날지 서버가 알려 주지 않으므로
 * 진행률 대신 계속 움직이는 연출만 쓴다. 입력은 받지 않는다(pointer-events: none).
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { createFitTransform, rectToDisplay } from '../lib/videoGeometry.js'
import { useLocale } from '../composables/useLocale.js'
import { drawLock, drawChip, HIGHLIGHT } from '../lib/overlayStyle.js'

const props = defineProps({
  videoEl: { type: Object, default: null },
  /** 원본 픽셀 좌표 {x, y, width, height} */
  sourceBox: { type: Object, default: null },
  /** 비우면 언어에 맞는 기본 문구('분석 중' / 'Analyzing')를 쓴다. */
  label: { type: String, default: '' },
})

const { isKo } = useLocale()

const canvasEl = ref(null)
let raf = 0
let start = 0

function render(now) {
  raf = requestAnimationFrame(render)
  const canvas = canvasEl.value
  const video = props.videoEl
  if (!canvas || !video) return
  const width = video.clientWidth
  const height = video.clientHeight
  if (!width || !height) return

  const dpr = window.devicePixelRatio || 1
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

  ctx.fillStyle = 'rgba(5,10,22,0.55)'
  ctx.fillRect(0, 0, width, height)

  const elapsed = now - start

  // 스캔 선: 영상 영역을 왼쪽에서 오른쪽으로 반복해서 훑는다.
  const area = tf
    ? { x: tf.offsetX, y: tf.offsetY, w: tf.displayWidth, h: tf.displayHeight }
    : { x: 0, y: 0, w: width, h: height }
  const k = (elapsed % 2000) / 2000
  const sx = area.x + area.w * k
  const trail = ctx.createLinearGradient(sx - 120, 0, sx, 0)
  trail.addColorStop(0, 'rgba(255,210,63,0)')
  trail.addColorStop(1, 'rgba(255,210,63,0.28)')
  ctx.fillStyle = trail
  ctx.fillRect(sx - 120, area.y, 120, area.h)
  ctx.fillStyle = HIGHLIGHT
  ctx.fillRect(sx - 1, area.y, 1.5, area.h)

  if (tf && props.sourceBox) {
    const shown = rectToDisplay(tf, props.sourceBox)
    const w = Math.max(shown.width, 26)
    const h = Math.max(shown.height, 26)
    const box = { x: shown.x - (w - shown.width) / 2, y: shown.y - (h - shown.height) / 2, width: w, height: h }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // 박스 주변으로 퍼지는 고리 두 개(위상을 반 주기 어긋나게)
    ctx.strokeStyle = HIGHLIGHT
    ctx.lineWidth = 2
    for (const phase of [0, 0.5]) {
      const p = ((elapsed / 1200) + phase) % 1
      ctx.globalAlpha = 1 - p
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(box.width, box.height) * 0.6 + 46 * p, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    drawLock(ctx, box, {})
  }

  drawChip(ctx, `● ${props.label || (isKo.value ? '분석 중' : 'Analyzing')}${'.'.repeat(Math.floor(elapsed / 400) % 4)}`, width / 2 - 50, 12, { strong: false, maxWidth: width })
}

onMounted(() => {
  start = performance.now()
  raf = requestAnimationFrame(render)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <canvas ref="canvasEl" class="analyze" />
</template>

<style scoped>
.analyze {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
</style>
