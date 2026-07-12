# TagFlow — Implementation Handoff

> This document is the
> complete specification for an MIT-licensed open-source library. It is written to be
> copied into the public repository as the founding design doc — it intentionally
> contains no references to any private project. Requirements marked **MUST** are
> v0.1 acceptance criteria; **SHOULD** items may slip to v0.2+.

## 1 · Vision

**One affiliate link per product, localized at the edge, on infrastructure you
already have.** A small TypeScript library + Cloudflare Worker that replaces paid
affiliate-link localizers (Geniuslink, ~$6+/mo) and Amazon's lossy built-in
OneLink redirects with a deterministic, self-hosted router:

- Visitor clicks `yoursite.com/go/<product>` → Worker reads the country Cloudflare
  already resolved (`request.cf.country`) → 302 to the right Amazon storefront,
  right ASIN, right per-marketplace affiliate tag — with explicit, configured
  fallbacks instead of opaque "similar product" matching or search-page dumps.
- Every click logged to Workers Analytics Engine (free tier: 100k data points/day)
  with the dimensions needed to catch revenue leaks (`fallbackUsed`, dead
  listings, unexpected geos).
- Everything fits Cloudflare's free plan: 100k Worker requests/day, geo lookup
  included, analytics included. The honest tagline is *"$0/mo on the Cloudflare
  free tier"*.

**Target user:** a developer running a content/review site (Astro, Next, Hugo,
Nuxt — anything static or Worker-served) with a **known, curated catalog** of
tens-to-hundreds of products, enrolled in one or more Amazon Associates
programs. Not a 50k-link media house.

**Why Cloudflare-only is the right constraint:** `request.cf.country` removes
the entire GeoIP problem (MaxMind licensing, database updates) that makes every
other DIY approach annoying; the free tier makes the cost story unbeatable; and
one `wrangler deploy` (or a mount into an existing Worker) is the whole install.

## 2 · Non-goals

- **No hosted service, no SaaS, no billing.** This is a library + template. MIT.
- **No arbitrary-URL shortening** — Sink / OpenShort.link / Dub own that space;
  link to them from the README instead of competing.
- **No price display or price API** — showing stale prices violates the Amazon
  Operating Agreement; deliberately out of scope forever.
- **No interstitial/retargeting-pixel pages** — adds latency and Amazon-compliance
  risk; deliberately rejected, not merely deferred.
- **No admin dashboard in v0.x** — links-as-code (a config file in git) *is* the
  management UI. A read-only stats page may come post-1.0.

## 3 · Prior art (why the niche is open)

| Project | What it is | Gap this library fills |
|---|---|---|
| Amazon OneLink | Free, Amazon-native geo-redirect | Opaque matching: exact-match misses → no redirect; "close match" → wrong/competitor product; no match → search-results dump. ~13 storefronts. Settings reported broken for months at a time. |
| Geniuslink / BetterLink | Paid SaaS localizers | $6+/mo, third party in the click path, closed source. |
| Sink, OpenShort.link | OSS shorteners 100% on Cloudflare | Prove the deploy model & traction; no marketplace localization, no affiliate tag logic, no availability model. |
| Dub | OSS link management (Vercel/Redis) | Different stack, AGPL — **do not copy code from it**. |
| AffLoc, BestAzon, Flovidy | WordPress plugins | WP-only; BestAzon's free tier takes 3% of clicks + interstitial ads. |

Nothing open-source does Amazon-affiliate localization on Cloudflare. Adjacent
projects prove both demand and the distribution model.

## 4 · Requirements

### Functional (v0.1 MUST)

- **F1 — Geo resolution.** Map visitor country (ISO 3166-1 alpha-2 from
  `request.cf.country`) to an Amazon marketplace via: per-country config
  override → built-in curated nearest-storefront map → configured default
  marketplace. Missing/`XX`/`T1` country codes resolve to the default.
- **F2 — Tag correctness.** Every emitted URL carries the affiliate tag
  configured *for that marketplace*. **Never emit an untagged Amazon link and
  never emit a tag on the wrong marketplace** (a mis-marketplace tag earns
  nothing and can look spammy). If the chosen marketplace has no tag, fall back
  (F3) rather than dropping the tag.
- **F3 — Explicit fallback chain.** When the candidate marketplace fails any
  gate (no tag configured, product not available there), walk a deterministic
  chain: candidate → configured regional fallback → default marketplace. The
  default marketplace is validated at config-load time to have a tag; products
  are assumed available there. The resolution must always terminate with a
  valid, tagged URL — never a search page, never an error page for the visitor.
- **F4 — Per-marketplace ASIN overrides.** The same physical product often has
  different ASINs across storefronts (third-party listings). Product entries
  support a base `asin` plus `asinByMarketplace` overrides.
- **F5 — Availability model.** Products declare `availableIn` (list of
  marketplaces). Resolution treats absence as "fall back", not "guess". This is
  the deterministic replacement for OneLink's catalog matching: correctness
  comes from a maintained map (see CLI, §10), not from scraping at request time.
- **F6 — Two link modes.**
  - *Curated*: `/go/<productKey>` — full waterfall (the primary mode).
  - *Raw ASIN*: `/go/amazon/<asin>` — for one-off links without a product
    entry; availability unknown, so behavior follows a config policy
    `unknownAsin: "geo" | "default"` (redirect to geo marketplace and hope, or
    play safe to the default marketplace). Default: `"default"`.
- **F7 — Mountable adapter.** The Worker handler must work in BOTH shapes:
  - standalone Worker template (`wrangler deploy` and done);
  - **mounted under a path prefix inside an existing Worker that serves static
    assets** (the Astro/Next-on-Workers case): handler returns a `Response` for
    matching paths and `null` otherwise so the host Worker falls through to
    `env.ASSETS.fetch(request)`. This mode is a first-class citizen, not an
    afterthought — many target users already serve their site from a Worker and
    must not need a second zone, domain, or deployment.
- **F8 — Build-time helper.** A tiny pure function (e.g.
  `goUrl(productKey, { base })` → `/go/<productKey>`) importable by any
  framework's build so site templates never hand-write redirect paths. Zero
  runtime dependencies; usable from `.astro`, JSX, MDX, Liquid, anything.
- **F9 — Response semantics.** `302` (not `301` — mappings and tags change),
  `Cache-Control: no-store` (geo-dependent), `X-Robots-Tag: noindex`. Rely on
  default browser referrer policy so the destination sees the linking origin
  (Amazon compliance requires the traffic source to be identifiable, §11).
- **F10 — Single-marketplace degenerate mode.** With exactly one marketplace
  configured, every click resolves to it — output identical to direct linking.
  This lets a site adopt the Worker on day one with one Associates membership
  and add marketplaces later purely by editing config. Adding a marketplace
  must never require touching published content.
- **F11 — Click analytics.** One Analytics Engine data point per click:
  dimensions `country`, `marketplaceResolved`, `productKey` (or raw ASIN),
  `resolutionReason` (`direct` | `fallback-no-tag` | `fallback-unavailable` |
  `unknown-country` | `raw-asin`), `uaClass` (`desktop` | `mobile` | `bot`);
  metric: count. Analytics is **optional**: no AE binding configured → skip
  logging, never fail the redirect. Redirect first, log via `ctx.waitUntil`.
- **F12 — Config validation.** Load-time validation with precise errors:
  default marketplace has a tag; every `availableIn`/override references a known
  marketplace; tag format sanity (warn, don't block — suffix conventions vary
  by storefront); no product key collides with reserved route segments.

### Functional (SHOULD, v0.2+)

- **F13 — A/B variants.** Weighted destination variants per product, stateless
  random assignment per click (no cookies), `variant` dimension in analytics.
- **F14 — Choice pages.** Optional per-product multi-retailer page (Amazon +
  other stores) rendered by the Worker: single self-contained HTML response,
  inline CSS, no external assets, light/dark aware.
- **F15 — Non-Amazon destinations.** Generalize the destination model so a
  product can route to arbitrary per-country retailer URLs (config-supplied,
  tag logic bypassed). Design the config for this now (§6) even though v0.1
  implements Amazon only.
- **F16 — Device routing.** UA-based mobile deep links (app URLs) where
  configured.
- **F17 — Earnings correlation.** CLI import of Associates earnings reports
  (CSV) joined against click data by tracking tag + date for a
  clicks-vs-orders view per marketplace.

### Non-functional

- **N1 — Free-tier fit.** Everything runs on the Workers free plan: ≤10 ms CPU
  per request budget (typical resolution should be well under 1 ms — one map
  lookup chain, no I/O), config bundled at build time (no KV/D1 dependency in
  v0.1; KV-backed config MAY be an opt-in adapter later).
- **N2 — Privacy by design.** No cookies, no localStorage, no fingerprinting,
  no PII stored. Analytics dimensions are aggregate-safe (country, not IP).
  This makes the Worker consent-banner-neutral under GDPR/ePrivacy — a
  headline feature for EU-based publishers; document the reasoning, and keep
  it true (adding a "convenient" cookie later would silently create a consent
  obligation for every downstream site).
- **N3 — Core purity.** `core` package: zero dependencies, no Cloudflare
  imports, no I/O, no `Date.now()`/randomness in `resolve()` (A/B randomness
  is injected). Fully unit-testable in plain vitest.
- **N4 — Strict TypeScript, ESM-only, exact-pinned dependencies** (no `^`/`~`),
  Node ≥ 20 for tooling, `wrangler` v4 for the template.
- **N5 — SEO safety.** Redirect paths carry `rel="sponsored nofollow"` guidance
  in docs; `noindex` on responses (F9); README includes a robots.txt snippet
  disallowing the mount prefix.

## 5 · Architecture & repo layout

pnpm workspace, three publishable packages + template + examples:

```
/packages
  /core          # pure resolution engine + config schema/validation + goUrl()
  /cloudflare    # createAffiliateHandler(config, opts) — the Worker adapter
  /cli           # init / validate / check / stats  (Node, runs on the user's machine)
/templates
  /worker        # standalone: wrangler.jsonc + index.ts + affiliate.config.json
/examples
  /astro-static-assets   # mounted mode inside an Astro site's Worker entry
  /standalone            # bare template usage
/docs            # README is primary; docs/ for compliance + recipes
```

- `core` exports: `parseConfig(json) → Config | ValidationError[]`,
  `resolve(ctx: ClickContext, config: Config) → Decision`, `goUrl(...)`,
  `COUNTRY_TO_MARKETPLACE` (the curated built-in map), marketplace/domain
  constants.
- `cloudflare` exports: `createAffiliateHandler(config, opts?)` returning
  `(request: Request, env: Env, ctx: ExecutionContext) => Promise<Response | null>`,
  plus a ready `fetch` export for the standalone template. `opts`: route
  prefix (default `/go`), analytics binding name, bot policy.
- `cli` is the only package allowed non-trivial dependencies.

## 6 · Config schema (spec)

Single JSON file, imported/bundled at build time. Shape (illustrative values):

```jsonc
{
  "$schema": "https://<docs-domain>/schema/v1.json",
  "defaultMarketplace": "es",
  "tags": {
    "es": "yourtag-21",
    "com": "yourtag-20",
    "co.uk": "yourtag-21",
    "de": "yourtag-21"
  },
  // country → marketplace, merged over the built-in map (override wins)
  "countryOverrides": { "CH": "de" },
  // marketplace → marketplace, tried when a candidate fails a gate
  "marketplaceFallbacks": { "co.uk": "de" },
  "unknownAsin": "default",
  "products": {
    "flagship-product": {
      "asin": "B0XXXXXXXX",
      "asinByMarketplace": { "co.uk": "B0YYYYYYYY" },
      "availableIn": ["es", "de", "fr", "it", "com"],
      // v0.2+: variants, retailers, deepLinks live here
    }
  }
}
```

Marketplace identifiers are the Amazon domain suffixes: `com`, `co.uk`, `de`,
`fr`, `it`, `es`, `nl`, `pl`, `se`, `com.be`, `ca`, `com.mx`, `com.br`,
`co.jp`, `in`, `sg`, `com.au`, `ae`, `sa`, `com.tr`, `eg`. Ship the full
domain map in `core` even for storefronts most users can't monetize — the
config's `tags` decides what's actually usable.

**Built-in country map:** every ISO country resolves to its nearest/serving
storefront. Key entries the map must get right (these encode real Amazon
serving relationships, not guesses): countries with their own storefront map to
it; `PT → es` (Amazon serves Portugal from amazon.es); `AT → de`; `IE → co.uk`;
`BE → com.be`; `CH → de`; `LU → de`; `LI → de`; `MC/AD → fr`; `NZ → com.au`;
Gulf states without storefronts → `ae`; everything else → `defaultMarketplace`
sentinel. The full table lives in `core` with a test asserting total ISO
coverage.

## 7 · Resolution algorithm (spec)

`resolve(ctx, config)` where `ctx = { country?, path, userAgent? }`:

1. **Parse route.** `/go/<productKey>` (curated) or `/go/amazon/<asin>` (raw).
   Unknown product key → `404` decision (host site's 404, or JSON in
   standalone mode). Reserved segment `amazon` cannot be a product key (F12).
2. **Candidate marketplace** = `countryOverrides[country]` ??
   `COUNTRY_TO_MARKETPLACE[country]` ?? `defaultMarketplace`.
3. **Gate chain.** A marketplace passes if it has a tag AND (curated mode) the
   product is listed in `availableIn`. On failure, try
   `marketplaceFallbacks[candidate]`, then `defaultMarketplace`. Record which
   gate failed as `resolutionReason`. (Chain is ≤3 hops by construction; no
   loops possible since fallbacks are validated non-cyclic at load.)
4. **Raw-ASIN mode** skips the availability gate and applies `unknownAsin`
   policy at step 2.
5. **ASIN selection**: `asinByMarketplace[final] ?? asin`.
6. **Decision**: `{ url: "https://www.amazon.<domain>/dp/<asin>?tag=<tag>",
   marketplace, resolutionReason, productKey }`. URL-encode ASIN and tag.

Property tests worth writing: resolution is total (never throws for any
country string), always returns a tagged Amazon URL for known products,
respects `availableIn` exactly, and is pure (same input → same output).

## 8 · Cloudflare adapter (spec)

- Extract country from `request.cf?.country`; UA class from a minimal
  UA heuristic (goal: bot flagging for analytics, not perfect detection —
  do not add a UA-parser dependency).
- Match prefix; non-matching path → return `null` (mounted mode contract).
- Build `Response.redirect(decision.url, 302)` with headers per F9.
- `ctx.waitUntil(logClick(env.CLICKS, decision, ctx))` — never block or fail
  the redirect on analytics errors (F11).
- Bot policy (`opts.bots`): `"redirect"` (default; logged with `uaClass=bot`)
  or `"ignore"` (redirect but skip logging).
- Standalone template: `index.ts` is ~10 lines wiring the handler + a 404
  JSON fallback; `wrangler.jsonc` includes the Analytics Engine binding
  commented-in with a note that it's free.
- Mounted example (the case that must be flawless): host Worker tries the
  handler first, else serves static assets:

```ts
import config from './affiliate.config.json'
import { createAffiliateHandler } from '<pkg>/cloudflare'

const affiliate = createAffiliateHandler(config)

export default {
  async fetch(request, env, ctx) {
    return (await affiliate(request, env, ctx)) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
```

## 9 · Analytics (spec)

- Workers Analytics Engine dataset, one point per click:
  `blobs: [country, marketplace, productKey, resolutionReason, uaClass]`,
  `doubles: [1]`, `indexes: [productKey]`.
- Documented facts (verified 2026-07): AE is available **on the free plan** —
  100k data points written/day and 10k read queries/day; paid plan includes
  10M points/month (+$0.25/M) and 1M queries/month (+$1/M); Cloudflare is not
  yet billing for AE at all. Cite the pricing page in docs and date the claim.
- The operationally important query (ship it in the CLI, promote it in the
  README): *clicks where `resolutionReason != 'direct'`, grouped by product ×
  marketplace* — that is the "this listing died / this geo leaks revenue"
  monitor that paid services charge for.

## 10 · CLI (spec)

Node CLI (`npx <pkg> …`), runs on the user's machine — never in the Worker:

- **`init`** — scaffold `affiliate.config.json` (interactive: default
  marketplace, tags) and print the standalone-vs-mounted setup choice.
- **`validate`** — schema + invariants (F12); non-zero exit for CI.
- **`check`** — for each product × tagged marketplace, verify the listing
  exists; update `availableIn` (with `--write`) and print a diff table;
  non-zero exit when a previously-available listing disappears (CI-able as a
  weekly GitHub Action — provide the workflow file in the template).
  - Two engines: **PA-API** (blessed path when the user has API keys) and
    **plain HTTPS probe** of the `/dp/` page from the user's own IP.
    Document clearly: the probe runs client-side at the user's own risk and
    discretion, is rate-limited with jitter, sends no affiliate tag, and must
    never be executed from Workers/datacenter infrastructure.
- **`stats`** — query AE's SQL API (needs account ID + API token via env
  vars): clicks by country/marketplace/product/reason over a window; the
  fallback-leak report from §9.
- **`import-earnings`** (v0.3, F17).

## 11 · Compliance & privacy (ship as a docs page, encode as defaults)

This section is a differentiator — every DIY blog post hand-waves it.

- **Amazon Operating Agreement:** redirects are not banned; what's banned is
  (a) obscuring *which site* the click came from and (b) making it unclear the
  link goes to Amazon. Therefore: same-domain path with `amazon` in the
  curated-raw route (`/go/amazon/…`), default referrer policy preserved so the
  destination sees the linking origin (F9), and README guidance that CTAs
  should say "on Amazon" (e.g. *View on Amazon*). Never inject tags on
  traffic the publisher doesn't own; one tag set per site.
- **Per-marketplace membership required to earn.** The Worker routes clicks;
  it cannot create payouts. Docs must be explicit that each `tags` entry
  requires enrollment in that storefront's Associates program (and note the
  activation rules new accounts face), so nobody blames the tool for
  unattributed clicks.
- **No prices, ever** (see Non-goals).
- **Disclosure:** remind users that FTC/EU rules require affiliate disclosure
  near the links; out of the library's scope to render, in scope to document.
- **Privacy:** N2 in full — no cookies/PII, aggregate country-level analytics
  only; template includes a one-paragraph privacy-policy snippet users can
  adapt.
- **Trademark hygiene:** the project name must not contain "Amazon"
  (Associates policy also forbids "amazon" in domains); README states the
  project is unaffiliated with Amazon and Cloudflare.

## 12 · Testing & CI

- `core`: plain vitest; 100% branch coverage on `resolve()` is realistic and
  worth enforcing; property tests from §7; a full-ISO-coverage test for the
  country map.
- `cloudflare`: `@cloudflare/vitest-pool-workers` (Workers runtime tests:
  route matching, mounted-mode `null` contract, headers, `waitUntil` logging;
  simulate `request.cf` variants including missing `cf`).
- `cli`: golden-file tests for `validate`/`check` output; probe engine mocked.
- GitHub Actions: lint (Biome) + typecheck + test on PR; release
  via changesets → npm (provenance enabled); template repo smoke-deploy job
  with `wrangler deploy --dry-run`.

## 13 · Roadmap

| Version | Scope |
|---|---|
| **v0.1** | F1–F12, N1–N5; `core` + `cloudflare` + `cli init/validate/check`; standalone template + mounted Astro example; README + compliance doc. Ship when the mounted example runs on a real site. |
| **v0.2** | `stats` CLI + fallback-leak report; A/B variants (F13); choice pages (F14). |
| **v0.3** | Non-Amazon destinations (F15); device routing (F16); earnings import (F17). |
| **v1.0** | API freeze, schema `v1` frozen, docs site. |
| Post-1.0 (maybe) | Read-only stats dashboard (static page over AE API, Sink-style); KV-backed config adapter for no-rebuild updates. |

**Launch checklist (marketing is the point):** good README with a 60-second
quickstart GIF and the "$0 on Cloudflare free tier" table; `examples/` runnable;
blog post ("Replacing Geniuslink and Amazon OneLink with a free Cloudflare
Worker") on the personal blog; Show HN; r/juststart + r/Affiliatemarketing;
PR to `738/awesome-url-shortener` and Cloudflare's community showcase; npm
keywords (`amazon-associates`, `affiliate`, `onelink-alternative`,
`geniuslink-alternative`, `cloudflare-workers`).

## 14 · Open decisions

1. **Name**: decided — **TagFlow** (`@tagflow/*` on npm, `tagflow` CLI/binary).
2. **npm scope**: publish under the personal npm scope; keep package names
   `@<scope>/core`, `@<scope>/cloudflare`, `@<scope>/cli` vs single-package
   with subpath exports (`<name>/cloudflare`). Single package with subpath
   exports is simpler for users; decide before v0.1.
3. **Docs hosting**: README-only until v0.2, then Cloudflare Pages + the
  `$schema` URL (needs the domain from decision 1).
4. **Analytics without AE**: is a no-op logger enough for v0.1 (yes, per F11),
   or ship a `console.log` JSON fallback for `wrangler tail` debugging (cheap,
   probably yes).

## 15 · Reference facts (verified 2026-07; re-verify before public claims)

- Cloudflare free plan: 100k Worker requests/day, 10 ms CPU/request;
  `request.cf.country` available on all plans.
- Workers Analytics Engine: free plan 100k points/day written + 10k read
  queries/day; paid 10M points + 1M queries/month included; not yet billed.
  Source: Cloudflare AE pricing docs.
- Amazon OneLink covers ~13 storefronts; excludes BR/MX/IN; failure modes:
  no-redirect on exact-match miss, similar-product substitution on close
  match, search-page dump on no match. Sources: Associates Central help,
  practitioner reports (Geniuslink blog, WP Manage Ninja).
- Amazon Operating Agreement anti-cloaking clause: prohibition targets
  obscuring the referring site / hiding that the destination is Amazon —
  branded same-domain redirects with clear labeling are the accepted pattern.
  Sources: Associates policies page; Geniuslink "Link Cloaking & Amazon
  Compliance"; URLgenius policy guide.
- Amazon serves Portugal via amazon.es (no amazon.pt) — encoded in the
  country map.
