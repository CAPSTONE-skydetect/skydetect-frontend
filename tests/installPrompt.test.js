import test from 'node:test'
import assert from 'node:assert/strict'
import { installMode, isIos, isMobileBrowser, isStandalone } from '../src/lib/installPrompt.js'

const base = { mobile: true, standalone: false, dismissed: false, ios: false, hasPrompt: false }

test('install guide picks the prompt button, the iOS text, or nothing', () => {
  assert.equal(installMode({ ...base, hasPrompt: true }), 'prompt')
  assert.equal(installMode({ ...base, ios: true }), 'ios')
  assert.equal(installMode(base), null)
})

test('install guide stays hidden on desktop, when installed, or after dismissal', () => {
  assert.equal(installMode({ ...base, hasPrompt: true, mobile: false }), null)
  assert.equal(installMode({ ...base, hasPrompt: true, standalone: true }), null)
  assert.equal(installMode({ ...base, ios: true, dismissed: true }), null)
})

test('platform detection', () => {
  assert.equal(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }), true)
  assert.equal(isIos({ userAgent: 'Macintosh; Intel Mac OS X', maxTouchPoints: 5 }), true)
  assert.equal(isIos({ userAgent: 'Macintosh; Intel Mac OS X', maxTouchPoints: 0 }), false)
  assert.equal(isMobileBrowser({ userAgentData: { mobile: true } }), true)
  assert.equal(isMobileBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), false)
  assert.equal(isStandalone({ matchMedia: () => ({ matches: true }) }, {}), true)
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }) }, { standalone: true }), true)
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }) }, {}), false)
})
