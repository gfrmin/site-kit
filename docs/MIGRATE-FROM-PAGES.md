# Migrating a site from Pages to Workers

Cloudflare keeps Pages supported and fixed, but all new investment goes to
Workers — static-asset routing, Workers Logs, gradual deployments, cron and
Durable Objects are Workers-only. **There is no migration deadline.** These are
runbooks, not an emergency.

## Config

`pages_build_output_dir` becomes an `[assets]` block:

```jsonc
// before (wrangler.toml)
name = "kana"
pages_build_output_dir = "dist"

// after (wrangler.jsonc)
{
  "name": "kana",
  "compatibility_date": "2026-09-05",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

KV and Analytics Engine bindings carry over **unchanged**.

`wrangler pages secret put X` becomes `wrangler secret put X`. Secrets do not
migrate themselves — re-put every one.

The workflow's deploy line changes from
`pages deploy dist --project-name=X --branch=master` to plain `deploy`, which is
the reusable workflow's default, so in practice the whole workflow collapses to
the caller in [NEW-SITE.md](NEW-SITE.md).

## If the site has a `functions/` directory

Pages' file-based routing and its `_middleware.js` chain do not exist in Workers.
Two things in this fleet depend on them:

- blazon's `functions/a/[payload].js` calls `env.ASSETS.fetch()` — needs
  `"binding": "ASSETS"` under `assets`.
- kaomoji's `functions/maker/_middleware.js` is built on `next()`, **which has no
  Workers equivalent at all**.

Compile rather than rewrite:

```jsonc
{
  "main": "./dist/worker/index.js",
  "assets": { "directory": "./dist", "binding": "ASSETS", "run_worker_first": ["/api/*"] }
}
```

```sh
wrangler pages functions build --outdir=./dist/worker/
```

This reproduces Pages' routing *and* middleware chaining, so `next()` survives
and **no route code changes**. That matters more than it looks: blazon has 492
tests gating its deploy, and `functions/a/[payload].js` deliberately chose regex
string-replace over `HTMLRewriter` *specifically so the same code runs under
`node --test`*. Rewriting onto a router would invalidate that rationale and the
tests with it. Rewrite later, per site, if there is a reason.

Add the compile to the build script so CI does it:

```json
"build": "vite build && wrangler pages functions build --outdir=./dist/worker/"
```

## Cutover

**A hostname belongs to a Pages project or a Worker, never both.** So there is a
strict order, and a window between steps 2 and 3 where the domain is unattached.

1. **Deploy the Worker and verify on `*.workers.dev`.** The account subdomain is
   `cloudflare-e5f`, so it is `https://<name>.cloudflare-e5f.workers.dev`. Check
   the routes that were Pages-specific, not just the homepage.
2. **Remove the custom domain from the Pages project.**
3. **Attach it to the Worker** — `PUT /accounts/:id/workers/domains`, which
   rewrites the DNS record from `CNAME → <project>.pages.dev` to the Worker
   route. `bin/new-site` does this step; for a migration run it by hand or with
   the same call.
4. **Verify**, then **leave the Pages project in place.** It is the rollback:
   re-attaching the domain to it is a one-call revert. Delete it weeks later,
   not the same day.

Do steps 2 and 3 back to back. Everything before step 2 and after step 3 is
unhurried.

## Order for this fleet

Least to most consequential, so each cutover de-risks the next:

| # | Site | Notes |
|---|---|---|
| 1 | `kana` | 4 commits, 679 lines, no `functions/`, **no `wrangler.toml` at all** — create one. Lowest stakes in the fleet. |
| 2 | `docavivplus` | Static Astro 4. Also rename `main` → `master` (account convention) and drop its local `deploy.sh`. |
| 3 | `asiansinisrael` | Hugo; assets directory is `./public`, not `./dist`. Keep the Hugo build, submodule checkout and `fetch-depth: 0`. |
| 4 | `atheniapartners` | A single `index.html` in `property-selling/site/` with no repo, no build and no CI. Give it its own repo via `new-site` and retire the hand deploy. |
| 5 | `kaomoji` | 4 functions incl. the `next()` middleware; Analytics Engine binding; PWA service worker. |
| 6 | `blazon` | Last. 10 routes, 2 KV namespaces, Turnstile, Stripe, resvg OG, 492 tests, and the only site taking payments. |

## Per-site checks before swapping the domain

- **blazon** — `/a/<payload>` returns HTML with the OG meta rewritten;
  `/api/health` returns `{generate, turnstile, checkout}` all true.
- **kaomoji** — `/maker/?k=…` has rewritten meta (proves the middleware chain
  survived compilation); `/og/maker?k=…` returns a real PNG, not the fallback
  redirect to `/og/maker.png`.
- **all** — `npm test` green where a suite exists, and
  `playwright screenshot --viewport-size=1100,900` plus `380,620` against the
  `workers.dev` URL, diffed against the live Pages site.

## Stale things to delete on the way past

- blazon's `wrangler.toml` warns that its `PURCHASES` KV id is a `PLACEHOLDER`
  that must be replaced before deploy. **Both namespaces exist** (`RATE`
  `de4812ca…`, `PURCHASES` `6da8571c…`, verified 2026-09-05). Delete the warning.
- blazon's README claims "Requires Node 18+" while its CI pins 22 and the fleet
  now pins 24.
- docavivplus's `deploy.sh` pulls `CLOUDFLARE_PAGES_TOKEN` from the keyring for a
  local manual deploy. That token cannot deploy Workers; delete the script and
  use CI.
