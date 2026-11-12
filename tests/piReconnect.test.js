import test from 'node:test'
import assert from 'node:assert/strict'
import { piReconnectPlugin, sameOriginCsrf } from '../dev/piReconnect.js'

const headers = { host: '127.0.0.1:5179', origin: 'http://127.0.0.1:5179', cookie: 'XSRF-TOKEN=abc', 'x-xsrf-token': 'abc' }
function harness(user = { role: 'ROLE_OPERATOR' }, authenticated = true) {
  let handler, calls = 0
  piReconnectPlugin({ controllerPath: '/fixed/control.py', backendOrigin: 'http://localhost:5178',
    fetchImpl: async () => ({ ok: authenticated, json: async () => user }),
    run: async (exe, args) => { calls++; assert.deepEqual(args, ['/fixed/control.py', 'relay', 'reconnect']); return { stdout: '{"status":"already_running"}' } },
  }).configureServer({ config: { server: { host: '127.0.0.1', port: 5179 } }, middlewares: { use(fn) { handler = fn } } })
  return { calls: () => calls, async request(overrides = {}) {
    let status, body
    await handler({ method: 'POST', url: '/local-device/reconnect', headers, resume() {}, ...overrides },
      { writeHead(s) { status = s }, end(b) { body = JSON.parse(b) } }, () => {})
    return { status, body }
  } }
}
test('reconnect rejects cross-origin, wrong host and missing CSRF', async () => {
  for (const change of [{ origin: 'https://evil.example' }, { host: 'other:5179' }, { 'x-xsrf-token': '' }]) {
    const h = harness()
    assert.equal((await h.request({ headers: { ...headers, ...change } })).status, 403)
    assert.equal(h.calls(), 0)
  }
  assert.equal(sameOriginCsrf({ headers: { ...headers, cookie: 'XSRF-TOKEN=%xx' } }, 5179), false)
})
test('only authenticated operators can execute fixed reconnect command', async () => {
  for (const [h, code] of [[harness({}, false), 401], [harness({ role: 'ROLE_VIEWER' }), 403]]) {
    assert.equal((await h.request()).status, code)
    assert.equal(h.calls(), 0)
  }
  const h = harness()
  assert.equal((await h.request({ method: 'GET' })).status, 405)
  assert.equal(h.calls(), 0)
  assert.equal((await h.request()).status, 200)
  assert.equal((await h.request()).status, 429)
  assert.equal(h.calls(), 1)
})
