import test from 'node:test'
import assert from 'node:assert/strict'
import { bindSelectionDismiss } from '../src/lib/selectionDismiss.js'

test('outside primary click dismisses without consuming the outside action', () => {
  const listeners = new Map()
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  let active = true, cancellations = 0
  const stage = { contains: node => node === 'canvas' }
  const button = { contains: node => node === 'button' }
  const dispose = bindSelectionDismiss(target, { isActive: () => active, roots: () => [stage, button], cancel() { cancellations++; active = false } })
  const click = node => ({ button: 0, target: node, preventDefault() { throw Error('must not consume') }, stopPropagation() { throw Error('must not consume') } })
  listeners.get('pointerdown')(click('canvas'))
  listeners.get('pointerdown')(click('button'))
  listeners.get('pointerdown')({ ...click('outside'), button: 2 })
  assert.equal(cancellations, 0)
  listeners.get('pointerdown')(click('outside'))
  assert.equal(cancellations, 1)
  listeners.get('pointerdown')(click('outside'))
  assert.equal(cancellations, 1)
  dispose()
  assert.equal(listeners.size, 0)
})

test('Escape only consumes key while selecting; composed paths stay inside', () => {
  const listeners = new Map()
  const root = { contains: () => false }
  let active = true, prevented = 0, cancelled = 0
  bindSelectionDismiss({ addEventListener: (n, f) => listeners.set(n, f), removeEventListener() {} }, {
    isActive: () => active, roots: () => [root], cancel() { cancelled++; active = false },
  })
  listeners.get('pointerdown')({ button: 0, composedPath: () => [root] })
  assert.equal(cancelled, 0)
  const key = { key: 'Escape', preventDefault() { prevented++ } }
  listeners.get('keydown')({ ...key, key: 'Enter' })
  listeners.get('keydown')(key)
  listeners.get('keydown')(key)
  assert.equal(cancelled, 1)
  assert.equal(prevented, 1)
})
