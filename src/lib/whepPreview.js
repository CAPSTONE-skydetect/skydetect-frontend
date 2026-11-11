// Receive-only WHEP. No camera/microphone access and no external ICE servers.
export function sessionUrl(location, endpoint) {
  if (!location) throw new Error('WHEP session location missing')
  const url = new URL(location, endpoint)
  if (url.origin !== new URL(endpoint).origin) throw new Error('Unexpected WHEP session origin')
  return url.href
}

export async function waitForIce(pc, signal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (pc.iceGatheringState === 'complete') return
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', check)
      signal.removeEventListener('abort', abort)
      error ? reject(error) : resolve()
    }
    const check = () => { if (pc.iceGatheringState === 'complete') finish() }
    const abort = () => finish(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('ICE gathering timed out')), 5000)
    pc.addEventListener('icegatheringstatechange', check)
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}

export class WhepPreview {
  constructor(video, endpoint, onStatus, onStats, dependencies = {}) {
    Object.assign(this, { video, endpoint, onStatus, onStats })
    this.fetch = dependencies.fetch || globalThis.fetch.bind(globalThis)
    this.makePeer = dependencies.makePeer || (() => new RTCPeerConnection({ iceServers: [] }))
    this.playing = () => this.onStatus('playing', null)
    this.generation = 0
  }

  removeSession(url) {
    if (url) this.fetch(url, { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(3000) }).catch(() => {})
  }

  stop() {
    this.generation++
    clearTimeout(this.retryTimer)
    clearTimeout(this.requestTimer)
    clearTimeout(this.mediaTimer)
    clearInterval(this.statsTimer)
    this.controller?.abort()
    if (this.pc) {
      this.pc.ontrack = null
      this.pc.onconnectionstatechange = null
      this.pc.close()
      this.pc = null
    }
    this.video.removeEventListener('playing', this.playing)
    if (this.stream && this.video.srcObject === this.stream) this.video.srcObject = null
    this.stream = null
    this.removeSession(this.session)
    this.session = null
  }

  async resume() {
    try { await this.video.play() }
    catch (error) { this.onStatus(error.name === 'NotAllowedError' ? 'blocked' : 'error', error) }
  }

  async start() {
    this.stop()
    const generation = this.generation
    const current = () => generation === this.generation
    const fail = (error) => {
      if (!current()) return
      this.stop()
      this.onStatus('error', error)
      this.retryTimer = setTimeout(() => this.start(), 3000)
    }
    this.onStatus('loading', null)
    this.onStats(null)
    const controller = this.controller = new AbortController()
    this.requestTimer = setTimeout(() => controller.abort(), 12000)
    try {
      const pc = this.pc = this.makePeer()
      this.video.addEventListener('playing', this.playing)
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.ontrack = (event) => {
        if (!current()) return
        this.stream = event.streams[0] || new MediaStream([event.track])
        this.video.srcObject = this.stream
        this.resume()
      }
      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(pc.connectionState)) fail(new Error('WebRTC connection interrupted'))
      }
      await pc.setLocalDescription(await pc.createOffer())
      await waitForIce(pc, controller.signal)
      if (!current()) return
      const response = await this.fetch(this.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp, signal: controller.signal,
      })
      if (response.status !== 201) throw new Error(`WebRTC handshake failed (${response.status})`)
      const session = sessionUrl(response.headers.get('Location'), this.endpoint)
      if (!current()) { this.removeSession(session); return }
      this.session = session
      const sdp = await response.text()
      if (!current()) return
      await pc.setRemoteDescription({ type: 'answer', sdp })
      if (!current()) return
      clearTimeout(this.requestTimer)
      let lastFrames = 0
      let lastProgress = Date.now()
      let checking = false
      this.mediaTimer = setTimeout(() => {
        if (!lastFrames) fail(new Error('WebRTC received no decoded video'))
      }, 15000)
      this.statsTimer = setInterval(async () => {
        if (checking || !current()) return
        checking = true
        try {
          const stats = await pc.getStats()
          if (!current()) return
          for (const row of stats.values()) {
            if (row.type !== 'inbound-rtp' || row.kind !== 'video') continue
            if ((row.framesDecoded || 0) > lastFrames) {
              lastFrames = row.framesDecoded
              lastProgress = Date.now()
            }
            this.onStats({ frames: lastFrames, width: row.frameWidth, height: row.frameHeight,
              fps: row.framesPerSecond, lost: row.packetsLost })
          }
          if (Date.now() - lastProgress > 15000 && !this.video.paused) fail(new Error('WebRTC video stopped progressing'))
        } catch (error) { fail(error) }
        finally { checking = false }
      }, 2000)
    } catch (error) { fail(error) }
  }
}
