/**
 * 분석 API.
 *
 * 세 갈래다.
 *   mock     브라우저 메모리
 *   ai       AI 서버(8000) 직결. 백엔드에 분석 API 가 없는 동안 쓰는 개발용 경로
 *   backend  프론트 → 백엔드 → AI. 정식 경로
 *
 * 실서버 경로/필드는 제안 명세지 확정이 아니다. docs/api-questions.md 참고.
 */
import { http } from './http.js'
import { ANALYSIS_SOURCE } from './config.js'
import * as mock from './mock/mockBackend.js'
import * as ai from './ai.js'

/**
 * 분석 요청.
 *
 * @param {string} clipId
 * @param {object} payload
 * @param {number} payload.initFrameIndex  정지 화면이 클립의 몇 번째 프레임인지
 * @param {[number, number, number, number]} payload.targetBbox
 *        원본 영상 픽셀 좌표 [x, y, w, h]. 화면 좌표가 아니다.
 * @param {object} [context]
 * @param {string} [context.videoUrl]  AI 직결 경로에서만 쓴다 (업로드용)
 * @returns {Promise<{analysisId: string, status: 'PENDING'}>} 202
 */
export function createAnalysis(clipId, payload, context) {
  if (ANALYSIS_SOURCE === 'mock') return mock.createAnalysis(clipId, payload)
  if (ANALYSIS_SOURCE === 'ai') return ai.createAnalysis(clipId, payload, context)
  return http.post(`/api/clips/${encodeURIComponent(clipId)}/analysis`, { json: payload })
}

/** 분석 상태 조회. DONE/FAILED 가 될 때까지 폴링한다. */
export function fetchAnalysis(analysisId) {
  if (ANALYSIS_SOURCE === 'mock') return mock.fetchAnalysis(analysisId)
  if (ANALYSIS_SOURCE === 'ai') return ai.fetchAnalysis(analysisId)
  return http.get(`/api/analyses/${encodeURIComponent(analysisId)}`)
}

/** 분석 이력 목록. */
export function fetchAnalysisHistory() {
  if (ANALYSIS_SOURCE === 'mock') return mock.fetchAnalysisHistory()
  if (ANALYSIS_SOURCE === 'ai') return ai.fetchAnalysisHistory()
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
