import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAnalytics, gateMode } from '../src/analytics.js'

const stubStorage = () => {
  const map = new Map()
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
}

// Records calls so a test can assert on "did not send", which is the whole
// point of the gate and the thing a live PostHog project cannot tell you.
const spyFetch = () => {
  const calls = []
  const fn = (url, init) => { calls.push({ url, init }); return undefined }
  fn.calls = calls
  return fn
}

test('gateMode: do-not-track wins over a present key', () => {
  assert.equal(gateMode({ dnt: true, hasKey: true }), 'dnt')
  assert.equal(gateMode({ dnt: false, hasKey: false }), 'no_key')
  assert.equal(gateMode({ dnt: false, hasKey: true }), 'enabled')
})

test('no key: drops events, warns exactly once, never calls fetch', () => {
  const fetchImpl = spyFetch()
  const warnings = []
  const a = createAnalytics({
    key: undefined, fetchImpl, storage: stubStorage(), warn: m => warnings.push(m)
  })

  assert.equal(a.mode, 'no_key')
  assert.equal(a.capture('$pageview'), 'no_key')
  assert.equal(a.capture('other'), 'no_key')

  assert.equal(fetchImpl.calls.length, 0)
  // Once, not once per event — a warning per event is noise people learn to
  // ignore, which is how this failure survived in the first place.
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /VITE_POSTHOG_KEY/)
})

test('do-not-track: silent, and no warning (this one is not a misconfiguration)', () => {
  const fetchImpl = spyFetch()
  const warnings = []
  const a = createAnalytics({
    key: 'phc_realkey', dnt: true, fetchImpl, storage: stubStorage(), warn: m => warnings.push(m)
  })

  assert.equal(a.capture('$pageview'), 'dnt')
  assert.equal(fetchImpl.calls.length, 0)
  assert.equal(warnings.length, 0)
})

test('with a key: posts the event to the capture endpoint', () => {
  const fetchImpl = spyFetch()
  const a = createAnalytics({
    key: 'phc_realkey', fetchImpl, storage: stubStorage(), random: () => 'fixed-id'
  })

  assert.equal(a.capture('$pageview', { $pathname: '/x' }), 'enabled')
  assert.equal(fetchImpl.calls.length, 1)

  const { url, init } = fetchImpl.calls[0]
  assert.equal(url, 'https://us.i.posthog.com/e/')
  assert.equal(init.keepalive, true)

  const body = JSON.parse(init.body)
  assert.equal(body.api_key, 'phc_realkey')
  assert.equal(body.event, '$pageview')
  assert.equal(body.distinct_id, 'fixed-id')
  assert.deepEqual(body.properties, { $pathname: '/x' })
})

test('a trailing slash on the host does not produce a double slash', () => {
  const fetchImpl = spyFetch()
  createAnalytics({
    key: 'phc_k', host: 'https://eu.i.posthog.com/', fetchImpl, storage: stubStorage()
  }).capture('e')
  assert.equal(fetchImpl.calls[0].url, 'https://eu.i.posthog.com/e/')
})

test('a storage that throws on access still sends', () => {
  const fetchImpl = spyFetch()
  const hostile = { get getItem () { throw new Error('SecurityError') } }
  const a = createAnalytics({
    key: 'phc_k', fetchImpl, storage: hostile, random: () => 'fallback-id'
  })

  assert.equal(a.capture('e'), 'enabled')
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).distinct_id, 'fallback-id')
})

test('the reference to the required variable stays in step with .env.example', async () => {
  const { readFileSync } = await import('node:fs')
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')

  // Anything the workflow refuses to build without must be documented, or the
  // failure message points at a variable nobody can find the meaning of.
  const required = (workflow.match(/require-vars:\s*(.+)/)?.[1] ?? '').trim().split(/[\s,]+/).filter(Boolean)
  assert.ok(required.length > 0, 'the template should require at least one variable')
  for (const name of required) {
    assert.match(env, new RegExp(`^${name}=`, 'm'), `${name} is required by CI but absent from .env.example`)
  }
})
