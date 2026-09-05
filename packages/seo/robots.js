// robots.txt, generated rather than copied.
//
// The three static copies in the fleet (blazon, kaomoji, docavivplus
// public/robots.txt) are the same three lines differing only in the sitemap
// origin — which is exactly the kind of file that gets copied to a new site and
// then points at the old site's sitemap.

/**
 * @param {object} opts
 * @param {string} opts.origin      e.g. "https://kana.gfrm.in"
 * @param {string[]} [opts.disallow]
 * @param {string} [opts.sitemap]   defaults to `${origin}/sitemap.xml`
 */
export const robotsTxt = ({ origin, disallow = [], sitemap }) =>
  [
    'User-agent: *',
    ...(disallow.length ? disallow.map((p) => `Disallow: ${p}`) : ['Allow: /']),
    '',
    `Sitemap: ${sitemap ?? `${origin.replace(/\/$/, '')}/sitemap.xml`}`,
    '',
  ].join('\n')
