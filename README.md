# site-kit

One deploy recipe, one scaffold, and the handful of utilities worth sharing
across the Cloudflare Workers sites on this account.

```sh
bin/new-site kana kana.gfrm.in
```

## Why

Six live sites, and before this repo existed:

- **five hand-synced copies of the same GitHub Actions workflow.** kaomoji's and
  kana's differed by a single line, and kana carries a commit titled
  *"Bump deploy workflow actions to match kaomoji-app"* — a cross-repo sync
  performed by hand.
- **a twelve-step ritual to create a new site**, six steps of which were
  undocumented: create the Pages project, wire DNS, create KV namespaces and
  paste their ids, enable Analytics Engine on the account first, decide
  Variables vs Secrets, put the per-feature secrets. That knowledge lived in
  four different repos' READMEs and workflow comments.
- **no shared code at all.** A full cross-repo hash sweep of the four front-end
  repos found *zero* byte-identical files — but three independent base64url
  implementations, three visually-hidden rules under three names, four copies of
  copy-to-clipboard (three of which report success when nothing was copied), and
  two separately-debugged resvg-wasm loaders each missing the other's fix.

So this repo shares the *operational* layer, which is where the duplication
actually was, and only the small utilities where one implementation was
demonstrably better than the others.

## Layout

```
.github/workflows/worker-deploy.yml   the one deploy recipe (workflow_call)
bin/new-site                          scaffold + GitHub + Cloudflare, one command
template/                             the skeleton a new site starts from
packages/
  og/       resvg-wasm rasteriser (merged from blazon + kaomoji)
  web/      base64url, clipboard, share, storage, a11y
  seo/      robots.txt and sitemap emitters
  kv/       fixed-window rate limiter
docs/
  NEW-SITE.md            the twelve steps, and the six that were tribal knowledge
  MIGRATE-FROM-PAGES.md  per-site cutover runbook
```

## Using the workflow

Each site's `.github/workflows/deploy.yml` becomes:

```yaml
name: deploy
on:
  push: { branches: [master] }
  pull_request:
  workflow_dispatch:

jobs:
  deploy:
    uses: gfrmin/site-kit/.github/workflows/worker-deploy.yml@master
    with:
      build: npm run build
      test: npm test
    secrets: inherit
```

Inputs: `build`, `test`, `node`, `hugo`, `submodules`, `fetch-depth`,
`wrangler-command`, `smoke-url`, `smoke-jq`. `secrets: inherit` is required — the
workflow reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the
calling repo.

Every repository **Variable** is exported into the build environment, so a site
needing `VITE_POSTHOG_KEY` at build time sets a Variable and changes no YAML.

## Using the packages

Installed straight from git — no build step, no npm publish:

```sh
npm i github:gfrmin/site-kit
```

```js
import { copyText } from 'site-kit/web/clipboard'
import { checkRates, ipKey } from 'site-kit/kv/ratelimit'
import { createRasteriser } from 'site-kit/og'
import { urlset } from 'site-kit/seo/sitemap'
```

Everything is plain ESM that Node and the Workers runtime both load as-is, which
is what makes a git dependency viable.

## Not shared, on purpose

Theme tokens, routing and styling stay per-repo. Four mutually exclusive styling
doctrines are declared deliberately across these sites — blazon and kana style
inline; kaomoji is global CSS with classes and *no* inline styles;
asiansinisrael is Tailwind — and blazon's and kaomoji's palettes each carry their
own WCAG-AA contrast audit. Merging them would lose the audits and overrule
three written-down decisions to no benefit.

## Tests

```sh
npm test
```

`node --test`, zero test dependencies — matching blazon, the only site in the
fleet with a real suite. A test runner you have to install is a test runner a new
site skips.
