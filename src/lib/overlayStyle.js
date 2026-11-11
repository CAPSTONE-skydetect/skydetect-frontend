/**
 * 영상 위 오버레이를 그리는 공용 도구.
 *
 * 로그인 화면 데모와 실제 화면(박스 지정, 추적 오버레이, 분석 중)이 같은 모양으로 보이도록
 * 그리는 방식을 한곳에 모았다. 파란 하늘 위에서도 잘 보이도록 노랑과 흰색을 쓴다.
 * 모든 좌표는 canvas CSS 픽셀(화면 좌표)이다.
 */

export const HIGHLIGHT = '#ffd23f'
export const WHITE = '#ffffff'

/**
 * 대상을 감싸는 박스. 굵은 흰 모서리, 색 테두리, 안쪽 가장자리만 물들인 채움.
 * 가운데는 비워 둬서 대상이 가려지지 않는다.
 *
 * @param rect   {x, y, width, height} 화면 좌표
 * @param opts   color 테두리색, label 라벨 글자, scale 박스 확대 배율(등장 연출), dashed 예측 프레임
 */
export function drawLock(ctx, rect, { color = HIGHLIGHT, label = '', scale = 1, dashed = false } = {}) {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const w = rect.width * scale
  const h = rect.height * scale
  const x = cx - w / 2
  const y = cy - h / 2
  const arm = Math.max(5, Math.min(w, h) * 0.34)

  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(w, h) * 0.75)
  g.addColorStop(0, 'rgba(255,210,63,0)')
  g.addColorStop(0.45, 'rgba(255,210,63,0.10)')
  g.addColorStop(1, 'rgba(255,210,63,0.5)')
  ctx.save()
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)

  ctx.shadowColor = 'rgba(8,16,30,0.7)'
  ctx.shadowBlur = 6
  ctx.strokeStyle = WHITE
  ctx.lineWidth = 3
  ctx.beginPath()
  const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]
  for (const [ax, ay, sx, sy] of corners) {
    ctx.moveTo(ax, ay + sy * arm)
    ctx.lineTo(ax, ay)
    ctx.lineTo(ax + sx * arm, ay)
  }
  ctx.stroke()

  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  if (dashed) ctx.setLineDash([5, 4])
  ctx.strokeRect(x, y, w, h)
  ctx.restore()

  if (label) drawChip(ctx, label, x, y - 22, { strong: true, color })
}

/** 라벨 칩. 캔버스 밖으로 나가지 않게 가로 위치를 잡는다. */
export function drawChip(ctx, text, x, y, { strong = false, color = HIGHLIGHT, maxWidth = Infinity } = {}) {
  ctx.save()
  ctx.font = '700 12px "IBM Plex Mono", ui-monospace, Consolas, monospace'
  const tw = ctx.measureText(text).width + 14
  const lx = Math.max(4, Math.min(maxWidth - tw - 4, x))
  const ly = Math.max(4, y)
  ctx.fillStyle = strong ? color : 'rgba(8,16,30,0.85)'
  ctx.fillRect(lx, ly, tw, 19)
  ctx.fillStyle = strong ? '#1b1500' : '#ffffff'
  ctx.fillText(text, lx + 7, ly + 13.5)
  ctx.restore()
}

/**
 * 지나온 경로. 굵고 빛나며, 머리 쪽이 굵고 진하고 꼬리 쪽이 가늘고 옅다.
 *
 * @param points [{x, y}] 화면 좌표. 끊긴 구간은 호출 쪽에서 나눠 넘긴다.
 */
export function drawTrail(ctx, points, { width = 5, glow = 14, color = HIGHLIGHT } = {}) {
  const n = points.length - 1
  if (n < 1) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(255,170,0,0.9)'
  ctx.strokeStyle = color
  const seg = 2
  for (let i = 0; i < n; i += seg) {
    const j = Math.min(n, i + seg)
    const k = j / n
    ctx.globalAlpha = 0.35 + 0.65 * k
    ctx.shadowBlur = glow * k
    ctx.lineWidth = 2 + (width - 2) * k
    ctx.beginPath()
    ctx.moveTo(points[i].x, points[i].y)
    for (let m = i + 1; m <= j; m++) ctx.lineTo(points[m].x, points[m].y)
    ctx.stroke()
  }
  ctx.restore()
}

/** 클릭한 자리에서 퍼지는 고리. k 는 0~1 진행도. */
export function drawRipple(ctx, x, y, k) {
  const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3)
  ctx.save()
  ctx.strokeStyle = HIGHLIGHT
  ctx.lineWidth = 2.5
  ctx.globalAlpha = 1 - k
  ctx.beginPath()
  ctx.arc(x, y, 10 + 40 * e, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}
