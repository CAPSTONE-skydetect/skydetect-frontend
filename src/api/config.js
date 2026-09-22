/**
 * 실행 환경 스위치. 코드 여기저기에서 import.meta.env 를 읽지 않도록 한 곳에 모은다.
 */

/**
 * 클립/분석 API 를 mock 으로 돌릴지.
 *
 * 백엔드에 /api/clips, /api/analyses 가 생기면 .env 에서 false 로 바꾼다.
 * 인증은 이 스위치와 무관하게 항상 실제 백엔드를 탄다.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/**
 * 라이브 HLS 플레이리스트 주소.
 * 기본값은 ffmpeg 로 만든 로컬 파일이라 네트워크 없이도 돈다.
 */
export const HLS_URL = import.meta.env.VITE_HLS_URL || '/mock/hls/live.m3u8'

/** 상태 폴링 간격. SSE/WebSocket 은 백엔드 미구현이라 폴링이 전제다. */
export const POLL_INTERVAL_MS = 1_000
