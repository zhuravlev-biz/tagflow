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

## Documentation

Full docs, config reference, Worker quickstart and compliance notes:
**[github.com/zhuravlev-biz/tagflow](https://github.com/zhuravlev-biz/tagflow)**

MIT. Unaffiliated with Amazon and Cloudflare.
