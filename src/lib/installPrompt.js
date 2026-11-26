// "홈 화면에 추가" 안내. 브라우저마다 방식이 달라서 한곳에 모은다.
//  - Android Chrome 등: beforeinstallprompt 이벤트를 붙잡아 두었다가 버튼을 누를 때 설치창을 띄운다.
//  - iOS: 설치창을 띄우는 API 가 없어서 "공유 → 홈 화면에 추가" 방법을 글로 안내한다.
// 이벤트는 앱이 그려지기 전에 올 수 있으므로 import 하는 즉시 듣기 시작한다(main.js 에서 import).
import { ref } from 'vue'

const DISMISS_KEY = 'skydetect.installDismissed'

/** 홈 화면에서 실행한 상태인가. 이미 설치했으면 안내하지 않는다. */
export function isStandalone(win = globalThis.window, nav = globalThis.navigator) {
  return !!(win?.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone)
}

export function isIos(nav = globalThis.navigator) {
  const ua = nav?.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS 는 데스크톱 Safari 로 위장한다.
  return /Macintosh/i.test(ua) && (nav?.maxTouchPoints || 0) > 1
}

export function isMobileBrowser(nav = globalThis.navigator) {
  if (typeof nav?.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile
  return isIos(nav) || /Android|Mobile/i.test(nav?.userAgent || '')
}

/**
 * 어떤 안내를 보여줄지. 'prompt'(설치 버튼) | 'ios'(방법 안내) | null(안 보임)
 */
export function installMode({ mobile, standalone, dismissed, ios, hasPrompt }) {
  if (!mobile || standalone || dismissed) return null
  if (hasPrompt) return 'prompt'
  if (ios) return 'ios'
  return null
}

function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

const deferred = ref(null)
const dismissed = ref(readDismissed())
const installed = ref(false)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault() // 브라우저 기본 미니 바 대신 우리 안내를 쓴다.
    deferred.value = event
  })
  window.addEventListener('appinstalled', () => { installed.value = true; deferred.value = null })
}

export function currentInstallMode() {
  return installMode({
    mobile: isMobileBrowser(),
    standalone: installed.value || isStandalone(),
    dismissed: dismissed.value,
    ios: isIos(),
    hasPrompt: !!deferred.value,
  })
}

export async function promptInstall() {
  const event = deferred.value
  if (!event) return
  deferred.value = null // 이벤트는 한 번만 쓸 수 있다.
  event.prompt()
  await event.userChoice.catch(() => {})
}

export function dismissInstall() {
  dismissed.value = true
  try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* 저장소 접근 불가 */ }
}
