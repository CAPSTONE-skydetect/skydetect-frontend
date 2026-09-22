/**
 * <video> 표시 영역 좌표 ↔ 원본 영상 픽셀 좌표 변환.
 *
 * 왜 따로 빼는가:
 *   AI 로 보내는 targetBbox 는 원본 픽셀 좌표다. 화면에 640px 폭으로 보이는
 *   1920px 영상에서 사용자가 그린 박스를 그대로 보내면 3배 어긋난다.
 *   그런데 이 버그는 화면상으로는 전혀 티가 나지 않고 AI 결과만 이상해진다.
 *   그래서 (1) 순수 함수로 분리해 검증 가능하게 두고,
 *        (2) 변환 결과를 다시 화면 좌표로 되돌려 눈으로 대조할 수 있게 한다.
 *
 * object-fit: contain 이면 위아래(또는 좌우)에 레터박스 여백이 생긴다.
 * 그 여백만큼 빼지 않으면 또 어긋난다. 그래서 스케일만이 아니라 오프셋도 같이 다룬다.
 */

/**
 * 현재 렌더 상태를 기술하는 변환 정보를 만든다.
 *
 * @param {object} p
 * @param {number} p.intrinsicWidth   video.videoWidth (원본 가로 픽셀)
 * @param {number} p.intrinsicHeight  video.videoHeight
 * @param {number} p.boxWidth         표시 영역 가로 (clientWidth)
 * @param {number} p.boxHeight        표시 영역 세로 (clientHeight)
 * @param {'contain'|'cover'} [p.fit]
 * @returns {{scale:number, offsetX:number, offsetY:number,
 *            displayWidth:number, displayHeight:number,
 *            intrinsicWidth:number, intrinsicHeight:number} | null}
 */
export function createFitTransform({
  intrinsicWidth,
  intrinsicHeight,
  boxWidth,
  boxHeight,
  fit = 'contain',
}) {
  if (!intrinsicWidth || !intrinsicHeight || !boxWidth || !boxHeight) return null

  const scaleX = boxWidth / intrinsicWidth
  const scaleY = boxHeight / intrinsicHeight
  // contain: 작은 쪽에 맞춰 전체가 들어온다 → 남는 쪽에 여백
  // cover  : 큰 쪽에 맞춰 꽉 채운다        → 넘치는 쪽이 잘림 (오프셋이 음수)
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)

  const displayWidth = intrinsicWidth * scale
  const displayHeight = intrinsicHeight * scale

  return {
    scale,
    offsetX: (boxWidth - displayWidth) / 2,
    offsetY: (boxHeight - displayHeight) / 2,
    displayWidth,
    displayHeight,
    intrinsicWidth,
    intrinsicHeight,
  }
}

/** 표시 영역 좌표 → 원본 픽셀 좌표 */
export function toSourcePoint(transform, x, y) {
  return {
    x: (x - transform.offsetX) / transform.scale,
    y: (y - transform.offsetY) / transform.scale,
  }
}

/** 원본 픽셀 좌표 → 표시 영역 좌표 (검증용 재투영에 쓴다) */
export function toDisplayPoint(transform, x, y) {
  return {
    x: x * transform.scale + transform.offsetX,
    y: y * transform.scale + transform.offsetY,
  }
}

/**
 * 표시 영역 사각형 → 원본 픽셀 사각형.
 * 결과는 원본 프레임 안으로 잘라낸다(clamp). 레터박스 여백에 걸친 드래그가
 * 음수 좌표로 나가면 서버가 422 를 준다.
 */
export function rectToSource(transform, rect) {
  const topLeft = toSourcePoint(transform, rect.x, rect.y)
  const bottomRight = toSourcePoint(transform, rect.x + rect.width, rect.y + rect.height)

  const x0 = clamp(Math.min(topLeft.x, bottomRight.x), 0, transform.intrinsicWidth)
  const y0 = clamp(Math.min(topLeft.y, bottomRight.y), 0, transform.intrinsicHeight)
  const x1 = clamp(Math.max(topLeft.x, bottomRight.x), 0, transform.intrinsicWidth)
  const y1 = clamp(Math.max(topLeft.y, bottomRight.y), 0, transform.intrinsicHeight)

  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** 원본 픽셀 사각형 → 표시 영역 사각형 (눈으로 검증할 때 되그리는 용도) */
export function rectToDisplay(transform, rect) {
  const topLeft = toDisplayPoint(transform, rect.x, rect.y)
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  }
}

/**
 * 정지 화면이 클립의 몇 번째 프레임인지.
 * fps 는 반드시 클립 메타데이터에서 온 값을 써야 한다. 30 을 상수로 박으면
 * 클립 fps 가 다를 때 조용히 틀린 프레임을 가리킨다.
 */
export function toFrameIndex(currentTimeSec, fps, frameCount) {
  const index = Math.round(currentTimeSec * fps)
  if (!Number.isFinite(index) || index < 0) return 0
  if (frameCount) return Math.min(index, frameCount - 1)
  return index
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
