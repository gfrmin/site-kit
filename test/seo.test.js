import { test } from 'node:test'
import assert from 'node:assert/strict'
import { robotsTxt } from '../packages/seo/robots.js'
import { urlset } from '../packages/seo/sitemap.js'

test('robots.txt defaults the sitemap to this origin', () => {
  const out = robotsTxt({ origin: 'https://kana.gfrm.in' })
  assert.match(out, /^User-agent: \*$/m)
  assert.match(out, /^Allow: \/$/m)
  assert.match(out, /^Sitemap: https:\/\/kana\.gfrm\.in\/sitemap\.xml$/m)
})

test('robots.txt trims a trailing slash off the origin', () => {
  assert.match(robotsTxt({ origin: 'https://kana.gfrm.in/' }), /gfrm\.in\/sitemap\.xml/)
  assert.ok(!robotsTxt({ origin: 'https://kana.gfrm.in/' }).includes('in//sitemap'))
})

test('robots.txt emits Disallow lines instead of Allow when given them', () => {
  const out = robotsTxt({ origin: 'https://x.test', disallow: ['/admin', '/api/'] })
  assert.match(out, /^Disallow: \/admin$/m)
  assert.match(out, /^Disallow: \/api\/$/m)
  assert.ok(!out.includes('Allow: /'))
})

test('sitemap percent-encodes before XML-escaping', () => {
  // The ordering bug: escape-then-encode yields %26amp%3B and resolves wrong.
  const out = urlset({ origin: 'https://x.test', urls: ['/slates/מחל', '/a&b'] })
  assert.match(out, /<loc>https:\/\/x\.test\/slates\/%D7%9E%D7%97%D7%9C<\/loc>/)
  assert.match(out, /<loc>https:\/\/x\.test\/a%26b<\/loc>/)
  assert.ok(!out.includes('%26amp%3B'))
})

test('sitemap keeps path separators unencoded', () => {
  const out = urlset({ origin: 'https://x.test', urls: ['/a/b/c'] })
  assert.match(out, /<loc>https:\/\/x\.test\/a\/b\/c<\/loc>/)
})

test('sitemap renders optional fields only when given', () => {
  const bare = urlset({ origin: 'https://x.test', urls: ['/'] })
  assert.ok(!bare.includes('<lastmod>'))
  const full = urlset({
    origin: 'https://x.test',
    urls: [{ path: '/', lastmod: new Date('2026-09-05T12:00:00Z'), changefreq: 'daily', priority: 1 }],
  })
  assert.match(full, /<lastmod>2026-09-05<\/lastmod>/)
  assert.match(full, /<changefreq>daily<\/changefreq>/)
  assert.match(full, /<priority>1<\/priority>/)
})
