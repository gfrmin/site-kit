// Minimal PostHog capture, with the gate that matters.
//
// No SDK dependency on purpose. site-kit ships zero dependencies, and a starter
// site should not pull ~50 kB of JavaScript to record a pageview. If you later
// want autocapture or session replay, swap in posthog-js — but keep the gate,
// because the gate is the part that has actually gone wrong in this fleet.
//
// What went wrong: blazon shipped for weeks with VITE_POSTHOG_KEY unset. Its
// analytics silently no-opped — no console output, no failed request, nothing
// in a green build or a 200 from the deployed site. The real fix is
// `require-vars` in site-kit's shared deploy workflow, which refuses to build
// without the key. The warning below is the second line of defence, for the
// case where someone builds by hand.

const DEFAULT_HOST = 'https://us.i.posthog.com'
const ID_KEY = 'ph_distinct_id'

// Exported for its own sake: a three-state gate is much easier to test, and to
// reason about, than a chain of `if (!key) return` scattered through a module.
export function gateMode ({ dnt, hasKey }) {
  if (dnt) return 'dnt'
  if (!hasKey) return 'no_key'
  return 'enabled'
}

// Sandboxed contexts throw on merely ACCESSING localStorage, not just on
// reading a key from it — so the whole thing sits inside one try.
function distinctId (storage, random) {
  try {
    const existing = storage.getItem(ID_KEY)
    if (existing) return existing
    const fresh = random()
    storage.setItem(ID_KEY, fresh)
    return fresh
  } catch {
    return random()
  }
}

export function createAnalytics ({
  key,
  host,
  dnt = false,
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  warn = console.warn,
  random = () => globalThis.crypto.randomUUID()
} = {}) {
  const mode = gateMode({ dnt, hasKey: Boolean(key) })
  const base = String(host || DEFAULT_HOST).replace(/\/+$/, '')
  let warned = false

  // Returns the mode it acted in, so a caller (or a test) can tell the
  // difference between "sent" and "deliberately dropped" without guessing.
  const capture = (event, properties = {}) => {
    if (mode === 'dnt') return mode
    if (mode === 'no_key') {
      if (!warned) {
        warned = true
        warn('[analytics] no PostHog key — every event is being dropped. Set the VITE_POSTHOG_KEY repository Variable.')
      }
      return mode
    }
    // keepalive so a pageview survives the navigation that triggered it.
    // Errors are swallowed: analytics must never break the page.
    fetchImpl(`${base}/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId(storage, random),
        properties
      })
    })?.catch?.(() => {})
    return mode
  }

  return { mode, capture }
}
