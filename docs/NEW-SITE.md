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

## Verifying that a site is actually measured

The two deploy gates (`require-vars`, `build-must-match`) prove the key reached
the runner and reached the bundle. **Neither proves an event reaches PostHog**,
and the gap between those is where a site sits dark while every signal reads
green. The only sufficient check is to ask PostHog.

### Read events with the query endpoint, not `/events/`

```sh
PK=$(secret-tool lookup service env key POSTHOG_PERSONAL_API_KEY)
curl -sS -X POST -H "Authorization: Bearer $PK" -H 'content-type: application/json' \
  "https://us.posthog.com/api/projects/<ID>/query/" \
  -d '{"query":{"kind":"HogQLQuery","query":
       "select properties.$host, event, count(), max(timestamp) from events
        where timestamp > now() - interval 30 minute group by 1,2 order by 4 desc"}}'
```

Two traps in that one command:

- **`GET /api/projects/:id/events/` lags.** Measured 2026-09-06: it was stale by
  two hours and reported the same "latest" timestamp for every host, which made
  a working site look dead. The `query` endpoint answered within ~20 s.
- **The API host is not the ingestion host.** Events go to `us.i.posthog.com`;
  the REST API is `us.posthog.com`. Same string bar two characters.

A hand-made event is the quickest way to separate "the key/project/ingestion is
broken" from "the browser is not sending":

```sh
curl -sS -X POST "https://us.i.posthog.com/i/v0/e/" -H 'content-type: application/json' \
  -d '{"api_key":"phc_...","event":"__probe","distinct_id":"probe","properties":{}}'
```

A `200 {"status":"Ok"}` clears all three in one shot.

### Playwright cannot see analytics unless you mask three bot signals

**posthog-js silently drops events from anything it thinks is automated** —
before `before_send`, before any network call, with nothing logged. `capture()`
returns normally. The observable result is identical to a broken SDK, and it
cost a full investigation and a wrongly-filed bug on 2026-09-06.

Its check ends in `return !!navigator.webdriver`, and its blocked-UA list
contains `"headlesschrome"`. Playwright's Chromium trips both — and a third that
survives overriding `navigator.userAgent`:

```python
ctx = browser.new_context(user_agent="Mozilla/5.0 (X11; Linux x86_64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
ctx.add_init_script("""
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  Object.defineProperty(navigator,'userAgentData',{get:()=>({
    brands:[{brand:'Chromium',version:'140'},{brand:'Google Chrome',version:'140'}],
    mobile:false, platform:'Linux'})});
""")
```

`navigator.userAgentData.brands` still advertises `HeadlessChrome` after the UA
string is replaced, so masking the UA alone is not enough and looks exactly like
the failure it is hiding.

### Always run a known-good control first

Point the same harness at a page that is known to emit. If **it** shows no
`POST /e/`, the harness is broken, not the site under test. This is one command
and it is the check that settles the question — on 2026-09-06 it was run last
instead of first, and everything before it was wasted.

