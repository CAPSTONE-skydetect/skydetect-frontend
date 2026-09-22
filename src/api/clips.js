/**
 * 클립 API.
 *
 * 백엔드 미구현 구간이다. USE_MOCK 이 true 면 mock, false 면 실제 호출로 간다.
 * 호출부(composable/컴포넌트)는 둘의 차이를 모른다 — 나중에 실서버로 바꾸는 작업이
 * .env 한 줄이 되도록 경계를 여기에 둔다.
 *
 * ⚠ 아래 real 구현의 경로/필드는 **제안 명세**지 확정이 아니다. 백엔드와 맞춰야 한다.
 */
import { http } from './http.js'
import { USE_MOCK } from './config.js'
import * as mock from './mock/mockBackend.js'

/**
 * 검출 트리거. 서버가 트리거 시각을 정하므로 보낼 본문이 없다.
 * @returns {Promise<{clipId: string, status: 'PENDING', readyAt: string}>} 202
 */
export function createClip() {
  if (USE_MOCK) return mock.createClip()
  return http.post('/api/clips', { json: {} })
}

/**
 * 클립 상태 조회. PENDING 인 동안 폴링한다.
 * @returns {Promise<ClipDto>}
 */
export function fetchClip(clipId) {
  if (USE_MOCK) return mock.fetchClip(clipId)
  return http.get(`/api/clips/${encodeURIComponent(clipId)}`)
}

/**
 * @typedef {object} ClipDto
 * @property {string} clipId
 * @property {'PENDING'|'READY'|'FAILED'} status
 * @property {string} [videoUrl]   READY 일 때만
 * @property {string} [readyAt]    PENDING 일 때. 남은 시간 계산에 쓴다
 * @property {number} [fps]        initFrameIndex 계산에 반드시 필요하다
 * @property {number} [width]      원본 해상도. bbox 좌표 변환의 기준
 * @property {number} [height]
 * @property {number} [frameCount]
 * @property {number} [durationMs]
 */
