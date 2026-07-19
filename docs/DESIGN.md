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

> **Status (2026-07-18): F1–F12 all ✅ Done.** Verified against
> `packages/core/src/resolve.ts`, `config.ts`, `go-url.ts` and
> `packages/cloudflare/src/handler.ts`.

- **F1 — Geo resolution.** ✅ Done — `resolve.ts`'s `candidateForCountry()`
  implements override → `COUNTRY_TO_MARKETPLACE` → default; `XX`/`T1`/missing
  handled by `marketplaceForCountry()`. Map visitor country (ISO 3166-1 alpha-2
  from
  `request.cf.country`) to an Amazon marketplace via: per-country config
  override → built-in curated nearest-storefront map → configured default
  marketplace. Missing/`XX`/`T1` country codes resolve to the default.
- **F2 — Tag correctness.** ✅ Done — `resolve.ts`'s `failureOf()` gates on a
  missing tag before any URL is emitted. Every emitted URL carries the affiliate tag
  configured *for that marketplace*. **Never emit an untagged Amazon link and
  never emit a tag on the wrong marketplace** (a mis-marketplace tag earns
  nothing and can look spammy). If the chosen marketplace has no tag, fall back
  (F3) rather than dropping the tag.
- **F3 — Explicit fallback chain.** ✅ Done — `resolveCurated()` builds a
  ≤3-hop chain; `parseConfig()` rejects cyclic `marketplaceFallbacks` and
  requires the default marketplace to carry a tag. Status (2026-07-19): a
  cyclic-fallback config now reports one error per cycle (deduped via a
  `reported` node set in `config.ts`) instead of one per cycle member — same
  rejection, clearer output. When the candidate marketplace fails any
  gate (no tag configured, product not available there), walk a deterministic
  chain: candidate → configured regional fallback → default marketplace. The
  default marketplace is validated at config-load time to have a tag; products
  are assumed available there. The resolution must always terminate with a
  valid, tagged URL — never a search page, never an error page for the visitor.
- **F4 — Per-marketplace ASIN overrides.** ✅ Done — `ProductConfig.asinByMarketplace`
  in `config.ts`, consumed in `redirectDecision()`. The same physical product often has
  different ASINs across storefronts (third-party listings). Product entries
  support a base `asin` plus `asinByMarketplace` overrides.
- **F5 — Availability model.** ✅ Done — `ProductConfig.availableIn`, gated in
  `resolveCurated`'s `failureOf`; default marketplace skips the gate as specified. Products declare `availableIn` (list of
  marketplaces). Resolution treats absence as "fall back", not "guess". This is
  the deterministic replacement for OneLink's catalog matching: correctness
  comes from a maintained map (see CLI, §10), not from scraping at request time.
- **F6 — Two link modes.** ✅ Done — `resolve()` dispatches curated vs raw
  ASIN, with `unknownAsin` policy in `resolveRawAsin()`.
  - *Curated*: `/go/<productKey>` — full waterfall (the primary mode).
  - *Raw ASIN*: `/go/amazon/<asin>` — for one-off links without a product
    entry; availability unknown, so behavior follows a config policy
    `unknownAsin: "geo" | "default"` (redirect to geo marketplace and hope, or
    play safe to the default marketplace). Default: `"default"`.
- **F7 — Mountable adapter.** ✅ Done — `packages/cloudflare/src/handler.ts`
  returns `null` for non-matching paths/unknown keys; verified live by both
  `templates/worker/src/index.ts` (standalone) and
  `examples/astro-static-assets/worker/index.ts` (mounted). The Worker handler must work in BOTH shapes:
  - standalone Worker template (`wrangler deploy` and done);
  - **mounted under a path prefix inside an existing Worker that serves static
    assets** (the Astro/Next-on-Workers case): handler returns a `Response` for
    matching paths and `null` otherwise so the host Worker falls through to
    `env.ASSETS.fetch(request)`. This mode is a first-class citizen, not an
    afterthought — many target users already serve their site from a Worker and
    must not need a second zone, domain, or deployment.
- **F8 — Build-time helper.** ✅ Done — `packages/core/src/go-url.ts`,
  zero-dependency, plus `goAmazonUrl`; used in
  `examples/astro-static-assets/src/pages/index.astro`. A tiny pure function (e.g.
  `goUrl(productKey, { base })` → `/go/<productKey>`) importable by any
  framework's build so site templates never hand-write redirect paths. Zero
  runtime dependencies; usable from `.astro`, JSX, MDX, Liquid, anything.
  Status (2026-07-19): `goUrl()` now throws a `TypeError` at build time for an
  empty or reserved (`amazon`) product key, and `goAmazonUrl()` throws for an
  empty ASIN — both are guaranteed-dead links, so the mistake surfaces as a
  build failure instead of a production 404. Full key/ASIN shape validation
  remains `parseConfig`'s job (F12), not this helper's.
- **F9 — Response semantics.** ✅ Done — `handler.ts` returns 302 with
  `cache-control: no-store` and `x-robots-tag: noindex`; no `Referrer-Policy`
  header set, preserving the browser default as specified. `302` (not `301` — mappings and tags change),
  `Cache-Control: no-store` (geo-dependent), `X-Robots-Tag: noindex`. Rely on
  default browser referrer policy so the destination sees the linking origin
  (Amazon compliance requires the traffic source to be identifiable, §11).
- **F10 — Single-marketplace degenerate mode.** ✅ Done — explicitly covered
  by `packages/core/test/resolve.test.ts` ("single-marketplace degenerate mode
  (F10)"). With exactly one marketplace
  configured, every click resolves to it — output identical to direct linking.
  This lets a site adopt the Worker on day one with one Associates membership
  and add marketplaces later purely by editing config. Adding a marketplace
  must never require touching published content.
- **F11 — Click analytics.** ✅ Done — `handler.ts`'s `logClick()` via
  `ctx.waitUntil`, optional (no-op without a binding), wrapped in try/catch,
  dimensions match spec exactly. One Analytics Engine data point per click:
  dimensions `country`, `marketplaceResolved`, `productKey` (or raw ASIN),
  `resolutionReason` (`direct` | `fallback-no-tag` | `fallback-unavailable` |
  `unknown-country` | `raw-asin`), `uaClass` (`desktop` | `mobile` | `bot`);
  metric: count. Analytics is **optional**: no AE binding configured → skip
  logging, never fail the redirect. Redirect first, log via `ctx.waitUntil`.
  Status (2026-07-19): only `GET` requests are logged as clicks —
  HEAD/OPTIONS/POST still get the redirect but are treated as prefetch/
  preflight noise, not counted — and the logged `country` blob is uppercased
  to match what `resolve()` normalizes internally (see §8).
- **F12 — Config validation.** ✅ Done — `packages/core/src/config.ts`'s
  `parseConfig()` covers every listed invariant, including reserved-key and
  cycle detection. Load-time validation with precise errors:
  default marketplace has a tag; every `availableIn`/override references a known
  marketplace; tag format sanity (warn, don't block — suffix conventions vary
  by storefront); no product key collides with reserved route segments.
  Status (2026-07-19): `createAffiliateHandler` in `packages/cloudflare/src/
  handler.ts` now runs `parseConfig` unconditionally at startup for *both*
  raw JSON and already-parsed `Config` input. A shape-sniffing heuristic that
  previously skipped validation for raw JSON already shaped like the
  documented schema was removed after review — it let malformed-but-
  schema-shaped input (e.g. a tagless default marketplace) through and
  produce untagged redirects, violating F2. `goUrl`/`goAmazonUrl` in
  `packages/core/src/go-url.ts` add a narrower, build-time backstop (see F8);
  full shape validation remains `parseConfig`'s job.

### Functional (SHOULD, v0.2+)

> **Status (2026-07-19): F13–F17 all ✅ Done.** Implemented in one pass;
> verified against `packages/core/src/config.ts`/`resolve.ts`,
> `packages/cloudflare/src/handler.ts`/`choice-page.ts`, and
> `packages/cli/src/commands/stats.ts`/`import-earnings.ts`. Curated-mode
> precedence when several features are configured on one product (documented
> here, encoded in `resolveCurated()`): **mobile deep link (F16) → choice
> page (F14) → retailer destination (F15) → Amazon waterfall (with F13
> variants)**. `parseConfig` warns when `choice: true` makes a configured
> `destination` dead config.

- **F13 — A/B variants.** ✅ Done — `ProductConfig.variants` in `config.ts`
  (record of `{ weight, asin?, asinByMarketplace? }`, weights positive and
  finite); `selectVariant()` in `resolve.ts` does a cumulative-weight walk
  over `random * totalWeight`. Randomness is injected via
  `ClickContext.random` (the adapter passes `Math.random()`; core stays pure
  per N3 — `random` omitted/out-of-range degrades deterministically to the
  first variant). The assigned variant name rides on the redirect decision
  and is logged as analytics blob 6 (empty when no variants). Stateless, no
  cookies. A variant's `asin`/`asinByMarketplace` replace the base fields
  wholesale (no per-key merge — mixing a variant's base ASIN with the base
  product's per-marketplace overrides would pair unrelated listings).
  Variants require a base `asin`, apply only to the Amazon waterfall (not to
  retailer redirects or choice pages), and never affect marketplace choice
  or availability gating. Raw-ASIN mode is unaffected.
- **F14 — Choice pages.** ✅ Done — `ProductConfig.choice: true` makes
  `resolve()` return a `{ type: 'choice', entries }` decision; entries are
  Amazon (full tag waterfall, when `asin` is set) plus every retailer with a
  URL for the visitor's country. `renderChoicePage()` in
  `packages/cloudflare/src/choice-page.ts` renders it: single self-contained
  HTML response, inline CSS only, zero scripts/external assets, light/dark
  via `color-scheme` + `prefers-color-scheme`, `rel="sponsored nofollow
  noopener"` on every link, all interpolations HTML-escaped. Served 200 with
  `no-store` + `noindex` (same posture as redirects, §8). Load-time
  validation guarantees a choice page always has ≥1 entry for any country;
  a page with <2 possible destinations warns ("just a slower redirect").
  Choice views are logged with reason `choice` and an empty marketplace
  blob; the stats leak report keys on the two `fallback-*` reasons only, so
  choice traffic never reads as a leak.
- **F15 — Non-Amazon destinations.** ✅ Done — `ProductConfig.retailers`
  (record of `{ label, url?, urlByCountry? }`, http(s)-validated, `amazon`
  reserved) plus `destination: "<retailerKey>"` route `/go/<key>` to a
  per-country retailer URL: `urlByCountry[country] ?? url`, else fall back
  to the Amazon waterfall. Tag logic is bypassed by design (`{ type:
  'external' }` decision, reason `retailer`, logged as `ext:<key>`).
  `asin` is now optional — but only when the destination retailer has a
  catch-all `url` (resolution must terminate for every country, F3);
  `availableIn`/`asinByMarketplace`/`variants` without an `asin` are
  rejected as dead config.
- **F16 — Device routing.** ✅ Done — `ProductConfig.deepLinks.mobile`
  (`{ url?, urlByCountry? }`; app schemes like `myapp://…` allowed). The
  adapter classifies the UA once and injects `ClickContext.device`; core
  does no UA parsing. For `device === 'mobile'`, a resolvable deep link
  wins over everything else (that is what deep links are for);
  no URL for the visitor's country → normal resolution (opportunistic, never
  an error). Logged as `ext:mobile` with reason `mobile-deeplink`. Bots and
  desktop always get the web flow.
- **F17 — Earnings correlation.** ✅ Done — `tagflow import-earnings
  <report.csv> [config-path]` (`packages/cli/src/commands/import-earnings.ts`
  + pure parser in `src/earnings/report.ts`): parses Associates
  earnings/orders reports (CSV or TSV, RFC 4180 quoting, preamble-line and
  header/column sniffing, US + European number formats, several date
  formats), aggregates per tracking tag, maps tags → marketplaces via
  `config.tags` (unknown tags surface as `?` with a warning), and joins
  clicks from the AE SQL API over the report's date range for a
  clicks-vs-orders/conv% view per marketplace. Click join degrades
  gracefully (missing credentials, API errors, `--no-clicks` → earnings-only
  view, still exit 0). Currency-mixing guard: the totals row only sums
  earnings when all rows share one marketplace; conv% is `—` when a tag maps
  to more than one marketplace (ambiguous join).

### Non-functional

> **Status (2026-07-18): N1–N5 all ✅ Done.**

- **N1 — Free-tier fit.** ✅ Done — no I/O/KV/D1 in `resolve()` (pure map
  lookups); free-tier numbers documented in README and `wrangler.jsonc`. Everything runs on the Workers free plan: ≤10 ms CPU
  per request budget (typical resolution should be well under 1 ms — one map
  lookup chain, no I/O), config bundled at build time (no KV/D1 dependency in
  v0.1; KV-backed config MAY be an opt-in adapter later).
- **N2 — Privacy by design.** ✅ Done — no cookies/localStorage/PII anywhere
  in `packages/cloudflare/src`; reasoning + snippet in `docs/COMPLIANCE.md`. No cookies, no localStorage, no fingerprinting,
  no PII stored. Analytics dimensions are aggregate-safe (country, not IP).
  This makes the Worker consent-banner-neutral under GDPR/ePrivacy — a
  headline feature for EU-based publishers; document the reasoning, and keep
  it true (adding a "convenient" cookie later would silently create a consent
  obligation for every downstream site).
- **N3 — Core purity.** ✅ Done — `packages/core/package.json` has zero
  runtime dependencies; no `Date.now()`/`Math.random()`/I/O in `resolve.ts` or
  `config.ts`. `core` package: zero dependencies, no Cloudflare
  imports, no I/O, no `Date.now()`/randomness in `resolve()` (A/B randomness
  is injected). Fully unit-testable in plain vitest.
- **N4 — Strict TypeScript, ESM-only, exact-pinned dependencies** (no `^`/`~`),
  Node ≥ 20 for tooling, `wrangler` v4 for the template. ✅ Done — verified
  across every `package.json` in the repo: exact versions throughout,
  `"type": "module"` everywhere, `"engines": {"node": ">=20"}` set,
  `wrangler: "4.110.0"`.
- **N5 — SEO safety.** ✅ Done — `x-robots-tag: noindex` in `handler.ts`;
  `rel="sponsored nofollow"` guidance and a `robots.txt` snippet in
  `docs/COMPLIANCE.md`, used live in the Astro example. Redirect paths carry `rel="sponsored nofollow"` guidance
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
      // A/B variants (F13): weighted, stateless per click; a variant's asin
      // fields replace the base fields wholesale. Assigned variant name is
      // logged as the `variant` analytics dimension.
      "variants": {
        "control": { "weight": 3 },
        "new-listing": { "weight": 1, "asin": "B0ZZZZZZZZ" }
      },
      // Non-Amazon retailers (F15) — also the entries of a choice page (F14).
      "retailers": {
        "bol": {
          "label": "Bol.com",
          "url": "https://www.bol.com/nl/p/…",
          "urlByCountry": { "BE": "https://www.bol.com/be/p/…" }
        }
      },
      // Route /go/flagship-product to a retailer instead of Amazon (F15).
      // Falls back to the Amazon waterfall when the retailer has no URL for
      // the visitor's country. Default: "amazon".
      "destination": "amazon",
      // Render a multi-retailer choice page instead of redirecting (F14).
      "choice": false,
      // Mobile visitors get this instead, when a URL resolves (F16).
      // App schemes allowed.
      "deepLinks": { "mobile": { "url": "amzn://…" } }
    }
  }
}
```

`asin` may be omitted only when `destination` names a retailer with a
catch-all `url` (resolution must terminate for every country). Feature
precedence per product: deep link (mobile) → choice → destination →
Amazon waterfall.

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

`resolve(ctx, config)` where `ctx = { country?, path, userAgent?, device?,
random? }` — `device` is the adapter's UA classification (core does no UA
parsing) and `random` is an injected uniform number in [0, 1) (core has no
randomness, N3):

1. **Parse route.** `/go/<productKey>` (curated) or `/go/amazon/<asin>` (raw).
   Unknown product key → `404` decision (host site's 404, or JSON in
   standalone mode). Reserved segment `amazon` cannot be a product key (F12).
1a. **Mobile deep link (F16).** `device === 'mobile'` and
   `deepLinks.mobile` resolves a URL for the country → `external` decision,
   reason `mobile-deeplink`. Otherwise fall through.
1b. **Choice page (F14).** `choice: true` → `choice` decision with one entry
   per resolvable destination (Amazon via the waterfall below, retailers via
   their country URL). Variants do not apply on choice pages.
1c. **Retailer destination (F15).** `destination` names a retailer →
   `urlByCountry[country] ?? url` → `external` decision, reason `retailer`;
   no URL for this country → continue with the Amazon waterfall.
2. **Candidate marketplace** = `countryOverrides[country]` ??
   `COUNTRY_TO_MARKETPLACE[country]` ?? `defaultMarketplace`.
3. **Gate chain.** A marketplace passes if it has a tag AND (curated mode) the
   product is listed in `availableIn`. On failure, try
   `marketplaceFallbacks[candidate]`, then `defaultMarketplace`. Record which
   gate failed as `resolutionReason`. (Chain is ≤3 hops by construction; no
   loops possible since fallbacks are validated non-cyclic at load.)
4. **Raw-ASIN mode** skips the availability gate and applies `unknownAsin`
   policy at step 2. Variants, deep links, retailers and choice pages never
   apply in raw mode.
5. **Variant + ASIN selection (F13)**: pick the variant by cumulative weight
   against `random * totalWeight` (insertion order fixes the walk; same
   `random` → same variant). Effective fields: a variant's
   `asin`/`asinByMarketplace` replace the base fields wholesale. Then
   `asinByMarketplace[final] ?? asin`.
6. **Decision**: `{ url: "https://www.amazon.<domain>/dp/<asin>?tag=<tag>",
   marketplace, resolutionReason, productKey, variant? }`. URL-encode ASIN
   and tag.

Property tests worth writing: resolution is total (never throws for any
country string), always returns a tagged Amazon URL for known products,
respects `availableIn` exactly, and is pure (same input → same output —
`random` is part of the input).

## 8 · Cloudflare adapter (spec)

- `createAffiliateHandler(config, opts)` runs `parseConfig` on `config`
  unconditionally at startup — whether `config` is raw JSON or an
  already-parsed `Config` object — never per request. There is no
  shape-sniffing fast path that skips validation; a config that merely
  *looks* schema-shaped still gets full invariant checking (F12).
- Extract country from `request.cf?.country`, uppercased once at the top of
  the handler so the value logged to Analytics Engine matches what
  `resolve()` normalizes internally; UA class from a minimal
  UA heuristic (goal: bot flagging for analytics, not perfect detection —
  do not add a UA-parser dependency).
- Match prefix; non-matching path → return `null` (mounted mode contract).
- Build `Response.redirect(decision.url, 302)` with headers per F9.
- `ctx.waitUntil(logClick(env.CLICKS, decision, ctx))` — never block or fail
  the redirect on analytics errors (F11). Only `GET` requests write an
  Analytics Engine data point; `HEAD`/`OPTIONS`/`POST` etc. still receive the
  302 but are treated as prefetch/preflight noise rather than visitor clicks
  and are not logged.
- Bot policy (`opts.bots`): `"redirect"` (default; logged with `uaClass=bot`)
  or `"ignore"` (redirect but skip logging).
- The handler injects `device` (its UA classification) and `random`
  (`Math.random()`) into `resolve()` — F16 routing and F13 assignment live
  in core, but the impurity stays in the adapter (N3). `external` decisions
  get the same 302 + headers as Amazon redirects; `choice` decisions are
  served 200 `text/html` from `renderChoicePage()` with the same
  `no-store`/`noindex` posture.
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
  `blobs: [country, marketplace, productKey, resolutionReason, uaClass,
  variant]`, `doubles: [1]`, `indexes: [productKey]`. Since v0.2: blob 2 is
  `ext:<retailer>`/`ext:mobile` for non-Amazon redirects (F15/F16) and empty
  for choice views; blob 4 gains the values `retailer`, `mobile-deeplink`
  and `choice`; blob 6 is the A/B variant name (F13) or empty.
- Documented facts (verified 2026-07): AE is available **on the free plan** —
  100k data points written/day and 10k read queries/day; paid plan includes
  10M points/month (+$0.25/M) and 1M queries/month (+$1/M); Cloudflare is not
  yet billing for AE at all. Cite the pricing page in docs and date the claim.
- The operationally important query (shipped as `tagflow stats --leaks`,
  promote it in the README): *clicks where `resolutionReason` is
  `fallback-no-tag` or `fallback-unavailable`, grouped by product ×
  marketplace* — that is the "this listing died / this geo leaks revenue"
  monitor that paid services charge for. (Deliberately not
  `!= 'direct'`: `unknown-country`, `raw-asin` and `choice` traffic is not
  a leak.)

## 10 · CLI (spec)

> **Status (2026-07-19):** all five commands ✅ Done —
> `init`/`validate`/`check`/`stats`/`import-earnings`.

Node CLI (`npx <pkg> …`), runs on the user's machine — never in the Worker:

- **`init`** ✅ Done — `packages/cli/src/commands/init.ts`, interactive +
  flag-driven, prints the standalone-vs-mounted next steps. Scaffold `affiliate.config.json` (interactive: default
  marketplace, tags) and print the standalone-vs-mounted setup choice.
  Status (2026-07-19): when required flags (`--default`/`--tag`) are missing
  and stdin is not a TTY, `init` now fails fast with a clear error instead of
  hanging on a prompt nobody can answer (checked via `stdin.isTTY`). All
  config writes (`init`'s scaffold, `check --write`) go through
  `config-io.ts`'s atomic write — temp file in the same directory, then
  `rename()` over the target — so a crash or concurrent run can't leave a
  partially-written `affiliate.config.json`.
- **`validate`** ✅ Done — `packages/cli/src/commands/validate.ts`, non-zero
  exit on error, prints warnings. Schema + invariants (F12); non-zero exit for CI.
- **`check`** ✅ Done — `packages/cli/src/commands/check.ts` +
  `packages/cli/src/check/engines.ts`; `--write` diffing, exit code 2 on
  regression; weekly GH Action shipped at
  `templates/worker/.github/workflows/check-listings.yml`. For each product × tagged marketplace, verify the listing
  exists; update `availableIn` (with `--write`) and print a diff table;
  non-zero exit when a previously-available listing disappears (CI-able as a
  weekly GitHub Action — provide the workflow file in the template).
  - Two engines: **PA-API** (blessed path when the user has API keys) and
    **plain HTTPS probe** of the `/dp/` page from the user's own IP.
    Document clearly: the probe runs client-side at the user's own risk and
    discretion, is rate-limited with jitter, sends no affiliate tag, and must
    never be executed from Workers/datacenter infrastructure.
  - **PA-API deprecation (2026-07-19):** Amazon's PA-API documentation now
    carries the notice "PA-API will be deprecated on May 15th, 2026. Please
    migrate to Creators API" (verified live at
    `webservices.amazon.com/paapi5/documentation/faq.html`; Creators API docs
    at `affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction`).
    That date has passed. `--engine paapi` (`packages/cli/src/check/
    engines.ts`'s `createPaapiEngine`) is therefore deprecated upstream and
    may stop working without notice. The HTTPS probe engine is unaffected and
    remains the default for local runs — but note the template's weekly
    `check-listings.yml` Action uses `--engine paapi` (the probe engine must
    never run from datacenter IPs, so it is the only CI-appropriate engine),
    which means the shipped CI monitor degrades to all-`unknown` if Amazon
    turns PA-API off. Migrating `check`'s API engine from PA-API to the
    Creators API is tracked as a new v0.2 roadmap item (§13).
  - Status (2026-07-19): the probe engine no longer trusts a bare HTTP 200 as
    proof of a live listing. `classifyOkResponse()` in `engines.ts` reads the
    response body for captcha/robot-check markers and checks whether the
    final URL still contains the requested ASIN (a redirect to the
    storefront or a search page means the listing is gone); either case now
    yields `unknown` instead of a false `ok`. Both engines also accept an
    `onWarn` diagnostic callback (`EngineIo.onWarn`), wired to `console.error`
    in `check.ts`, so network errors and non-200 responses are surfaced as
    warnings instead of being silently folded into `unknown`.
- **`stats`** ✅ Done — `packages/cli/src/commands/stats.ts` on top of the
  minimal AE SQL client in `src/stats/ae.ts` (fetch injectable for tests;
  credentials via `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`, the same
  env vars wrangler uses; token needs "Account Analytics: Read"). Default
  report: clicks by marketplace × reason plus top products over `--days`
  (default 7); `--leaks` runs the §9 fallback-leak report. Counts use
  `SUM(_sample_interval)`, not `count()` — AE samples. The dataset name is
  interpolated into SQL as an identifier, so it is shape-validated
  (`isSafeDatasetName`) instead of quoted; `--days`/`--limit` are
  range-checked.
- **`import-earnings`** ✅ Done (F17) — see the F17 status in §4 for
  behavior; `packages/cli/src/commands/import-earnings.ts` + pure
  parser/aggregator in `src/earnings/report.ts`.

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

> **Status (2026-07-18):** core coverage/property/ISO tests ✅ Done; CI
> lint+typecheck+test and template smoke-deploy ✅ Done; cloudflare tests and
> cli tests 🟡 Partial (equivalent coverage, different mechanism than
> specified — see notes below); changesets release workflow ⬜ Not done.

- `core`: plain vitest; 100% branch coverage on `resolve()` is realistic and
  worth enforcing; property tests from §7; a full-ISO-coverage test for the
  country map. ✅ Done — enforced via `packages/core/vitest.config.ts`
  coverage thresholds on `src/resolve.ts`; property tests in
  `resolve.test.ts`; `country-map.test.ts` asserts all 249 ISO codes present
  with no dupes. Status (2026-07-19): `vitest.config.ts` also gates
  `config.ts` coverage now (branches 90% / lines+statements 93% floors, set
  just below actual post-fix coverage so it can't silently regress).
  Status (2026-07-19, F13–F16 landing): core suite grew 51 → 128 tests;
  `resolve.ts` branch threshold relaxed 100% → 97% for exactly three
  provably-unreachable defensive guards (enumerated in a comment in
  `vitest.config.ts`); lines/statements/functions on `resolve.ts` remain
  100%.
- `cloudflare`: `@cloudflare/vitest-pool-workers` (Workers runtime tests:
  route matching, mounted-mode `null` contract, headers, `waitUntil` logging;
  simulate `request.cf` variants including missing `cf`). 🟡 Partial —
  `packages/cloudflare/test/handler.test.ts` covers the same behaviors (route
  matching, `null` contract, headers, `waitUntil`) but via plain vitest with
  hand-mocked `Request`/`cf`/`ctx` objects, not an actual Workers runtime —
  `@cloudflare/vitest-pool-workers` is not a dependency anywhere in the repo.
  Status (2026-07-19): 29 tests after F13–F16 — choice-page rendering/
  escaping/self-containment (`choice-page.test.ts`) and handler coverage for
  choice responses, variant blobs, `ext:*` logging and deep-link routing.
- `cli`: golden-file tests for `validate`/`check` output; probe engine mocked.
  🟡 Partial — `packages/cli/test/commands.test.ts` and `engines.test.ts` are
  thorough behavioral tests (exit codes, config diffs, mocked engines) but
  assert on parsed state/exit codes rather than golden-file/snapshot
  comparisons of stdout; no fixture files exist. Status (2026-07-19): the
  suite grew from 21 to 37 tests (`commands.test.ts` 18,
  `config-io.test.ts` 4, `engines.test.ts` 15), adding coverage for engine
  selection, the atomic config write (§10), captcha/redirect-away
  classification in the probe engine, and a frozen golden-value test for the
  SigV4 signer (`engines.test.ts`, "matches a frozen golden signature for a
  fixed input") — still not golden-file/snapshot comparisons of CLI stdout,
  so the mechanism gap noted above stands. Status (2026-07-19, `stats` +
  `import-earnings` landing): 66 tests across 5 files (`stats.test.ts` and
  `earnings.test.ts` added; both use an injected fake `fetch` — no network).
- GitHub Actions: lint (Biome) + typecheck + test on PR; release
  via changesets → npm (provenance enabled); template repo smoke-deploy job
  with `wrangler deploy --dry-run`. Lint+typecheck+test ✅ Done and template
  smoke-deploy ✅ Done (both in `.github/workflows/ci.yml`); the
  changesets → npm release workflow is ⬜ Not done — no `.changeset`
  directory, no changesets dependency, no publish workflow exists yet (and
  none of the publishable packages have a `repository` field yet, which npm
  provenance requires — moot until a git remote exists). Status
  (2026-07-19): a `template-copyout` job was added
  (`.github/workflows/ci.yml`) that reproduces the documented user flow
  end-to-end — pack `core`/`cloudflare`/`cli` to tarballs, copy
  `templates/worker` out of the workspace, point its deps at the tarballs,
  `pnpm install`, `tsc --noEmit`, `wrangler deploy --dry-run`. The prior
  `template-smoke` job only exercised the template from inside the
  workspace, which masked a real `workspace:*`-dependency breakage for
  copied-out users; `templates/worker/package.json` now pins exact versions
  (`0.1.0`) instead of `workspace:*` and ships a self-contained `tsconfig.json`
  (no `extends` into the monorepo) so it builds standalone. In-repo installs
  still link via `pnpm-workspace.yaml`'s `linkWorkspacePackages: true`.

## 13 · Roadmap

| Version | Status | Scope |
|---|---|---|
| **v0.1** | ✅ Done | F1–F12, N1–N5; `core` + `cloudflare` + `cli init/validate/check`; standalone template + mounted Astro example; README + compliance doc. Ship when the mounted example runs on a real site. Exit criterion met — the Astro mounted example is built and runnable (`examples/astro-static-assets`). Remaining v0.1-adjacent gaps: changesets release workflow, Workers-runtime tests via `vitest-pool-workers`, and CLI golden-file tests (see §12) are not yet done but were not v0.1 MUSTs. Status (2026-07-19): the copied-out-template gap closed — `template-copyout` CI job + exact-pinned `templates/worker` deps (see §12) now prove the documented user flow works outside the workspace. |
| **v0.2** | 🟡 Feature-complete (2026-07-19) | `stats` CLI + fallback-leak report ✅; A/B variants (F13) ✅; choice pages (F14) ✅. Remaining: migrate `check`'s API engine from PA-API to the Creators API (§10, §15 — PA-API's deprecation date has passed), and the release plumbing (changesets → npm) before anything can actually ship as 0.2.0. |
| **v0.3** | 🟡 Feature-complete (2026-07-19) | Non-Amazon destinations (F15) ✅; device routing (F16) ✅; earnings import (F17) ✅. Implemented alongside v0.2 — one config-schema change instead of two. |
| **v1.0** | ⬜ Not started | API freeze, schema `v1` frozen, docs site. |
| Post-1.0 (maybe) | ⬜ Not started | Read-only stats dashboard (static page over AE API, Sink-style); KV-backed config adapter for no-rebuild updates. |

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
- **PA-API deprecation (verified live 2026-07-19):** Amazon's PA-API
  documentation carries the notice "PA-API will be deprecated on May 15th,
  2026. Please migrate to Creators API"
  (`webservices.amazon.com/paapi5/documentation/faq.html`; Creators API docs:
  `affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction`). That
  date has passed. `check`'s `--engine paapi` path (§10) is deprecated
  upstream and may stop working; the HTTPS probe engine is unaffected and
  remains the default; migrating to the Creators API is a v0.2 roadmap item
  (§13).
