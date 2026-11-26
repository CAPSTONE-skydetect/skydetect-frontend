import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isPhoneDevice, pickRecorderMime, extensionFor, recordingName, cameraErrorMessage,
} from '../src/lib/phoneCapture.js'

const media = { getUserMedia() {} }

test('phone is detected by userAgentData, then user agent, and needs a camera API', () => {
  assert.equal(isPhoneDevice({ mediaDevices: media, userAgentData: { mobile: true } }), true)
  assert.equal(isPhoneDevice({ mediaDevices: media, userAgentData: { mobile: false }, userAgent: 'iPhone' }), false)
  assert.equal(isPhoneDevice({ mediaDevices: media, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }), true)
  assert.equal(isPhoneDevice({ mediaDevices: media, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), false)
  // 아이패드 Safari
  assert.equal(isPhoneDevice({ mediaDevices: media, userAgent: 'Macintosh; Intel Mac OS X', maxTouchPoints: 5 }), true)
  assert.equal(isPhoneDevice({ mediaDevices: media, userAgent: 'Macintosh; Intel Mac OS X', maxTouchPoints: 0 }), false)
  // HTTP 에서는 mediaDevices 가 없다
  assert.equal(isPhoneDevice({ userAgent: 'Android Mobile' }), false)
})

test('recorder prefers mp4 and falls back to webm', () => {
  const only = (...types) => ({ isTypeSupported: (t) => types.includes(t) })
  assert.equal(pickRecorderMime(only('video/mp4', 'video/webm')), 'video/mp4')
  assert.equal(pickRecorderMime(only('video/webm;codecs=vp8')), 'video/webm;codecs=vp8')
  assert.equal(pickRecorderMime(only()), '')
  assert.equal(pickRecorderMime(undefined), '')
})

test('recording file name carries time and matching extension', () => {
  const at = new Date(2026, 10, 26, 14, 30, 5)
  assert.equal(recordingName('video/mp4;codecs=avc1.42E01E', at), 'phone_20261126_143005.mp4')
  assert.equal(recordingName('video/webm', at), 'phone_20261126_143005.webm')
  assert.equal(extensionFor(''), 'webm')
})

test('camera errors become readable Korean messages', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /권한/)
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /카메라/)
  assert.equal(cameraErrorMessage({ name: 'Weird', message: 'boom' }), 'boom')
})
