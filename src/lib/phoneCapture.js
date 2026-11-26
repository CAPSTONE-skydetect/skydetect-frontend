// 폰 카메라 실시간 모드에서 쓰는 순수 함수 모음. 브라우저 객체는 인자로 받아 테스트할 수 있게 한다.

/** 녹화 길이. 업로드 분석의 추적 길이(maxSeconds 10)와 맞춘다. */
export const RECORD_SECONDS = 10

/**
 * 폰(태블릿 포함)에서 카메라를 쓸 수 있는 환경인가.
 * 노트북은 false 여서 기존대로 파이 영상을 본다.
 * getUserMedia 는 HTTPS 에서만 열리므로 mediaDevices 가 없으면 폰이어도 false 다.
 */
export function isPhoneDevice(nav = globalThis.navigator) {
  if (!nav?.mediaDevices?.getUserMedia) return false
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile
  const ua = nav.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true
  // iPadOS 는 데스크톱 Safari 로 위장한다.
  return /Macintosh/i.test(ua) && (nav.maxTouchPoints || 0) > 1
}

// 서버(AI)가 확실히 읽는 mp4 를 먼저 고르고, 안 되는 기기만 webm 으로 떨어진다.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

/** MediaRecorder 가 지원하는 첫 형식. 하나도 없으면 빈 문자열(브라우저 기본값 사용). */
export function pickRecorderMime(recorderClass = globalThis.MediaRecorder) {
  if (!recorderClass?.isTypeSupported) return ''
  return MIME_CANDIDATES.find((type) => recorderClass.isTypeSupported(type)) || ''
}

export function extensionFor(mime) {
  return /mp4/i.test(mime) ? 'mp4' : 'webm'
}

/** 'phone_20261126_143005.mp4' 처럼 찍은 시각이 보이는 파일 이름. */
export function recordingName(mime, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `phone_${stamp}.${extensionFor(mime)}`
}

/** getUserMedia 오류를 화면에 보일 한국어 문장으로. */
export function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '카메라 권한이 막혀 있습니다. 브라우저 주소창의 권한 설정에서 카메라를 허용해 주세요.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '사용할 수 있는 카메라를 찾지 못했습니다.'
    case 'NotReadableError':
    case 'AbortError':
      return '카메라를 다른 앱이 쓰고 있거나 열 수 없습니다. 다른 앱을 닫고 다시 시도해 주세요.'
    default:
      return error?.message || '카메라를 열지 못했습니다.'
  }
}
