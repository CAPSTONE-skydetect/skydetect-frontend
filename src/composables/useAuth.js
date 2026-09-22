/**
 * 인증 상태. Pinia 없이 모듈 스코프 ref 로 싱글톤을 만든다.
 * 이 모듈을 import 하는 모든 컴포넌트가 같은 ref 를 본다.
 */
import { ref, readonly } from 'vue'
import { bootstrapSession, login as loginApi, logout as logoutApi } from '../api/auth.js'
import { setUnauthorizedHandler } from '../api/http.js'

const user = ref(null)
const ready = ref(false)          // 앱 시작 시 세션 확인이 끝났는가
const sessionExpired = ref(false) // 쓰던 중에 끊긴 건지, 그냥 로그인 안 한 건지 구분

let handlerRegistered = false

/**
 * 앱 시작 시 한 번. main.js 가 아니라 App.vue 에서 부른다(라우터가 없으므로).
 *
 * 하는 일 두 가지:
 *   1. 세션 생존 확인 (새로고침 후 로그인 유지)
 *   2. XSRF-TOKEN 쿠키 확보 — 401 이어도 쿠키는 내려온다. 이게 없으면
 *      첫 POST 인 로그인부터 403 이 난다.
 */
async function initialize() {
  registerGlobalUnauthorizedHandler()
  try {
    user.value = await bootstrapSession()
  } catch {
    // 서버가 안 떠 있는 경우. 로그인 화면에서 다시 시도하면 된다.
    user.value = null
  } finally {
    ready.value = true
  }
}

/**
 * 전역 401 처리.
 *
 * 유휴 30분 / 절대 12시간 만료 때문에, 화면이 잘 돌아가는 중에도 아무 요청이나
 * 갑자기 401 이 될 수 있다. 특히 절대 만료는 활동해도 리셋되지 않는다.
 * 그래서 개별 호출부가 아니라 여기서 한 번만 처리한다.
 *
 * 로그인 시도와 앱 시작 시 세션 확인은 skipAuthHandler 로 여기를 타지 않는다.
 * 그 둘의 401 은 "만료"가 아니라 정상 응답이기 때문이다.
 */
function registerGlobalUnauthorizedHandler() {
  if (handlerRegistered) return
  handlerRegistered = true

  setUnauthorizedHandler(() => {
    // 이미 로그아웃 상태인데 또 알릴 필요는 없다.
    if (user.value) sessionExpired.value = true
    user.value = null
  })
}

async function login(username, password) {
  sessionExpired.value = false
  user.value = await loginApi(username, password)
  return user.value
}

async function logout() {
  try {
    await logoutApi()
  } finally {
    // 서버 응답이 어떻든 화면은 로그아웃 상태로 간다.
    user.value = null
    sessionExpired.value = false
  }
}

export function useAuth() {
  return {
    user: readonly(user),
    ready: readonly(ready),
    sessionExpired: readonly(sessionExpired),
    initialize,
    login,
    logout,
  }
}
