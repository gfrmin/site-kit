// Fixed-window rate limiter over Workers KV.
//
// From blazon's functions/_lib/ratelimit.js, the only implementation in the
// fleet. kaomoji's /e and /og/maker endpoints have no limiter at all — cheap and
// idempotent, so arguably fine, but that was never a decision anyone recorded.
//
// KV is eventually consistent, so this is a cost BACKSTOP, not a precise quota.
// Pure except for the injected `kv`; `now` is injectable so it is unit-testable.

/**
 * @param {{get: Function, put: Function}} kv
 * @param {string} baseKey  identity for this limit, e.g. "ip:1.2.3.4:min"
 * @param {{limit: number, windowSec: number, now?: number}} opts
 * @returns {Promise<{ok: boolean, remaining: number, key: string}>}
 */
export async function checkRate(kv, baseKey, { limit, windowSec, now = Date.now() }) {
  const bucket = Math.floor(now / (windowSec * 1000))
  const key = `rl:${baseKey}:${bucket}`
  const current = parseInt(await kv.get(key), 10) || 0
  if (current >= limit) return { ok: false, remaining: 0, key }
  // TTL a little past the window so the bucket self-expires.
  await kv.put(key, String(current + 1), { expirationTtl: windowSec + 60 })
  return { ok: true, remaining: limit - current - 1, key }
}

/**
 * Apply several limits in order; the first failure short-circuits, so a request
 * already over its per-minute cap does not also burn its daily budget.
 * @param {{get: Function, put: Function}} kv
 * @param {Array<{baseKey: string, limit: number, windowSec: number}>} limits
 * @param {number} [now]
 */
export async function checkRates(kv, limits, now = Date.now()) {
  for (const l of limits) {
    const r = await checkRate(kv, l.baseKey, { limit: l.limit, windowSec: l.windowSec, now })
    if (!r.ok) return { ok: false, failed: l.baseKey }
  }
  return { ok: true }
}

/**
 * A rate-limit key for a client IP.
 * IPv6 is collapsed to its /64 — a single client is routinely handed a whole
 * /64, so limiting the full address limits nothing.
 */
export const ipKey = (request) => {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (!ip.includes(':')) return ip
  return ip.split(':').slice(0, 4).join(':') + '::/64'
}
