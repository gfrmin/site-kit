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
strict order, and the site is **down** from step 2 until step 4.

> **Detaching from Pages does not delete the DNS record, and the Workers attach
> refuses to overwrite it.** This cost kana about a minute of downtime on
> 2026-09-05. `DELETE .../pages/projects/<p>/domains/<host>` succeeds and leaves
> `CNAME <host> → <project>.pages.dev` in place, now pointing at a project that
> no longer answers for it — so the site is already down. The follow-up
> `PUT .../workers/domains` then fails with
> `100117: Hostname '<host>' already has externally managed DNS records (A,
> CNAME, etc). Delete them first`. **Step 3 below is the one that is easy to
> miss, and skipping it turns a ten-second window into however long it takes to
> work out what happened.**

1. **Deploy the Worker and verify on `*.workers.dev`.** The account subdomain is
   `cloudflare-e5f`, so it is `https://<name>.cloudflare-e5f.workers.dev`. Check
   the routes that were Pages-specific, not just the homepage.
2. **Remove the custom domain from the Pages project.**
   `DELETE /accounts/:id/pages/projects/<project>/domains/<host>`
3. **Delete the leftover DNS record.** Look it up by name and delete it by id:
   `GET /zones/:zid/dns_records?name=<host>` then `DELETE /zones/:zid/dns_records/:id`.
   This needs **DNS Write**, which the fleet Workers token deliberately does not
   have — use the legacy global key for this one-off rather than widening the
   token, since a migration happens once per site and never again.
4. **Attach it to the Worker** — `PUT /accounts/:id/workers/domains` with
   `{environment, hostname, service, zone_id}`. Cloudflare writes the new DNS
   record itself.
5. **Verify**, then **leave the Pages project in place.** It is the rollback:
   re-attaching the domain to it is a one-call revert. Delete it weeks later,
   not the same day.

Have steps 2, 3 and 4 ready to run as one block. Everything before step 2 and
after step 4 is unhurried.

## Order used for this fleet (all six done, 2026-09-05)

Least to most consequential, so each cutover de-risked the next:

| # | Site | Notes |
|---|---|---|
| 1 | `kana` | 4 commits, no `functions/`, had no wrangler config at all. Lowest stakes; went first to prove the workflow. |
| 2 | `docavivplus` | Static Astro 4. Also renamed `main` → `master` and dropped its local `deploy.sh`. |
| 3 | `atheniapartners` | One `index.html` in `property-selling/site/` with no repo, no build and no CI. Stayed in that repo behind a `site/**` path filter rather than being split out. |
| 4 | `asiansinisrael` | Hugo, assets at `./public`. The `_redirects` ordering problem above. |
| 5 | `kaomoji` | First with `functions/`: the `next()` middleware, Analytics Engine, PWA service worker. |
| 6 | `blazon` | Last. 494 tests, 10 routes, 2 KV namespaces, Turnstile, Stripe, the only site taking payments. |

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
