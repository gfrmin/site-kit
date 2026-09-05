import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bytesToBase64Url, base64UrlToBytes, encodeJson, decodeJson,
} from '../packages/web/base64url.js'

test('round-trips arbitrary bytes', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
  assert.deepEqual(base64UrlToBytes(bytesToBase64Url(bytes)), bytes)
})

test('emits no +, / or = characters', () => {
  // 0xfb 0xff produce '+' and '/' under standard base64.
  const encoded = bytesToBase64Url(Uint8Array.from([0xfb, 0xff, 0xfe, 0x01]))
  assert.ok(!/[+/=]/.test(encoded), `got ${encoded}`)
})

test('decodes an unpadded payload of every length mod 4', () => {
  // The bug this guards: atob() throws on an unpadded string whose length is
  // not a multiple of 4. kaomoji's copy skips the re-pad and only works because
  // its own inputs happen to be aligned.
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => i + 1)
    const encoded = bytesToBase64Url(bytes)
    assert.deepEqual(base64UrlToBytes(encoded), bytes, `length ${n}`)
  }
})

test('survives a payload past the fromCharCode argument limit', () => {
  // 200k bytes: `String.fromCharCode(...view)` throws RangeError well below this.
  const big = Uint8Array.from({ length: 200_000 }, (_, i) => i % 256)
  assert.deepEqual(base64UrlToBytes(bytesToBase64Url(big)), big)
})

test('round-trips JSON including non-ASCII', () => {
  const value = { slate: 'מחל', face: '(╯°□°)╯', n: 42 }
  assert.deepEqual(decodeJson(encodeJson(value)), value)
})
