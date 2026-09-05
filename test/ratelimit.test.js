import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRate, checkRates, ipKey } from '../packages/kv/ratelimit.js'

const fakeKv = (seed = {}) => {
  const store = new Map(Object.entries(seed))
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
  }
}

test('allows up to the limit, then refuses', async () => {
  const kv = fakeKv()
  const now = 1_000_000
  for (let i = 0; i < 3; i++) {
    const r = await checkRate(kv, 'ip:1.2.3.4', { limit: 3, windowSec: 60, now })
    assert.equal(r.ok, true, `call ${i}`)
    assert.equal(r.remaining, 2 - i)
  }
  assert.equal((await checkRate(kv, 'ip:1.2.3.4', { limit: 3, windowSec: 60, now })).ok, false)
})

test('a new time bucket resets the count', async () => {
  const kv = fakeKv()
  const opts = { limit: 1, windowSec: 60 }
  assert.equal((await checkRate(kv, 'k', { ...opts, now: 0 })).ok, true)
  assert.equal((await checkRate(kv, 'k', { ...opts, now: 0 })).ok, false)
  assert.equal((await checkRate(kv, 'k', { ...opts, now: 60_000 })).ok, true)
})

test('sets a TTL past the window so buckets self-expire', async () => {
  const puts = []
  const kv = { get: async () => null, put: async (k, v, o) => puts.push(o) }
  await checkRate(kv, 'k', { limit: 5, windowSec: 60, now: 0 })
  assert.deepEqual(puts, [{ expirationTtl: 120 }])
})

test('checkRates short-circuits on the first failed limit', async () => {
  // The per-minute cap must not consume the daily budget on the way to failing.
  const kv = fakeKv()
  const limits = [
    { baseKey: 'min', limit: 0, windowSec: 60 },
    { baseKey: 'day', limit: 10, windowSec: 86_400 },
  ]
  const r = await checkRates(kv, limits, 0)
  assert.deepEqual(r, { ok: false, failed: 'min' })
  assert.equal(kv.store.size, 0, 'nothing should have been written')
})

test('ipKey collapses IPv6 to a /64 and leaves IPv4 alone', () => {
  const req = (ip) => ({ headers: { get: (h) => (h === 'CF-Connecting-IP' ? ip : null) } })
  assert.equal(ipKey(req('1.2.3.4')), '1.2.3.4')
  assert.equal(ipKey(req('2a01:4f8:1c1e:aaaa:bbbb:cccc:dddd:eeee')), '2a01:4f8:1c1e:aaaa::/64')
  assert.equal(ipKey({ headers: { get: () => null } }), 'unknown')
})
