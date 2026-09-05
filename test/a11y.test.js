import { test } from 'node:test'
import assert from 'node:assert/strict'
import { srOnly, srOnlyCss } from '../packages/web/a11y.js'

test('both shapes declare the same properties', () => {
  const css = srOnlyCss('visually-hidden')
  for (const prop of ['position', 'width', 'height', 'padding', 'margin', 'overflow', 'clip', 'white-space', 'border']) {
    assert.match(css, new RegExp(`\\b${prop}:`), prop)
  }
  assert.deepEqual(Object.keys(srOnly).sort(), [
    'border', 'clip', 'height', 'margin', 'overflow', 'padding', 'position', 'whiteSpace', 'width',
  ])
})

test('srOnly is frozen so a consumer cannot mutate the shared object', () => {
  assert.throws(() => { srOnly.width = 999 }, TypeError)
})

test('srOnlyCss takes the class name the repo already uses', () => {
  assert.match(srOnlyCss('sr-only'), /^\.sr-only \{/)
  assert.match(srOnlyCss('visually-hidden'), /^\.visually-hidden \{/)
})
