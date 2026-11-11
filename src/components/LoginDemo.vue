<script setup>
/**
 * 로그인 왼쪽 영역의 실행 과정 데모.
 *
 * 실제 드론 촬영 영상(public/demo/drone.mp4)과 그 영상에서 뽑은 실제 궤적
 * (assets/demo/drone-track.json) 위에 단계별 설명을 얹는다. 이 앱의 실제 사용 흐름을 따른다.
 *   1 Select  : 영상이 재생되다 멈추고, 멈춘 화면에서 대상을 클릭한다.
 *               (구경만 해도 잠시 뒤 커서가 대신 클릭한다. 직접 클릭하면 바로 넘어간다.)
 *   2 Track   : 클릭한 순간부터 바운딩 박스가 대상을 따라가고, 지나온 위치가 진한 궤적으로 쌓인다.
 *   3 Analyze : 뽑힌 궤적만 따로 떼어 앞에서부터 훑으며 분석한다.
 *   4 Result  : 드론으로 판정한다.
 * 궤적은 영상에서 실제로 뽑은 값이다. 판정은 시연용 연출이며 AI 모델의 출력이 아니다.
 *
 * 영상은 매 프레임 currentTime 을 읽어 canvas 에 박스와 궤적만 덧그린다.
 * prefers-reduced-motion 이면 재생 없이 결과 장면을 고정해 보여 준다.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import data from '../assets/demo/drone-track.json'
import { useLocale } from '../composables/useLocale.js'

const { t } = useLocale()

const track = data.track
const FPS = data.fps
const DUR = data.frames / FPS
const LAST = track.length - 1

const PAUSE_AT = 0.5          // 영상이 멈추는 시각(초). 드론이 한눈에 보이는 장면
const CURSOR_FLY_MS = 1500    // 커서가 대상까지 가는 시간
const CLICK_AT_MS = 1900      // 멈춘 뒤 자동 클릭까지
const LOCK_MS = 750           // 클릭 뒤 박스가 붙는 연출
const ANALYZE_MS = 4600
const RESULT_MS = 4200
const START_I = Math.round(PAUSE_AT * FPS)

const STEP_KEYS = ['detect', 'track', 'analyze', 'result']
const STEPS = computed(() => STEP_KEYS.map((key, i) => ({
  key,
  n: '0' + (i + 1),
  title: t('demo.' + key),
  text: t('demo.' + key + '.text'),
})))

/* 궤적 좌표(잔떨림을 줄이려고 이동 평균) */
function smooth(arr, k = 3) {
  return arr.map((_, i) => {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - k); j <= Math.min(arr.length - 1, i + k); j++) { s += arr[j]; c++ }
    return s / c
  })
}
const xs = smooth(track.map((p) => p.cx * data.width))
const ys = smooth(track.map((p) => p.cy * data.height))

/* ---- 화면에 보이는 상태 ---- */
const stepIdx = ref(0)
const awaiting = ref(false)     // 클릭을 기다리는 중(캔버스가 클릭을 받는다)
const analyzing = ref(false)
const progress = ref(0)
const verdictOn = ref(false)
const video = ref(null)
const canvas = ref(null)
const box = ref(null)
const step = computed(() => STEPS.value[stepIdx.value])

/* ---- 내부 상태(반응형 아님) ---- */
let raf = 0
let ro = null
let phase = 'play'      // play | await | lock | track | analyze | result
let phaseStart = 0
let started = false
let size = { w: 0, h: 0, dpr: 1 }

function fit() {
  const el = box.value
  const c = canvas.value
  if (!el || !c) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  size = { w: el.clientWidth, h: el.clientHeight, dpr }
  c.width = Math.round(size.w * dpr)
  c.height = Math.round(size.h * dpr)
}

const frameIndex = (tm) => Math.min(LAST, Math.max(0, Math.round(tm * FPS)))
const px = (i) => [(xs[i] / data.width) * size.w, (ys[i] / data.height) * size.h]
const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)

const HI = '#ffd23f'        // 진한 강조색. 파란 하늘 위에서 가장 잘 보이는 노랑
const WHITE = '#ffffff'

/** 대상 주변 강조. 채운 원 + 바깥 고리 + 굵은 모서리 박스. */
function drawLock(ctx, i, label, scale = 1) {
  const [cx, cy] = px(i)
  const p = track[i]
  const w = Math.max(40, p.w * size.w * 2.1) * scale
  const h = Math.max(40, p.h * size.h * 2.1) * scale
  const x = cx - w / 2
  const y = cy - h / 2
  const L = Math.min(w, h) * 0.34

  // 대상 위에 깔리는 채움 오버레이
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(w, h) * 0.75)
  // 대상이 가려지지 않도록 가운데는 비우고, 박스 안쪽 가장자리만 노랗게 물들인다.
  g.addColorStop(0, 'rgba(255,210,63,0)')
  g.addColorStop(0.45, 'rgba(255,210,63,0.10)')
  g.addColorStop(1, 'rgba(255,210,63,0.5)')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)

  ctx.shadowColor = 'rgba(8,16,30,0.7)'
  ctx.shadowBlur = 6
  ctx.strokeStyle = WHITE
  ctx.lineWidth = 3
  ctx.lineJoin = 'miter'
  ctx.beginPath()
  const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]
  for (const [ax, ay, sx, sy] of corners) {
    ctx.moveTo(ax, ay + sy * L)
    ctx.lineTo(ax, ay)
    ctx.lineTo(ax + sx * L, ay)
  }
  ctx.stroke()
  ctx.strokeStyle = HI
  ctx.lineWidth = 1.5
  ctx.strokeRect(x, y, w, h)
  ctx.shadowBlur = 0

  if (label) drawChip(ctx, label, x, y - 24, true)
}

function drawChip(ctx, text, x, y, strong) {
  ctx.font = '700 12px "IBM Plex Mono", ui-monospace, Consolas, monospace'
  const tw = ctx.measureText(text).width + 14
  const lx = Math.max(4, Math.min(size.w - tw - 4, x))
  ctx.fillStyle = strong ? HI : 'rgba(8,16,30,0.85)'
  ctx.fillRect(lx, y, tw, 20)
  ctx.fillStyle = strong ? '#1b1500' : '#fff'
  ctx.fillText(text, lx + 7, y + 14)
}

/** from..to 구간의 궤적. 굵고 발광하며, 오래된 쪽은 얇고 옅다. */
function drawTrail(ctx, from, to, width = 5, glow = 14) {
  if (to <= from) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const seg = 2
  for (let i = from; i < to; i += seg) {
    const j = Math.min(to, i + seg)
    const k = (j - from) / Math.max(1, to - from)
    ctx.globalAlpha = 0.35 + 0.65 * k
    ctx.shadowColor = 'rgba(255,170,0,0.9)'
    ctx.shadowBlur = glow * k
    ctx.strokeStyle = HI
    ctx.lineWidth = 2 + (width - 2) * k
    ctx.beginPath()
    const [sx, sy] = px(i)
    ctx.moveTo(sx, sy)
    for (let m = i + 1; m <= j; m++) {
      const [x, y] = px(m)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
}

function drawCursor(ctx, x, y, pressed) {
  ctx.save()
  ctx.translate(x, y)
  if (pressed) ctx.scale(0.88, 0.88)
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 5
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#0b1119'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 17)
  ctx.lineTo(4.5, 13)
  ctx.lineTo(7.5, 20)
  ctx.lineTo(10, 19)
  ctx.lineTo(7, 12)
  ctx.lineTo(12.5, 12)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawRipple(ctx, x, y, k) {
  ctx.strokeStyle = HI
  ctx.lineWidth = 2.5
  ctx.globalAlpha = 1 - k
  ctx.beginPath()
  ctx.arc(x, y, 10 + 40 * easeOut(k), 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
}

/** 분석 연출: 화면을 어둡게 깔고 궤적만 도드라지게 하여, 머리 쪽으로 훑으며 점과 눈금이 켜진다. */
function drawAnalyze(ctx, k) {
  ctx.fillStyle = 'rgba(5,10,22,0.62)'
  ctx.fillRect(0, 0, size.w, size.h)

  // 아직 분석하지 않은 구간은 점선으로 흐리게
  ctx.setLineDash([3, 6])
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = START_I; i <= LAST; i++) {
    const [x, y] = px(i)
    if (i === START_I) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.setLineDash([])

  const head = START_I + Math.round(k * (LAST - START_I))
  drawTrail(ctx, START_I, head, 6, 18)

  // 분석한 구간의 눈금(궤적에 수직)
  ctx.strokeStyle = WHITE
  ctx.lineWidth = 1.5
  for (let i = START_I + 4; i <= head; i += 6) {
    const [x, y] = px(i)
    const [x2, y2] = px(Math.min(LAST, i + 1))
    const [x0, y0] = px(Math.max(0, i - 1))
    const dx = x2 - x0
    const dy = y2 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    ctx.beginPath()
    ctx.moveTo(x - nx * 7, y - ny * 7)
    ctx.lineTo(x + nx * 7, y + ny * 7)
    ctx.stroke()
  }

  // 스캐너: 머리에서 수직으로 긴 선과 퍼지는 고리
  const [hx, hy] = px(head)
  const [ax, ay] = px(Math.max(0, head - 2))
  const [bx, by] = px(Math.min(LAST, head + 2))
  const dl = Math.hypot(bx - ax, by - ay) || 1
  const nx = -(by - ay) / dl
  const ny = (bx - ax) / dl
  ctx.strokeStyle = HI
  ctx.lineWidth = 2
  ctx.shadowColor = 'rgba(255,170,0,0.9)'
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(hx - nx * 46, hy - ny * 46)
  ctx.lineTo(hx + nx * 46, hy + ny * 46)
  ctx.stroke()
  ctx.shadowBlur = 0
  const pulse = (performance.now() % 900) / 900
  ctx.globalAlpha = 1 - pulse
  ctx.beginPath()
  ctx.arc(hx, hy, 8 + 26 * pulse, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = WHITE
  ctx.beginPath()
  ctx.arc(hx, hy, 4.5, 0, Math.PI * 2)
  ctx.fill()

  // 분석한 구간의 샘플 점
  ctx.fillStyle = WHITE
  for (let i = START_I; i <= head; i += 10) {
    const [x, y] = px(i)
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function render(now) {
  const c = canvas.value
  const v = video.value
  if (!c || !v || !size.w) return
  const ctx = c.getContext('2d')
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
  ctx.clearRect(0, 0, size.w, size.h)
  const el = now - phaseStart
  const [tx, ty] = px(START_I)

  if (phase === 'await') {
    // 대상 위치를 가리키는 숨 쉬는 고리와 안내 문구
    const pulse = (el % 1200) / 1200
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 2
    ctx.globalAlpha = 0.9 - 0.9 * pulse
    ctx.beginPath()
    ctx.arc(tx, ty, 16 + 22 * pulse, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
    drawChip(ctx, t('demo.hint'), tx - 50, ty + 34, false)
    // 커서가 오른쪽 아래에서 날아와 대상을 누른다
    const k = easeOut(el / CURSOR_FLY_MS)
    const sx = tx + 150
    const sy = ty + 110
    const pressed = el > CLICK_AT_MS - 160
    drawCursor(ctx, sx + (tx - sx) * k, sy + (ty - sy) * k, pressed)
  } else if (phase === 'lock') {
    const k = el / LOCK_MS
    drawRipple(ctx, tx, ty, k)
    drawLock(ctx, START_I, t('demo.candidate'), 1 + 1.6 * (1 - easeOut(k * 1.4)))
  } else if (phase === 'track') {
    const i = Math.max(START_I, frameIndex(v.currentTime))
    drawTrail(ctx, START_I, i)
    drawLock(ctx, i, 'ID 1')
  } else if (phase === 'analyze') {
    drawAnalyze(ctx, Math.min(1, el / ANALYZE_MS))
  } else if (phase === 'result') {
    drawTrail(ctx, START_I, LAST)
    drawLock(ctx, LAST, verdictOn.value ? t('demo.drone') : 'ID 1')
  } else {
    // play: 아직 아무것도 그리지 않는다.
  }
}

/* ---- 진행(상태 기계) ---- */
function go(next, now) {
  phase = next
  phaseStart = now
  awaiting.value = next === 'await'
  analyzing.value = next === 'analyze'
  if (next === 'play') {
    stepIdx.value = 0
    verdictOn.value = false
    progress.value = 0
    video.value.currentTime = 0
    video.value.play().catch(() => {})
  } else if (next === 'await') {
    // 프레임 확인이 한 박자 늦어도 대상이 고리 안에 오도록 멈춘 위치를 못 박는다.
    video.value.pause()
    video.value.currentTime = START_I / FPS
  } else if (next === 'lock') {
    stepIdx.value = 0
  } else if (next === 'track') {
    stepIdx.value = 1
    video.value.play().catch(() => {})
  } else if (next === 'analyze') {
    stepIdx.value = 2
    video.value.pause()
    video.value.currentTime = (LAST + 1) / FPS - 0.03
  } else if (next === 'result') {
    stepIdx.value = 3
  }
}

function tick(now) {
  const v = video.value
  const el = now - phaseStart
  if (phase === 'play' && v.currentTime >= PAUSE_AT) go('await', now)
  else if (phase === 'await' && el >= CLICK_AT_MS) go('lock', now)
  else if (phase === 'lock' && el >= LOCK_MS) go('track', now)
  else if (phase === 'track' && (v.ended || v.currentTime >= DUR - 0.04)) go('analyze', now)
  else if (phase === 'analyze') {
    progress.value = Math.min(1, el / ANALYZE_MS)
    if (el >= ANALYZE_MS) go('result', now)
  } else if (phase === 'result') {
    if (el > 500) verdictOn.value = true
    if (el >= RESULT_MS) go('play', now)
  }
  render(now)
  raf = requestAnimationFrame(tick)
}

/** 사용자가 직접 대상을 클릭하면 자동 클릭을 기다리지 않고 바로 넘어간다. */
function onCanvasClick(event) {
  if (phase !== 'await') return
  const rect = canvas.value.getBoundingClientRect()
  const [tx, ty] = px(START_I)
  const d = Math.hypot(event.clientX - rect.left - tx, event.clientY - rect.top - ty)
  if (d <= 70) go('lock', performance.now())
}

onMounted(() => {
  fit()
  ro = new ResizeObserver(fit)
  ro.observe(box.value)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const v = video.value
  const start = () => {
    if (started) return
    started = true
    if (reduced) {
      phase = 'result'
      stepIdx.value = 3
      verdictOn.value = true
      v.currentTime = Math.max(0, DUR - 0.05)
      v.addEventListener('seeked', () => render(performance.now()), { once: true })
      return
    }
    go('play', performance.now())
    raf = requestAnimationFrame(tick)
  }
  if (v.readyState >= 2) start()
  else v.addEventListener('loadeddata', start, { once: true })
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  video.value?.pause()
})
</script>

<template>
  <div class="demo" role="img" :aria-label="t('demo.aria')">
    <div ref="box" class="demo__stage">
      <video ref="video" class="demo__video" src="/demo/drone.mp4" muted playsinline preload="auto" />
      <canvas ref="canvas" class="demo__canvas" :class="{ 'demo__canvas--click': awaiting }" @click="onCanvasClick" />

      <div class="demo__tag mono"><i /> {{ t('demo.tag') }}</div>

      <ol class="demo__steps">
        <li v-for="(s, i) in STEPS" :key="s.key" :class="{ on: i === stepIdx, done: i < stepIdx }">
          <b /> <span>{{ s.title }}</span>
        </li>
      </ol>

      <Transition name="chip">
        <div v-if="analyzing" class="demo__analyzing mono">
          <span class="demo__spin" />
          {{ t('demo.analyzing') }}
          <b>{{ Math.round(progress * 100) }}%</b>
        </div>
      </Transition>

      <Transition name="verdict">
        <div v-if="verdictOn" class="demo__verdict">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M9.2 9.2 5.6 5.6M14.8 9.2l3.6-3.6M9.2 14.8l-3.6 3.6M14.8 14.8l3.6 3.6" />
            <circle cx="5" cy="5" r="2.6" /><circle cx="19" cy="5" r="2.6" />
            <circle cx="5" cy="19" r="2.6" /><circle cx="19" cy="19" r="2.6" />
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" stroke="none" />
          </svg>
          <div>
            <span class="mono">{{ t('demo.verdict') }}</span>
            <strong>{{ t('demo.drone') }}</strong>
          </div>
        </div>
      </Transition>

      <div class="demo__caption">
        <Transition name="cap" mode="out-in">
          <div :key="step.key">
            <span class="mono">{{ step.n }} / 04</span>
            <strong>{{ step.title }}</strong>
            <p>{{ step.text }}</p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo { width: 100%; }
.demo__stage {
  position: relative;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-video);
}
.demo__video, .demo__canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.demo__video { object-fit: fill; }
.demo__canvas { pointer-events: none; }
.demo__canvas--click { pointer-events: auto; cursor: pointer; }

.demo__tag {
  position: absolute; top: 12px; left: 14px;
  display: flex; align-items: center; gap: 7px;
  font-size: 10.5px; letter-spacing: .06em; color: #fff;
  padding: 4px 8px; border-radius: 3px; background: rgba(8, 16, 30, .7);
}
.demo__tag i { width: 6px; height: 6px; border-radius: 50%; background: var(--drone); animation: blink 1.4s steps(2) infinite; }

.demo__steps {
  position: absolute; top: 12px; right: 14px; margin: 0; padding: 5px 9px;
  display: flex; gap: 12px; list-style: none; border-radius: 3px; background: rgba(8, 16, 30, .7);
  font-size: 11px; color: rgba(255, 255, 255, .55);
}
.demo__steps li { display: flex; align-items: center; gap: 5px; transition: color .25s; }
.demo__steps b { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; }
.demo__steps .done { color: var(--accent-text); }
.demo__steps .on { color: #fff; font-weight: 700; }
.demo__steps .on b { background: #ffd23f; opacity: 1; box-shadow: 0 0 0 3px rgba(255, 210, 63, .3); }

.demo__analyzing {
  position: absolute; top: 46px; right: 14px;
  display: flex; align-items: center; gap: 9px;
  padding: 6px 12px; border-radius: 4px; font-size: 12px; letter-spacing: .06em;
  color: #fff; background: rgba(8, 16, 30, .85); border: 1px solid rgba(255, 210, 63, .6);
}
.demo__analyzing b { color: #ffd23f; min-width: 3ch; text-align: right; }
.demo__spin {
  width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid rgba(255, 210, 63, .3); border-top-color: #ffd23f; animation: spin .8s linear infinite;
}

.demo__verdict {
  position: absolute; bottom: 7%; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px;
  padding: 16px 28px 16px 22px; border-radius: 8px;
  color: #ffd23f; background: rgba(6, 12, 24, .9);
  border: 2px solid #ffd23f; box-shadow: 0 0 0 6px rgba(255, 210, 63, .18), 0 18px 50px rgba(0, 0, 0, .5);
}
.demo__verdict > div { display: flex; flex-direction: column; gap: 2px; }
.demo__verdict span { font-size: 11px; letter-spacing: .12em; color: rgba(255, 255, 255, .7); }
.demo__verdict strong { font-size: 34px; line-height: 1; letter-spacing: .04em; color: #fff; }
.demo__verdict svg { width: 34px; height: 34px; }

/* 설명은 위쪽 카드에 둔다. 드론이 아래쪽으로 날아서 아래에 두면 궤적을 가린다. */
.demo__caption {
  position: absolute; top: 46px; left: 14px; max-width: min(55%, 420px);
  padding: 10px 14px 12px; color: #fff; border-radius: 6px;
  background: rgba(6, 12, 24, .78); border: 1px solid rgba(255, 255, 255, .12);
  pointer-events: none;
}
.demo__caption > div { display: grid; grid-template-columns: auto 1fr; align-items: baseline; column-gap: 10px; }
.demo__caption span { font-size: 11px; color: #ffd23f; }
.demo__caption strong { font-size: 18px; letter-spacing: -.01em; }
.demo__caption p { grid-column: 1 / -1; margin: 4px 0 0; font-size: 13px; line-height: 1.5; color: rgba(255, 255, 255, .88); }

.verdict-enter-active { transition: opacity .35s, transform .45s cubic-bezier(.2, .9, .3, 1.25); }
.verdict-enter-from { opacity: 0; transform: translateX(-50%) translateY(14px) scale(.9); }
.verdict-leave-active, .chip-enter-active, .chip-leave-active { transition: opacity .25s; }
.verdict-leave-to, .chip-enter-from, .chip-leave-to { opacity: 0; }
.cap-enter-active, .cap-leave-active { transition: opacity .22s, transform .22s; }
.cap-enter-from { opacity: 0; transform: translateY(6px); }
.cap-leave-to { opacity: 0; }

@keyframes blink { 50% { opacity: .25; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .demo__tag i, .demo__spin { animation: none; }
  .verdict-enter-active, .cap-enter-active { transition: none; }
}
@media (max-width: 1100px) {
  .demo__steps { display: none; }
  .demo__verdict strong { font-size: 26px; }
}
</style>
