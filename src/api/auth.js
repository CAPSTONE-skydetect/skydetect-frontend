/**
 * 인증 API. 이 부분은 백엔드에 이미 구현되어 있어 mock 을 타지 않는다.
 */
import { http } from './http.js'

/**
 * 현재 로그인한 사용자.
 *
 * skipAuthHandler=true 인 이유: 이 호출의 401 은 "세션이 끊겼다"가 아니라
 * "아직 로그인 안 했다"는 정상 상태다. 전역 세션만료 처리를 태우면 안 된다.
 *
 * @returns {Promise<{username: string, role: string} | null>}
 */
export async function fetchMe() {
  try {
    return await http.get('/api/auth/me', { skipAuthHandler: true })
  } catch (error) {
    if (error.status === 401) return null
    throw error
  }
}

/**
 * 앱 시작 시 딱 한 번 부른다. 두 가지 일을 동시에 한다.
 *
 *   1. 새로고침 후 세션이 살아있는지 확인
 *   2. XSRF-TOKEN 쿠키 받아오기  ← 이게 없으면 로그인 POST 부터 403 이 난다
 *
 * 401 이 나도 2번은 성사되므로 실패로 치지 않는다.
 */
export const bootstrapSession = fetchMe

/**
 * 로그인.
 *
 * JSON 이 아니라 form-urlencoded 다. Spring Security 의
 * UsernamePasswordAuthenticationFilter 가 그 형식만 읽기 때문이다.
 */
export async function login(username, password) {
  return http.post('/api/auth/login', {
    form: { username, password },
    // 비밀번호 틀림(401 LOGIN_FAILED)은 세션 만료가 아니다.
    skipAuthHandler: true,
  })
}

/** 로그아웃. 204, 본문 없음. 서버가 새 CSRF 토큰을 쿠키에 실어준다. */
export async function logout() {
  return http.post('/api/auth/logout')
}
