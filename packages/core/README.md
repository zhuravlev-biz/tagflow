# @tagflow/core

Pure resolution engine for localized Amazon affiliate links: config schema,
country-to-marketplace map for all 249 ISO countries, and deterministic
fallback resolution across all 21 Amazon storefronts.

**Zero dependencies.** No `node:` builtins either — pure functions that run
anywhere JavaScript does: Cloudflare Workers, Node, Deno, Bun, the browser.

This is the engine underneath [TagFlow](https://github.com/zhuravlev-biz/tagflow),
a free, self-hosted alternative to Amazon OneLink and Geniuslink. Most users
want [`@tagflow/cloudflare`](https://www.npmjs.com/package/@tagflow/cloudflare)
(the ready-made Worker handler) rather than this package directly — reach for
`@tagflow/core` when you're building your own integration.

## What it does

Given a click context (country, path) and your config, `resolve()` decides —
purely, totally, never throwing — where that click should go:

```ts
import { parseConfig, resolve, goUrl } from '@tagflow/core'

const parsed = parseConfig(rawJson) // schema + invariant validation
if (!parsed.ok) throw new Error(parsed.errors.map((e) => `${e.path}: ${e.message}`).join('\n'))

// path is relative to your mount prefix (the /go part is the adapter's job)
const decision = resolve({ country: 'DE', path: '/flagship-product' }, parsed.config)
// {
//   type: 'redirect',
//   url: 'https://www.amazon.de/dp/B0YYYYYYYY?tag=yourtag0d-21',
//   marketplace: 'de',
//   resolutionReason: 'direct',
//   productKey: 'flagship-product',
// }

goUrl('flagship-product') // "/go/flagship-product" — for your templates
```

Same input → same output; a validated config can never emit an untagged
Amazon URL, and every known product terminates on a valid destination —
explicit, configured fallbacks instead of OneLink's opaque "similar product"
matching.

## Exports

- `resolve(ctx, config)` — the decision function: redirect / external
  retailer / choice page / not-found, with a `resolutionReason` you can log
- `parseConfig(raw)` — validation with precise, path-qualified issues
- `COUNTRY_TO_MARKETPLACE`, `marketplaceForCountry` — 249 ISO codes → the
  storefront that actually serves them (PT → es, IE → co.uk, NZ → com.au, …)
- `MARKETPLACE_IDS`, `AMAZON_DOMAINS`, `isMarketplaceId` — the 21 storefronts
- `goUrl`, `goAmazonUrl` — link builders for your site templates
- `parseAmazonUrl`, `withAffiliateTag` — pure URL helpers for click-time
  tagging (e.g. from a browser extension); see below

### `parseAmazonUrl` / `withAffiliateTag`

For code that meets a raw Amazon URL rather than building one from a
config — a browser extension acting on the page the visitor is already on,
say. Both are pure and dependency-free (no Node APIs; safe in a browser or
service worker) and never throw.

```ts
import { parseAmazonUrl, withAffiliateTag } from '@tagflow/core'

parseAmazonUrl('https://www.amazon.de/Some-Widget/dp/B0YYYYYYYY?tag=old-21')
// { marketplace: 'de', asin: 'B0YYYYYYYY', tag: 'old-21' }

parseAmazonUrl('https://notamazon.de/dp/B0YYYYYYYY') // null — not a real storefront

withAffiliateTag('https://www.amazon.de/dp/B0YYYYYYYY', parsed.config)
// { url: '...?tag=yourtag0d-21', applied: true, reason: 'applied' }
```

`withAffiliateTag` looks up `config.tags[marketplace]` and **never
overwrites an existing tag** — there is no option to. `reason` is always one
of `applied`, `has-own-tag`, `has-other-tag`, `no-tag-for-marketplace`, or
`not-amazon`, so a caller always knows why nothing changed.

These are read-only classifiers, not a policy engine: they don't decide
*when* to tag a link. Call them only right after an explicit user action —
see [`docs/COMPLIANCE.md`](https://github.com/zhuravlev-biz/tagflow/blob/main/docs/COMPLIANCE.md#browser-extensions)
for why.

## Documentation

Full docs, config reference, Worker quickstart and compliance notes:
**[github.com/zhuravlev-biz/tagflow](https://github.com/zhuravlev-biz/tagflow)**

MIT. Unaffiliated with Amazon and Cloudflare.
