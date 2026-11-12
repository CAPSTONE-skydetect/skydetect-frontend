import { execFile } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export const RECONNECT_PATH = '/local-device/reconnect'

export function sameOriginCsrf(req, port) {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (!allowed.includes(req.headers.host) || req.headers.origin !== `http://${req.headers.host}`) return false
  try {
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1]
    const token = req.headers['x-xsrf-token']
    if (!cookie || typeof token !== 'string') return false
    const a = Buffer.from(decodeURIComponent(cookie)), b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch { return false }
}

// Opt-in host-side development helper. No Docker socket, host discovery scan or key enrollment.
export function piReconnectPlugin({ controllerPath, backendOrigin, python = 'python3', run = execute, fetchImpl = fetch }) {
  let busy = false
  let lastAttempt = -Infinity
  return {
    name: 'local-pi-reconnect',
    apply: 'serve',
    configureServer(server) {
      if (server.config.server.host !== '127.0.0.1') throw new Error('Pi helper requires a loopback-only dev server')
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== RECONNECT_PATH) return next()
        const reply = (status, message, extra = {}) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ message, ...extra }))
        }
        if (req.method !== 'POST') return reply(405, 'POST required')
        if (!sameOriginCsrf(req, server.config.server.port)) return reply(403, 'Same-origin session and CSRF required')
        req.resume()
        try {
          const response = await fetchImpl(`${backendOrigin}/api/auth/me`, { headers: { cookie: req.headers.cookie }, signal: AbortSignal.timeout(4000), redirect: 'error' })
          if (!response.ok) return reply(401, '로그인이 필요합니다.')
          const user = await response.json()
          if (user.role !== 'ROLE_OPERATOR') return reply(403, '운영자 권한이 필요합니다.')
          if (busy || Date.now() - lastAttempt < 5000) return reply(429, '연결 확인 중입니다. 잠시 후 다시 시도하세요.')
          busy = true
          lastAttempt = Date.now()
          try {
            const { stdout } = await run(python, [controllerPath, 'relay', 'reconnect'], { timeout: 25000, maxBuffer: 64 * 1024 })
            reply(200, '파이 연결 확인 완료. 영상 수신을 재시도합니다.', { relay: JSON.parse(stdout) })
          } finally { busy = false }
        } catch {
          reply(503, '파이에 연결하지 못했습니다. 전원·랜선·설정 주소·기존 SSH 인증을 확인하세요. 인증 정보는 자동 등록하지 않습니다.')
        }
      })
    },
  }
}
