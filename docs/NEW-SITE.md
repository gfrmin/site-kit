# Creating a new site

```sh
bin/new-site kana kana.gfrm.in
bin/new-site blazon blazon.fyi --kv RATE --kv PURCHASES
```

That is the whole thing. What follows is why each step exists, and the handful
of facts that used to live only in four different repos' READMEs.

## What `new-site` does

| | Step | Was |
|---|---|---|
| 1 | Scaffold from `template/`, substituting name, domain and a fresh `compatibility_date` | `npm create vite`, then strip boilerplate by hand |
| 2 | `git init` + first commit on **`master`** | — |
| 3 | `gh repo create` + push, forcing the default branch to `master` | manual |
| 4 | `gh secret set CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | manual, and easy to forget until CI fails |
| 5 | Create any KV namespaces and write their **real ids** into `wrangler.jsonc` | `wrangler kv namespace create`, then paste the id by hand |
| 6 | Bootstrap `wrangler deploy` so the Worker exists | — |
| 7 | Attach the custom domain (Cloudflare writes the DNS record) | dashboard, twice |
| 8 | `curl` the domain and report the status | — |

Every step is idempotent and says whether it created or found each thing, so a
re-run after a failure resumes instead of duplicating.

## The deploy token

**Both tokens already in the keyring are Pages-scoped and return HTTP 403 on
every Workers endpoint** (measured 2026-09-05: `CLOUDFLARE_PAGES_TOKEN` and
`CLOUDFLARE_BLAZON_DEPLOY_TOKEN`). That 403 reads exactly like a dead key and is
not one. `new-site` prints a hint when it sees one.

Mint a fleet Workers token once, following the mint–verify–store loop in the
`cloudflare-api` skill, and store it as **`CLOUDFLARE_WORKERS_DEPLOY_TOKEN`**.

Permission groups (IDs verified live 2026-09-05):

| ID | Name | Scope |
|---|---|---|
| `e086da7e2179491d91ee5f35b3ca210a` | Workers Scripts Write | account |
| `f7f0eda5697f475c90846e879bab8666` | Workers KV Storage Write | account |
| `28f4b596e7d643029c524985477ae49a` | Workers Routes Write | zone |

**This one is not per-zone least-privilege, and that is a Cloudflare
constraint, not a shortcut.** "Workers Scripts Write" only exists at account
scope — there is no way to scope a token to a single Worker. So any site's
GitHub secret can redeploy any Worker on the account. That was already true of
the Pages tokens (Pages permissions are account-scoped too), so this changes
nothing, but do not describe it as scoped. What it *is* bounded to is Workers:
it cannot purge cache, edit DNS generally, or read zone settings.

`Workers Routes Write` must cover every zone a site might land on. Scope it to
the zones in use rather than "all zones" if you would rather add zones by hand
later.

## Variables vs Secrets

The reusable workflow exports **every repository Variable** into the build
environment. A site that needs `VITE_POSTHOG_KEY` or `PUBLIC_SITE` at build time
sets a repo Variable and it appears — no workflow edit.

Use **Variables, not Secrets**, for anything the bundler bakes into client code.
A build-time key in a shipped bundle is public the moment it deploys; blazon's
workflow says exactly this about its Turnstile site key. Putting such a value in
Secrets buys nothing and hides it from whoever is auditing the site.

Real secrets go to the Worker, never the bundle:

```sh
npx wrangler secret put ANTHROPIC_API_KEY
```

## Things that will bite you

**A hostname belongs to a Pages project *or* a Worker, never both.** Attaching a
domain that is still on a Pages project fails. When migrating, detach from Pages
first — see [MIGRATE-FROM-PAGES.md](MIGRATE-FROM-PAGES.md).

**A dashboard-set binding does not reach a CLI-deployed Worker.** Bindings come
from `wrangler.jsonc` at deploy time. Anything added in the dashboard is
invisible to `wrangler deploy`. (Learned in kaomoji's `functions/README.md`.)

**Analytics Engine must be enabled on the account before first use**, or the
deploy itself fails — not the request, the deploy.

**`not_found_handling` is a real decision.** `"single-page-application"` returns
`index.html` with a 200 for every unmatched path, which is what makes deep links
work in a client-routed app — and what makes a multi-page site return 200 for
every typo, so crawlers index the shell. Pick deliberately; the template
defaults to SPA and says so.

**resvg-wasm renders text as nothing without fonts.** There is no OS font store
in the Workers runtime, and no error is raised — blazon shipped a blank motto
before noticing. `site-kit/og` takes a `loadFonts` callback for this reason.

**Keep the wasm/font import specifiers literal.** The bundler finds them by
static analysis. `site-kit/og` takes loader *functions* precisely so those
literals stay in your repo where the bundler can see them.

## Domains

`new-site` resolves the zone by walking up the hostname, so `kana.gfrm.in` finds
the `gfrm.in` zone and `blazon.fyi` finds its own. **The zone must already exist
on the account** — buying a domain is still a manual step. As of 2026-09-05
`hkex.guru` and `sfchk.guru` are on the account but still pointing at Namecheap
parking pages, so both are ready for a `new-site` run.

## Adding server code

The template deploys assets only. To add routes:

1. Write `src/worker.js` with a default `fetch` export.
2. Set `"main": "./src/worker.js"` in `wrangler.jsonc`.
3. Set `"run_worker_first": ["/api/*"]` under `assets` for the paths that must
   beat the static handler.
4. Uncomment `"binding": "ASSETS"` if the Worker needs to read its own files
   (rewriting OG meta on the HTML shell, say).

Rate limiting, OG rasterisation and the base64url helpers are already in
`site-kit/kv/ratelimit`, `site-kit/og` and `site-kit/web/base64url`.
