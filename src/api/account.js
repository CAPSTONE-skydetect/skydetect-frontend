/**
 * 계정 API. 로그인 전에 쓰므로 401 은 세션 만료가 아니다(skipAuthHandler).
 * 가입 중 입력 오류나 중복은 서버가 {code, message} 로 알려 준다.
 */
import { http } from './http.js'

const open = { skipAuthHandler: true }

export const signup = (username, email, password) =>
  http.post('/api/auth/signup', { json: { username, email, password }, ...open })

export const findUsername = (email) =>
  http.post('/api/auth/find-username', { json: { email }, ...open })

export const requestPasswordReset = (email) =>
  http.post('/api/auth/password-reset/request', { json: { email }, ...open })

export const confirmPasswordReset = (token, newPassword) =>
  http.post('/api/auth/password-reset/confirm', { json: { token, newPassword }, ...open })
