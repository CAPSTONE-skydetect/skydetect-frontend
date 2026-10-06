/**
 * 실행 환경 스위치. import.meta.env 를 읽는 곳을 여기 하나로 모은다.
 */

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

/**
 * 클립을 어디서 가져올지: 'mock' | 'backend'
 * 백엔드에 /api/clips 가 생기면 .env 에서 backend 로 바꾼다.
 */
export const CLIP_SOURCE = pick(
  import.meta.env.VITE_CLIP_SOURCE, ['mock', 'backend'], 'mock',
)

/**
 * 분석을 어디로 보낼지: 'mock' | 'ai' | 'backend'
 *
 * 'ai' 는 AI 서버(8000)를 직접 부르는 개발용 경로다. 백엔드에 분석 API 가
 * 아직 없어서, 로컬에 AI 를 띄워두면 진짜 결과를 볼 수 있게 열어둔 길이다.
 * 정식 경로는 프론트 → 백엔드 → AI 이므로 'backend' 가 최종 목적지다.
 */
export const ANALYSIS_SOURCE = pick(
  import.meta.env.VITE_ANALYSIS_SOURCE, ['mock', 'ai', 'backend'], 'mock',
)

/** 인증은 스위치와 무관하게 항상 실제 백엔드를 탄다. */

/** 라이브 HLS 플레이리스트. 기본값은 네트워크 없이도 도는 로컬 파일. */
export const HLS_URL = import.meta.env.VITE_HLS_URL || '/mock/hls/live.m3u8'

/* AI 서버 프록시 접두어는 판정 모델마다 다르다. lib/aiModel.js 의 aiBase() 를 쓴다. */

/** 상태 폴링 간격. SSE/WebSocket 은 백엔드 미구현이라 폴링이 전제다. */
export const POLL_INTERVAL_MS = 1_000
