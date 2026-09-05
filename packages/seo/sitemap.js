// sitemap.xml.
//
// URLs are percent-encoded before XML-escaping, in that order. The order is not
// cosmetic: dataguru's bechirot hit this with Hebrew slugs like /slates/מחל,
// where escaping first and encoding second produces a document that validates
// and resolves to the wrong path.

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const encodePath = (path) =>
  path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')

/**
 * @param {object} opts
 * @param {string} opts.origin
 * @param {Array<string|{path: string, lastmod?: string|Date, changefreq?: string, priority?: number}>} opts.urls
 */
export const urlset = ({ origin, urls }) => {
  const base = origin.replace(/\/$/, '')
  const entries = urls.map((u) => (typeof u === 'string' ? { path: u } : u))
  const body = entries
    .map(({ path, lastmod, changefreq, priority }) => {
      const loc = xmlEscape(base + encodePath(path.startsWith('/') ? path : `/${path}`))
      const when = lastmod instanceof Date ? lastmod.toISOString().slice(0, 10) : lastmod
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        when ? `    <lastmod>${xmlEscape(when)}</lastmod>` : null,
        changefreq ? `    <changefreq>${xmlEscape(changefreq)}</changefreq>` : null,
        priority != null ? `    <priority>${priority}</priority>` : null,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`
}
