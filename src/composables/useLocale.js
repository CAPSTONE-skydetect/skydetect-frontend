/**
 * 화면 언어(한국어/영어) 전환.
 *
 * 선택한 언어는 localStorage 에 저장해 새로고침 뒤에도 유지한다.
 * 저장소를 못 쓰는 환경(사생활 보호 창 등)에서는 조용히 메모리로만 동작한다.
 * 문구는 아래 MESSAGES 에 모은다. 키 목록이 한/영 같아야 하며, 없는 키는 키 이름이 그대로 보인다.
 */
import { ref, computed } from 'vue'

const STORAGE_KEY = 'skydetect.locale'

function initial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ko' || saved === 'en') return saved
  } catch { /* 저장소 접근 불가 */ }
  return 'en'
}

const locale = ref(initial())
document.documentElement.lang = locale.value

const MESSAGES = {
  en: {
    'login.title': 'Drone Detection System',
    'login.subtitle': 'Detects drones from live streams and recorded video.',
    'login.heading': 'Sign in',
    'login.expired': 'Your session has expired. Please sign in again.',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.submitting': 'Signing in',
    'login.err.network': 'Cannot reach the server. Check the backend (port 8080).',
    'login.err.csrf': 'CSRF token error. Refresh the page and try again.',
    'login.err.fallback': 'Sign-in failed.',
    'login.scroll': 'Scroll for the guide',
    'login.welcome': 'Signed in as',
    'login.choose': 'Where to?',
    'login.choose.sub': 'Pick a part to open.',
    'login.enter.live': 'Live detection',
    'login.enter.live.text': 'Watch the camera stream and cut out moments to analyze.',
    'login.enter.upload': 'Video upload',
    'login.enter.upload.text': 'Analyze a recorded video by selecting an object.',
    'login.enter.history': 'Detection history',
    'login.enter.history.text': 'Review past results.',
    'login.signout': 'Sign out',
    'lang.switch': 'Switch language',

    'demo.aria': 'Demo on real footage: pick an object, track it, analyze its trajectory and identify it as a drone',
    'demo.tag': 'REC · SAMPLE FOOTAGE',
    'demo.detect': 'Select',
    'demo.detect.text': 'Playback pauses. Click the object you want to follow.',
    'demo.track': 'Track',
    'demo.track.text': 'A bounding box locks on and follows it, drawing its path.',
    'demo.analyze': 'Analyze',
    'demo.analyze.text': 'The extracted trajectory is analyzed from start to end.',
    'demo.result': 'Result',
    'demo.result.text': 'Final decision: this object is a drone.',
    'demo.hint': 'Click the object',
    'demo.candidate': 'target',
    'demo.analyzing': 'ANALYZING',
    'demo.verdict': 'RESULT',
    'demo.drone': 'DRONE',
  },
  ko: {
    'login.title': '드론 탐지 시스템',
    'login.subtitle': '실시간 영상과 녹화 영상에서 드론을 탐지합니다.',
    'login.heading': '로그인',
    'login.expired': '세션이 만료되었습니다. 다시 로그인하세요.',
    'login.username': '아이디',
    'login.password': '비밀번호',
    'login.submit': '로그인',
    'login.submitting': '확인 중',
    'login.err.network': '서버에 연결할 수 없습니다. 백엔드(8080)를 확인하세요.',
    'login.err.csrf': 'CSRF 토큰 오류입니다. 새로고침 후 다시 시도하세요.',
    'login.err.fallback': '로그인에 실패했습니다.',
    'login.scroll': '아래로 내려 이용 안내 보기',
    'login.welcome': '로그인한 계정',
    'login.choose': '어디로 갈까요?',
    'login.choose.sub': '들어갈 파트를 고르세요.',
    'login.enter.live': '실시간 탐지',
    'login.enter.live.text': '카메라 영상을 보다가 순간을 잘라 분석합니다.',
    'login.enter.upload': '영상 업로드',
    'login.enter.upload.text': '녹화 영상에서 물체를 골라 분석합니다.',
    'login.enter.history': '검출 기록',
    'login.enter.history.text': '지난 결과를 다시 봅니다.',
    'login.signout': '로그아웃',
    'lang.switch': '언어 전환',

    'demo.aria': '실제 영상 데모: 대상을 선택하고, 추적하고, 궤적을 분석해 드론으로 판별합니다',
    'demo.tag': 'REC · 샘플 영상',
    'demo.detect': '선택',
    'demo.detect.text': '재생이 멈춥니다. 따라갈 대상을 클릭하세요.',
    'demo.track': '추적',
    'demo.track.text': '바운딩 박스가 대상에 붙어 따라가며 이동 경로를 그립니다.',
    'demo.analyze': '분석',
    'demo.analyze.text': '뽑힌 궤적을 처음부터 끝까지 분석합니다.',
    'demo.result': '결과',
    'demo.result.text': '최종 판정: 이 객체는 드론입니다.',
    'demo.hint': '대상을 클릭',
    'demo.candidate': '대상',
    'demo.analyzing': '분석 중',
    'demo.verdict': '판정',
    'demo.drone': '드론',
  },
}

function setLocale(next) {
  if (next !== 'ko' && next !== 'en') return
  locale.value = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* 저장 실패는 무시 */ }
  document.documentElement.lang = next
}

export function useLocale() {
  const t = (key) => MESSAGES[locale.value][key] ?? key
  const isKo = computed(() => locale.value === 'ko')
  return { locale, isKo, t, setLocale }
}
