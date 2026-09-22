/**
 * 모든 HTTP 호출이 반드시 지나가는 단 하나의 통로.
 *
 * 여기에만 두 가지를 구현하고, 호출부는 이걸 신경 쓰지 않는다.
 *   1. CSRF  — 상태 변경 요청에 X-XSRF-TOKEN 헤더를 붙인다
 *   2. 401   — 세션이 끊기면 전역 핸들러를 호출한다
 *
 * 호출부마다 넣으면 언젠가 반드시 빠뜨리기 때문에 한 곳으로 모은다.
 */

/** 서버가 준 에러 응답을 그대로 실어 나르는 예외. */
export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    /** 백엔드의 ErrorResponse.code (LOGIN_FAILED / UNAUTHENTICATED / ACCESS_DENIED ...) */
    this.code = code
    this.body = body
  }
}

/** 네트워크가 끊겼거나 서버가 안 떠 있을 때. status 가 없다. */
export class NetworkError extends Error {
  constructor(cause) {
    super('서버에 연결할 수 없습니다.')
    this.name = 'NetworkError'
    this.status = 0
    this.cause = cause
  }
}

// CSRF

/**
 * XSRF-TOKEN 쿠키를 읽는다.
 *
 * 절대 캐싱하지 않는다. 서버는 로그인/로그아웃마다 토큰을 회전시키므로
 * 변수에 담아두면 그 직후 요청이 403 이 된다. 매 요청마다 새로 읽는 게 규칙이다.
 */
function readCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : undefined
}

/** GET/HEAD 에는 CSRF 토큰이 필요 없다. 나머지는 전부 필요하다. */
function needsCsrf(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

// 401 전역 처리

let unauthorizedHandler = null

/**
 * 세션이 끊겼을 때 부를 콜백을 등록한다. (useAuth 가 앱 시작 시 한 번 등록)
 *
 * 유휴 30분 / 절대 12시간 만료가 있어서, 화면이 멀쩡히 돌아가는 중에도
 * 아무 요청이나 갑자기 401 이 될 수 있다. 개별 호출부에서 처리하면 놓친다.
 */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler
}

// 본체

/**
 * @param {string} path      '/api/...' 형태의 same-origin 경로 (Vite 프록시가 백엔드로 넘긴다)
 * @param {object} options
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [options.method]
 * @param {object} [options.json]   JSON 본문
 * @param {object} [options.form]   application/x-www-form-urlencoded 본문 (로그인용)
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.skipAuthHandler]
 *        이 호출의 401 은 "세션 만료"가 아니라 정상 응답이라는 표시.
 *        로그인 시도(비밀번호 틀림)와 앱 시작 시 세션 확인이 여기 해당한다.
 */
export async function request(path, options = {}) {
  const { method = 'GET', json, form, signal, skipAuthHandler = false } = options

  const headers = {}
  let body

  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(form)
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }

  if (needsCsrf(method)) {
    const token = readCsrfToken()
    if (token) headers['X-XSRF-TOKEN'] = token
    // 토큰이 없으면 헤더를 생략한 채 보낸다. 서버는 403 을 주고,
    // 아래에서 "왜 403 인지" 알아볼 수 있는 메시지로 바꿔준다.
  }

  let response
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      signal,
      // 프록시 덕분에 same-origin 이다. 쿠키는 자동으로 실린다.
      credentials: 'same-origin',
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new NetworkError(error)
  }

  const payload = await parseBody(response)

  if (response.ok) return payload

  if (response.status === 401 && !skipAuthHandler) {
    unauthorizedHandler?.()
  }

  if (response.status === 403 && !readCsrfToken()) {
    throw new ApiError(403, 'CSRF_TOKEN_MISSING',
      'CSRF 토큰이 없어 요청이 거부되었습니다. 앱 시작 시 GET /api/auth/me 가 호출됐는지 확인하세요.', payload)
  }

  throw new ApiError(
    response.status,
    payload?.code,
    payload?.message,
    payload,
  )
}

/** 204 / 빈 본문 / JSON 아님 을 모두 견디는 본문 파서. */
async function parseBody(response) {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const http = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, options) => request(path, { ...options, method: 'POST' }),
  put: (path, options) => request(path, { ...options, method: 'PUT' }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),
}
