/**
 * 클립 API.
 *
 * spring-pi 모드에서는 새 클립은 Spring에 쓰고 기존 클립은 브리지에서 읽는다.
 */
import { http } from './http.js'
import { CLIP_SOURCE } from './config.js'
import * as mock from './mock/mockBackend.js'

/**
 * 검출 트리거. 영상 시각은 참고 정보이며 서버가 저장 기준 시각을 정한다.
 * @returns {Promise<{clipId: string, status: 'PENDING', readyAt: string}>} 202
 */
export function createClip(observation = {}) {
  if (CLIP_SOURCE === 'mock') return mock.createClip()
  if (CLIP_SOURCE === 'local') return http.post('/local-api/clips', { json: observation })
  return http.post('/api/clips', { json: observation })
}

/** 클립 상태 조회. PENDING 인 동안 폴링한다. */
export function fetchClip(clipId) {
  if (CLIP_SOURCE === 'mock') return mock.fetchClip(clipId)
  if (CLIP_SOURCE === 'local' || (CLIP_SOURCE === 'spring-pi' && /^clip_[0-9a-f]{32}$/.test(clipId))) {
    return http.get(`/local-api/clips/${encodeURIComponent(clipId)}`)
  }
  return http.get(`/api/clips/${encodeURIComponent(clipId)}`)
}

/** Server-persisted clip records used to restore the queue after a reload. */
export async function listClips() {
  if (CLIP_SOURCE === 'local') return http.get('/local-api/clips')
  if (CLIP_SOURCE === 'spring-pi') {
    const [current, legacy] = await Promise.all([http.get('/api/clips'), http.get('/local-api/clips')])
    return { clips: [...current.clips, ...legacy.clips].sort(
      (a, b) => b.serverReceivedEpochMs - a.serverReceivedEpochMs,
    ) }
  }
  if (CLIP_SOURCE === 'backend') return http.get('/api/clips')
  return Promise.resolve({ clips: [] })
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
