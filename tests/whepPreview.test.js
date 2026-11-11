import assert from 'node:assert/strict'
import test from 'node:test'
import { WhepPreview, sessionUrl, waitForIce } from '../src/lib/whepPreview.js'

const endpoint = 'http://127.0.0.1:18889/pi/whep'
class Peer extends EventTarget {
  iceGatheringState = 'complete'
  connectionState = 'new'
  addTransceiver(kind, options) { this.transceiver = { kind, ...options } }
  async createOffer() { return { type: 'offer', sdp: 'offer' } }
  async setLocalDescription(value) { this.localDescription = value }
  async setRemoteDescription(value) { this.remoteDescription = value }
  async getStats() { return new Map() }
  close() { this.closed = true }
}
function fixture(fetcher) {
  const video = new EventTarget()
  video.play = async () => {}
  const peer = new Peer()
  const calls = []
  const statuses = []
  const player = new WhepPreview(video, endpoint, (...args) => statuses.push(args), () => {}, {
    makePeer: () => peer,
    fetch: async (...args) => {
      calls.push(args)
      return fetcher ? fetcher(...args) : new Response('answer', {
        status: 201, headers: { Location: '/pi/whep/session-one' },
      })
    },
  })
  return { video, peer, calls, statuses, player }
}

test('only same-origin session locations are accepted', () => {
  assert.equal(sessionUrl('/pi/whep/id', endpoint), 'http://127.0.0.1:18889/pi/whep/id')
  assert.throws(() => sessionUrl('http://example.com/id', endpoint), /origin/)
  assert.throws(() => sessionUrl(null, endpoint), /missing/)
})

test('WHEP receives video only and deletes session on close', async () => {
  const f = fixture()
  try {
    await f.player.start()
    assert.deepEqual(f.peer.transceiver, { kind: 'video', direction: 'recvonly' })
    assert.equal(f.calls[0][1].method, 'POST')
    assert.equal(f.calls[0][1].body, 'offer')
    assert.deepEqual(f.peer.remoteDescription, { type: 'answer', sdp: 'answer' })
  } finally { f.player.stop() }
  assert.equal(f.peer.closed, true)
  assert.equal(f.calls.at(-1)[1].method, 'DELETE')
})

test('handshake errors are visible and cancellable', async () => {
  const f = fixture(async () => new Response('', { status: 404 }))
  await f.player.start()
  assert.equal(f.statuses.at(-1)[0], 'error')
  assert.match(f.statuses.at(-1)[1].message, /404/)
  assert.equal(f.peer.closed, true)
  f.player.stop()
})

test('late POST after stopping deletes orphan without attaching SDP', async () => {
  let respond
  let entered
  const posted = new Promise(resolve => { entered = resolve })
  const f = fixture(async (url, options) => {
    if (options.method === 'DELETE') return new Response('', { status: 200 })
    entered()
    return new Promise(resolve => { respond = resolve })
  })
  const starting = f.player.start()
  await posted
  f.player.stop()
  respond(new Response('late', { status: 201, headers: { Location: '/pi/whep/late' } }))
  await starting
  assert.equal(f.peer.remoteDescription, undefined)
  assert.equal(f.calls.at(-1)[1].method, 'DELETE')
})

test('ICE gathering is abortable', async () => {
  const pc = new Peer()
  pc.iceGatheringState = 'gathering'
  const controller = new AbortController()
  const promise = waitForIce(pc, controller.signal)
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' })
})

test('stop never clears a replacement player stream', async () => {
  const f = fixture()
  await f.player.start()
  f.player.stream = { old: true }
  const replacement = { new: true }
  f.video.srcObject = replacement
  f.player.stop()
  assert.equal(f.video.srcObject, replacement)
})
