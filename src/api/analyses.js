/**
 * 분석 API. clips.js 와 같은 이유로 mock/real 스위치를 둔다.
 *
 * ⚠ 경로/필드는 제안 명세다. 확정 아님.
 */
import { http } from './http.js'
import { USE_MOCK } from './config.js'
import * as mock from './mock/mockBackend.js'

/**
 * 분석 요청.
 *
 * @param {string} clipId
 * @param {object} payload
 * @param {number} payload.initFrameIndex  정지 화면이 클립의 몇 번째 프레임인지
 * @param {[number, number, number, number]} payload.targetBbox
 *        **원본 영상 픽셀 좌표** [x, y, w, h]. 화면 좌표가 아니다.
 * @returns {Promise<{analysisId: string, status: 'PENDING'}>} 202
 */
export function createAnalysis(clipId, payload) {
  if (USE_MOCK) return mock.createAnalysis(clipId, payload)
  return http.post(`/api/clips/${encodeURIComponent(clipId)}/analysis`, { json: payload })
}

/** 분석 상태 조회. DONE/FAILED 가 될 때까지 폴링한다. */
export function fetchAnalysis(analysisId) {
  if (USE_MOCK) return mock.fetchAnalysis(analysisId)
  return http.get(`/api/analyses/${encodeURIComponent(analysisId)}`)
}

/** 분석 이력 목록. */
export function fetchAnalysisHistory() {
  if (USE_MOCK) return mock.fetchAnalysisHistory()
  return http.get('/api/analyses')
}

/**
 * @typedef {object} AnalysisDto
 * @property {string} analysisId
 * @property {'PENDING'|'RUNNING'|'DONE'|'FAILED'} status
 * @property {'bird'|'drone'|'uncertain'} [label]   DONE 일 때만
 * @property {number} [confidence]                  uncertain 이면 0 이 온다
 * @property {string|null} [rejectReason]           uncertain 사유
 * @property {number} [processingTimeMs]
 * @property {object} [quality]      제안 명세 밖. AI 가 주는 품질 요약
 * @property {object} [topFeatures]  제안 명세 밖. 기여도 상위 특징
 */
