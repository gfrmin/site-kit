import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// `node --test` with zero test dependencies, matching blazon — the only repo in
// the fleet with a real suite. A test runner you have to install is a test
// runner a new site skips.
test('index.html declares a canonical URL', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+\/"/)
})

test('robots.txt points at this site\'s own sitemap', () => {
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const [, domain] = html.match(/<link rel="canonical" href="https:\/\/([^/"]+)/)
  assert.match(robots, new RegExp(`Sitemap: https://${domain}/sitemap\\.xml`))
})
