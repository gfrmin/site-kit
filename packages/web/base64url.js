// base64url for bytes and JSON. Written three times across the fleet — twice
// inside blazon alone (src/share/codec.js and functions/_lib/unlock.js), which
// is how the padding difference below went unnoticed.
//
// Web APIs only: identical in the browser, in Workers, and in Node >= 18.

/** @param {Uint8Array|ArrayBuffer} bytes */
export const bytesToBase64Url = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  // Chunked: `String.fromCharCode(...view)` blows the argument limit somewhere
  // around 100k bytes, which a compressed payload can reach.
  const CHUNK = 0x8000
  for (let i = 0; i < view.length; i += CHUNK) {
    bin += String.fromCharCode(...view.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** @param {string} s @returns {Uint8Array} */
export const base64UrlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  // Re-pad before atob. blazon's codec does this; kaomoji's generator does not,
  // and its inputs happen to always be a multiple of 4 — which is a property of
  // its data, not of the encoding. Padding here makes it true for any input.
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

/** JSON -> base64url. */
export const encodeJson = (value) =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))

/** base64url -> JSON. Throws on malformed input; callers should catch. */
export const decodeJson = (s) =>
  JSON.parse(new TextDecoder().decode(base64UrlToBytes(s)))
