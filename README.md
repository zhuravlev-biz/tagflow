# TagFlow

**One affiliate link per product, localized at the edge, on Cloudflare infrastructure — $0/mo on the Cloudflare free tier.**

> Unaffiliated with Amazon and Cloudflare.

A visitor clicks `yoursite.com/go/flagship-product`. The Worker reads the
country Cloudflare already resolved, picks the right Amazon storefront, the
right ASIN for that storefront, and the affiliate tag you configured *for
that marketplace* — then 302s. Explicit, configured fallbacks instead of
Amazon OneLink's opaque "similar product" matching or search-page dumps.

```
DE visitor → /go/flagship-product → 302 https://www.amazon.de/dp/B0YYYYYYYY?tag=yourtag0d-21
US visitor → /go/flagship-product → 302 https://www.amazon.com/dp/B0XXXXXXXX?tag=yourtag-20
?? visitor → /go/flagship-product → 302 to your default marketplace, always tagged
```

## Why

| | Amazon OneLink | Others | **TagFlow** |
|---|---|---|---|
| Cost | free | ~$6+/mo | **$0** (Cloudflare free tier) |
| Exact-match miss | no redirect / wrong product / search dump | ok | **your configured fallback** |
| Click path | Amazon-controlled | third-party SaaS | **your own domain + Worker** |
| Coverage | ~13 storefronts | wide | all 21 storefronts, config decides |
| Analytics | opaque | paid tiers | **Workers Analytics Engine, free** |
| Source | closed | closed | **MIT** |

Free-tier fit, verified 2026-07: 100k Worker requests/day, geo lookup
(`request.cf.country`) on all plans, Analytics Engine 100k points/day
written + 10k queries/day. Sub-millisecond resolution — one map-lookup
chain, no I/O.

## Quickstart

### A. Standalone Worker (60 seconds)

```sh
cp -r templates/worker my-links && cd my-links
npx tagflow init        # default marketplace + tags, interactively
npx wrangler deploy
```

### B. Mounted inside your existing Worker (Astro, Next, any static site on Workers)

Your site is already a Worker with static assets? The router mounts in front
of it — no second zone, domain, or deployment:

```ts
import config from './affiliate.config.json'
import { createAffiliateHandler } from '@tagflow/cloudflare'

const affiliate = createAffiliateHandler(config)

export default {
  async fetch(request, env, ctx) {
    return (await affiliate(request, env, ctx)) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
```

Non-`/go` paths — and unknown product keys — fall through to your site
untouched. See [examples/astro-static-assets](examples/astro-static-assets).

### Links in your templates

```ts
import { goUrl } from '@tagflow/core'

goUrl('flagship-product')          // "/go/flagship-product"
goAmazonUrl('B0XXXXXXXX')         // "/go/amazon/B0XXXXXXXX" (one-off, no product entry)
```

#### What if a product isn't in the config?

There are two link shapes, and only the curated one needs a `products` entry:

- **Curated — `/go/<product-key>`.** Pure config lookup. If the key isn't in
  `products`, resolution returns *not-found* and the handler emits **no
  redirect**. In **mounted** mode the request falls through to your site (your
  own 404 or page); in **standalone** mode you get a JSON `404`. So a
  `goUrl('new-product')` link is **dead until you add the entry** — adding the
  product to your site alone is not enough.
- **Raw ASIN — `/go/amazon/<asin>`.** Deliberately does **not** touch
  `products`. Any valid ASIN (exactly 10 chars, `A–Z`/`0–9`) redirects with no
  config change — this is the escape hatch for one-off links.

So yes: **a raw `/go/amazon/<asin>` link works even when the product isn't
configured.** But going raw trades away three things the curated entry gives
you:

1. **Per-marketplace ASIN overrides** (`asinByMarketplace`). Raw mode sends the
   *same* ASIN to every storefront — wrong if a third-party listing has a
   different ASIN abroad.
2. **Availability fallback** (`availableIn`). Raw mode can't know where the item
   is listed, so it can't route around a missing listing. It instead obeys the
   top-level `unknownAsin` policy: `"geo"` geo-routes and hopes, `"default"`
   sends everyone to `defaultMarketplace`.
3. **A stable, pretty URL** you can point the ASIN somewhere else later without
   touching published links.

Rule of thumb: one-off mention → `goAmazonUrl`. Anything you link more than
once, or that sells cross-marketplace → add it to `products` and use `goUrl`.

Start with **one** marketplace and one Associates membership: with a single
marketplace configured, every click resolves to it — identical to direct
linking. Add marketplaces later purely by editing config; published content
never changes.

## Config

```jsonc
{
  "defaultMarketplace": "es",
  "tags": {
    "es": "yourtag-21",
    "com": "yourtag-20",
    "de": "yourtag0d-21"
  },
  "countryOverrides": { "CH": "de" },        // wins over the built-in map
  "marketplaceFallbacks": { "co.uk": "de" }, // tried when a gate fails
  "unknownAsin": "default",                  // raw-ASIN policy: "geo" | "default"
  "products": {
    "flagship-product": {
      "asin": "B0XXXXXXXX",
      "asinByMarketplace": { "de": "B0YYYYYYYY" },
      "availableIn": ["es", "de", "com"]
    }
  }
}
```

Resolution per click: country → candidate marketplace (your override → the
built-in curated map → default) → gates (has a tag? product available
there?) → on failure walk candidate → configured fallback → default. Always
terminates on a valid, tagged URL. Never an untagged link, never a tag on
the wrong marketplace, never a search page.

The built-in map encodes real serving relationships (`PT → es`, `AT/CH → de`,
`IE → co.uk`, `NZ → com.au`, Gulf states → `ae`, Nordics → `se`, …) for all
249 ISO countries.

## CLI

```sh
npx tagflow init       # scaffold affiliate.config.json
npx tagflow validate   # schema + invariants; non-zero exit for CI
npx tagflow check      # verify every product × marketplace listing exists
```

`check` is the revenue-leak monitor paid services charge for: it verifies
each listing via the Creators API (with your credentials) or a rate-limited
client-side HTTPS probe, updates `availableIn` with `--write`, and exits
non-zero when a previously-available listing died. The template ships a
weekly GitHub Action for it.

> Note (2026-07-19): PA-API was retired by Amazon on 2026-05-15; `check` now
> talks to its successor, the Creators API, via `--engine creatorsapi`
> (`CREATORSAPI_CREDENTIAL_ID`/`CREATORSAPI_CREDENTIAL_SECRET` env vars —
> create these under Associates Central → Tools → Creators API). The old
> `--engine paapi` is rejected with a pointer to the new flag. The HTTPS
> probe engine is unaffected and remains the default when no credentials are
> set.

## Analytics

One Analytics Engine data point per click — `country`, `marketplace`,
`productKey`, `resolutionReason`, `uaClass` — logged after the redirect via
`waitUntil`, never blocking it. No binding configured → no logging, redirects
unaffected. The query that matters (clicks where
`resolutionReason != 'direct'`, by product × marketplace) tells you which
listing died and which geo leaks revenue.

**Privacy by design:** no cookies, no fingerprinting, no PII — country-level
aggregates only. That keeps the Worker consent-banner-neutral under
GDPR/ePrivacy. See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Compliance defaults (encoded, not just documented)

- 302 (not 301), `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
- Default referrer policy preserved — Amazon sees which site sent the click.
- `/go/amazon/<asin>` route says "amazon" out loud; label CTAs "View on
  Amazon"; `rel="sponsored nofollow"` on links; robots.txt disallows `/go/`.
- Each `tags` entry needs *your enrollment in that storefront's Associates
  program* — the router routes clicks, it cannot create payouts.
- No price display, ever (Operating Agreement); no interstitials.

Full reasoning: [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Repository layout

| Path | What |
|---|---|
| [packages/core](packages/core) | Pure resolution engine, config schema, `goUrl()` — zero deps, no I/O |
| [packages/cloudflare](packages/cloudflare) | `createAffiliateHandler()` Worker adapter |
| [packages/cli](packages/cli) | `tagflow init / validate / check` |
| [templates/worker](templates/worker) | Standalone template — `wrangler deploy` and done |
| [examples/](examples/) | Standalone + Astro mounted-mode examples |
| [docs/DESIGN.md](docs/DESIGN.md) | Founding design doc (spec, roadmap, prior art) |

Not this project's lane: arbitrary-URL shortening ([Sink](https://github.com/ccbikai/Sink),
[Dub](https://dub.co)), price display, hosted anything.

## Development

```sh
pnpm install
pnpm build && pnpm test && pnpm typecheck
```

Strict TypeScript, ESM-only, exact-pinned deps, Node ≥ 20, `core` at 100%
branch coverage on `resolve()`.

## License

[MIT](LICENSE)
